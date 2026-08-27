// Server-Sent Events broker. Local subscribers are kept in-memory keyed by userId.
// When REDIS_URL is set, a Redis pub/sub backplane fans events out across ALL app
// instances (pm2 cluster / multiple pods) so a publish on instance A reaches a
// client connected to instance B — otherwise notifications and session-revoke
// events are silently lost across processes. Without Redis it behaves exactly as
// the previous single-process in-memory broker.

import type { Redis } from "ioredis";
import type { Request, Response } from "express";
import { sseClients, sseBackplaneUp, sseBackplaneErrors, sseBackplaneMode, sseEvents, sseReconnects } from "./observability.js";
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

/**
 * CHUẨN HOÁ nhãn `event` của metric `sse_events` về một tập HỮU HẠN.
 *
 * `publish`/`broadcast` là hàm EXPORT: chỗ gọi mới có thể truyền tên sự kiện dựng động (ghép id,
 * ghép tên người dùng…). Lấy thẳng tham số làm nhãn Prometheus là công thức nổ cardinality — mỗi
 * giá trị nhãn là một chuỗi thời gian riêng, và không có gì trong repo chặn được điều đó ở chỗ gọi.
 * Tập dưới đây là ĐÚNG những tên đang được phát (grep `publish(`/`broadcast(` toàn src/), phần còn
 * lại gộp vào "khac" — mất chi tiết ở một sự kiện lạ, đổi lại không bao giờ giết được Prometheus.
 */
const TEN_SU_KIEN = new Set(["changed", "notification", "presence", "session:refresh", "session:revoked", "shutdown"]);
const nhanSuKien = (event: string) => (TEN_SU_KIEN.has(event) ? event : "khac");

// --- delivery to THIS process's connections only ---
function localPublish(userId: number, event: string, data: unknown) {
  const set = subscribers.get(userId);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  const nhan = nhanSuKien(event);
  // ĐẾM LẦN GHI THÀNH CÔNG, không đếm lần GỌI. Một broadcast tới 50 tab là 50 lần giao — đó mới là
  // khối lượng thật của đường realtime, và nó là thứ so được với `sse_clients`. Khung bị bỏ vì áp
  // lực ngược (`ghiAnToan` trả false) KHÔNG được tính: đó là sự kiện MẤT, đếm nó vào đây là tự nói
  // dối mình rằng đã giao xong.
  for (const res of [...set]) if (ghiAnToan(res, payload)) sseEvents.inc({ event: nhan }); // sao chép: ghiAnToan có thể gỡ phần tử
}
function localBroadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  const nhan = nhanSuKien(event);
  for (const set of [...subscribers.values()]) {
    for (const res of [...set]) if (ghiAnToan(res, payload)) sseEvents.inc({ event: nhan });
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
 * Với publisher thì SAI, và src/queue.ts (khối chú thích trên `maxRetriesPerRequest`) đã viết hẳn một đoạn dài về đúng cái bẫy này: PUBLISH
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
      // ⚠️ KHÔNG gán `pub` Ở ĐÂY. Xem khối "MẤT SỰ KIỆN LÚC KHỞI ĐỘNG" ngay dưới `await subscribe`.
      pubClient.on("error", (e: any) => { sseBackplaneUp.set(0); logger.warn({ err: e.message }, "sse redis pub error"); });
      // PHẢI CÓ ĐƯỜNG VỀ 1. Không có handler này thì MỘT lỗi thoáng qua (ECONNRESET khi Redis
      // restart) ghim gauge ở 0 VĨNH VIỄN dù backplane đã khoẻ lại — và một cảnh báo kêu mãi là
      // một cảnh báo bị người trực tắt đi. ioredis phát "ready" sau mỗi lần nối lại thành công.
      // Chỉ nâng gauge khi backplane ĐÃ dùng được cả hai chiều. `pub` còn null nghĩa là subscriber
      // chưa sẵn sàng, tức đang chạy cục bộ — báo up=1 lúc đó là nói dối người trực.
      pubClient.on("ready", () => { if (pub) sseBackplaneUp.set(1); });
      // Chế độ là "redis" ngay khi ĐÃ CHỌN đường Redis, không đợi "ready": cảnh báo cần phân biệt
      // "đang định dùng Redis mà nó chưa lên" với "cố ý không dùng Redis".
      sseBackplaneMode.set({ mode: "redis" }, 1);
      sseBackplaneMode.set({ mode: "local" }, 0);
      const sub = new (IORedis as any)(config.REDIS_URL, backplaneOptions("sub"));
      sub.on("error", (e: any) => { sseBackplaneUp.set(0); logger.warn({ err: e.message }, "sse redis sub error"); });
      // GẮN HANDLER TRƯỚC `subscribe`, không phải sau. Redis pub/sub KHÔNG có bộ đệm: gói tới trong
      // khoảng giữa "subscribe xong" và "gắn handler" bị ioredis bỏ đi vì không ai nghe. Khoảng đó
      // ngắn, nhưng nó có thật và không có gì báo khi mất.
      sub.on("message", (_chan: string, raw: string) => {
        try {
          const m = JSON.parse(raw);
          if (m.userId != null) localPublish(m.userId, m.event, m.data);
          else localBroadcast(m.event, m.data);
        } catch { /* ignore malformed */ }
      });
      await sub.subscribe(CHANNEL);

      // ── MẤT SỰ KIỆN LÚC KHỞI ĐỘNG ─────────────────────────────────────────
      // `pub` là CÔNG TẮC: `publish()`/`broadcast()` thấy nó khác null là đi đường Redis và TRẢ VỀ
      // NGAY, KHÔNG phát cục bộ (đúng thiết kế — subscriber mới là nơi phát, nếu không mỗi sự kiện
      // sẽ tới hai lần trên chính instance này).
      //
      // Bản trước gán `pub` NGAY SAU khi dựng publisher, tức TRƯỚC khi subscriber kịp `subscribe`.
      // Mọi sự kiện phát trong khoảng đó đi thẳng vào Redis MÀ KHÔNG AI NGHE, và Redis pub/sub
      // không có bộ đệm — chúng MẤT HẲN, im lặng, gauge vẫn báo khoẻ.
      //
      // Đó là lỗi PRODUCTION chứ không phải chuyện của bộ test: mỗi lần một instance khởi động lại,
      // mọi `emitChange` trong cửa sổ đó (báo giá vừa tạo/sửa/xoá) không tới màn hình của ai cả —
      // đúng lúc người ta cần nhất, là lúc vừa deploy xong.
      //
      // Gán `pub` Ở ĐÂY, sau `await subscribe`. Trước thời điểm này `publish()` rơi về `localPublish`:
      // instance khác vẫn không nhận được, nhưng người đang ngồi trên chính instance này THÌ CÓ —
      // hơn hẳn "không ai nhận được".
      // ── REDIS CHẾT RỒI SỐNG LẠI: ĐÃ ĐO, KHÔNG CẦN VÁ THÊM ─────────────────
      // Một vòng phản biện nghi rằng subscriber không tự nối lại, làm mất hàng chục sự kiện âm
      // thầm. ĐO THẬT (giết `redis-cli shutdown nosave`, chờ, `redis-server` lại):
      //   · ioredis TỰ SUBSCRIBE LẠI — sự kiện phát sau khi hồi phục VẪN TỚI nơi;
      //   · publish TRONG LÚC Redis chết thì NÉM ("Stream isn't writeable…", vì
      //     `backplaneOptions("pub")` tắt hàng đợi ngoại tuyến) → rơi vào `.catch(roiVeCucBo)` →
      //     `sseBackplaneUp` xuống 0 và sự kiện được phát CỤC BỘ.
      // Nghĩa là không có chuyện "mất im lặng": người trên chính instance này vẫn nhận được, và
      // gauge báo hỏng. Thứ THẬT SỰ mất là sự kiện tới người dùng trên INSTANCE KHÁC trong quãng
      // Redis chết — đó là bản chất của pub/sub không bộ đệm, và là đánh đổi đã cân ở khối
      // `roiVeCucBo` bên dưới. Muốn đóng nốt thì phải đổi sang Redis Streams; đừng vá lặt vặt.
      pub = pubClient;
      sseBackplaneUp.set(1);
      logger.info("SSE Redis pub/sub backplane enabled");
    } catch (e) {
      pub = null;
      sseBackplaneUp.set(0);
      sseBackplaneMode.set({ mode: "local" }, 1);
      sseBackplaneMode.set({ mode: "redis" }, 0);
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, "SSE Redis backplane init failed — falling back to in-memory");
    }
  })();
} else {
  // KHÔNG CẤU HÌNH REDIS KHÔNG PHẢI LÀ HỎNG — nhưng cũng KHÔNG được báo là "up".
  //
  // Chạy một tiến trình duy nhất, không backplane, là cấu hình hợp lệ (xem đầu file). Bản trước
  // giải quyết chuyện đó bằng cách `sseBackplaneUp.set(1)` ngay tại đây, và như vậy là sai: KHÔNG
  // có gì bảo đảm "một tiến trình". infra/k8s/app.yaml khai `replicas: 2`; `REDIS_URL` là
  // `.optional()` và thiếu nó ở production chỉ sinh một `console.warn`; values.yaml của Helm để sẵn
  // `REDIS_URL: ""`. Tổ hợp "nhiều replica + không Redis" vì thế dựng được — và đó ĐÚNG LÀ cấu hình
  // hỏng mà gauge này sinh ra để bắt, trong khi nó lại báo 1.
  //
  // Nay tách làm hai: `sse_backplane_up` chỉ nói về backplane REDIS, còn CHẾ ĐỘ nằm ở
  // `sse_backplane_mode`. Cảnh báo đúng là `mode{mode="redis"}==1 and up==0`, nên bản một tiến
  // trình không bị báo động giả mà cấu hình thiếu Redis ở cụm nhiều instance vẫn lộ ra.
  sseBackplaneUp.set(0);
  sseBackplaneMode.set({ mode: "local" }, 1);
  sseBackplaneMode.set({ mode: "redis" }, 0);
}

/**
 * Trần số kết nối SSE ĐỒNG THỜI của MỘT tài khoản. Không có trần thì `attach` nhận vô hạn: mỗi kết
 * nối là một `Response` giữ mãi cộng một `setInterval` keepalive, và dọn dẹp chỉ xảy ra khi client
 * đóng — nên socket chết không FIN tích lại cho tới lần restart. Đặt rộng rãi so với nhu cầu thật
 * (vài tab mỗi người) để không ai đang làm việc bị chặn oan; đây là chốt chặn lạm dụng, không phải
 * hạn ngạch. Nới bằng SSE_MAX_PER_USER nếu có nhu cầu thật.
 */
export const SSE_MAX_PER_USER = Number(process.env.SSE_MAX_PER_USER) || 10;

// ── ĐẾM NỐI LẠI (`sse_reconnects`) ──────────────────────────────────────────
//
// KHÔNG có cách đo CHÍNH XÁC ở phía máy chủ, và chỗ này phải nói thật về điều đó.
// `EventSource` chỉ gửi header `Last-Event-ID` khi máy chủ ĐÃ từng gửi trường `id:` — mà đường phát
// ở file này không gửi `id:` bao giờ (xem `localPublish`), nên header đó không tồn tại. Client
// (web/src/components/Shell.tsx) cũng chỉ `new EventSource("/api/stream/events")`, không kèm dấu
// hiệu nào.
//
// SUY LUẬN ĐANG DÙNG: một lượt `attach` được tính là NỐI LẠI khi tài khoản đó vừa rớt về KHÔNG
// kết nối trong vòng `SSE_RECONNECT_WINDOW_MS` trước đó. Mở thêm tab thứ hai KHÔNG tính (số kết nối
// chưa hề về 0). Người bỏ đi 10 phút rồi quay lại cũng không tính.
//
// Cửa sổ mặc định 90 giây = hơn 3 nhịp keepalive 25 giây, đủ để trùm lượt thử lại mặc định của
// EventSource (~3 giây) và một lượt F5, mà không trùm cả một buổi làm việc.
//
// Con số này vì thế đọc là "đường realtime có đang CHẬP CHỜN không", không phải "đếm tuyệt đối số
// lần nối lại" — và đó đúng là câu hỏi người trực cần trả lời.
export const SSE_RECONNECT_WINDOW_MS = Number(process.env.SSE_RECONNECT_WINDOW_MS) || 90_000;
/** userId → mốc rớt HẾT kết nối gần nhất. Chỉ giữ trong cửa sổ trên. */
const roiLucCuoi = new Map<number, number>();
/** Trần số mục nhớ — bản đồ này KHÔNG được phép thành một đường rò bộ nhớ mới. */
const RECONNECT_NHO_TOI_DA = 5_000;

function donRoi() {
  const han = Date.now() - SSE_RECONNECT_WINDOW_MS;
  for (const [u, t] of roiLucCuoi) if (t < han) roiLucCuoi.delete(u);
  // Vẫn đầy (5000 người rớt cùng lúc — đứt mạng diện rộng) → bỏ nửa CŨ NHẤT. Thà đếm thiếu vài lượt
  // nối lại còn hơn để một bản đồ chẩn đoán phình không giới hạn trong tiến trình phục vụ request.
  if (roiLucCuoi.size >= RECONNECT_NHO_TOI_DA) {
    const cu = [...roiLucCuoi.entries()].sort((a, b) => a[1] - b[1]).slice(0, Math.floor(RECONNECT_NHO_TOI_DA / 2));
    for (const [u] of cu) roiLucCuoi.delete(u);
  }
}

function ghiNhoRoi(userId: number) {
  if (roiLucCuoi.size >= RECONNECT_NHO_TOI_DA) donRoi();
  roiLucCuoi.set(userId, Date.now());
}

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

  // ĐẶT SAU cổng 429 và sau khi header đã đi: một lượt bị TỪ CHỐI vì chạm trần không phải một lượt
  // nối lại thành công, đếm nó vào đây sẽ làm số này nói về chuyện khác.
  const mocRoi = roiLucCuoi.get(userId);
  if (mocRoi !== undefined) {
    roiLucCuoi.delete(userId);
    if (Date.now() - mocRoi <= SSE_RECONNECT_WINDOW_MS) sseReconnects.inc();
  }

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
    // đóng hết tab → gỡ presence, VÀ ghi mốc rớt để lượt `attach` kế tiếp trong cửa sổ được tính là
    // nối lại (xem khối chú thích ở `SSE_RECONNECT_WINDOW_MS`).
    if (set.size === 0) { subscribers.delete(userId); clearUserPresence(userId); ghiNhoRoi(userId); }
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
      try { res.write(`event: shutdown\ndata: {}\n\n`); sseEvents.inc({ event: "shutdown" }); } catch { /* socket đã hỏng */ }
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

/**
 * Backplane Redis ĐÃ SẴN SÀNG chưa (tức `publish`/`broadcast` có đi qua Redis không).
 *
 * Có mặt vì BỘ TEST cần biết nó vừa kiểm ĐƯỜNG NÀO. tests/mwobs-sse.test.js được viết lại riêng
 * cho cấu hình CÓ Redis (production luôn có), nhưng nó XANH 10/10 cả khi Redis chết — nó không
 * phân biệt được đường Redis với đường rơi cục bộ, nên "kiểm đúng cấu hình production" chỉ là
 * lời tự nhận. Đo được: đặt REDIS_URL trỏ cổng 6399 (không có gì lắng nghe) → vẫn 10/10.
 *
 * KHÔNG dùng cái này trong mã nghiệp vụ để rẽ nhánh: `publish`/`broadcast` đã tự xử lý cả hai
 * đường, thêm một nhánh nữa là thêm một trạng thái phải kiểm.
 */
export function backplaneDangDung(): boolean {
  return pub !== null;
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
