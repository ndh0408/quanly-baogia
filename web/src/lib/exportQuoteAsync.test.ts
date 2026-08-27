// BÁO GIÁ LƯU ĐƯỢC 60.000 DÒNG NHƯNG TẢI VỀ THÌ CỤT Ở 20.000 — chốt hồi quy cho lối thoát.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `web/src/pages/QuoteList.tsx` và `web/src/pages/QuoteEditor.tsx` gọi
// `window.open("/api/export/:id.xlsx")`. `window.open` giao THẲNG phản hồi cho trình duyệt, nên mã
// trạng thái không bao giờ tới được JavaScript. Mà `src/routes/export.routes.ts:108` (xlsx) và
// `:152` (pdf) trả **413** khi báo giá vượt `MAX_EXPORT_ITEMS`. Người dùng nhận một tab trắng in ra
// `{"error":"Báo giá quá lớn để xuất trực tiếp — vui lòng dùng xuất nền (async)"}`.
//
// Lời nhắn đó còn trỏ tới một chức năng KHÔNG NÚT NÀO GỌI: `POST /api/quotes/:id/export`
// (src/routes/jobs.routes.ts) có từ lâu, nhưng `grep -rn "api/jobs" web/src` không ra kết quả nào.
//
// Ngõ cụt là THẬT: `src/validators.ts` cho LƯU 60 trang × 1000 dòng = 60.000 dòng, đường xuất đồng
// bộ dừng ở 20.000. Lưu xong mới phát hiện không tải được, không cảnh báo trước.
//
// ── VÌ SAO KHÔNG NÂNG TRẦN 20.000 ───────────────────────────────────────────
// docs/REMAINING_RISKS.md có số đo: 60.000 dòng = 20,8 giây + 393MB RSS cho MỘT request. Chặn event
// loop 20 giây là không chấp nhận được. Lối ra đúng là đẩy sang worker.
//
// ── BÀI NÀY KHOÁ GÌ ─────────────────────────────────────────────────────────
// Chặn `fetch` ở mức mạng rồi kiểm HÀNH VI, không kiểm cách viết:
//   · 200  → tải ngay, KHÔNG đụng tới đường nền
//   · 413  → PHẢI gọi POST /quotes/:id/export, hỏi job tới khi xong, tải từ URL worker trả về
//   · 503 export_async_unavailable → nói rõ phải nhờ quản trị viên, không im lặng
//   · job failed → báo lỗi, không hỏi vòng vô tận
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Ép kiểu lỏng CÓ CHỦ Ý — cùng lý do với web/src/lib/api401.test.ts: repo không cài jsdom, mọi test
// web đều chạy ở môi trường node với `window`/`document` giả tối thiểu.
const g = globalThis as unknown as Record<string, unknown>;

type Loi = { url: string; method: string };
let daGoi: Loi[] = [];
let daTai: { href: string; download: string }[] = [];
let toastRa: { msg: string; loai: string }[] = [];
let cu: Record<string, unknown> = {};
/** Tên các hàm tĩnh mình TỰ gắn vào URL — gỡ đúng những cái đó, không đụng cái node có sẵn. */
let ganThem: string[] = [];

/** Trả lời theo từng đường dẫn. Mỗi kịch bản đặt lại hàm này. */
let traLoi: (url: string, method: string) => Response;

/** `document` tối thiểu: đủ cho `taiVe()` dựng thẻ <a download> rồi bấm. */
const gaDocument = () => ({
  createElement: () => {
    const a = {
      href: "",
      download: "",
      rel: "",
      style: {} as Record<string, string>,
      click() {
        daTai.push({ href: a.href, download: a.download });
      },
      remove() {},
    };
    return a;
  },
  body: { appendChild: () => {} },
});

beforeEach(() => {
  vi.resetModules();
  daGoi = [];
  daTai = [];
  toastRa = [];
  cu = { fetch: g.fetch, window: g.window, document: g.document };
  g.window = { dispatchEvent: () => true };
  g.document = gaDocument();
  // URL.createObjectURL/revokeObjectURL không có ở node. GẮN THÊM vào lớp URL THẬT, đừng thay lớp
  // bằng một object: `new URL(...)` vẫn được dùng ở nơi khác trong cây import, và thay lớp thì nó
  // đổ `TypeError: URL is not a constructor` cho MỌI bài trong file.
  ganThem = [];
  const bosung: Record<string, () => string | void> = {
    createObjectURL: (): string => "blob:gia-lap",
    revokeObjectURL: (): void => {},
  };
  for (const [k, v] of Object.entries(bosung)) {
    if (!(k in URL)) { ganThem.push(k); (URL as unknown as Record<string, unknown>)[k] = v; }
  }
  g.fetch = vi.fn(async (url: unknown, opts?: { method?: string }) => {
    const u = String(url);
    const m = (opts?.method || "GET").toUpperCase();
    if (u.includes("/csrf-token")) return new Response(JSON.stringify({ token: "t" }), { status: 200 });
    daGoi.push({ url: u, method: m });
    return traLoi(u, m);
  });
  vi.doMock("./ui", () => ({
    toast: (msg: string, loai = "info") => {
      toastRa.push({ msg, loai });
    },
  }));
});

afterEach(() => {
  for (const [k, v] of Object.entries(cu)) {
    if (v === undefined) delete g[k];
    else g[k] = v;
  }
  for (const k of ganThem) delete (URL as unknown as Record<string, unknown>)[k];
  ganThem = [];
  vi.restoreAllMocks();
  vi.doUnmock("./ui");
});

const nap = () => import("./exportQuote");
const duongNen = () => daGoi.filter((c) => /\/quotes\/\d+\/export$/.test(c.url) && c.method === "POST");
const duongHoi = () => daGoi.filter((c) => c.url.includes("/jobs/"));

describe("xuatBaoGia — báo giá vừa: đường đồng bộ, không đụng hàng đợi", () => {
  it("200 thì tải ngay, KHÔNG gọi đường nền lần nào", async () => {
    traLoi = () =>
      new Response("noi-dung-xlsx", {
        status: 200,
        headers: { "Content-Disposition": 'attachment; filename="BaoGia_ABC-01.xlsx"' },
      });
    const { xuatBaoGia } = await nap();
    expect(await xuatBaoGia(7, "xlsx")).toBe(true);

    expect(daTai.length, "không tải file nào về").toBe(1);
    expect(daTai[0].download, "tên file phải lấy từ Content-Disposition của server").toBe("BaoGia_ABC-01.xlsx");
    expect(duongNen(), "báo giá vừa mà vẫn xếp việc vào hàng đợi — tốn worker vô ích").toEqual([]);
    expect(duongHoi()).toEqual([]);
  });

  it("thiếu Content-Disposition thì vẫn có tên tử tế, không phải 'download'", async () => {
    traLoi = () => new Response("x", { status: 200 });
    const { xuatBaoGia } = await nap();
    await xuatBaoGia(42, "pdf");
    expect(daTai[0].download).toBe("BaoGia_42.pdf");
  });
});

describe("xuatBaoGia — 413 phải chuyển sang xuất nền (đây là ngõ cụt cũ)", () => {
  it("413 thì xếp việc, hỏi tới khi xong, rồi tải từ URL worker trả về", async () => {
    let lanHoi = 0;
    traLoi = (u, m) => {
      if (/\/api\/export\//.test(u)) {
        // Bản CŨ dừng ở đây: window.open giao thẳng phản hồi này cho trình duyệt.
        return new Response(
          JSON.stringify({ error: "Báo giá quá lớn để xuất trực tiếp — vui lòng dùng xuất nền (async)" }),
          { status: 413 },
        );
      }
      if (m === "POST" && /\/quotes\/\d+\/export$/.test(u)) {
        return new Response(JSON.stringify({ jobId: "j-1", queue: "export", format: "xlsx" }), { status: 202 });
      }
      if (u.includes("/jobs/")) {
        lanHoi++;
        // Hai lượt đầu còn đang chạy — khoá luôn việc client BIẾT CHỜ, không bỏ cuộc ở lượt hỏi đầu.
        if (lanHoi < 3) {
          return new Response(
            JSON.stringify({ id: "j-1", state: "active", returnvalue: null, failedReason: null }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            id: "j-1",
            state: "completed",
            failedReason: null,
            returnvalue: { url: "https://kho.example/da-ky/BaoGia.xlsx?sig=abc", key: "exports/x.xlsx", size: 30700000 },
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    };
    const { xuatBaoGia } = await nap();
    expect(await xuatBaoGia(7, "xlsx")).toBe(true);

    expect(duongNen().length, "gặp 413 mà KHÔNG xếp việc vào hàng đợi thì vẫn là ngõ cụt cũ").toBe(1);
    expect(lanHoi, "bỏ cuộc ngay lượt hỏi đầu — job nặng thì luôn chưa xong ở lượt đầu").toBeGreaterThanOrEqual(3);
    expect(daTai.length).toBe(1);
    expect(daTai[0].href, "phải tải từ URL đã ký của worker").toContain("https://kho.example/da-ky/");
    expect(toastRa.some((t) => t.loai === "success")).toBe(true);
  }, 30000);

  it("PDF cũng đi cùng đường — 413 ở :152 không phải chỉ xlsx", async () => {
    traLoi = (u, m) => {
      if (/\/api\/export\//.test(u)) return new Response(JSON.stringify({ error: "quá lớn" }), { status: 413 });
      if (m === "POST") return new Response(JSON.stringify({ jobId: "j-2", queue: "export", format: "pdf" }), { status: 202 });
      return new Response(
        JSON.stringify({ id: "j-2", state: "completed", failedReason: null, returnvalue: { url: "https://kho.example/a.pdf" } }),
        { status: 200 },
      );
    };
    const { xuatBaoGia } = await nap();
    expect(await xuatBaoGia(9, "pdf")).toBe(true);
    expect(daGoi.some((c) => c.method === "POST" && c.url.includes("/quotes/9/export"))).toBe(true);
  }, 30000);
});

describe("xuatBaoGia — hỏng thì nói rõ, không im lặng và không treo", () => {
  it("xuất nền chưa bật (503) thì nói phải nhờ quản trị viên, không chỉ 'Lỗi 503'", async () => {
    traLoi = (u, m) => {
      if (/\/api\/export\//.test(u)) return new Response(JSON.stringify({ error: "quá lớn" }), { status: 413 });
      if (m === "POST") {
        return new Response(
          JSON.stringify({
            error: "Xuất nền chưa dùng được (chưa cấu hình kho lưu trữ tệp). Vui lòng dùng chức năng xuất file trực tiếp.",
            code: "export_async_unavailable",
          }),
          { status: 503 },
        );
      }
      return new Response("{}", { status: 200 });
    };
    const { xuatBaoGia } = await nap();
    expect(await xuatBaoGia(7, "xlsx")).toBe(false);

    const loi = toastRa.find((t) => t.loai === "error");
    expect(loi, "im lặng khi xuất nền chưa bật là bỏ người dùng đứng giữa đường").toBeTruthy();
    expect(loi!.msg, "phải nói rõ ai khắc phục được, vì người dùng không tự bật Redis/kho object").toMatch(/quản trị viên/);
    expect(daTai).toEqual([]);
  });

  it("job thất bại thì báo đúng lý do worker trả về, không hỏi vòng vô tận", async () => {
    traLoi = (u, m) => {
      if (/\/api\/export\//.test(u)) return new Response(JSON.stringify({ error: "quá lớn" }), { status: 413 });
      if (m === "POST") return new Response(JSON.stringify({ jobId: "j-3", queue: "export" }), { status: 202 });
      return new Response(
        JSON.stringify({
          id: "j-3",
          state: "failed",
          returnvalue: null,
          failedReason: "Báo giá quá lớn: sinh file vượt trần 30s",
        }),
        { status: 200 },
      );
    };
    const { xuatBaoGia } = await nap();
    expect(await xuatBaoGia(7, "xlsx")).toBe(false);
    expect(toastRa.some((t) => t.loai === "error" && t.msg.includes("vượt trần 30s"))).toBe(true);
  }, 30000);

  it("lỗi KHÔNG phải 413 (403 không có quyền xuất) thì báo nguyên văn, KHÔNG xếp việc", async () => {
    traLoi = () => new Response(JSON.stringify({ error: "Bạn không có quyền xuất báo giá" }), { status: 403 });
    const { xuatBaoGia } = await nap();
    expect(await xuatBaoGia(7, "xlsx")).toBe(false);
    expect(duongNen(), "403 mà vẫn xếp việc = nện worker cho một lượt chắc chắn bị từ chối").toEqual([]);
    expect(toastRa.some((t) => t.loai === "error" && t.msg === "Bạn không có quyền xuất báo giá")).toBe(true);
  });

  it("mất mạng thì báo lỗi, không ném ra ngoài cho nơi gọi phải bắt", async () => {
    g.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { xuatBaoGia } = await nap();
    await expect(xuatBaoGia(7, "xlsx")).resolves.toBe(false);
    expect(toastRa.some((t) => t.loai === "error")).toBe(true);
  });
});
