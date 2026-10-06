/** @vitest-environment jsdom */
//
// BỘ LỌC ĐẦY ĐỦ của Danh sách báo giá (chủ repo 2026-09-30: "bộ lọc … chưa đầy đủ và thông minh"). Component thuần: nhận bộ lọc
// + số đếm, báo ý định qua `dat` / `xoa`. Bài này kiểm từng ô theo cách NGƯỜI DÙNG dùng, và những chỗ dễ vỡ âm thầm:
//   · "chưa ghi chú" và "theo màu" LOẠI TRỪ nhau (lọc cả hai luôn ra 0 dòng);
//   · ô tiền đọc "100tr"/"1,5 tỷ", gõ chưa hiểu thì BÁO LỖI và KHÔNG đổi bộ lọc (không đoán bừa số tiền);
//   · chip "Khác" (trạng thái cũ) chỉ hiện khi còn dữ liệu cũ hoặc đang chọn;
//   · người/công ty đang chọn mà lượt đếm sau không còn trả về vẫn hiện ĐÚNG TÊN, không thành "#7";
//   · phản hồi số đếm sai hình dạng không làm sập cả bộ lọc.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BoLocBaoGia } from "./BoLocBaoGia";
import { LOC_RONG, khoangNgay, type BoLocDS } from "../lib/locDanhSach";
import type { QuoteFacets } from "../lib/api";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; hop?.remove(); hop = null; document.body.innerHTML = ""; vi.restoreAllMocks(); });

const FACETS: QuoteFacets = {
  total: 20, mine: 5,
  status: [{ value: "draft", count: 8 }, { value: "converted", count: 10 }, { value: "lost", count: 2 }],
  creators: [{ id: 7, name: "Nguyễn Văn Ánh", count: 12 }, { id: 8, name: "Trần Thị Bình", count: 8 }],
  companies: [{ id: 1, name: "GN", count: 15 }, { id: 2, name: "CLF", count: 5 }],
  note: { has: 6, none: 14, colors: { red: 2, orange: 0, green: 1, blue: 3, purple: 0 } },
};

let hienTai: BoLocDS = LOC_RONG;
function Khung({ dau, facets, xoa }: { dau: Partial<BoLocDS>; facets?: QuoteFacets; xoa?: () => void }) {
  const [loc, setLoc] = useState<BoLocDS>({ ...LOC_RONG, ...dau });
  useEffect(() => { hienTai = loc; }, [loc]);
  return <BoLocBaoGia loc={loc} dat={(p) => setLoc((c) => ({ ...c, ...p }))} xoa={() => { xoa?.(); setLoc(LOC_RONG); }} facets={facets} meId={7} />;
}
async function mo(dau: Partial<BoLocDS> = {}, facets?: QuoteFacets, xoa?: () => void) {
  hienTai = LOC_RONG;
  hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  await act(async () => { root!.render(<Khung dau={dau} facets={facets} xoa={xoa} />); });
}
async function veLai(dau: Partial<BoLocDS>, facets?: QuoteFacets) {
  await act(async () => { root!.render(<Khung dau={dau} facets={facets} />); });
}
const chipTT = (nhan: string) => [...hop!.querySelectorAll('[aria-label="Trạng thái báo giá"] button')].find((b) => b.textContent?.startsWith(nhan)) as HTMLButtonElement | undefined;
const nutChu = (nhan: string) => [...hop!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith(nhan));
const bam = (el: Element | undefined) => act(async () => { (el as HTMLElement).click(); });
const mau = (ten: string) => hop!.querySelector(`button.bl-mau[aria-label^="Màu ${ten}"]`) as HTMLButtonElement;
const oTien = (nhan: string) => hop!.querySelector(`input[aria-label="${nhan}"]`) as HTMLInputElement;
const mauNgay = () => hop!.querySelector('select[aria-label="Mẫu ngày báo giá"]') as HTMLSelectElement;
function go(el: HTMLInputElement | HTMLSelectElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => { setter.call(el, v); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
}
const roiO = (el: HTMLElement) => act(async () => { el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); el.dispatchEvent(new FocusEvent("blur")); });
const enter = (el: HTMLElement) => act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });

describe("Trạng thái + Của tôi", () => {
  it("ba chip trạng thái chính kèm SỐ ĐẾM; chưa có số đếm thì chỉ có chữ (bộ lọc vẫn dùng được)", async () => {
    await mo({}, FACETS);
    expect([...hop!.querySelectorAll('[aria-label="Trạng thái báo giá"] button')].map((b) => b.textContent)).toEqual(["Nháp8", "Đã chốt10", "Không chốt2"]);
    act(() => root!.unmount()); root = null; hop!.remove(); document.body.innerHTML = "";
    await mo({});
    expect([...hop!.querySelectorAll('[aria-label="Trạng thái báo giá"] button')].map((b) => b.textContent)).toEqual(["Nháp", "Đã chốt", "Không chốt"]);
  });

  it("bấm chip bật/tắt, chọn được NHIỀU; aria-pressed khớp trạng thái", async () => {
    await mo({}, FACETS);
    await bam(chipTT("Nháp"));
    await bam(chipTT("Đã chốt"));
    expect(hienTai.status).toEqual(["draft", "converted"]);
    expect(chipTT("Nháp")!.getAttribute("aria-pressed")).toBe("true");
    expect(chipTT("Không chốt")!.getAttribute("aria-pressed")).toBe("false");
    await bam(chipTT("Nháp"));
    expect(hienTai.status).toEqual(["converted"]);
  });

  it("chip 'Khác' (bốn trạng thái CŨ) chỉ hiện khi còn dữ liệu cũ hoặc đang chọn; bấm bật/tắt CẢ BỐN cùng lúc", async () => {
    await mo({}, FACETS);
    expect(chipTT("Khác")).toBeUndefined();
    act(() => root!.unmount()); root = null; hop!.remove(); document.body.innerHTML = "";

    const coCu: QuoteFacets = { ...FACETS, status: [...FACETS.status, { value: "pending", count: 2 }, { value: "sent", count: 1 }] };
    await mo({}, coCu);
    expect(chipTT("Khác")!.textContent).toBe("Khác3");
    await bam(chipTT("Khác"));
    expect(hienTai.status.sort()).toEqual(["approved", "pending", "rejected", "sent"]);
    expect(chipTT("Khác")!.getAttribute("aria-pressed")).toBe("true");
    await bam(chipTT("Khác"));
    expect(hienTai.status).toEqual([]);
    act(() => root!.unmount()); root = null; hop!.remove(); document.body.innerHTML = "";

    // Đang chọn (link cũ ?status=pending) mà không còn dữ liệu cũ → chip vẫn hiện để gỡ được.
    await mo({ status: ["pending"] }, FACETS);
    expect(chipTT("Khác")).toBeTruthy();
  });

  it("'Của tôi' đặt người tạo = chính mình, bấm lại bỏ; sáng khi ĐÚNG một mình mình được chọn", async () => {
    await mo({}, FACETS);
    const nutToi = () => nutChu("Của tôi")!;
    expect(nutToi().textContent).toBe("Của tôi5");
    await bam(nutToi());
    expect(hienTai.nguoi).toEqual([7]);
    expect(nutToi().getAttribute("aria-pressed")).toBe("true");
    await bam(nutToi());
    expect(hienTai.nguoi).toEqual([]);
    act(() => root!.unmount()); root = null; hop!.remove(); document.body.innerHTML = "";
    await mo({ nguoi: [7, 8] }, FACETS);
    expect(nutToi().getAttribute("aria-pressed"), "chọn cả hai người thì không phải 'của tôi'").toBe("false");
  });
});

describe("Người tạo / Công ty (chọn nhiều)", () => {
  it("chọn người tạo trong bảng nổi → bộ lọc nhận id SỐ; nút hiện số đã chọn", async () => {
    await mo({}, FACETS);
    await bam(nutChu("Người tạo"));
    const nguoi = [...document.querySelectorAll<HTMLInputElement>(".bang-noi label.cn-dong input")];
    await act(async () => { nguoi[1].click(); });
    expect(hienTai.nguoi).toEqual([8]);
    expect(nutChu("Người tạo")!.querySelector(".cn-sl")!.textContent).toBe("1");
  });

  it("chọn công ty → id số; bảng công ty đọc từ facets.companies", async () => {
    await mo({}, FACETS);
    await bam(nutChu("Công ty"));
    expect([...document.querySelectorAll(".bang-noi .cn-ten")].map((x) => x.textContent)).toEqual(["GN", "CLF"]);
    await act(async () => { (document.querySelectorAll<HTMLInputElement>(".bang-noi label.cn-dong input")[0]).click(); });
    expect(hienTai.cty).toEqual([1]);
  });

  it("người đang chọn mà lượt đếm sau KHÔNG còn trả về vẫn hiện đúng TÊN (không thành '#7')", async () => {
    await mo({ nguoi: [7] }, FACETS);
    // Lượt đếm sau (đã thêm bộ lọc khác) không còn người #7 nào khớp.
    await veLai({ nguoi: [7] }, { ...FACETS, creators: [{ id: 8, name: "Trần Thị Bình", count: 1 }] });
    await bam(nutChu("Người tạo"));
    const chu = [...document.querySelectorAll(".bang-noi .cn-ten")].map((x) => x.textContent);
    expect(chu).toContain("Nguyễn Văn Ánh");
    expect(chu).not.toContain("#7");
  });
});

describe("Ngày báo giá", () => {
  it("chọn mẫu nhanh → đặt từ/đến theo giờ máy; chọn 'Tất cả' → xoá cả hai", async () => {
    await mo({}, FACETS);
    const r = khoangNgay("thangnay");
    go(mauNgay(), "thangnay");
    expect(hienTai.tu).toBe(r.tu);
    expect(hienTai.den).toBe(r.den);
    // Ô chọn hiện MỘT mẫu đang khớp — "Tháng này" và "30 ngày qua" trùng nhau đúng ngày cuối tháng 30 ngày, nên chỉ khẳng định
    // mẫu hiện ra có cùng khoảng (không gắn cứng tên, khỏi đỏ theo ngày chạy bài). "Năm nay" không bao giờ trùng mẫu nào.
    expect(khoangNgay(mauNgay().value as never)).toEqual(r);
    go(mauNgay(), "namnay");
    expect(mauNgay().value).toBe("namnay");
    go(mauNgay(), "");
    expect(hienTai.tu).toBe("");
    expect(hienTai.den).toBe("");
  });

  it("tự chọn ngày lẻ → ô mẫu hiện 'Tự chọn…' (không nói dối là một mẫu); hai ô ngày chặn nhau (từ ≤ đến)", async () => {
    await mo({ tu: "2026-09-02", den: "2026-09-05" }, FACETS);
    expect(mauNgay().value).toBe("tuychon");
    expect([...mauNgay().options].map((o) => o.textContent)).toContain("Tự chọn…");
    const tu = hop!.querySelector('input[aria-label="Ngày báo giá từ"]') as HTMLInputElement;
    const den = hop!.querySelector('input[aria-label="Ngày báo giá đến"]') as HTMLInputElement;
    expect(tu.max).toBe("2026-09-05");
    expect(den.min).toBe("2026-09-02");
    go(tu, "2026-09-01");
    expect(hienTai.tu).toBe("2026-09-01");
  });

  it("không đặt ngày thì KHÔNG có mục 'Tự chọn…' trong ô mẫu", async () => {
    await mo({}, FACETS);
    expect([...mauNgay().options].map((o) => o.textContent)).not.toContain("Tự chọn…");
    expect(mauNgay().value).toBe("");
  });
});

describe("Tổng tiền — gõ kiểu người Việt", () => {
  it("'100tr' + rời ô → bộ lọc nhận '100000000' và ô hiện lại 100.000.000 (người dùng thấy máy hiểu gì)", async () => {
    await mo({}, FACETS);
    go(oTien("Tổng từ"), "100tr");
    expect(hienTai.tienTu, "chưa rời ô thì chưa đổi bộ lọc (khỏi gọi máy chủ theo từng phím)").toBe("");
    await roiO(oTien("Tổng từ"));
    expect(hienTai.tienTu).toBe("100000000");
    expect(oTien("Tổng từ").value).toBe("100.000.000");
  });

  it("Enter chốt luôn (không cần rời ô); '1,5 tỷ' đọc là 1,5 tỷ chứ không phải 15 tỷ", async () => {
    await mo({}, FACETS);
    go(oTien("Tổng đến"), "1,5 tỷ");
    await enter(oTien("Tổng đến"));
    expect(hienTai.tienDen).toBe("1500000000");
    expect(oTien("Tổng đến").value).toBe("1.500.000.000");
  });

  it("gõ chưa hiểu → đánh dấu lỗi + giải thích, bộ lọc HIỆN CÓ giữ nguyên; sửa lại cho đúng thì hết lỗi", async () => {
    await mo({ tienTu: "5000000" }, FACETS);
    expect(oTien("Tổng từ").value).toBe("5.000.000");
    go(oTien("Tổng từ"), "abc");
    await roiO(oTien("Tổng từ"));
    expect(oTien("Tổng từ").className).toContain("is-loi");
    expect(oTien("Tổng từ").getAttribute("aria-invalid")).toBe("true");
    expect(oTien("Tổng từ").title).toContain("Chưa hiểu");
    expect(hop!.querySelector(".bl-loi")!.textContent, "lời nhắn HIỆN RA, không chỉ tooltip").toContain("Chưa hiểu");
    expect(hop!.querySelector(".bl-loi")!.getAttribute("role")).toBe("alert");
    expect(hienTai.tienTu, "không đoán bừa: giữ nguyên bộ lọc cũ").toBe("5000000");
    go(oTien("Tổng từ"), "7tr");
    await roiO(oTien("Tổng từ"));
    expect(oTien("Tổng từ").className).not.toContain("is-loi");
    expect(hop!.querySelector(".bl-loi"), "sửa đúng rồi thì lời nhắn biến mất").toBeNull();
    expect(hienTai.tienTu).toBe("7000000");
  });

  it("xoá trống ô → bỏ bộ lọc tiền; 'Xóa tất cả' từ ngoài làm ô theo (không giữ chữ cũ)", async () => {
    await mo({ tienTu: "5000000", tienDen: "9000000" }, FACETS);
    go(oTien("Tổng từ"), "");
    await roiO(oTien("Tổng từ"));
    expect(hienTai.tienTu).toBe("");
    expect(hienTai.tienDen).toBe("9000000");
    await bam(nutChu("Xóa tất cả"));
    expect(oTien("Tổng đến").value).toBe("");
  });
});

describe("Ghi chú + màu", () => {
  it("năm chấm màu mang số đếm trong aria-label; bấm bật/tắt, chọn được nhiều màu", async () => {
    await mo({}, FACETS);
    expect(mau("Đỏ").getAttribute("aria-label")).toBe("Màu Đỏ (2)");
    expect(mau("Tím").getAttribute("aria-label")).toBe("Màu Tím (0)");
    expect(hop!.querySelectorAll("button.bl-mau")).toHaveLength(5);
    await bam(mau("Đỏ"));
    await bam(mau("Xanh dương"));
    expect(hienTai.mau).toEqual(["red", "blue"]);
    expect(mau("Đỏ").getAttribute("aria-pressed")).toBe("true");
    expect(mau("Đỏ").className).toContain("is-on");
    await bam(mau("Đỏ"));
    expect(hienTai.mau).toEqual(["blue"]);
  });

  it("mỗi chấm dùng lớp màu CHUNG với ô ghi chú (qn-c-<khoá>) — một bảng màu duy nhất", async () => {
    await mo({}, FACETS);
    for (const [ten, khoa] of [["Đỏ", "red"], ["Cam", "orange"], ["Xanh lá", "green"], ["Xanh dương", "blue"], ["Tím", "purple"]] as const) expect(mau(ten).className).toContain(`qn-c-${khoa}`);
  });

  it("'Chưa có' và 'theo màu' LOẠI TRỪ nhau Ở CẢ HAI CHIỀU (cùng bật luôn ra 0 dòng): bật 'Chưa có' xoá màu; chọn màu khi đang 'Chưa có' bỏ 'Chưa có'", async () => {
    await mo({ mau: ["red"] }, FACETS);
    await bam(nutChu("Chưa có"));
    expect(hienTai.ghiChu).toBe("none");
    expect(hienTai.mau, "'chưa ghi chú' + 'màu đỏ' luôn ra 0 dòng — không cho cùng tồn tại").toEqual([]);
    await bam(mau("Xanh lá"));
    expect(hienTai.mau).toEqual(["green"]);
    expect(hienTai.ghiChu, "chọn màu khi đang 'Chưa có' → màu thắng, 'Chưa có' bị gỡ").toBe("");
    expect(nutChu("Chưa có")!.getAttribute("aria-pressed")).toBe("false");
    await bam(nutChu("Chưa có"));
    expect(hienTai.ghiChu).toBe("none");
    expect(hienTai.mau).toEqual([]);
    await bam(nutChu("Chưa có"));
    expect(hienTai.ghiChu).toBe("");
  });

  it("'Có ghi chú' bật/tắt được và không xoá màu đang chọn; số đếm lấy từ facets", async () => {
    await mo({ mau: ["green"] }, FACETS);
    expect(nutChu("Có ghi chú")!.textContent).toBe("Có ghi chú6");
    expect(nutChu("Chưa có")!.textContent).toBe("Chưa có14");
    await bam(nutChu("Có ghi chú"));
    expect(hienTai.ghiChu).toBe("has");
    expect(hienTai.mau).toEqual(["green"]);
    await bam(nutChu("Có ghi chú"));
    expect(hienTai.ghiChu).toBe("");
  });
});

describe("Xóa tất cả + phản hồi lạ", () => {
  it("mờ khi chưa lọc gì; có lọc thì hiện SỐ NHÓM đang lọc và xoá hết khi bấm", async () => {
    const xoa = vi.fn();
    await mo({}, FACETS, xoa);
    expect(nutChu("Xóa tất cả")!.disabled).toBe(true);
    act(() => root!.unmount()); root = null; hop!.remove(); document.body.innerHTML = "";
    await mo({ q: "sao mai", status: ["draft"], tienTu: "5", mau: ["red"], ghiChu: "has" }, FACETS, xoa);
    const n = nutChu("Xóa tất cả")!;
    expect(n.disabled).toBe(false);
    expect(n.querySelector(".inv-filter-count")!.textContent, "q + trạng thái + tiền + (ghi chú và màu = MỘT nhóm)").toBe("4");
    await bam(n);
    expect(xoa).toHaveBeenCalledTimes(1);
    expect(hienTai).toEqual(LOC_RONG);
  });

  it("số đếm SAI HÌNH DẠNG (máy chủ bản cũ, proxy trả trang lỗi, mock lỏng) không làm sập bộ lọc — chỉ thiếu số", async () => {
    for (const hong of [{} as unknown as QuoteFacets, { status: "x" } as unknown as QuoteFacets, { ...FACETS, note: undefined } as unknown as QuoteFacets, { ...FACETS, creators: null } as unknown as QuoteFacets]) {
      await mo({}, hong);
      expect(chipTT("Nháp")!.textContent).toBe("Nháp");
      expect(nutChu("Của tôi")!.textContent).toBe("Của tôi");
      expect(mau("Đỏ").getAttribute("aria-label")).toBe("Màu Đỏ");
      await bam(nutChu("Người tạo"));
      expect(document.querySelector(".bang-noi")).toBeTruthy();
      act(() => root!.unmount()); root = null; hop!.remove(); document.body.innerHTML = "";
    }
  });
});

describe("Điện thoại: bộ lọc thu gọn sau nút 'Bộ lọc khác'", () => {
  // Đo 2026-10-06: bộ lọc đầy đủ cao 397px = 54% màn 360×740, thẻ báo giá đầu tiên chỉ ló 66px. CSS (≤820px) ẩn phần sau nút khi
  // panel chưa có .is-mo — jsdom không áp @media nên ở đây kiểm HỢP ĐỒNG mà CSS dựa vào: lớp, aria, và số trên nút.
  const nutThem = () => hop!.querySelector<HTMLButtonElement>("button.bl-mo-them")!;
  const panel = () => hop!.querySelector(".bl-panel")!;

  it("mặc định THU GỌN: nút có aria-expanded=false, panel chưa có .is-mo; bấm thì mở, bấm lại thì thu", async () => {
    await mo({}, FACETS);
    expect(nutThem().getAttribute("aria-expanded")).toBe("false");
    expect(panel().classList.contains("is-mo")).toBe(false);
    expect(nutThem().textContent).toBe("Bộ lọc khác");
    await bam(nutThem());
    expect(nutThem().getAttribute("aria-expanded")).toBe("true");
    expect(panel().classList.contains("is-mo")).toBe(true);
    expect(nutThem().textContent).toBe("Thu gọn bộ lọc");
    await bam(nutThem());
    expect(panel().classList.contains("is-mo")).toBe(false);
  });

  it("phần bị giấu đúng là người tạo / công ty / của tôi + cả hàng ngày-tiền-ghi chú; chip trạng thái LUÔN hiện", async () => {
    await mo({}, FACETS);
    const trong = hop!.querySelector(".bl-them-trong")!;
    expect(trong.textContent).toContain("Người tạo");
    expect(trong.textContent).toContain("Công ty");
    expect(trong.textContent).toContain("Của tôi");
    expect(trong.contains(hop!.querySelector('[aria-label="Trạng thái báo giá"]'))).toBe(false);
    const hang = hop!.querySelector(".bl-them-hang")!;
    expect(hang.querySelector('select[aria-label="Mẫu ngày báo giá"]')).toBeTruthy();
    expect(hang.querySelector('[aria-label="Tổng tiền"]')).toBeTruthy();
    expect(hang.querySelector('[aria-label="Ghi chú"]')).toBeTruthy();
    expect(nutThem().getAttribute("aria-controls")).toBe(hang.id);
  });

  it("số trên nút = số NHÓM lọc đang bật mà đang bị giấu (không đếm trạng thái / ô tìm vốn đang hiện)", async () => {
    await mo({ q: "abc", status: ["draft"] }, FACETS);
    expect(nutThem().querySelector(".inv-filter-count")).toBeNull();
    act(() => root!.unmount()); root = null; hop!.remove(); document.body.innerHTML = "";
    await mo({ nguoi: [7], tu: "2026-09-01", mau: ["red"], status: ["draft"] }, FACETS);
    expect(nutThem().querySelector(".inv-filter-count")!.textContent).toBe("3");
    await bam(nutThem());
    expect(nutThem().querySelector(".inv-filter-count"), "đang mở thì khỏi đếm — thấy tận mắt rồi").toBeNull();
  });
});
