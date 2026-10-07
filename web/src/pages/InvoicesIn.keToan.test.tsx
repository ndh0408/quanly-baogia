/** @vitest-environment jsdom */
//
// Trang HÓA ĐƠN ĐẦU VÀO — CỘT "KẾ TOÁN" + HỘP "KHOẢN CHI" (chủ repo 2026-10-06: "cái thanh toán bên đó là cho kế toán,
// không nằm trong kia nữa"). Kế toán tích ĐÃ CHI + ảnh chứng từ (invoice:input:pay), ghi Ngày hóa đơn + Ghi chú kế toán
// (invoice:edit) ngay trên trang này; máy chủ: PUT /api/quotes/input-invoices/:quoteId/:side/:rid.
//
// Bài này khoá phía trình duyệt: ai thấy nút, lệnh ghi gửi ĐÚNG khoản + CHỈ trường đã đổi, bỏ tích không kèm ảnh, hộp
// không bao giờ làm nhảy sang báo giá, Esc / IME không làm mất phần đang gõ, 409 giữ phần đang nhập, xem thử không vá
// cache, dải "Có bản mới" không tự tải khi hộp còn thay đổi, và các dòng "Cần chú ý" tách khỏi tiền.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InputInvoiceRow, InputInvoicesResp, KhoanChiDto } from "../lib/api";

const h = vi.hoisted(() => ({
  resp: null as unknown,
  goi: 0,
  xemThu: false,
  dongY: true,
  anhNen: "data:image/jpeg;base64,/9j/NENROI==",
  ghi: vi.fn(),
  anh: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  nen: vi.fn(),
}));
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  const ham: Record<string, unknown> = {
    inputInvoices: vi.fn(async () => { h.goi++; return typeof h.resp === "function" ? (h.resp as () => unknown)() : h.resp; }),
    ghiKhoanChi: (...a: unknown[]) => h.ghi(...a),
    anhKhoanChi: (...a: unknown[]) => h.anh(...a),
  };
  return { ...that, isPreviewMode: () => h.xemThu, api: new Proxy(ham, { get: (t, k: string) => t[k] ?? vi.fn(async () => ({})) }) };
});
vi.mock("../lib/ui", async (goc) => ({
  ...(await goc<typeof import("../lib/ui")>()),
  toast: (...a: unknown[]) => h.toast(...a),
  confirmModal: (...a: unknown[]) => h.confirm(...a),
}));
// Nén ảnh dùng canvas — jsdom không có. Thay bằng một data-URL cố định (luật nén có test riêng ở lib/anhChungTu).
vi.mock("../lib/anhChungTu", () => ({
  compressImage: (...a: unknown[]) => h.nen(...a), nenAnh: async () => h.anhNen, TRAN_ANH_KY_TU: 900_000,
  LOI_DOC_ANH: "Ảnh không đọc được — chọn ảnh PNG / JPG / WEBP khác.",
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { InvoicesInPage, locHang, BO_LOC_RONG } from "./InvoicesIn";
import { ApiError } from "../lib/api";
import { laTrangAnToan, _datLai } from "../lib/phienBan";

// vitest chặn tệp .css (đọc đĩa — styles.contrast.test.ts); jsdom thay `URL` toàn cục nên node:fs không nhận nó → ghép
// chuỗi rồi để node:url đổi sang đường dẫn (khuôn styles.oTranToi.test.tsx).
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (p: string, e: string) => string };
const nurl = (await import(/* @vite-ignore */ ["node", "url"].join(":"))) as { fileURLToPath: (u: string) => string };
const docCss = () => fs.readFileSync(nurl.fileURLToPath(import.meta.url.replace(/pages\/[^/]*$/, "styles.css")), "utf8");

const ANH = "data:image/png;base64,iVBORw0KGgo=";
let n = 0;
const hang = (over: Partial<InputInvoiceRow> = {}): InputInvoiceRow => {
  n++;
  const r: InputInvoiceRow = {
    key: "", quoteId: 10 + n, quoteCode: `FP_A26_0${n}`, title: `Sự kiện ${n}`, status: "converted",
    customerCode: "KH1", customerName: "Sao Mai", companyName: "GN", createdByName: "Lan",
    sheetId: 100 + n, sheetName: "Trang A", sheetCode: `FP_A26_0${n}_01`, side: "sheet", category: "hcm", tableName: "Chi phí HCM",
    rid: `r${n}`, name: `Hạng mục ${n}`, detail: null, unit: null, quantity: 1, unitPrice: 1000, days: null, amount: 1000,
    ns: null, chungTu: null, luuKho: false, approvedAt: "2026-09-20T03:00:00.000Z", approvedByName: "Admin",
    version: 0, paid: false, paidAt: null, paidByName: null, hasPaidProof: false, proofs: [], paidAmount: null, tienDoi: false,
    invoiceDate: null, accountingNote: null, keToanCapNhatLuc: null, keToanCapNhatBoi: null, nguon: "khong",
    trangThaiHang: "binh-thuong", coTheGhi: true, lyDoKhoa: null, ...over,
  };
  const side = r.category === "hanoi" ? "hn" : r.side;
  return { ...r, side, key: over.key ?? `${r.quoteId}:${side}:${r.rid}` };
};
/** Phản hồi PUT 200: phần kế toán của dòng sau khi ghi. */
const dto = (r: InputInvoiceRow, over: Partial<KhoanChiDto> = {}): KhoanChiDto => ({
  key: r.key, quoteId: r.quoteId, side: r.side, rid: r.rid ?? "", version: r.version + 1,
  paid: r.paid, paidAt: r.paidAt, paidByName: r.paidByName, hasPaidProof: r.hasPaidProof, proofs: r.proofs,
  paidAmount: r.paidAmount, tienDoi: r.tienDoi, invoiceDate: r.invoiceDate, accountingNote: r.accountingNote,
  keToanCapNhatLuc: "2026-10-06T03:00:00.000Z", keToanCapNhatBoi: "KT", nguon: "bang", ...over,
});

const ME_XEM = { id: 1, username: "kt", displayName: "KT", role: "accountant", permissions: ["invoice:page"] };
const ME_KE_TOAN = { ...ME_XEM, permissions: ["invoice:page", "invoice:edit", "invoice:pay", "invoice:input:pay"] };
const ME_ADMIN = { ...ME_XEM, role: "admin", permissions: [...ME_KE_TOAN.permissions, "quote:read:all"] };

let root: Root | null = null;
let khung: HTMLDivElement;
let qc: QueryClient;
const cho = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
async function mo(rows: InputInvoiceRow[] | (() => InputInvoicesResp), me: typeof ME_XEM = ME_KE_TOAN) {
  h.resp = typeof rows === "function" ? rows : { data: rows, meta: { quotes: rows.length, truncated: false } };
  khung = document.createElement("div"); document.body.appendChild(khung);
  root = createRoot(khung);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root!.render(<QueryClientProvider client={qc}><InvoicesInPage me={me} /></QueryClientProvider>); });
  await cho();
}
beforeEach(() => {
  n = 0; h.goi = 0; h.xemThu = false; h.dongY = true;
  h.ghi.mockReset(); h.anh.mockReset(); h.toast.mockReset();
  h.confirm.mockReset(); h.confirm.mockImplementation(async () => h.dongY);
  h.nen.mockReset(); h.nen.mockImplementation(async () => h.anhNen);
  _datLai();
});
afterEach(() => {
  if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; location.hash = "";
  (window as Window & { __editorDirty?: boolean }).__editorDirty = false;
});

const dongBang = () => [...khung.querySelectorAll("tbody tr")] as HTMLElement[];
const tenDong = () => dongBang().map((r) => r.querySelectorAll("td")[2].querySelector("div")!.textContent);
const oKeToan = (i = 0) => dongBang()[i].querySelector("td.inv-in-kt") as HTMLElement;
const nutKeToan = (i = 0) => oKeToan(i).querySelector("button[data-ke-toan]") as HTMLButtonElement | null;
const hopThoai = () => khung.querySelector('[role="dialog"]') as HTMLElement | null;
const trongHop = <T extends Element>(sel: string) => hopThoai()!.querySelector(sel) as T;
const nutTrongHop = (chu: string) => [...hopThoai()!.querySelectorAll("button")].find((b) => b.textContent === chu) as HTMLButtonElement | undefined;
const stat = (nhan: string) => [...khung.querySelectorAll(".stat-card")].find((s) => s.querySelector(".stat-label")!.textContent === nhan)?.querySelector(".stat-value")!.textContent;
const theCanChuY = () => [...khung.querySelectorAll("button.stat-card")].find((s) => s.querySelector(".stat-label")!.textContent === "Cần chú ý") as HTMLButtonElement | undefined;
function go(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => { setter.call(el, v); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
}
const chon = (nhan: string) => khung.querySelector(`select[aria-label="${nhan}"]`) as HTMLSelectElement;
async function moHop(i = 0) { await act(async () => { nutKeToan(i)!.click(); }); }
async function bam(el: HTMLElement) { await act(async () => { el.click(); }); }
async function phim(el: Element, init: KeyboardEventInit) { await act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init })); }); }

describe("ô 'Kế toán' — ai thấy nút, ô hiện gì", () => {
  it("tiêu đề cột cuối là 'Kế toán', ô mang lớp DÍNH PHẢI (sticky; right: 0) và bảng không gắn .inv-table", async () => {
    await mo([hang(), hang()]);
    const th = [...khung.querySelectorAll("thead th")];
    expect(th[th.length - 1].textContent).toBe("Kế toán");
    expect(th[th.length - 1].classList.contains("inv-in-kt")).toBe(true);
    for (const tr of dongBang()) expect(tr.lastElementChild!.classList.contains("inv-in-kt")).toBe(true);
    expect(khung.querySelector("table")!.classList.contains("inv-table"), "inv-table kéo theo 5 cột khoá 772px").toBe(false);
    const css = docCss().replace(/\/\*[\s\S]*?\*\//g, "");
    const luat = /\.inv-in-table \.inv-in-kt \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(luat).toMatch(/position:\s*sticky/);
    expect(luat).toMatch(/right:\s*0/);
    expect(luat, "có nền — chữ các cột cuộn qua không lộ dưới ô").toMatch(/background:\s*var\(--surface\)/);
    expect(css, "bóng trái riêng cho chế độ tối").toMatch(/\[data-theme="dark"\] \.inv-in-table \.inv-in-kt \{[^}]*box-shadow/);
  });

  it("ba dòng: '✓ Đã chi · ngày' + 📎 / '⚠ chưa có ảnh' | 'Chưa chi'; 'HĐ dd/mm/yyyy' | 'HĐ —'; ghi chú cắt một dòng (đủ chữ ở title)", async () => {
    await mo([
      hang({ paid: true, paidAt: "2026-10-03T03:00:00.000Z", hasPaidProof: true, invoiceDate: "2026-10-05", accountingNote: "HĐ đỏ số 0012345 — đã nhận bản gốc" }),
      hang({ paid: true, paidAt: "2026-10-04T03:00:00.000Z", hasPaidProof: false }),
      hang(),
    ]);
    expect(oKeToan(0).textContent).toContain("✓ Đã chi · 03/10/2026");
    expect(oKeToan(0).querySelector('[aria-label="Có ảnh chứng từ"]')!.textContent).toBe("📎");
    expect(oKeToan(0).textContent).toContain("HĐ 05/10/2026");
    const ghiChu = oKeToan(0).querySelector(".inv-in-kt-ghichu") as HTMLElement;
    expect(ghiChu.getAttribute("title")).toBe("HĐ đỏ số 0012345 — đã nhận bản gốc");
    expect(oKeToan(1).textContent).toContain("⚠ chưa có ảnh");
    expect(oKeToan(2).textContent).toContain("Chưa chi");
    expect(oKeToan(2).textContent).toContain("HĐ —");
    expect(oKeToan(2).querySelector(".inv-in-kt-ghichu")).toBeNull();
  });

  it("huy hiệu ⚠ khi số tiền đổi sau khi chi — nêu số đã chi và số hiện tại", async () => {
    await mo([hang({ paid: true, paidAt: "2026-10-03T03:00:00.000Z", tienDoi: true, paidAmount: 1000000, amount: 1200000 }), hang()]);
    const canh = oKeToan(0).querySelector("[data-canh]") as HTMLElement;
    expect(canh.textContent).toBe("⚠");
    expect(canh.getAttribute("title")).toBe("Số tiền đã đổi sau khi chi: đã chi 1.000.000 — hiện 1.200.000");
    expect(oKeToan(1).querySelector("[data-canh]")).toBeNull();
  });

  it("CHỐT CHẶN: chỉ có invoice:page → không có button / input nào trong bảng", async () => {
    await mo([hang({ paid: true, paidAt: "2026-10-03T03:00:00.000Z" }), hang()], ME_XEM);
    expect(dongBang()).toHaveLength(2);
    expect(khung.querySelectorAll("tbody button, tbody input, tbody textarea, tbody select")).toHaveLength(0);
  });

  it("chỉ có invoice:page → ô Kế toán là CHỮ (không mở được hộp) + gợi ý xin quyền tích ĐÃ CHI", async () => {
    await mo([hang({ paid: true, paidAt: "2026-10-03T03:00:00.000Z" })], ME_XEM);
    expect(oKeToan(0).querySelector(".inv-in-kt-chu")!.textContent).toContain("✓ Đã chi");
    expect(khung.textContent, "gợi ý xin quyền tích ĐÃ CHI").toContain("Hóa đơn đầu vào: tích ĐÃ CHI + ảnh chứng từ");
  });

  it("có invoice:input:pay HOẶC invoice:edit (và dòng ghi được) → ô là nút data-ke-toan", async () => {
    await mo([hang()], ME_KE_TOAN);
    expect(nutKeToan(0)).not.toBeNull();
    act(() => root!.unmount()); root = null; khung.remove();
    await mo([hang()], { ...ME_XEM, permissions: ["invoice:page", "invoice:edit"] });
    expect(nutKeToan(0), "chỉ có invoice:edit vẫn ghi được Ngày HĐ / ghi chú").not.toBeNull();
    act(() => root!.unmount()); root = null; khung.remove();
    await mo([hang()], { ...ME_XEM, permissions: ["invoice:page", "invoice:pay"] });
    expect(nutKeToan(0), "invoice:pay là NGÀY THU tiền hoá đơn đầu ra — không mở được khoản chi").toBeNull();
  });

  it("coTheGhi=false → ô KHOÁ (không nút), title nêu lý do của máy chủ", async () => {
    const lyDo = "Hàng cũ chưa có mã nội bộ — nhờ quản trị chạy công cụ chuẩn hoá mã (backfillKhoanChi --sua-rid), rồi tải lại trang này.";
    await mo([hang({ coTheGhi: false, lyDoKhoa: lyDo, rid: null, key: "11:hcm:111:0:0" })]);
    expect(nutKeToan(0)).toBeNull();
    expect(oKeToan(0).querySelector(".inv-in-kt-chu")!.getAttribute("title")).toBe(lyDo);
  });
});

describe("hộp 'Khoản chi' — lệnh ghi", () => {
  it("Lưu gọi api.ghiKhoanChi ĐÚNG (quoteId, side, rid) với CHỈ trường đã đổi + baseVersion", async () => {
    const r = hang({ quoteId: 41, rid: "rid/có dấu", version: 2, invoiceDate: "2026-10-01" });
    await mo([r]);
    await moHop();
    expect(hopThoai()).not.toBeNull();
    await bam(trongHop<HTMLInputElement>('input[name="paid"]'));
    go(trongHop('textarea[name="accountingNote"]'), "Đã nhận HĐ đỏ");
    h.ghi.mockResolvedValue({ row: dto(r, { paid: true, paidAt: "2026-10-06T03:00:00.000Z", accountingNote: "Đã nhận HĐ đỏ" }) });
    await bam(nutTrongHop("Lưu")!);
    expect(h.ghi).toHaveBeenCalledTimes(1);
    expect(h.ghi.mock.calls[0]).toEqual([41, "sheet", "rid/có dấu", { baseVersion: 2, paid: true, paidMethod: "chuyen-khoan", accountingNote: "Đã nhận HĐ đỏ" }]);
    expect(hopThoai(), "lưu xong đóng hộp").toBeNull();
  });

  it("dòng Hà Nội đi phía 'hn'; ngày gửi 'YYYY-MM-DD', xoá ngày gửi null", async () => {
    const a = hang({ category: "hanoi", quoteId: 50, rid: "hn1", tableName: "Giá Hà Nội", sheetId: null, sheetCode: null, sheetName: null });
    const b = hang({ quoteId: 51, rid: "s1", version: 5, invoiceDate: "2026-10-01" });
    await mo([a, b]);
    await moHop(0);
    go(trongHop('input[name="invoiceDate"]'), "2026-10-05");
    h.ghi.mockResolvedValue({ row: dto(a, { invoiceDate: "2026-10-05" }) });
    await bam(nutTrongHop("Lưu")!);
    expect(h.ghi.mock.calls[0]).toEqual([50, "hn", "hn1", { baseVersion: 0, invoiceDate: "2026-10-05" }]);
    await moHop(1);
    go(trongHop('input[name="invoiceDate"]'), "");
    h.ghi.mockResolvedValue({ row: dto(b, { invoiceDate: null }) });
    await bam(nutTrongHop("Lưu")!);
    expect(h.ghi.mock.calls[1]).toEqual([51, "sheet", "s1", { baseVersion: 5, invoiceDate: null }]);
  });

  it("BỎ tích phải qua hộp xác nhận (ảnh hiện tại RÚT khỏi khoản, vẫn giữ lịch sử); thân là {paid:false} — KHÔNG có khoá paidProof", async () => {
    const r = hang({ paid: true, paidAt: "2026-10-03T03:00:00.000Z", hasPaidProof: true, version: 4 });
    await mo([r]);
    await moHop();
    h.dongY = false;
    await bam(trongHop('input[name="paid"]'));
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(String(h.confirm.mock.calls[0][1])).toContain("Ảnh hiện tại sẽ được RÚT khỏi khoản — vẫn giữ trong lịch sử");
    expect(trongHop<HTMLInputElement>('input[name="paid"]').checked, "huỷ xác nhận → vẫn tích").toBe(true);
    h.dongY = true;
    await bam(trongHop('input[name="paid"]'));
    expect(trongHop<HTMLInputElement>('input[name="paid"]').checked).toBe(false);
    h.ghi.mockResolvedValue({ row: dto(r, { paid: false, paidAt: null, hasPaidProof: false }) });
    await bam(nutTrongHop("Lưu")!);
    const than = h.ghi.mock.calls[0][3] as Record<string, unknown>;
    expect(than).toEqual({ baseVersion: 4, paid: false });
    expect(Object.prototype.hasOwnProperty.call(than, "paidProof")).toBe(false);
  });

  it("chọn ảnh khi tích → gửi kèm data-URL đã nén; 415 → báo đúng lời máy chủ, GIỮ ảnh vừa chọn, không nạp lại; Lưu lại vẫn gửi ảnh", async () => {
    const r = hang({ version: 1 });
    await mo([r]);
    await moHop();
    await bam(trongHop('input[name="paid"]'));
    const tep = trongHop<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(tep, "files", { value: [new File(["x"], "uy-nhiem-chi.png", { type: "image/png" })], configurable: true });
    await act(async () => { tep.dispatchEvent(new Event("change", { bubbles: true })); });
    await cho();
    expect(trongHop<HTMLImageElement>(".inv-in-hop-anh img").getAttribute("src")).toBe(h.anhNen);
    const goiTruoc = h.goi;
    h.ghi.mockRejectedValueOnce(new ApiError("Nội dung không phải ảnh PNG/JPG/WEBP", 415, { error: "Nội dung không phải ảnh PNG/JPG/WEBP", code: "khong-phai-anh" }));
    await bam(nutTrongHop("Lưu")!);
    expect(h.ghi.mock.calls[0][3]).toEqual({ baseVersion: 1, paid: true, paidMethod: "chuyen-khoan", paidProof: h.anhNen });
    expect(h.toast).toHaveBeenCalledWith("Nội dung không phải ảnh PNG/JPG/WEBP", "error");
    expect(hopThoai(), "hộp còn mở").not.toBeNull();
    expect(trongHop<HTMLImageElement>(".inv-in-hop-anh img").getAttribute("src"), "ảnh vừa chọn còn nguyên").toBe(h.anhNen);
    await cho();
    expect(h.goi, "415 không nạp lại danh sách").toBe(goiTruoc);
    h.ghi.mockResolvedValueOnce({ row: dto(r, { paid: true, hasPaidProof: true }) });
    await bam(nutTrongHop("Lưu")!);
    expect(h.ghi.mock.calls[1][3]).toEqual({ baseVersion: 1, paid: true, paidMethod: "chuyen-khoan", paidProof: h.anhNen });
  });

  it("'Xác nhận số tiền hiện tại' (số tiền đổi sau khi chi) gửi paid:true", async () => {
    const r = hang({ paid: true, paidAt: "2026-10-03T03:00:00.000Z", tienDoi: true, paidAmount: 900, amount: 1000, version: 7 });
    await mo([r]);
    await moHop();
    expect(hopThoai()!.textContent).toContain("Số tiền đã đổi sau khi chi: đã chi 900 — hiện 1.000");
    await bam(trongHop('input[name="xacNhanTien"]'));
    h.ghi.mockResolvedValue({ row: dto(r, { tienDoi: false, paidAmount: 1000 }) });
    await bam(nutTrongHop("Lưu")!);
    expect(h.ghi.mock.calls[0][3]).toEqual({ baseVersion: 7, paid: true });
  });

  it("200 → vá cache bằng dòng trả về (không nạp lại); dòng vừa sửa ĐỨNG YÊN dù không còn khớp bộ lọc — tới khi đổi bộ lọc", async () => {
    const a = hang({ name: "A" }), b = hang({ name: "B" });
    await mo([a, b]);
    go(chon("Lọc theo thanh toán"), "unpaid");
    expect(tenDong()).toEqual(["A", "B"]);
    const goiTruoc = h.goi;
    await moHop(0);
    await bam(trongHop('input[name="paid"]'));
    h.ghi.mockResolvedValue({ row: dto(a, { paid: true, paidAt: "2026-10-06T03:00:00.000Z", paidByName: "KT" }) });
    await bam(nutTrongHop("Lưu")!);
    await cho();
    expect(h.goi, "vá cache, không gọi lại danh sách").toBe(goiTruoc);
    expect(oKeToan(0).textContent).toContain("✓ Đã chi · 06/10/2026");
    const cache = qc.getQueryData<InputInvoicesResp>(["inputInvoices"])!;
    expect(cache.data.find((x) => x.key === a.key)!.paid).toBe(true);
    expect(cache.data.find((x) => x.key === a.key)!.version).toBe(1);
    expect(tenDong(), "A đã chi nhưng vẫn nằm yên dưới bộ lọc 'Chưa thanh toán'").toEqual(["A", "B"]);
    go(chon("Lọc theo ngày hóa đơn"), "chua");
    expect(tenDong(), "đổi bộ lọc → A rời danh sách").toEqual(["B"]);
  });

  it("XEM THỬ quyền: lệnh ghi trả 'thành công giả' → KHÔNG vá cache, dòng giữ nguyên", async () => {
    h.xemThu = true;
    const r = hang();
    await mo([r]);
    await moHop();
    await bam(trongHop('input[name="paid"]'));
    h.ghi.mockResolvedValue({ ok: true, id: 900000123, _preview: true, baseVersion: 0, paid: true });
    await bam(nutTrongHop("Lưu")!);
    expect(h.ghi).toHaveBeenCalledTimes(1);
    expect(hopThoai()).toBeNull();
    expect(qc.getQueryData<InputInvoicesResp>(["inputInvoices"])!.data[0].paid).toBe(false);
    expect(oKeToan(0).textContent).toContain("Chưa chi");
    expect(String(h.toast.mock.calls.at(-1)?.[0])).toMatch(/xem thử/i);
  });
});

describe("hộp 'Khoản chi' — xung đột, lỗi, quyền", () => {
  it("409 'khoan-chi-da-doi' → báo + nạp lại; phần đang nhập GIỮ, ô chưa đụng lấy giá trị mới, lần Lưu sau dùng version mới", async () => {
    let ban = 2;
    const goc = hang({ quoteId: 60, rid: "x1", version: 2 });
    await mo(() => ({ data: [ban === 2 ? goc : { ...goc, version: 3, invoiceDate: "2026-10-02" }], meta: { quotes: 1, truncated: false } }));
    await moHop();
    go(trongHop('textarea[name="accountingNote"]'), "Ghi chú của tôi");
    ban = 3;   // kế toán khác vừa ghi Ngày HĐ
    h.ghi.mockRejectedValueOnce(new ApiError("Kế toán khác vừa sửa khoản này", 409, { error: "Kế toán khác vừa sửa khoản này", code: "khoan-chi-da-doi" }));
    const goiTruoc = h.goi;
    await bam(nutTrongHop("Lưu")!);
    await cho();
    expect(h.toast).toHaveBeenCalledWith("Kế toán khác vừa sửa khoản này — đã nạp lại, phần bạn đang nhập vẫn giữ", "error");
    expect(h.goi, "đã nạp lại danh sách").toBeGreaterThan(goiTruoc);
    expect(hopThoai(), "hộp vẫn mở").not.toBeNull();
    expect(trongHop<HTMLTextAreaElement>('textarea[name="accountingNote"]').value).toBe("Ghi chú của tôi");
    expect(trongHop<HTMLInputElement>('input[name="invoiceDate"]').value, "ô chưa đụng lấy giá trị người kia vừa ghi").toBe("2026-10-02");
    h.ghi.mockResolvedValueOnce({ row: dto({ ...goc, version: 3 }, { accountingNote: "Ghi chú của tôi", invoiceDate: "2026-10-02" }) });
    await bam(nutTrongHop("Lưu")!);
    expect(h.ghi.mock.calls[1]).toEqual([60, "sheet", "x1", { baseVersion: 3, accountingNote: "Ghi chú của tôi" }]);
  });

  it("409 'hang-*' / 404 → báo lời máy chủ + nạp lại; dòng biến mất thì hộp báo 'không còn' và khoá Lưu. 403 → chỉ báo", async () => {
    let con = true;
    const r = hang();
    await mo(() => ({ data: con ? [r] : [], meta: { quotes: 1, truncated: false } }));
    await moHop();
    go(trongHop('textarea[name="accountingNote"]'), "abc");
    h.ghi.mockRejectedValueOnce(new ApiError("Bạn không có quyền sửa Ngày hóa đơn / Ghi chú kế toán", 403, { error: "x" }));
    let goiTruoc = h.goi;
    await bam(nutTrongHop("Lưu")!);
    await cho();
    expect(h.toast).toHaveBeenLastCalledWith("Bạn không có quyền sửa Ngày hóa đơn / Ghi chú kế toán", "error");
    expect(h.goi, "403 không nạp lại").toBe(goiTruoc);
    con = false;
    h.ghi.mockRejectedValueOnce(new ApiError("Không tìm thấy dòng này trong báo giá (có thể vừa bị xoá hoặc đổi) — hãy tải lại trang.", 404, { error: "x", code: "khong-thay-hang" }));
    goiTruoc = h.goi;
    await bam(nutTrongHop("Lưu")!);
    await cho();
    expect(h.toast).toHaveBeenLastCalledWith("Không tìm thấy dòng này trong báo giá (có thể vừa bị xoá hoặc đổi) — hãy tải lại trang.", "error");
    expect(h.goi).toBeGreaterThan(goiTruoc);
    expect(hopThoai()!.textContent).toContain("không còn trong danh sách");
    expect(nutTrongHop("Lưu")!.disabled).toBe(true);
    expect(trongHop<HTMLTextAreaElement>('textarea[name="accountingNote"]').value, "chữ đang gõ vẫn còn để chép lại").toBe("abc");
  });

  it("dưới <StrictMode> (bản dev — main.tsx): lưu hỏng thì nút trở lại 'Lưu', không kẹt 'Đang lưu…'", async () => {
    h.resp = { data: [hang()], meta: { quotes: 1, truncated: false } };
    khung = document.createElement("div"); document.body.appendChild(khung);
    root = createRoot(khung);
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => { root!.render(<StrictMode><QueryClientProvider client={qc}><InvoicesInPage me={ME_KE_TOAN} /></QueryClientProvider></StrictMode>); });
    await cho();
    await moHop();
    go(trongHop('textarea[name="accountingNote"]'), "abc");
    h.ghi.mockRejectedValueOnce(new ApiError("Ghi chú kế toán tối đa 1000 ký tự", 400, { error: "x" }));
    await bam(nutTrongHop("Lưu")!);
    await cho();
    expect(nutTrongHop("Lưu"), "nút không kẹt ở 'Đang lưu…'").toBeDefined();
    expect(nutTrongHop("Lưu")!.disabled).toBe(false);
  });

  it("409 'hang-chua-duyet' cũng nạp lại", async () => {
    await mo([hang()]);
    await moHop();
    await bam(trongHop('input[name="paid"]'));
    h.ghi.mockRejectedValueOnce(new ApiError("Dòng này chưa được duyệt — chưa đánh dấu đã chi được.", 409, { error: "x", code: "hang-chua-duyet" }));
    const goiTruoc = h.goi;
    await bam(nutTrongHop("Lưu")!);
    await cho();
    expect(h.toast).toHaveBeenLastCalledWith("Dòng này chưa được duyệt — chưa đánh dấu đã chi được.", "error");
    expect(h.goi).toBeGreaterThan(goiTruoc);
  });

  it("thiếu invoice:input:pay → ô 'Đã chi' KHOÁ kèm gợi ý xin quyền; ngày + ghi chú vẫn sửa được", async () => {
    await mo([hang({ paid: true, paidAt: "2026-10-03T03:00:00.000Z", hasPaidProof: true })], { ...ME_XEM, permissions: ["invoice:page", "invoice:edit"] });
    await moHop();
    expect(trongHop<HTMLInputElement>('input[name="paid"]').disabled).toBe(true);
    expect(hopThoai()!.textContent).toContain("nhờ quản trị cấp quyền Hóa đơn đầu vào: tích ĐÃ CHI + ảnh chứng từ");
    expect(nutTrongHop("Xem ảnh"), "ảnh ủy nhiệm chi là dữ liệu cá nhân — chỉ người có quyền tích xem").toBeUndefined();
    expect(trongHop<HTMLTextAreaElement>('textarea[name="accountingNote"]').disabled).toBe(false);
    expect(trongHop<HTMLInputElement>('input[name="invoiceDate"]').disabled).toBe(false);
  });

  it("thiếu invoice:edit → ngày + ghi chú KHOÁ kèm lý do", async () => {
    await mo([hang()], { ...ME_XEM, permissions: ["invoice:page", "invoice:input:pay"] });
    await moHop();
    expect(trongHop<HTMLTextAreaElement>('textarea[name="accountingNote"]').disabled).toBe(true);
    expect(trongHop<HTMLInputElement>('input[name="invoiceDate"]').disabled).toBe(true);
    expect(hopThoai()!.textContent).toContain("Bạn chưa có quyền sửa Ngày hóa đơn / Ghi chú kế toán");
    expect(trongHop<HTMLInputElement>('input[name="paid"]').disabled).toBe(false);
  });

  it("hàng chưa duyệt (Cần chú ý) mà CHƯA chi → không tích mới được (kèm lý do); đã chi thì bỏ tích được; 'không còn hàng' không đính ảnh mới", async () => {
    await mo([
      hang({ trangThaiHang: "chua-duyet", approvedAt: null, approvedByName: null }),
      hang({ trangThaiHang: "khong-con-hang", paid: true, paidAt: "2026-10-03T03:00:00.000Z", approvedAt: null }),
    ]);
    await bam(theCanChuY()!);
    await moHop(0);
    expect(trongHop<HTMLInputElement>('input[name="paid"]').disabled).toBe(true);
    expect(hopThoai()!.textContent).toContain("chưa đánh dấu đã chi được");
    await bam(nutTrongHop("Hủy")!);
    await moHop(1);
    expect(trongHop<HTMLInputElement>('input[name="paid"]').disabled, "khoản đã chi vẫn bỏ tích được").toBe(false);
    expect(nutTrongHop("Chọn ảnh…"), "hàng không còn trong báo giá — không đính ảnh mới").toBeUndefined();
    expect(hopThoai()!.textContent).toContain("không đính ảnh mới được");
  });

  it("xem ảnh theo yêu cầu, ba trạng thái: đang tải → lỗi + Thử lại → có ảnh; 'Ảnh trước (n)' mở đúng proofId; không có ảnh → nói rõ", async () => {
    const r = hang({
      quoteId: 70, rid: "p1", paid: true, paidAt: "2026-10-03T03:00:00.000Z", hasPaidProof: true,
      proofs: [
        { id: 5, uploadedAt: "2026-10-03T03:00:00.000Z", uploadedByName: "KT", retiredAt: null, retiredReason: null, source: "upload", hienTai: true },
        { id: 4, uploadedAt: "2026-10-02T03:00:00.000Z", uploadedByName: "KT", retiredAt: "2026-10-03T03:00:00.000Z", retiredReason: "thay", source: "upload", hienTai: false },
      ],
    });
    await mo([r]);
    await moHop();
    expect(h.anh, "mở hộp KHÔNG tự tải ảnh (mỗi lần xem là một dòng nhật ký dữ liệu cá nhân)").not.toHaveBeenCalled();
    let traLoi: (v: unknown) => void = () => {};
    let tuChoi: (e: unknown) => void = () => {};
    h.anh.mockImplementationOnce(() => new Promise((ok, loi) => { traLoi = ok; tuChoi = loi; }));
    await bam(nutTrongHop("Xem ảnh")!);
    expect(h.anh.mock.calls[0]).toEqual([70, "sheet", "p1", undefined, "chi"]);
    expect(trongHop('[aria-busy="true"]'), "đang tải").not.toBeNull();
    await act(async () => { tuChoi(new ApiError("Máy chủ lỗi 500 — thử lại sau ít phút.", 500, null)); });
    expect(trongHop(".inv-in-hop-xem .err")!.textContent).toContain("Máy chủ lỗi 500");
    expect(trongHop(".inv-in-hop-xem img"), "lỗi tải KHÔNG nói thành 'không có ảnh'").toBeNull();
    h.anh.mockImplementationOnce(() => new Promise((ok) => { traLoi = ok; }));
    await bam(nutTrongHop("Thử lại")!);
    await act(async () => { traLoi({ paidProof: ANH, proofId: 5, retiredAt: null, nguon: "bang" }); });
    expect(trongHop<HTMLImageElement>(".inv-in-hop-xem img").getAttribute("src")).toBe(ANH);
    expect(hopThoai()!.textContent).toContain("Ảnh trước (1)");
    h.anh.mockResolvedValueOnce({ paidProof: null, proofId: 4, retiredAt: "2026-10-03T03:00:00.000Z", nguon: "bang" });
    await bam([...hopThoai()!.querySelectorAll(".inv-in-hop-truoc button")][0] as HTMLButtonElement);
    await cho();
    expect(h.anh.mock.calls.at(-1)).toEqual([70, "sheet", "p1", 4, "chi"]);
    expect(trongHop(".inv-in-hop-xem")!.textContent).toContain("Không có ảnh");
  });
});

describe("hộp 'Khoản chi' — bàn phím, điều hướng, tải lại trang", () => {
  it("bấm ô Kế toán hay bấm TRONG hộp không đổi location.hash — kể cả admin (người mở được báo giá)", async () => {
    await mo([hang({ quoteId: 77 })], ME_ADMIN);
    expect(dongBang()[0].className).toContain("qrow");
    await bam(nutKeToan(0)!.querySelector("span") as HTMLElement);
    expect(location.hash).toBe("");
    await bam(trongHop('input[name="paid"]'));
    await bam(trongHop(".inv-in-hop-dau"));
    await bam(trongHop('textarea[name="accountingNote"]'));
    expect(location.hash, "cú bấm trong hộp không nổi lên dòng").toBe("");
    // Bấm nền tối (ngoài hộp) → đóng hộp (không có thay đổi thì không hỏi), vẫn không nhảy trang.
    await bam(trongHop('input[name="paid"]'));   // bỏ tích lại → về trạng thái gốc, không còn thay đổi
    const nen = khung.querySelector(".inv-in-hop-nen") as HTMLElement;
    await act(async () => { nen.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); nen.click(); });
    expect(hopThoai()).toBeNull();
    expect(h.confirm).not.toHaveBeenCalled();
    expect(location.hash).toBe("");
  });

  it("Esc đóng hộp KHÔNG gọi API; còn thay đổi thì HỎI trước (Huỷ → hộp ở lại)", async () => {
    await mo([hang()]);
    await moHop();
    await phim(trongHop('input[name="paid"]'), { key: "Escape" });
    expect(hopThoai(), "không thay đổi → đóng ngay").toBeNull();
    expect(h.confirm).not.toHaveBeenCalled();
    await moHop();
    go(trongHop('textarea[name="accountingNote"]'), "đang gõ dở");
    h.dongY = false;
    await phim(trongHop('textarea[name="accountingNote"]'), { key: "Escape" });
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(hopThoai(), "Huỷ → hộp ở lại, chữ còn nguyên").not.toBeNull();
    expect(trongHop<HTMLTextAreaElement>('textarea[name="accountingNote"]').value).toBe("đang gõ dở");
    h.dongY = true;
    await phim(trongHop('textarea[name="accountingNote"]'), { key: "Escape" });
    expect(hopThoai()).toBeNull();
    expect(h.ghi).not.toHaveBeenCalled();
  });

  it("Enter trong ghi chú là xuống dòng; Ctrl+Enter lưu — trừ khi bộ gõ (IME) đang soạn; Esc lúc đang soạn không đóng hộp", async () => {
    const r = hang({ version: 3 });
    await mo([r]);
    await moHop();
    const ta = trongHop<HTMLTextAreaElement>('textarea[name="accountingNote"]');
    go(ta, "Hoá đơn");
    await phim(ta, { key: "Enter" });
    expect(h.ghi, "Enter trần không lưu").not.toHaveBeenCalled();
    await phim(ta, { key: "Enter", ctrlKey: true, isComposing: true });
    expect(h.ghi, "Ctrl+Enter lúc IME đang soạn không lưu").not.toHaveBeenCalled();
    await phim(ta, { key: "Escape", isComposing: true });
    expect(hopThoai(), "Esc lúc IME đang soạn chỉ huỷ cụm chữ").not.toBeNull();
    expect(h.confirm).not.toHaveBeenCalled();
    h.ghi.mockResolvedValue({ row: dto(r, { accountingNote: "Hoá đơn" }) });
    await phim(ta, { key: "Enter", ctrlKey: true });
    expect(h.ghi).toHaveBeenCalledTimes(1);
    expect(h.ghi.mock.calls[0][3]).toEqual({ baseVersion: 3, accountingNote: "Hoá đơn" });
  });

  it("ghi chú: maxLength 1000 + bộ đếm ký tự", async () => {
    await mo([hang()]);
    await moHop();
    const ta = trongHop<HTMLTextAreaElement>('textarea[name="accountingNote"]');
    expect(ta.maxLength).toBe(1000);
    go(ta, "abc");
    expect(trongHop(".inv-in-hop-dem")!.textContent).toContain("3/1000");
  });

  it("dải 'Có bản mới': laTrangAnToan() = false khi hộp CÒN thay đổi chưa lưu; đóng hộp → an toàn lại", async () => {
    await mo([hang()]);
    expect(laTrangAnToan()).toBe(true);
    await moHop();
    expect(laTrangAnToan(), "mở hộp mà chưa sửa gì vẫn an toàn").toBe(true);
    go(trongHop('textarea[name="accountingNote"]'), "chưa lưu");
    expect(laTrangAnToan()).toBe(false);
    await phim(trongHop('textarea[name="accountingNote"]'), { key: "Escape" });   // h.dongY = true → bỏ thay đổi
    expect(hopThoai()).toBeNull();
    expect(laTrangAnToan()).toBe(true);
  });
});

describe("lọc / tìm / thẻ số", () => {
  it("tìm theo ghi chú kế toán, Ngày HĐ (dd/mm/yyyy) và người đánh dấu đã chi (thuần + trên trang)", async () => {
    const ds = [
      hang({ name: "A", accountingNote: "Hóa đơn đỏ đã nhận bản gốc" }),
      hang({ name: "B", invoiceDate: "2026-10-05" }),
      hang({ name: "C", paid: true, paidAt: "2026-10-03T03:00:00.000Z", paidByName: "Nguyễn Kế Toán" }),
    ];
    const ten = (q: string) => locHang(ds, { ...BO_LOC_RONG, q }).map((r) => r.name);
    expect(ten("hoa don do")).toEqual(["A"]);
    expect(ten("05/10/2026")).toEqual(["B"]);
    expect(ten("ke toan nguyen")).toEqual(["C"]);
    expect(ten("da chi")).toContain("C");
    await mo(ds);
    go(khung.querySelector('input[aria-label="Tìm hóa đơn đầu vào"]') as HTMLInputElement, "05/10/2026");
    expect(tenDong()).toEqual(["B"]);
  });

  it("bộ lọc 'Ngày HĐ: Đã có / Chưa có'", async () => {
    const ds = [hang({ name: "A", invoiceDate: "2026-10-05" }), hang({ name: "B" })];
    expect(locHang(ds, { ...BO_LOC_RONG, ngayHd: "co" }).map((r) => r.name)).toEqual(["A"]);
    expect(locHang(ds, { ...BO_LOC_RONG, ngayHd: "chua" }).map((r) => r.name)).toEqual(["B"]);
    await mo(ds);
    // Ở hàng lọc THỨ HAI: ô tìm (sàn 260px) + bốn ô chọn ở hàng một tràn 30px ở laptop 1280px, khung lọc cắt mất nửa
    // phải của ô thứ tư (đo headless 2026-10-06).
    expect(chon("Lọc theo ngày hóa đơn").closest(".inv-filter-extra")).not.toBeNull();
    expect(khung.querySelectorAll(".inv-filter-main select")).toHaveLength(3);
    // Mọi ô lọc có `name` — Chrome DevTools báo "form field should have an id or name" (soát 2026-10-06).
    expect([...khung.querySelectorAll(".inv-filters input, .inv-filters select")].filter((e) => !e.getAttribute("name")), "ô lọc thiếu name").toHaveLength(0);
    go(chon("Lọc theo ngày hóa đơn"), "co");
    expect(tenDong()).toEqual(["A"]);
  });

  it("thẻ 'Cần chú ý' chỉ hiện khi có; dòng đó KHÔNG lẫn danh sách chính và KHÔNG cộng vào thẻ tiền; bấm để xem riêng", async () => {
    await mo([
      hang({ name: "A", amount: 1000000, paid: true, paidAt: "2026-10-03T03:00:00.000Z" }),
      hang({ name: "B", amount: 500000 }),
      hang({ name: "C", amount: 300000, paid: true, paidAt: "2026-10-03T03:00:00.000Z", trangThaiHang: "chua-duyet", approvedAt: null }),
      hang({ name: "D", amount: 200000, trangThaiHang: "khong-con-hang", approvedAt: null }),
    ]);
    expect(tenDong()).toEqual(["A", "B"]);
    expect(stat("Tổng tiền đã duyệt")).toBe("1.500.000");
    expect(stat("Đã thanh toán")).toBe("1.000.000");
    expect(stat("Số khoản")).toBe("2");
    expect(stat("Cần chú ý")).toBe("2");
    await bam(theCanChuY()!);
    expect(tenDong()).toEqual(["C", "D"]);
    expect(stat("Tổng tiền đã duyệt"), "dòng Cần chú ý không phải khoản chi hiệu lực").toBe("0");
    expect(stat("Đã thanh toán")).toBe("0");
    expect(stat("Số khoản")).toBe("2");
    expect(oKeToan(0).querySelector("[data-canh]")!.getAttribute("title")).toContain("chưa duyệt");
    await bam(theCanChuY()!);
    expect(tenDong()).toEqual(["A", "B"]);
    act(() => root!.unmount()); root = null; khung.remove();
    await mo([hang({ name: "A" })]);
    expect(theCanChuY(), "không có dòng cần chú ý → không có thẻ").toBeUndefined();
  });

  it("chỉ có dòng 'Cần chú ý' (chưa dòng nào đã duyệt) → trạng thái rỗng mời bấm thẻ", async () => {
    await mo([hang({ name: "C", trangThaiHang: "hn-chua-duyet", category: "hanoi", approvedAt: null })]);
    expect(khung.querySelector(".empty")!.textContent).toContain("Chưa có hàng nào được duyệt");
    expect(khung.querySelector(".empty")!.textContent).toContain("1 khoản cần chú ý");
    await bam(theCanChuY()!);
    expect(tenDong()).toEqual(["C"]);
  });

  it("bỏ chữ 'CHỈ XEM' — trang ghi được, câu dẫn nói cột Kế toán", async () => {
    await mo([hang()]);
    const dan = khung.querySelector("h1 + p")!.textContent!;
    expect(dan).not.toMatch(/chỉ xem/i);
    expect(dan).toContain("Kế toán");
  });
});

// Soát 2026-10-06 (W3 · W4 · W5 · W6 · W9 · KT-UI-01 · DT-2): những chỗ hộp Khoản chi còn làm mất / ghi đè phần đang nhập,
// hoặc đẩy người dùng vào ngõ cụt. ĐỎ trên bản trước các bản vá.
describe("hộp 'Khoản chi' — không mất, không ghi đè im lặng, không ngõ cụt", () => {
  const ANH_HIEN_TAI = { id: 5, uploadedAt: "2026-10-03T03:00:00.000Z", uploadedByName: "KT A", retiredAt: null, retiredReason: null, source: "upload", hienTai: true };

  it("W3: bấm KHOẢNG TRỐNG của ô Kế toán (ngoài nút) không nhảy sang báo giá; bấm ô khác thì vẫn mở", async () => {
    const r = hang({ quoteId: 77 });
    await mo([r], ME_ADMIN);
    await bam(oKeToan(0));
    expect(location.hash, "hụt nút một chút mà mất chỗ đang làm").toBe("");
    await bam(dongBang()[0].querySelectorAll("td")[2] as HTMLElement);
    expect(location.hash).toBe("#/quotes/77");
  });

  it("W9 + KT-UI-01: dòng BÁO GIÁ ĐÃ XOÁ không mời mở báo giá; ô Kế toán mở hộp CHỈ XEM — xem được ảnh, không Lưu", async () => {
    const lyDo = "Báo giá đã bị xoá — khoản chỉ còn để đối chiếu.";
    const r = hang({
      quoteId: 88, trangThaiHang: "bao-gia-da-xoa", coTheGhi: false, lyDoKhoa: lyDo, approvedAt: null,
      paid: true, paidAt: "2026-10-03T03:00:00.000Z", hasPaidProof: true, proofs: [ANH_HIEN_TAI], version: 2, accountingNote: "Đã nhận HĐ",
    });
    await mo([r], ME_ADMIN);
    await bam(theCanChuY()!);
    const tr = dongBang()[0];
    expect(tr.classList.contains("qrow"), "không gắn kiểu 'bấm được'").toBe(false);
    await bam(tr.querySelectorAll("td")[2] as HTMLElement);
    expect(location.hash, "báo giá đã xoá — mở là 404").toBe("");
    expect(nutKeToan(0), "trước bản vá: ô chỉ là chữ, kế toán không xem lại được ảnh chứng từ").not.toBeNull();
    expect(nutKeToan(0)!.getAttribute("title")).toContain("chỉ xem");
    await moHop();
    expect(hopThoai()!.textContent).toContain(lyDo);
    expect(trongHop<HTMLInputElement>('input[name="paid"]').disabled).toBe(true);
    expect(trongHop<HTMLTextAreaElement>('textarea[name="accountingNote"]').disabled).toBe(true);
    expect(nutTrongHop("Lưu")!.disabled).toBe(true);
    h.anh.mockResolvedValue({ paidProof: ANH, proofId: 5, retiredAt: null, nguon: "bang" });
    await bam(nutTrongHop("Xem ảnh")!);
    await cho();
    expect(h.anh).toHaveBeenCalledWith(88, "sheet", r.rid, undefined, "chi");
    expect(trongHop<HTMLImageElement>(".pay-proof img").getAttribute("src")).toBe(ANH);
  });

  it("W5: đang nén ảnh thì nút Lưu KHOÁ — bấm lúc đó là ghi khoản thiếu đúng tấm ảnh vừa chọn", async () => {
    const r = hang({ version: 3 });
    await mo([r]);
    await moHop();
    await bam(trongHop('input[name="paid"]'));
    expect(nutTrongHop("Lưu")!.disabled).toBe(false);
    let xongNen: (s: string) => void = () => {};
    h.nen.mockImplementation(() => new Promise<string>((res) => { xongNen = res; }));
    const tep = trongHop<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(tep, "files", { value: [new File(["x"], "unc.png", { type: "image/png" })], configurable: true });
    await act(async () => { tep.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(hopThoai()!.textContent).toContain("Đang nén ảnh…");
    expect(nutTrongHop("Lưu")!.disabled, "đang nén").toBe(true);
    await act(async () => { xongNen(h.anhNen); });
    await cho();
    expect(nutTrongHop("Lưu")!.disabled).toBe(false);
    h.ghi.mockResolvedValue({ row: dto(r, { paid: true, hasPaidProof: true }) });
    await bam(nutTrongHop("Lưu")!);
    expect(h.ghi.mock.calls[0][3]).toEqual({ baseVersion: 3, paid: true, paidMethod: "chuyen-khoan", paidProof: h.anhNen });
  });

  it("W6: Ngày hóa đơn ngoài 2000–2100 (gõ thiếu số năm) → báo ngay + khoá Lưu; sửa đúng thì mở", async () => {
    await mo([hang()]);
    await moHop();
    const o = trongHop<HTMLInputElement>('input[name="invoiceDate"]');
    go(o, "0026-10-05");
    expect(hopThoai()!.querySelector(".field-err")!.textContent).toContain("01/01/2000 – 31/12/2100");
    expect(nutTrongHop("Lưu")!.disabled, "máy chủ 400 — đừng để người dùng bấm rồi mới biết").toBe(true);
    go(o, "2101-01-01");
    expect(nutTrongHop("Lưu")!.disabled).toBe(true);
    go(o, "2026-10-05");
    expect(hopThoai()!.querySelector(".field-err")).toBeNull();
    expect(nutTrongHop("Lưu")!.disabled).toBe(false);
  });

  it("DT-2: realtime nạp lại đổi ĐÚNG ô mình đang sửa → HỎI trước khi ghi đè (nêu người + giá trị mới); Huỷ → không gửi", async () => {
    const r = hang({ version: 0, accountingNote: "Cũ" });
    await mo([r]);
    await moHop();
    go(trongHop('textarea[name="accountingNote"]'), "Của tôi");
    // Kế toán B lưu ghi chú khác cho CÙNG khoản; SSE nạp lại danh sách — baseVersion của hộp theo dòng mới, nên KHÔNG có 409.
    h.resp = { data: [{ ...r, version: 1, accountingNote: "Của B", keToanCapNhatBoi: "KT B" }], meta: { quotes: 1, truncated: false } };
    await act(async () => { await qc.invalidateQueries({ queryKey: ["inputInvoices"] }); });
    await cho();
    h.dongY = false;
    await bam(nutTrongHop("Lưu")!);
    expect(h.confirm).toHaveBeenCalledTimes(1);
    const [tieuDe, loi] = h.confirm.mock.calls[0] as [string, string];
    expect(tieuDe).toBe("Khoản vừa được người khác sửa");
    expect(loi).toContain("KT B");
    expect(loi).toContain("Ghi chú kế toán → “Của B”");
    expect(h.ghi, "trước bản vá: ghi đè im lặng 'Của B'").not.toHaveBeenCalled();
    expect(hopThoai(), "hộp ở lại, phần đang nhập còn").not.toBeNull();
    expect(trongHop<HTMLTextAreaElement>('textarea[name="accountingNote"]').value).toBe("Của tôi");
    h.dongY = true;
    h.ghi.mockResolvedValue({ row: dto({ ...r, version: 1 }, { accountingNote: "Của tôi" }) });
    await bam(nutTrongHop("Lưu")!);
    expect(h.ghi.mock.calls[0][3]).toEqual({ baseVersion: 1, accountingNote: "Của tôi" });
  });

  it("DT-2: người khác đổi ô KHÁC (Ngày HĐ) trong lúc mình sửa ghi chú → không hỏi, ghi chú lưu thẳng, ngày của họ giữ nguyên", async () => {
    const r = hang({ version: 0 });
    await mo([r]);
    await moHop();
    go(trongHop('textarea[name="accountingNote"]'), "Ghi chú");
    h.resp = { data: [{ ...r, version: 1, invoiceDate: "2026-10-01" }], meta: { quotes: 1, truncated: false } };
    await act(async () => { await qc.invalidateQueries({ queryKey: ["inputInvoices"] }); });
    await cho();
    expect(trongHop<HTMLInputElement>('input[name="invoiceDate"]').value, "ô chưa đụng lấy giá trị mới").toBe("2026-10-01");
    h.ghi.mockResolvedValue({ row: dto({ ...r, version: 1 }, { accountingNote: "Ghi chú", invoiceDate: "2026-10-01" }) });
    await bam(nutTrongHop("Lưu")!);
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.ghi.mock.calls[0][3]).toEqual({ baseVersion: 1, accountingNote: "Ghi chú" });
  });

  it("W4: còn thay đổi → F5 / đóng tab bị hỏi (beforeunload) và Back / menu hỏi (cờ __editorDirty); đóng hộp → gỡ cả hai", async () => {
    const w = window as Window & { __editorDirty?: boolean };
    const thuTai = () => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    await mo([hang()]);
    await moHop();
    expect(thuTai(), "chưa sửa gì thì không hỏi").toBe(false);
    expect(!!w.__editorDirty).toBe(false);
    go(trongHop('textarea[name="accountingNote"]'), "đang gõ dở");
    expect(thuTai(), "trước bản vá: F5 là mất im lặng").toBe(true);
    expect(w.__editorDirty, "Shell.guardLeave đọc cờ này khi Back / bấm menu").toBe(true);
    await bam(nutTrongHop("Hủy")!);   // h.dongY = true → "Bỏ thay đổi"
    expect(hopThoai()).toBeNull();
    expect(thuTai()).toBe(false);
    expect(w.__editorDirty).toBe(false);
  });
});
