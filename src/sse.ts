// Server-Sent Events broker. Local subscribers are kept in-memory keyed by userId.
// When REDIS_URL is set, a Redis pub/sub backplane fans events out across ALL app
// instances (pm2 cluster / multiple pods) so a publish on instance A reaches a
// client connected to instance B — otherwise notifications and session-revoke
// events are silently lost across processes. Without Redis it behaves exactly as
// the previous single-process in-memory broker.

import type { Redis } from "ioredis";
import type { Request, Response } from "express";
import { sseClients, sseBackplaneUp, sseBackplaneErrors } from "./observability.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const subscribers = new Map<number, Set<Response>>(); // userId -> Set<res>
const CHANNEL = "sse:events";
let pub: Redis | null = null; // Redis publisher (null = in-memory only)

function recountClients() {
  let n = 0;
  for (const s of subscribers.values()) n += s.size;
  sseClients.set(n);
}

/**
 * ÁP LỰC NGƯỢC. `res.write` trả `false` khi bộ đệm đã đầy, nhưng giá trị đó trước đây bị bỏ qua —
 * nên một client đọc chậm, hay một socket đã chết mà không gửi FIN (chuyện thường qua tunnel/NAT),
 * làm mọi sự kiện tiếp theo dồn vào bộ đệm TRONG TIẾN TRÌNH, không giới hạn. SSE là dữ liệu gợi ý
 * làm mới màn hình: mất vài sự kiện thì client tự re-fetch, còn phình bộ nhớ thì kéo sập cả app.
 *
 * Huỷ socket thay vì chỉ bỏ ghi: `res.destroy()` làm `req` phát "close", nên phần dọn dẹp trong
 * `attach` chạy đúng như khi người dùng đóng tab — không cần đường dọn thứ hai.
 */
export const SSE_MAX_BUFFER = Number(process.env.SSE_MAX_BUFFER) || 1_000_000;
function ghiAnToan(res: Response, payload: string): boolean {
  const dem = (res as unknown as { writableLength?: number }).writableLength ?? 0;
  if (dem > SSE_MAX_BUFFER) {
    try { res.destroy(); } catch { /* đã hỏng sẵn */ }
    return false;
  }
  try { return res.write(payload) !== false; } catch { return false; /* socket gone */ }
}

// --- delivery to THIS process's connections only ---
function localPublish(userId: number, event: string, data: unknown) {
  const set = subscribers.get(userId);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  for (const res of [...set]) ghiAnToan(res, payload); // sao chép: ghiAnToan có thể gỡ phần tử
}
function localBroadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  for (const set of [...subscribers.values()]) {
    for (const res of [...set]) ghiAnToan(res, payload);
  }
}

// --- optional Redis backplane ---
// On every instance: PUBLISH goes to Redis; a dedicated subscriber receives the
// message (on this instance too) and delivers it to local connections. So publish
// must NOT also deliver locally when Redis is active — the subscriber handles it.
/**
 * Options ioredis TÁCH THEO VAI TRÒ. Trước đây publisher và subscriber dùng CHUNG
 * `{ maxRetriesPerRequest: null }` — tức "thử lại vô hạn", cộng hàng đợi offline mặc định.
 *
 * Với subscriber thì đúng: đó là kết nối dài, phải tự nối lại và chờ được.
 * Với publisher thì SAI, và src/queue.ts:19-29 đã viết hẳn một đoạn dài về đúng cái bẫy này: PUBLISH
 * của SSE là bắn-và-quên trên đường xử lý request. Redis chết mà xếp hàng vô hạn thì hàng đợi offline
 * của ioredis phình trong bộ nhớ, còn sự kiện thì dù sao cũng đã lỗi thời khi Redis sống lại. Thà
 * TRƯỢT NHANH và mất sự kiện — client vẫn tự re-fetch khi tương tác.
 */
export function backplaneOptions(vaiTro: "pub" | "sub") {
  if (vaiTro === "sub") return { maxRetriesPerRequest: null, enableReadyCheck: false } as const;
  return { maxRetriesPerRequest: 2, enableReadyCheck: false, enableOfflineQueue: false, commandTimeout: 1000 } as const;
}

if (config.REDIS_URL) {
  (async () => {
    try {
      const { default: IORedis } = await import("ioredis");
      const pubClient: Redis = new (IORedis as any)(config.REDIS_URL, backplaneOptions("pub"));
      pub = pubClient;
      pubClient.on("error", (e: any) => { sseBackplaneUp.set(0); logger.warn({ err: e.message }, "sse redis pub error"); });
      // PHẢI CÓ ĐƯỜNG VỀ 1. Không có handler này thì MỘT lỗi thoáng qua (ECONNRESET khi Redis
      // restart) ghim gauge ở 0 VĨNH VIỄN dù backplane đã khoẻ lại — và một cảnh báo kêu mãi là
      // một cảnh báo bị người trực tắt đi. ioredis phát "ready" sau mỗi lần nối lại thành công.
      pubClient.on("ready", () => sseBackplaneUp.set(1));
      const sub = new (IORedis as any)(config.REDIS_URL, backplaneOptions("sub"));
      sub.on("error", (e: any) => { sseBackplaneUp.set(0); logger.warn({ err: e.message }, "sse redis sub error"); });
      await sub.subscribe(CHANNEL);
      sub.on("message", (_chan: string, raw: string) => {
        try {
          const m = JSON.parse(raw);
          if (m.userId != null) localPublish(m.userId, m.event, m.data);
          else localBroadcast(m.event, m.data);
        } catch { /* ignore malformed */ }
      });
      sseBackplaneUp.set(1);
      logger.info("SSE Redis pub/sub backplane enabled");
    } catch (e) {
      pub = null;
      sseBackplaneUp.set(0);
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, "SSE Redis backplane init failed — falling back to in-memory");
    }
  })();
} else {
  // KHÔNG CẤU HÌNH REDIS KHÔNG PHẢI LÀ HỎNG.
  //
  // Chạy một tiến trình duy nhất, không backplane, là cấu hình hợp lệ (xem đầu file: "Without Redis
  // it behaves exactly as the previous single-process broker"). Trước đây gauge chỉ được `.set(1)`
  // bên trong nhánh có REDIS_URL, nên mọi bản triển khai như vậy báo `sse_backplane_up 0` ngay từ
  // giây đầu — báo động giả vĩnh viễn. Số này đo "đường phát realtime có đang hoạt động không",
  // và ở chế độ một tiến trình thì nó đang hoạt động.
  sseBackplaneUp.set(1);
}

/**
 * Trần số kết nối SSE ĐỒNG THỜI của MỘT tài khoản. Không có trần thì `attach` nhận vô hạn: mỗi kết
 * nối là một `Response` giữ mãi cộng một `setInterval` keepalive, và dọn dẹp chỉ xảy ra khi client
 * đóng — nên socket chết không FIN tích lại cho tới lần restart. Đặt rộng rãi so với nhu cầu thật
 * (vài tab mỗi người) để không ai đang làm việc bị chặn oan; đây là chốt chặn lạm dụng, không phải
 * hạn ngạch. Nới bằng SSE_MAX_PER_USER nếu có nhu cầu thật.
 */
export const SSE_MAX_PER_USER = Number(process.env.SSE_MAX_PER_USER) || 10;

export function attach(req: Request, res: Response, userId: number) {
  // KIỂM TRẦN TRƯỚC khi đặt header: đã flushHeaders với text/event-stream thì không còn trả 429 được.
  const daCo = subscribers.get(userId);
  if (daCo && daCo.size >= SSE_MAX_PER_USER) {
    res.status(429).json({ error: "Quá nhiều kết nối realtime — đóng bớt tab rồi thử lại", code: "sse_too_many" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // nginx
  res.flushHeaders?.();
  res.write(`: connected\n\n`);

  let set = subscribers.get(userId);
  if (!set) { set = new Set(); subscribers.set(userId, set); }
  set.add(res);
  recountClients();

  // Keepalive every 25s
  const ka = setInterval(() => {
    ghiAnToan(res, `: keepalive\n\n`);
  }, 25_000);

  req.on("close", () => {
    clearInterval(ka);
    set.delete(res);
    if (set.size === 0) { subscribers.delete(userId); clearUserPresence(userId); } // đóng hết tab → gỡ presence
    recountClients();
  });
}

/**
 * Đóng MỌI kết nối SSE đang mở. Gọi khi tắt máy chủ có kiểm soát.
 *
 * VÌ SAO CẦN: `server.close()` chờ MỌI kết nối đang mở kết thúc. Kết nối SSE thì theo thiết kế là
 * KHÔNG BAO GIỜ kết thúc — nên callback của `server.close()` không bao giờ chạy, và tiến trình chỉ
 * thoát nhờ bộ đếm giờ cưỡng bức 10 giây, với mã thoát 1. Hệ quả: mỗi lần deploy đều là một lần
 * tắt CỨNG (request đang dở bị cắt), và orchestrator thấy mã thoát 1 nên coi như container hỏng.
 *
 * Gửi một sự kiện `shutdown` trước khi đóng để client biết mà kết nối lại, thay vì im lặng ngắt.
 */
export function closeAllSse() {
  let n = 0;
  for (const set of subscribers.values()) {
    for (const res of set) {
      // end() phải nằm trong try RIÊNG: nếu write hỏng (EPIPE — socket đã chết ở đầu bên kia) mà
      // gộp chung một try thì end() bị bỏ qua và socket ở lại trong danh sách của Node, đúng cái
      // mà hàm này sinh ra để dọn.
      try { res.write(`event: shutdown\ndata: {}\n\n`); } catch { /* socket đã hỏng */ }
      try { res.end(); n++; } catch { /* đã đóng rồi */ }
    }
  }
  subscribers.clear();
  recountClients();
  return n;
}

/**
 * PUBLISH hỏng thì RƠI VỀ PHÁT CỤC BỘ, không chỉ đếm rồi bỏ.
 *
 * Bản trước đếm lỗi và hạ gauge, nhưng dừng ở đó — và `pub` không bao giờ được đặt lại về null.
 * Nghĩa là khi Redis chết, mọi sự kiện realtime biến mất KỂ CẢ với client đang nối vào CHÍNH tiến
 * trình này, dù danh sách `subscribers` nằm ngay trong bộ nhớ và phát được ngay. Đó là hỏng rộng
 * hơn cần thiết: mất backplane lẽ ra chỉ mất đồng bộ GIỮA các instance.
 *
 * ĐÁNH ĐỔI đã cân: nếu Redis nhận được lệnh nhưng phản hồi bị mất (lệnh vẫn tới subscriber) thì
 * client cùng tiến trình nhận sự kiện HAI LẦN. Vô hại ở đây — mọi sự kiện SSE là gợi ý làm mới, và
 * client React chỉ dùng nó để re-fetch qua API đã gác quyền. Nhân đôi một lượt re-fetch rẻ hơn
 * nhiều so với mất hẳn realtime.
 */
function roiVeCucBo(op: "publish" | "broadcast", e: unknown, phatLai: () => void) {
  sseBackplaneErrors.inc({ op });
  sseBackplaneUp.set(0);
  logger.warn({ err: e instanceof Error ? e.message : String(e) }, `sse ${op} thất bại — phát cục bộ`);
  phatLai();
}

/** Push an event to all open connections for a user (across instances when Redis is on). */
export function publish(userId: number, event: string, data: unknown) {
  if (pub) {
    // KHÔNG nuốt lỗi im lặng nữa: publisher nay trượt nhanh khi Redis chết, nên lỗi ở đây là tín
    // hiệu duy nhất cho biết realtime đang hỏng. Đếm để /metrics thấy được, thay vì `catch(() => {})`.
    pub.publish(CHANNEL, JSON.stringify({ userId, event, data })).catch((e) =>
      roiVeCucBo("publish", e, () => localPublish(userId, event, data))
    );
    return;
  }
  localPublish(userId, event, data);
}

/** Broadcast to everyone connected (across instances when Redis is on). */
export function broadcast(event: string, data: unknown) {
  if (pub) {
    pub.publish(CHANNEL, JSON.stringify({ event, data })).catch((e) =>
      roiVeCucBo("broadcast", e, () => localBroadcast(event, data))
    );
    return;
  }
  localBroadcast(event, data);
}

/**
 * Broadcast a data-change hint so every connected client refreshes the relevant
 * list view without a manual reload. The client re-fetches through the normal
 * (permission-scoped) API, so broadcasting to everyone is safe.
 *
 * KHÔNG PHÁT `id` RA NGOÀI. `broadcast` đi tới MỌI phiên đang mở, không lọc quyền, còn chỗ gọi
 * (src/db.ts) chạy sau mỗi lần ghi Quote/Customer/User — nên id thật của báo giá trước đây tới cả
 * những tài khoản không được phép đọc báo giá ấy. Nghe SSE một lúc là dựng được nhịp làm việc và
 * khoảng id. Client React (web/src/components/Shell.tsx) KHÔNG hề đọc payload — nó chỉ dùng sự kiện
 * làm tín hiệu re-fetch qua API đã gác quyền — nên bỏ id không đổi hành vi nào của giao diện.
 * Tham số vẫn giữ để chỗ gọi không phải sửa.
 */
export function emitChange(entity: string, action: string, _id?: number | string | null) {
  broadcast("changed", { entity, action });
}

/** Tell one user their session is no longer valid (locked/deactivated/deleted) → client logs out. */
export function revokeSession(userId: number, reason?: string) {
  publish(userId, "session:revoked", { reason: reason || "revoked" });
}

/** Tell one user to re-pull their capabilities (role changed) → client re-renders. */
export function refreshSession(userId: number) {
  publish(userId, "session:refresh", {});
}

// ── PRESENCE ("ai đang MỞ editor báo giá nào") ────────────────────────────────
// Tạm thời, in-memory, KHÔNG lưu DB (mất khi restart = chấp nhận được, F5 reset). quoteId → (userId
// → {name, at}). Tab đóng đột ngột → hết hạn sau PRESENCE_TTL; sweep + ngắt-SSE dọn để báo người khác.
type EditorPresence = { name: string; at: number };
const editing = new Map<number, Map<number, EditorPresence>>();
const PRESENCE_TTL = 70_000; // 70s — heartbeat client mỗi 30s, chịu được 2 nhịp lỡ

// Lọc bỏ editor hết hạn + trả danh sách hiện tại của 1 báo giá.
function freshPresence(quoteId: number): { id: number; name: string }[] {
  const m = editing.get(quoteId);
  if (!m) return [];
  const now = Date.now();
  const out: { id: number; name: string }[] = [];
  for (const [uid, v] of m) {
    if (now - v.at > PRESENCE_TTL) m.delete(uid);
    else out.push({ id: uid, name: v.name });
  }
  if (m.size === 0) editing.delete(quoteId);
  return out;
}

/**
 * Gửi cập nhật presence CHỈ tới những người đang mở đúng báo giá đó (+ người vừa rời đi, để họ dọn
 * trạng thái trên màn hình).
 *
 * TRƯỚC ĐÂY dùng `broadcast` — mọi tài khoản đang đăng nhập đều nhận `{quoteId, editing:[{id,name}]}`
 * dù không có quyền đọc báo giá ấy. Đó là rò metadata: dựng được sơ đồ ai-đang-làm-báo-giá-nào theo
 * thời gian thực, kèm HỌ TÊN, chỉ bằng cách ngồi nghe SSE. Route /presence gác quyền GHI nhưng
 * không cứu được vì kênh phát tán mới là chỗ hở. Ai đang có mặt trên báo giá đều đã qua canOnQuote
 * ở route, nên tập người nhận này đúng bằng tập được phép biết.
 */
function publishPresence(quoteId: number, list: { id: number; name: string }[], alsoNotify?: number) {
  const payload = { quoteId, editing: list };
  const seen = new Set<number>();
  for (const p of list) { if (!seen.has(p.id)) { seen.add(p.id); publish(p.id, "presence", payload); } }
  if (alsoNotify != null && !seen.has(alsoNotify)) publish(alsoNotify, "presence", payload);
}

/** open/heartbeat/close 1 editor báo giá. Trả danh sách người ĐANG sửa (đã lọc hết hạn). */
export function setPresence(quoteId: number, userId: number, name: string, action: "open" | "heartbeat" | "close"): { id: number; name: string }[] {
  let m = editing.get(quoteId);
  if (action === "close") {
    if (m) { m.delete(userId); if (m.size === 0) editing.delete(quoteId); }
  } else if (action === "heartbeat") {
    const cur = m?.get(userId);
    if (cur) cur.at = Date.now();
    else { if (!m) { m = new Map(); editing.set(quoteId, m); } m.set(userId, { name, at: Date.now() }); }
  } else { // open
    if (!m) { m = new Map(); editing.set(quoteId, m); }
    m.set(userId, { name, at: Date.now() });
  }
  const list = freshPresence(quoteId);
  // heartbeat KHÔNG đổi danh sách → khỏi bắn (giảm nhiễu); open/close thì báo những người còn lại.
  if (action !== "heartbeat") publishPresence(quoteId, list, userId);
  return list;
}

// Gỡ user khỏi MỌI báo giá khi họ ngắt kết nối SSE hẳn (đóng hết tab) → báo người còn lại ngay.
function clearUserPresence(userId: number) {
  for (const quoteId of [...editing.keys()]) {
    if (editing.get(quoteId)?.delete(userId)) publishPresence(quoteId, freshPresence(quoteId));
  }
}

// Sweep dọn editor hết hạn (tab đóng đột ngột không kịp "close") + báo lại nếu danh sách đổi.
const _presenceSweep = setInterval(() => {
  for (const quoteId of [...editing.keys()]) {
    const before = editing.get(quoteId)?.size ?? 0;
    const list = freshPresence(quoteId);
    if (list.length !== before) publishPresence(quoteId, list);
  }
}, 35_000);
(_presenceSweep as { unref?: () => void }).unref?.();
