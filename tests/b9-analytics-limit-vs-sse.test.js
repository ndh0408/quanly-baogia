/**
 * ============================================================================
 * TRẦN /api/analytics phải tính CẢ đường tự-tải-lại theo SSE, không chỉ thao tác tay.
 *
 * ── LỖI ─────────────────────────────────────────────────────────────────────
 * Trần 60 req/phút khoá theo TÀI KHOẢN được đặt với lý lẽ "Dashboard bắn 4 request mỗi lần đổi
 * khoảng thời gian; 60/phút cho phép đổi ~15 lần/phút". Phép tính đó bỏ sót nguồn sinh request áp
 * đảo — và bỏ sót nó thì trần chặn đúng người dùng bình thường:
 *
 *   src/db.ts (emitChange sau mọi ghi Quote/Customer/User)
 *     → src/sse.ts broadcast cho MỌI client đang mở
 *     → web/src/components/Shell.tsx phát `realtime:changed`
 *     → web/src/lib/query.tsx `qc.invalidateQueries()` KHÔNG tham số, gộp theo cửa sổ WINDOW ms
 *     → web/src/pages/Dashboard.tsx queryFn bắn `Promise.all` 4 request analytics
 *
 * Chỉ cần 15 lần ghi mỗi phút trong công ty (một lần mỗi 4 giây) là một người đang MỞ Dashboard
 * chạm trần 60 — họ không làm gì cả, và nhận 429.
 *
 * ── VÌ SAO TEST Ở LỚP NÀY ───────────────────────────────────────────────────
 * `src/rateLimit.ts` cố ý trả middleware RỖNG khi NODE_ENV=test (bộ đếm Redis dùng chung giữa các
 * tiến trình vitest gây 429 giả), nên KHÔNG lái được con số này qua HTTP. Thứ kiểm được — và là
 * thứ thật sự trôi — là QUAN HỆ giữa ba con số nằm ở ba file khác nhau. Bài này đọc cả ba từ MÃ
 * NGUỒN, nên đổi một cái mà quên cái kia là đỏ.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** Trần request/phút của nhóm /api/analytics, đọc từ chính khối createLimiter("analytics", …). */
function tranAnalytics() {
  const src = readFileSync("src/routes/analytics.routes.ts", "utf8");
  const khoi = /createLimiter\(\s*"analytics"[\s\S]*?\)\s*\)/.exec(src);
  expect(khoi, "không tìm thấy createLimiter(\"analytics\") — mã đã đổi, cập nhật test").not.toBeNull();
  const w = /windowMs:\s*([\d_]+)/.exec(khoi[0]);
  const m = /max:\s*([\d_]+)/.exec(khoi[0]);
  expect(w && m, "không đọc được windowMs/max").toBeTruthy();
  return { windowMs: Number(w[1].replace(/_/g, "")), max: Number(m[1].replace(/_/g, "")) };
}

/** Cửa sổ gộp invalidate của client (ms). */
function cuaSoGop() {
  const src = readFileSync("web/src/lib/query.tsx", "utf8");
  const m = /const WINDOW\s*=\s*(\d+)/.exec(src);
  expect(m, "không đọc được WINDOW trong web/src/lib/query.tsx").not.toBeNull();
  return Number(m[1]);
}

/** Số request analytics mà MỘT lần refetch Dashboard bắn ra. */
function soRequestMoiLan() {
  const src = readFileSync("web/src/pages/Dashboard.tsx", "utf8");
  const m = /Promise\.all\(\[([\s\S]*?)\]\)/.exec(src);
  expect(m, "không tìm thấy Promise.all trong Dashboard.tsx").not.toBeNull();
  const n = (m[1].match(/api\.analytics[A-Za-z]*\(/g) || []).length;
  expect(n, "không đếm được lời gọi api.analytics* nào").toBeGreaterThan(0);
  return n;
}

describe("trần /api/analytics vs nhịp SSE thật", () => {
  it("phải chịu được trần trên của đường tự-tải-lại", () => {
    const { windowMs, max } = tranAnalytics();
    const WINDOW = cuaSoGop();
    const moiLan = soRequestMoiLan();
    // Số lần invalidate tối đa trong một cửa sổ limiter, rồi nhân số request mỗi lần.
    const toiDa = Math.floor(windowMs / WINDOW) * moiLan;
    expect(max, `trần ${max}/phút thấp hơn nhịp mà CHÍNH ứng dụng sinh ra (${toiDa}/phút = ` +
      `${Math.floor(windowMs / WINDOW)} lượt invalidate × ${moiLan} request). Người dùng mở Dashboard ` +
      `sẽ nhận 429 khi đồng nghiệp lưu báo giá đủ dày, dù họ không làm gì.`).toBeGreaterThanOrEqual(toiDa);
  });

  it("vẫn là một cái TRẦN thật, không phải mở toang", () => {
    const { max } = tranAnalytics();
    expect(max, "bỏ trần thì một vòng lặp gọi tự động quét sạch bảng Quote không gì chặn").toBeLessThanOrEqual(1000);
  });

  it("chú thích chọn số phải NHẮC tới đường SSE — bản trước chỉ đếm thao tác tay", () => {
    const src = readFileSync("src/routes/analytics.routes.ts", "utf8");
    expect(src, "chú thích không nhắc invalidateQueries/SSE → phép tính lại chỉ đếm thao tác tay")
      .toMatch(/invalidateQueries|SSE|emitChange/);
  });
});
