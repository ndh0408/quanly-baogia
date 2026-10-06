/** @vitest-environment jsdom */
//
// ĐỔI KHÁCH HÀNG (danh mục) NGAY TRONG MÀN SOẠN BÁO GIÁ (chủ repo 2026-09-30: "trong báo giá cho chọn đổi khách hàng luôn nhé").
// Điều dễ vỡ âm thầm, nên bài này khoá từng cái:
//   · các ô "Bên nhận" là UNCONTROLLED (defaultValue) — đổi `q.toCompany…` mà không dựng lại ô thì màn hình vẫn hiện khách CŨ
//     trong khi payload Lưu mang khách MỚI (hoặc ngược lại);
//   · khách mới để trống một ô (email/SĐT…) thì ô đó phải TRỐNG — không được giữ email/SĐT của khách CŨ dưới tên khách mới;
//   · chọn lại ĐÚNG khách đang gắn thì không đè phần người dùng đã sửa tay;
//   · chỉ người sửa được phần "Báo giá chính" thấy nút (khoá hoá đơn, không quyền sửa → không nút);
//   · lỗi tải danh mục (không có quyền) phải được nói ra, không giả làm "không có khách khớp".
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const MAU = [{ id: 1, code: "gn", name: "GN", companyId: 7, layout: { hasDays: false } }];
const CTY = [{ id: 7, name: "Gia Nguyễn" }];
const KHACH = [
  { id: 5, code: "KH005", name: "Công ty Cũ", phone: "0900", email: "cu@x.vn", contactName: "Anh Cũ", address: "Địa chỉ cũ" },
  { id: 9, code: "KH009", name: "Công ty Mới", phone: "0911", email: "moi@x.vn", contactName: "Chị Mới", address: "Địa chỉ mới" },
  { id: 10, code: "KH010", name: "Khách Trống", phone: null, email: null, contactName: null, address: null },
];
const baoGia = (over: Record<string, unknown> = {}) => ({
  id: 11, quoteNumber: "GN26011", title: "Sự kiện", status: "draft", companyId: 7, createdById: 1,
  toCompany: "Công ty Cũ", toContact: "Anh Cũ", toEmail: "cu@x.vn", toPhone: "0900", toAddress: "Địa chỉ cũ",
  customerId: 5, customerCode: "KH005", customerName: "Công ty Cũ", customer: { code: "KH005", name: "Công ty Cũ" },
  vatPercent: 0, discount: 0, showTotals: true, city: "TP. Hồ Chí Minh", quoteDate: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z", hnTables: [], members: [],
  sheets: [{ id: 101, templateId: 1, name: "Trang 1", groupSubtotal: false, items: [{ kind: "item", name: "Backdrop", unit: "cái", quantity: 1, unitPrice: 1000 }], extraTables: [] }],
  ...over,
});

const h = vi.hoisted(() => ({
  updateQuote: null as unknown as ReturnType<typeof vi.fn>,
  listCustomers: null as unknown as ReturnType<typeof vi.fn>,
  toast: null as unknown as ReturnType<typeof vi.fn>,
  getQuote: null as unknown as ReturnType<typeof vi.fn>,
}));
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  const fns: Record<string, ReturnType<typeof vi.fn>> = {
    metaCompanies: vi.fn(async () => CTY),
    metaTemplates: vi.fn(async () => MAU),
    getQuote: vi.fn(async () => baoGia()),
    presence: vi.fn(async () => ({ editing: [] })),
    hnAccounts: vi.fn(async () => ({ data: [] })),
    updateQuote: vi.fn(async (_id: number, p: Record<string, unknown>) => baoGia({ ...p, updatedAt: "2026-06-14T01:00:00.000Z" })),
    listCustomers: vi.fn(async () => ({ data: KHACH, meta: { total: KHACH.length, page: 1, size: 30, pageCount: 1 } })),
  };
  h.updateQuote = fns.updateQuote; h.listCustomers = fns.listCustomers; h.getQuote = fns.getQuote;
  const api = new Proxy(fns, { get: (t, k: string) => t[k] ?? (t[k] = vi.fn(async () => ({}))) });
  return { ...that, api };
});
vi.mock("../lib/ui", async (goc) => {
  const that = await goc<typeof import("../lib/ui")>();
  h.toast = vi.fn();
  return { ...that, toast: h.toast, confirmModal: vi.fn(async () => true) };
});
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { QuoteEditorPage } from "./QuoteEditor";
import { ApiError } from "../lib/api";

const ME = { id: 1, username: "a", displayName: "A", role: "admin", permissions: ["quote:send", "quote:update:all", "quote:read:all"] };
const ME_CHI_XEM = { id: 2, username: "b", displayName: "B", role: "manager", permissions: ["quote:read:own"] };

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  (window as unknown as { __editorDirty?: boolean }).__editorDirty = false;
  h.getQuote.mockImplementation(async () => baoGia());
  h.listCustomers.mockImplementation(async () => ({ data: KHACH, meta: { total: KHACH.length, page: 1, size: 30, pageCount: 1 } }));
});
afterEach(async () => {
  await cho(1300);   // hẹn giờ ghi bản nháp 1,2s — cho nổ trong act rồi mới tháo cây
  if (root) act(() => root!.unmount());
  root = null; hop?.remove(); hop = null; document.body.innerHTML = "";
});

async function moEditor(me = ME) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  await act(async () => { root!.render(<QuoteEditorPage me={me} quoteId={11} isNew={false} />); });
  await cho(10);
}
const nutDoi = () => [...hop!.querySelectorAll("button")].find((b) => b.textContent === "Đổi khách hàng" || b.textContent === "Chọn khách hàng") as HTMLButtonElement | undefined;
const khungKh = () => hop!.querySelector(".kh-chon") as HTMLElement;
const o = (placeholder: string) => hop!.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
const oTen = () => o("Tên công ty khách"), oLienHe = () => o("Người liên hệ phía KH"), oEmail = () => o("Email khách (hiện ở 'Kính gửi')"), oSdt = () => o("SĐT khách hàng"), oDiaChi = () => o("Địa chỉ khách hàng");
const hopChon = () => document.querySelector('.modal[aria-label="Chọn khách hàng"]') as HTMLElement | null;
const dongKhach = (ma: string) => [...document.querySelectorAll<HTMLElement>('.modal[aria-label="Chọn khách hàng"] tr.qrow')].find((t) => t.textContent?.includes(ma))!;
async function moHopChon() {
  await act(async () => { nutDoi()!.click(); });
  await cho(300);   // ô tìm hoãn 250ms
}
function go(el: HTMLInputElement, v: string) {
  // setter GỐC của prototype: gán thẳng `el.value` làm bộ theo dõi giá trị của React tưởng không đổi → ô CÓ KIỂM SOÁT (ô tìm của
  // hộp chọn) không nhận onChange. Ô không kiểm soát (bên nhận) chạy được với cả hai cách.
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => { setter.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const luu = async () => {
  const b = [...hop!.querySelectorAll("button")].find((x) => x.textContent?.includes("Lưu")) as HTMLButtonElement;
  await act(async () => { b.click(); }); await cho(10);
};

describe("Màn soạn báo giá — khách hàng đang gắn + nút Đổi", () => {
  it("hiện mã + tên khách (danh mục) đang gắn và nút 'Đổi khách hàng' cho người sửa được", async () => {
    await moEditor();
    expect(khungKh().textContent).toContain("KH005");
    expect(khungKh().textContent).toContain("Công ty Cũ");
    expect(nutDoi()!.textContent).toBe("Đổi khách hàng");
  });

  it("báo giá CHƯA gắn khách (cũ) → nói rõ + nút 'Chọn khách hàng'", async () => {
    h.getQuote.mockImplementation(async () => baoGia({ customerId: null, customerCode: null, customerName: null, customer: null }));
    await moEditor();
    expect(khungKh().textContent).toContain("Chưa gắn khách hàng trong danh mục");
    expect(nutDoi()!.textContent).toBe("Chọn khách hàng");
  });

  it("không sửa được → KHÔNG có nút (người chỉ có quote:read:own; báo giá đã xuất hoá đơn)", async () => {
    await moEditor(ME_CHI_XEM);
    expect(nutDoi(), "người chỉ xem không được đổi khách").toBeUndefined();
    expect(khungKh().textContent, "nhưng vẫn thấy khách đang gắn").toContain("KH005");
    act(() => root!.unmount()); root = null; hop!.remove(); document.body.innerHTML = "";
    h.getQuote.mockImplementation(async () => baoGia({ sheets: [{ id: 101, templateId: 1, name: "Trang 1", groupSubtotal: false, invoiceNo: "HD001", items: [{ kind: "item", name: "Backdrop", unit: "cái", quantity: 1, unitPrice: 1000 }], extraTables: [] }] }));
    await moEditor();
    expect(nutDoi(), "đã xuất hoá đơn thì khoá (khớp máy chủ)").toBeUndefined();
  });
});

describe("Màn soạn báo giá — đổi khách", () => {
  it("chọn khách mới → khối hiện khách mới, MỌI ô bên nhận đổi theo khách mới (không chỉ tên), chưa gọi máy chủ, cờ chưa-lưu bật", async () => {
    await moEditor();
    await moHopChon();
    expect(hopChon()).toBeTruthy();
    expect(hopChon()!.textContent, "khách đang gắn được đánh dấu").toContain("đang chọn");
    await act(async () => { dongKhach("KH009").click(); });
    expect(hopChon(), "chọn xong hộp đóng").toBeNull();
    expect(khungKh().textContent).toContain("KH009");
    expect(khungKh().textContent).toContain("Công ty Mới");
    expect(oTen().value).toBe("Công ty Mới");
    expect(oLienHe().value).toBe("Chị Mới");
    expect(oEmail().value).toBe("moi@x.vn");
    expect(oSdt().value).toBe("0911");
    expect(oDiaChi().value).toBe("Địa chỉ mới");
    expect(h.updateQuote, "đổi khách CHƯA lưu cho tới khi bấm Lưu").not.toHaveBeenCalled();
    expect((window as unknown as { __editorDirty?: boolean }).__editorDirty, "rời trang phải hỏi 'chưa lưu'").toBe(true);
    expect(String(h.toast.mock.calls.at(-1)?.[0])).toContain("KH009");
  });

  it("bấm Lưu → payload mang customerId MỚI + khối bên nhận MỚI (màn hình và dữ liệu gửi đi khớp nhau)", async () => {
    await moEditor();
    await moHopChon();
    await act(async () => { dongKhach("KH009").click(); });
    await luu();
    expect(h.updateQuote).toHaveBeenCalledTimes(1);
    const p = h.updateQuote.mock.calls[0][1] as Record<string, unknown>;
    expect(p).toMatchObject({ customerId: 9, toCompany: "Công ty Mới", toContact: "Chị Mới", toEmail: "moi@x.vn", toPhone: "0911", toAddress: "Địa chỉ mới" });
  });

  it("khách mới THIẾU thông tin → ô đó TRỐNG, KHÔNG giữ email/SĐT/địa chỉ của khách CŨ dưới tên khách mới", async () => {
    await moEditor();
    await moHopChon();
    await act(async () => { dongKhach("KH010").click(); });
    expect(oTen().value).toBe("Khách Trống");
    for (const [ten, el] of [["người liên hệ", oLienHe()], ["email", oEmail()], ["SĐT", oSdt()], ["địa chỉ", oDiaChi()]] as const) expect(el.value, `${ten} của khách CŨ còn sót`).toBe("");
    await luu();
    const p = h.updateQuote.mock.calls[0][1] as Record<string, unknown>;
    expect(p).toMatchObject({ customerId: 10, toCompany: "Khách Trống", toContact: "", toEmail: "", toPhone: "", toAddress: "" });
  });

  it("chọn LẠI đúng khách đang gắn → không đổi gì, KHÔNG đè phần đã sửa tay; báo cho người dùng biết", async () => {
    await moEditor();
    go(oTen(), "Tên tôi sửa tay");
    await moHopChon();
    await act(async () => { dongKhach("KH005").click(); });
    expect(oTen().value, "sửa tay bị đè").toBe("Tên tôi sửa tay");
    expect(String(h.toast.mock.calls.at(-1)?.[0])).toContain("đã thuộc khách hàng này");
    await luu();
    expect((h.updateQuote.mock.calls[0][1] as Record<string, unknown>).toCompany).toBe("Tên tôi sửa tay");
  });

  it("đổi khách rồi sửa tay một ô vẫn được (các ô không bị khoá)", async () => {
    await moEditor();
    await moHopChon();
    await act(async () => { dongKhach("KH009").click(); });
    go(oLienHe(), "Người khác");
    await luu();
    const p = h.updateQuote.mock.calls[0][1] as Record<string, unknown>;
    expect(p).toMatchObject({ customerId: 9, toCompany: "Công ty Mới", toContact: "Người khác" });
  });

  it("đóng hộp chọn (Esc / Đóng) → không đổi gì", async () => {
    await moEditor();
    await moHopChon();
    await act(async () => { [...document.querySelectorAll<HTMLButtonElement>(".modal-foot button")].find((b) => b.textContent === "Đóng")!.click(); });
    expect(hopChon()).toBeNull();
    expect(oTen().value).toBe("Công ty Cũ");
    expect(khungKh().textContent).toContain("KH005");
    expect((window as unknown as { __editorDirty?: boolean }).__editorDirty).toBe(false);
  });
});

describe("Hộp chọn khách hàng (dùng chung với wizard)", () => {
  it("lỗi tải danh mục (không có quyền xem) → NÓI RA lỗi, không giả làm 'Không có khách hàng khớp'", async () => {
    h.listCustomers.mockImplementation(async () => { throw new ApiError("Bạn không có quyền xem dữ liệu này", 403, null); });
    await moEditor();
    await moHopChon();
    expect(hopChon()!.textContent).toContain("Bạn không có quyền xem dữ liệu này");
    expect(hopChon()!.textContent).not.toContain("Không có khách hàng khớp");
  });

  it("gõ tìm gọi API với từ khoá (sau hoãn) và chỉ nhận kết quả của lượt CUỐI (lượt cũ về muộn không đè)", async () => {
    let traLoiCu: (v: unknown) => void = () => {};
    h.listCustomers.mockImplementation(async (q: string) => {
      if (q === "") return { data: KHACH, meta: { total: 3, page: 1, size: 30, pageCount: 1 } };
      if (q === "moi") return new Promise((r) => { traLoiCu = r; });   // lượt chậm
      return { data: [KHACH[2]], meta: { total: 1, page: 1, size: 30, pageCount: 1 } };   // lượt mới nhanh hơn
    });
    await moEditor();
    await moHopChon();
    const tim = document.querySelector('.modal[aria-label="Chọn khách hàng"] input[type="search"]') as HTMLInputElement;
    go(tim, "moi"); await cho(300);       // lượt 1: treo
    go(tim, "trong"); await cho(300);     // lượt 2: về ngay
    expect(document.querySelectorAll('.modal[aria-label="Chọn khách hàng"] tr.qrow')).toHaveLength(1);
    await act(async () => { traLoiCu({ data: [KHACH[1]], meta: { total: 1, page: 1, size: 30, pageCount: 1 } }); });   // lượt 1 về MUỘN
    await cho(10);
    expect(document.querySelector('.modal[aria-label="Chọn khách hàng"] tr.qrow')!.textContent, "kết quả của lượt cũ đè lượt mới").toContain("KH010");
  });

  it("nhiều khách hơn số hiện → nhắc gõ thêm để thu hẹp", async () => {
    h.listCustomers.mockImplementation(async () => ({ data: KHACH, meta: { total: 120, page: 1, size: 30, pageCount: 4 } }));
    await moEditor();
    await moHopChon();
    expect(hopChon()!.textContent).toContain("3/120");
  });
});
