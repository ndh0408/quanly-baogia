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

// ─────────────────────────────────────────────────────────────────────────────
// BA LỖI NGẦM TÌM RA KHI PHẢN BIỆN LẠI CHÍNH BẢN VÁ NÀY (2026-08-27).
// Chúng KHÔNG do bản cũ để lại — chúng do bản vá 782243d sinh ra. Ghi rõ để khỏi ai đó
// "dọn dẹp" mấy chốt dưới đây vì tưởng là thừa.
// ─────────────────────────────────────────────────────────────────────────────

describe("xuatBaoGia — chế độ XEM THỬ", () => {
  // `req()` (api.ts) có nhánh `if (__preview && method !== "GET")` trả THÀNH CÔNG GIẢ, không gửi gì
  // lên máy chủ. `exportAsync` là POST → rơi vào đó → không có jobId/queue.
  // ĐÃ TÁI HIỆN trước khi vá: client hỏi `GET /api/jobs/undefined/undefined`, máy chủ trả 404,
  // người dùng nhận "Không tìm thấy hàng đợi" — không hề biết là do đang xem thử.
  it("báo giá LỚN khi đang xem thử: nói rõ là do xem thử, KHÔNG hỏi /jobs/undefined/undefined", async () => {
    traLoi = (u) => {
      if (/\/api\/export\//.test(u)) return new Response(JSON.stringify({ error: "quá lớn" }), { status: 413 });
      return new Response(JSON.stringify({ error: "Không tìm thấy hàng đợi" }), { status: 404 });
    };
    const { setPreviewMode } = await import("./api");
    const { xuatBaoGia } = await nap();
    setPreviewMode(true);
    try {
      expect(await xuatBaoGia(7, "xlsx")).toBe(false);
    } finally {
      setPreviewMode(false);
    }

    expect(daGoi.some((c) => c.url.includes("undefined")),
      "hỏi máy chủ về job 'undefined' — đúng lỗi đã tái hiện được").toBe(false);
    const loi = toastRa.find((t) => t.loai === "error");
    expect(loi, "im lặng thì người dùng tưởng nút hỏng").toBeTruthy();
    expect(loi!.msg, "phải nói là do XEM THỬ, chứ 'Không tìm thấy hàng đợi' thì chẳng ai hiểu")
      .toMatch(/[Xx]em thử/);
  });

  it("báo giá VỪA khi đang xem thử vẫn tải được — xem thử chỉ chặn lệnh GHI", async () => {
    // Đường đồng bộ là GET, không bị nhánh xem thử chặn, và tải file là việc admin vốn làm được.
    traLoi = () => new Response("x", { status: 200 });
    const { setPreviewMode } = await import("./api");
    const { xuatBaoGia } = await nap();
    setPreviewMode(true);
    try {
      expect(await xuatBaoGia(7, "xlsx")).toBe(true);
    } finally {
      setPreviewMode(false);
    }
    expect(daTai.length).toBe(1);
  });
});

describe("xuatBaoGia — phản hồi và chặn bấm lại", () => {
  it("phản hồi thiếu jobId/queue thì báo lỗi, KHÔNG hỏi /jobs/undefined/undefined", async () => {
    traLoi = (u, m) => {
      if (/\/api\/export\//.test(u)) return new Response(JSON.stringify({ error: "quá lớn" }), { status: 413 });
      if (m === "POST") return new Response(JSON.stringify({ ok: true }), { status: 202 });   // thiếu jobId
      return new Response(JSON.stringify({ error: "Không tìm thấy hàng đợi" }), { status: 404 });
    };
    const { xuatBaoGia } = await nap();
    expect(await xuatBaoGia(7, "xlsx")).toBe(false);
    expect(daGoi.some((c) => c.url.includes("undefined"))).toBe(false);
    expect(toastRa.some((t) => t.loai === "error" && /mã tác vụ/.test(t.msg))).toBe(true);
  });

  it("bấm lần thứ hai trong lúc đang chạy bị chặn — KHÔNG gửi thêm request nào", async () => {
    // Hồi quy do chính bản vá này gây ra: `window.open` trả quyền về ngay và trình duyệt tự hiện
    // chỉ báo tải, còn bản này `await` hàng giây mà màn hình không có gì → người dùng bấm lại.
    // QuoteList có busy.current che, nhưng QuoteEditor thì KHÔNG (nút nằm trong menu).
    let moKhoa: (() => void) | null = null;
    const cho = new Promise<void>((r) => { moKhoa = r; });
    g.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/csrf-token")) return new Response(JSON.stringify({ token: "t" }), { status: 200 });
      daGoi.push({ url: u, method: "GET" });
      await cho;                       // giữ lượt đầu treo lại
      return new Response("x", { status: 200 });
    });
    const { xuatBaoGia } = await nap();

    const dau = xuatBaoGia(7, "xlsx");
    await new Promise((r) => setTimeout(r, 20));
    const soLanTruoc = daGoi.length;

    expect(await xuatBaoGia(7, "xlsx"), "lượt thứ hai phải bị chặn").toBe(false);
    expect(daGoi.length, "lượt thứ hai vẫn gửi request = vẫn tạo việc trùng").toBe(soLanTruoc);
    expect(toastRa.some((t) => t.msg.includes("Đang tạo file"))).toBe(true);

    moKhoa!();
    expect(await dau).toBe(true);

    // Xong rồi thì KHOÁ PHẢI ĐƯỢC MỞ, nếu không nút chết vĩnh viễn tới khi tải lại trang.
    expect(await xuatBaoGia(7, "xlsx"), "khoá không được mở sau khi xong — nút chết").toBe(true);
  }, 30000);

  it("khoá được mở cả khi lượt trước THẤT BẠI", async () => {
    traLoi = () => new Response(JSON.stringify({ error: "Bạn không có quyền xuất báo giá" }), { status: 403 });
    const { xuatBaoGia } = await nap();
    expect(await xuatBaoGia(7, "xlsx")).toBe(false);
    // Lần hai phải CHẠY THẬT (ra 403 lần nữa), không phải bị chặn bởi khoá còn kẹt.
    const truoc = daGoi.length;
    expect(await xuatBaoGia(7, "xlsx")).toBe(false);
    expect(daGoi.length, "khoá kẹt sau lượt lỗi → nút chết").toBeGreaterThan(truoc);
  });

  it("khoá tính theo (báo giá, định dạng) — xuất PDF không bị Excel chặn", async () => {
    let moKhoa: (() => void) | null = null;
    const cho = new Promise<void>((r) => { moKhoa = r; });
    g.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/csrf-token")) return new Response(JSON.stringify({ token: "t" }), { status: 200 });
      daGoi.push({ url: u, method: "GET" });
      if (u.includes(".xlsx")) await cho;
      return new Response("x", { status: 200 });
    });
    const { xuatBaoGia } = await nap();
    const dauXlsx = xuatBaoGia(7, "xlsx");
    await new Promise((r) => setTimeout(r, 20));
    expect(await xuatBaoGia(7, "pdf"), "PDF bị Excel chặn oan").toBe(true);
    moKhoa!();
    expect(await dauXlsx).toBe(true);
  }, 30000);
});

describe("xuatBaoGia — mất phiên và xuất nền chưa bật", () => {
  it("401 phải bắn auth:expired + dọn mã CSRF — `fetch` trần đi vòng qua req() nên mất hai việc đó", async () => {
    // Lớp phủ đăng nhập lại (App.tsx nghe "auth:expired") tồn tại để KHÔNG unmount QuoteEditor và
    // không làm mất báo giá đang soạn — xem web/src/lib/api401.test.ts. Đường xuất đi vòng qua
    // `req()` nên phải tự làm phần việc đó.
    const suKien: string[] = [];
    g.window = { dispatchEvent: (e: { type: string }) => { suKien.push(e.type); return true; } };
    traLoi = () => new Response(JSON.stringify({ error: "Chưa đăng nhập" }), { status: 401 });
    const { xuatBaoGia } = await nap();
    expect(await xuatBaoGia(7, "xlsx")).toBe(false);
    expect(suKien, "mất phiên mà app không biết → người dùng kẹt, không có đường đăng nhập lại")
      .toContain("auth:expired");
  });

  it("503 KHÔNG có `code` và lời nhắn KỸ THUẬT (proxy/LB) → vẫn phải nói người dùng làm gì", async () => {
    // ⚠️ BÀI NÀY TỪNG RỖNG. Bản đầu dùng một lời nhắn 503 có sẵn chữ "quản trị viên", nên nó xanh
    // CẢ KHI gỡ chốt `|| loi?.status === 503` — đường rơi chung cũng in đúng chuỗi đó ra.
    // Đã kiểm ngược: gỡ chốt → KHÔNG bài nào đỏ. Bài phải phân biệt được mới có giá trị.
    //
    // Ca THẬT phân biệt được: 503 từ một lớp KHÔNG PHẢI ứng dụng (nginx, Cloudflare, LB) — thân
    // chỉ có một câu kỹ thuật, không `code`, không hướng dẫn. Không có chốt thì người dùng nhận
    // đúng "Service Unavailable" và không biết làm gì tiếp.
    traLoi = (u, m) => {
      if (/\/api\/export\//.test(u)) return new Response(JSON.stringify({ error: "quá lớn" }), { status: 413 });
      if (m === "POST") return new Response(JSON.stringify({ error: "Service Unavailable" }), { status: 503 });
      return new Response("{}", { status: 200 });
    };
    const { xuatBaoGia } = await nap();
    expect(await xuatBaoGia(7, "xlsx")).toBe(false);
    const loi = toastRa.find((t) => t.loai === "error");
    expect(loi!.msg, "đổ nguyên 'Service Unavailable' ra cho người dùng thì họ không làm gì được")
      .not.toBe("Service Unavailable");
    expect(loi!.msg, "phải nói rõ: quá lớn để tải trực tiếp, và chế độ nền chưa bật")
      .toMatch(/chế độ nền chưa được bật/);
  }, 30000);

  it("503 CỦA ỨNG DỤNG thì giữ NGUYÊN VĂN — quản trị viên cần biết thiếu HÀNG ĐỢI hay thiếu KHO", async () => {
    traLoi = (u, m) => {
      if (/\/api\/export\//.test(u)) return new Response(JSON.stringify({ error: "quá lớn" }), { status: 413 });
      if (m === "POST") return new Response(JSON.stringify({ error: "Xuất nền chưa dùng được (chưa cấu hình hàng đợi/Redis). Hãy nhờ quản trị viên bật hàng đợi." }), { status: 503 });
      return new Response("{}", { status: 200 });
    };
    const { xuatBaoGia } = await nap();
    expect(await xuatBaoGia(7, "xlsx")).toBe(false);
    expect(toastRa.find((t) => t.loai === "error")!.msg).toMatch(/hàng đợi\/Redis/);
  }, 30000);

  it("503 nhánh thiếu KHO cũng nói rõ thiếu kho, không nhầm sang hàng đợi", async () => {
    traLoi = (u, m) => {
      if (/\/api\/export\//.test(u)) return new Response(JSON.stringify({ error: "quá lớn" }), { status: 413 });
      if (m === "POST") return new Response(JSON.stringify({
        error: "Xuất nền chưa dùng được (chưa cấu hình kho lưu trữ tệp). Hãy nhờ quản trị viên bật kho lưu trữ.",
        code: "export_async_unavailable",
      }), { status: 503 });
      return new Response("{}", { status: 200 });
    };
    const { xuatBaoGia } = await nap();
    expect(await xuatBaoGia(7, "xlsx")).toBe(false);
    expect(toastRa.find((t) => t.loai === "error")!.msg).toMatch(/kho lưu trữ/);
  }, 30000);
});

describe("xuatBaoGia — ba ca hỏng câm", () => {
  it("200 nhưng thân là HTML (proxy/SSO/SPA fallback) → KHÔNG lưu thành .xlsx hỏng", async () => {
    traLoi = () => new Response("<!doctype html><title>Đăng nhập</title>", {
      status: 200, headers: { "Content-Type": "text/html; charset=utf-8" },
    });
    const { xuatBaoGia } = await nap();
    expect(await xuatBaoGia(7, "xlsx")).toBe(false);
    expect(daTai, "lưu nguyên trang HTML thành .xlsx — Excel chỉ báo 'không mở được', không manh mối").toEqual([]);
    expect(toastRa.some((t) => t.loai === "error" && /trang web/.test(t.msg))).toBe(true);
  });

  it("job ở trạng thái 'unknown' → dừng NGAY, không hỏi 65 lượt trong 5 phút", async () => {
    let lanHoi = 0;
    traLoi = (u, m) => {
      if (/\/api\/export\//.test(u)) return new Response(JSON.stringify({ error: "quá lớn" }), { status: 413 });
      if (m === "POST") return new Response(JSON.stringify({ jobId: "j-9", queue: "export" }), { status: 202 });
      lanHoi++;
      return new Response(JSON.stringify({ id: "j-9", state: "unknown", returnvalue: null, failedReason: null }), { status: 200 });
    };
    const { xuatBaoGia } = await nap();
    expect(await xuatBaoGia(7, "xlsx")).toBe(false);
    expect(lanHoi, "vẫn hỏi vòng về một job không tồn tại").toBe(1);
    expect(toastRa.some((t) => t.loai === "error" && /không còn tồn tại/.test(t.msg))).toBe(true);
  }, 30000);

  it("thẻ <a> KHÔNG bị gỡ ngay trong tick của click() (Safari cũ huỷ mất lượt tải)", async () => {
    // Bằng chứng đo được: ghi lại thứ tự click/remove trên chính thẻ giả.
    const nhatKy: string[] = [];
    g.document = {
      createElement: () => {
        const a = { href: "", download: "", rel: "", style: {} as Record<string, string>,
          click() { nhatKy.push("click"); },
          remove() { nhatKy.push("remove"); } };
        return a;
      },
      body: { appendChild: () => nhatKy.push("append") },
    };
    traLoi = () => new Response("x", { status: 200 });
    const { xuatBaoGia } = await nap();
    await xuatBaoGia(7, "xlsx");
    expect(nhatKy, "remove xảy ra ngay sau click trong cùng tick").toEqual(["append", "click"]);
    await new Promise((r) => setTimeout(r, 10));
    expect(nhatKy, "nhưng vẫn phải được dọn ở tick sau, không rò thẻ vào DOM").toEqual(["append", "click", "remove"]);
  });
});
