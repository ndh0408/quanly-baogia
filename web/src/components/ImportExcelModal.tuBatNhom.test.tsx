/** @vitest-environment jsdom */
/**
 * Hộp "Nhập từ Excel": nhập Số Lượng nhóm > 1 thì "Hiện Thành Tiền nhóm" PHẢI được bật (chủ repo chốt 2026-09-30, đảo quyết
 * định cũ "chỉ cảnh báo"). Lý do là tiền: bộ đọc file chỉ coi cờ là BẬT khi dòng nhóm có ghi Thành Tiền; file mang SL nhóm 3
 * mà không ghi Thành Tiền nhóm ra cờ TẮT, và `M.sheetSubtotalGrouped` khi tắt KHÔNG nhân hệ số → tổng thiếu ×3 và xuất Excel
 * ra SAI TIỀN. Nên nạp xong mà bảng kết quả còn nhóm SL > 1 thì cờ = BẬT (rồi bị khoá theo luật khoá của lưới).
 *
 * Bài này kiểm phần HỘP: cờ hiệu lực dùng để tính tổng dự kiến / đối chiếu tiền, dòng cảnh báo (KHÔNG chặn), và hộp xác nhận.
 * Phần GHI cờ vào sheet ở QuoteEditor / AccountHnView có bài riêng (QuoteEditor.napBatNhom, AccountHnView.napBatNhom).
 *
 * Cờ SAU KHI nạp phụ thuộc đường nạp (xem `coSauNhapExcel`): sheet MỚI → theo file; NỐI → cờ đích; THAY ở trình soạn báo giá →
 * theo file mà không làm mất cờ bật của sheet đang bật; THAY ở bảng Hà Nội (`thayGiuCoNhomCuaDich`) → cờ bảng đích.
 *
 * Bảng Hà Nội còn khác ở TIỀN (`tongKhongNhanNhom`): tổng của nó là extraTableSum, KHÔNG BAO GIỜ nhân Số Lượng nhóm — cờ bật
 * chỉ làm ô Thành Tiền của dòng nhóm hiện số đã nhân. Hộp phải tính và nói đúng như vậy, không nói "tổng đã nhân hệ số nhóm".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EditorTemplate, ImportResult, ImportedItem } from "../lib/api";

const { ketQua, loiXacNhan } = vi.hoisted(() => ({ ketQua: { v: null as unknown }, loiXacNhan: [] as string[] }));
vi.mock("../lib/api", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/api")>();
  return { ...goc, api: { ...goc.api, importExcel: async () => ketQua.v } };
});
vi.mock("../lib/ui", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/ui")>();
  return { ...goc, toast: () => {}, confirmModal: async (_t: string, msg: string) => { loiXacNhan.push(msg); return true; } };
});
import { ImportExcelModal, type ImportApplyPayload } from "./ImportExcelModal";
import { extraTableSum } from "./ExtraTables";
import * as M from "../lib/quoteMath";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MAU: EditorTemplate[] = [{ id: 1, code: "marico_decor", name: "GN (không ngày)", layout: { hasDays: false, hasDetail: false, reserveDetail: true, numberSubsections: false } }];
/** Dòng cảnh báo tự bật: nói ĐÃ BẬT, vì nhóm SL > 1 ở đâu (file / sheet đích) và tổng đã nhân hệ số nhóm. */
const TU_BAT = /Đã bật Thành Tiền nhóm vì (file|sheet đích) có nhóm Số Lượng > 1 nên tổng đã nhân hệ số nhóm/;
/** …ở bảng Hà Nội (tổng không bao giờ nhân hệ số nhóm): bật chỉ đổi ô Thành Tiền của dòng nhóm. */
const TU_BAT_HN = /Đã bật Thành Tiền nhóm vì (file|sheet đích) có nhóm Số Lượng > 1: ô Thành Tiền của dòng nhóm/;

const hangNhom = (sl: number): ImportedItem => ({ kind: "section", name: "Nhóm A", quantity: sl, unitPrice: 0, row: 7 });
const hangMuc: ImportedItem = { kind: "item", name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 250000, row: 8 };
const KHONG_NHAN = 2 * 250_000;   // tổng khi cờ TẮT (hệ số nhóm ép về 1)
const CO_NHAN_3 = 3 * KHONG_NHAN;  // tổng khi cờ BẬT + nhóm SL 3

/** Tệp một sheet: nhóm SL `slNhom`, cờ nhóm theo file `coFile`, tổng trong file `tongFile` (null = không có dòng Tổng). */
const tep = (slNhom: number, coFile: boolean, tongFile: number | null = null): ImportResult => ({
  warnings: [],
  sheets: [{
    index: 0, name: "Décor", templateCode: "marico_decor", templateName: "GN (không ngày)",
    hasDays: false, numberSubs: false, groupSubtotal: coFile, showImages: false, warnings: [],
    columns: { _stt: "B", name: "C", unit: "E", quantity: "F", unitPrice: "G", _amount: "H", notes: "I" },
    headerRow: 6, firstRow: 7, lastRow: 8,
    stats: { rows: 2, items: 1, sections: 1, subsections: 0, subs: 0, infos: 0, formulas: 0, formulasDropped: 0 },
    items: [hangNhom(slNhom), hangMuc],
    ...(tongFile != null ? { totals: { subtotal: tongFile } } : {}),
  }],
});

let thung: HTMLDivElement, goc: Root;
beforeEach(() => { thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung); loiXacNhan.length = 0; });
afterEach(() => { act(() => goc.unmount()); thung.remove(); document.body.innerHTML = ""; });

type Dich = { groupSubtotal: boolean; items?: M.Item[] } | null;
/** Mở hộp, đọc `ketQua`, chọn tệp → dựng xem trước. `dich` = sheet đang có trong báo giá (null → không có sheet nào → sheet MỚI).
 *  `coNgay`: mẫu đích có cột Số Ngày. */
async function moHop(ket: ImportResult, dich: Dich, them: { thayGiuCo?: boolean; tongKhongNhan?: boolean; cheDo?: "append" | "skip"; coNgay?: boolean } = {}) {
  ketQua.v = ket;
  let payload: ImportApplyPayload | null = null;
  const dong: { name: string; templateId: number; groupSubtotal: boolean; items: M.Item[] }[] = dich ? [{ name: "Décor", templateId: 1, groupSubtotal: dich.groupSubtotal, items: dich.items ?? [] }] : [];
  act(() => goc.render(
    <ImportExcelModal
      sheets={dong} templates={MAU}
      usesDaysOf={() => !!them.coNgay} addrDetailOf={() => true} newSheetTemplateId={() => 1}
      thayGiuCoNhomCuaDich={them.thayGiuCo} tongKhongNhanNhom={them.tongKhongNhan}
      onApply={(p) => { payload = p; }} onClose={() => {}}
    />,
  ));
  const input = thung.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [new File(["x"], "khach-sua.xlsx")] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  if (them.cheDo) {
    const chon = [...thung.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === them.cheDo)) as HTMLSelectElement;
    expect(chon, `không thấy ô chọn chế độ ${them.cheDo}`).toBeTruthy();
    await act(async () => { chon.value = them.cheDo!; chon.dispatchEvent(new Event("change", { bubbles: true })); });
  }
  const nap = async () => {
    const nut = [...thung.querySelectorAll("button")].find((b) => b.textContent === "Nạp các thay đổi này") as HTMLButtonElement;
    expect(nut, "không thấy nút nạp — tệp chưa được đọc").toBeTruthy();
    await act(async () => { nut.click(); });
    return payload as ImportApplyPayload | null;
  };
  const dongBao = () => [...thung.querySelectorAll("ul.import-warn li")].map((li) => li.textContent || "");
  const tuBat = () => dongBao().filter((t) => TU_BAT.test(t) || TU_BAT_HN.test(t));
  const tongSauNap = () => (thung.querySelector(".import-summary strong")?.textContent || "");
  const the = (ten: string) => [...thung.querySelectorAll(".import-check-card")].find((c) => c.querySelector("span")?.textContent === ten) as HTMLElement | undefined;
  return { nap, tuBat, dongBao, tongSauNap, the, html: () => thung.textContent || "" };
}

describe("nhập Excel — sheet MỚI (cờ theo file, tự bật khi còn nhóm SL > 1)", () => {
  it("file KHÔNG ghi Thành Tiền nhóm (cờ tắt) mà nhóm SL 3 → nói ĐÃ BẬT, tổng dự kiến NHÂN hệ số nhóm", async () => {
    const h = await moHop(tep(3, false), null);
    const [li] = h.tuBat();
    expect(li, "phải nói ra việc tự bật").toBeTruthy();
    expect(li).toMatch(/vì file có nhóm/);
    expect(li).toMatch(/xuất Excel ra sai tiền/);
    expect(li).toMatch(/khoá bật/);
    expect(h.tongSauNap(), "tổng sau nạp phải theo cờ ĐÃ BẬT (×3), không theo cờ tắt trong file").toBe(M.fmtMoney(CO_NHAN_3));
  });

  it("file có cờ BẬT + nhóm SL 3 → không có gì để nói (cờ đã bật sẵn), tổng vẫn nhân", async () => {
    const h = await moHop(tep(3, true), null);
    expect(h.tuBat()).toEqual([]);
    expect(h.tongSauNap()).toBe(M.fmtMoney(CO_NHAN_3));
  });

  it("nhóm SL 1 (×1 không đổi tổng), cờ tắt → không bật, không nói, tổng KHÔNG nhân", async () => {
    const h = await moHop(tep(1, false), null);
    expect(h.tuBat()).toEqual([]);
    expect(h.tongSauNap()).toBe(M.fmtMoney(KHONG_NHAN));
  });

  it("tổng ghi trong file KHÔNG nhân hệ số (500.000) mà sau nạp đã nhân (1.500.000) → cảnh báo nói ĐÚNG lý do, KHÔNG chặn", async () => {
    const h = await moHop(tep(3, false, KHONG_NHAN), null);
    const [li] = h.tuBat();
    expect(li).toMatch(/nên tổng đã nhân hệ số nhóm và khác tổng ghi trong file/);
    expect(li).toContain(M.fmtMoney(KHONG_NHAN));
    expect(li).toContain(M.fmtMoney(CO_NHAN_3));
    expect(h.dongBao().some((t) => /Tổng tiền chưa khớp/.test(t)), "không kèm dòng 'chưa khớp' chung chung — một dòng, nói đúng nguyên nhân").toBe(false);
    const payload = await h.nap();
    expect(payload, "cảnh báo không được chặn việc nạp").toBeTruthy();
    expect(loiXacNhan, "khác tổng do chủ ý tự bật không đi qua hộp xác nhận").toEqual([]);
    expect(payload!.plans[0].items, "hàng nạp giữ nguyên").toHaveLength(2);
  });

  it("file BẬT + nhóm SL 3 nhưng tổng ghi trong file sai (khác 1.500.000) → vẫn là lệch THƯỜNG: dòng 'chưa khớp' + hộp xác nhận", async () => {
    const h = await moHop(tep(3, true, 1_000_000), null);
    expect(h.tuBat()).toEqual([]);
    expect(h.dongBao().some((t) => /Tổng tiền chưa khớp/.test(t))).toBe(true);
    await h.nap();
    expect(loiXacNhan.join(" | ")).toMatch(/tổng sau nạp khác tổng trong Excel/);
  });

  it("file tắt + nhóm SL 3 + tổng file ĐÃ nhân (1.500.000): sau nạp cũng 1.500.000 → khớp, không lệch (trước đây tổng dự kiến 500.000 báo lệch oan)", async () => {
    const h = await moHop(tep(3, false, CO_NHAN_3), null);
    expect(h.dongBao().some((t) => /khác tổng ghi trong file/.test(t))).toBe(false);
    expect(h.tuBat().length, "vẫn nói việc tự bật").toBe(1);
    await h.nap();
    expect(loiXacNhan).toEqual([]);
  });

  it("tự bật NHƯNG tổng ghi trong file sai THẬT (400.000: khác cả tổng không nhân 500.000) → chủ ý tự bật không được nuốt lệch thật: còn dòng 'chưa khớp' + hộp xác nhận", async () => {
    const h = await moHop(tep(3, false, 400_000), null);
    const [li] = h.tuBat();
    expect(li, "vẫn nói việc tự bật").toBeTruthy();
    expect(li, "nhưng không nhận phần lệch này là chủ ý").not.toMatch(/khác tổng ghi trong file/);
    expect(h.dongBao().some((t) => /Tổng tiền chưa khớp/.test(t)), "lệch thật phải còn dòng cảnh báo chung").toBe(true);
    expect(h.the("Đối chiếu tiền")!.className, "lệch thật thì thẻ đỏ, không phải vàng").toMatch(/danger/);
    await h.nap();
    expect(loiXacNhan.join(" | ")).toMatch(/tổng sau nạp khác tổng trong Excel/);
  });

  it("tự bật, lệch CHỈ do nhân hệ số (500.000 → 1.500.000) → thẻ đối chiếu VÀNG, không phải đỏ", async () => {
    const h = await moHop(tep(3, false, KHONG_NHAN), null);
    expect(h.the("Đối chiếu tiền")!.className).toMatch(/warn/);
    expect(h.the("Đối chiếu tiền")!.className).not.toMatch(/danger/);
  });

  it("thẻ 'Cấu trúc dòng' nói đúng thứ sẽ xảy ra: file không nhân mà app bật → nói app bật tổng và hệ số nhóm khi nạp", async () => {
    const h = await moHop(tep(3, false), null);
    expect(h.the("Cấu trúc dòng")!.textContent).toMatch(/app bật tổng và hệ số theo nhóm khi nạp/);
  });

  it("thẻ 'Cấu trúc dòng' giữ nguyên lời cũ khi không có gì được bật: file bật → 'Có tính tổng…'; nhóm SL 1 → 'Cộng trực tiếp…'", async () => {
    const bat = await moHop(tep(3, true), null);
    expect(bat.the("Cấu trúc dòng")!.textContent).toMatch(/Có tính tổng và hệ số theo nhóm/);
    act(() => goc.unmount()); thung.remove();
    thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung);
    const khong = await moHop(tep(1, false), null);
    expect(khong.the("Cấu trúc dòng")!.textContent).toMatch(/Cộng trực tiếp từng hạng mục/);
    expect(khong.the("Cấu trúc dòng")!.textContent).not.toMatch(/app bật/);
  });
});

describe("nhập Excel vào sheet ĐANG CÓ (trình soạn báo giá) — Thay / Nối", () => {
  it("THAY: sheet đích đang bật, file tắt + nhóm SL 3 → cờ GIỮ bật (không bị file tắt làm mất) → không 'tự bật', tổng nhân", async () => {
    const h = await moHop(tep(3, false), { groupSubtotal: true });
    expect(h.tuBat()).toEqual([]);
    expect(h.tongSauNap()).toBe(M.fmtMoney(CO_NHAN_3));
  });

  it("THAY: sheet đích đang tắt, file tắt + nhóm SL 3 → tự bật, nói ra", async () => {
    const h = await moHop(tep(3, false), { groupSubtotal: false });
    expect(h.tuBat().length).toBe(1);
    expect(h.tongSauNap()).toBe(M.fmtMoney(CO_NHAN_3));
  });

  it("THAY: sheet đích tắt, file BẬT → cờ thành bật theo file, không phải 'tự bật'", async () => {
    const h = await moHop(tep(3, true), { groupSubtotal: false });
    expect(h.tuBat()).toEqual([]);
  });

  it("THAY: cả hai tắt + nhóm SL 1 → không bật", async () => {
    const h = await moHop(tep(1, false), { groupSubtotal: false });
    expect(h.tuBat()).toEqual([]);
    expect(h.tongSauNap()).toBe(M.fmtMoney(KHONG_NHAN));
  });

  it("NỐI: đích tắt + file mang nhóm SL 3 (dù file bật) → cờ đích TẮT nên tự bật, nói 'vì file có nhóm'", async () => {
    const h = await moHop(tep(3, true), { groupSubtotal: false }, { cheDo: "append" });
    const [li] = h.tuBat();
    expect(li).toBeTruthy();
    expect(li).toMatch(/vì file có nhóm/);
  });

  it("NỐI: đích BẬT → không 'tự bật' (dù file tắt)", async () => {
    const h = await moHop(tep(3, false), { groupSubtotal: true }, { cheDo: "append" });
    expect(h.tuBat()).toEqual([]);
  });

  it("NỐI: đích tắt + file nhóm SL 1 + đích không có nhóm SL > 1 → không bật", async () => {
    const h = await moHop(tep(1, false), { groupSubtotal: false }, { cheDo: "append" });
    expect(h.tuBat()).toEqual([]);
  });

  it("NỐI: đích tắt và ĐÃ CÓ nhóm SL 3 từ trước, file không mang nhóm SL > 1 → bảng kết quả vẫn 'tắt + SL 3' nên bật, nói 'vì sheet đích có nhóm'", async () => {
    const dich = [{ kind: "section", name: "Nhóm cũ", quantity: 3, unitPrice: 0 }, { kind: "item", name: "Cũ", unit: "cái", quantity: 1, unitPrice: 1000 }] as unknown as M.Item[];
    const h = await moHop(tep(1, false), { groupSubtotal: false, items: dich }, { cheDo: "append" });
    const [li] = h.tuBat();
    expect(li).toBeTruthy();
    expect(li).toMatch(/vì sheet đích có nhóm/);
  });

  it("Bỏ qua sheet → chỉ để xem, không có gì được bật", async () => {
    const h = await moHop(tep(3, false), { groupSubtotal: false }, { cheDo: "skip" });
    expect(h.tuBat()).toEqual([]);
  });

  it("Bỏ qua sheet có dòng Tổng: đối chiếu theo cờ của CHÍNH file → file tự khớp thì không báo 'chưa khớp' (bản đầu tính theo cờ 'sẽ bật' → đỏ oan)", async () => {
    const h = await moHop(tep(3, false, KHONG_NHAN), { groupSubtotal: false }, { cheDo: "skip" });
    expect(h.dongBao().some((t) => /Tổng tiền chưa khớp/.test(t))).toBe(false);
    expect(h.the("Đối chiếu tiền")!.className).toMatch(/\bok\b/);
  });
});

describe("sheet đích ĐANG BẬT mà file không nhân hệ số nhóm — lệch chỉ do hệ số, như ca tự bật: cảnh báo, KHÔNG chặn", () => {
  it("THAY: giữ bật, tổng sau nạp nhân ×3; thẻ đối chiếu VÀNG, nói đúng lý do, không có dòng 'chưa khớp', nạp không hỏi", async () => {
    const h = await moHop(tep(3, false, KHONG_NHAN), { groupSubtotal: true });
    expect(h.tongSauNap()).toBe(M.fmtMoney(CO_NHAN_3));
    expect(h.the("Đối chiếu tiền")!.className).toMatch(/warn/);
    expect(h.the("Đối chiếu tiền")!.className).not.toMatch(/danger/);
    const li = h.dongBao().find((t) => /Sheet đích đang bật Thành Tiền nhóm/.test(t));
    expect(li, "phải nói vì sao tổng khác file").toBeTruthy();
    expect(li).toMatch(/tổng đã nhân hệ số nhóm và khác tổng ghi trong file/);
    expect(li).toContain(M.fmtMoney(KHONG_NHAN));
    expect(li).toContain(M.fmtMoney(CO_NHAN_3));
    expect(h.dongBao().some((t) => /Tổng tiền chưa khớp/.test(t))).toBe(false);
    expect(h.tuBat(), "cờ không đổi thì không phải 'tự bật'").toEqual([]);
    expect(await h.nap()).toBeTruthy();
    expect(loiXacNhan, "lệch chỉ do hệ số nhóm không đi qua hộp xác nhận").toEqual([]);
  });

  it("NỐI vào sheet đang bật: như trên", async () => {
    const h = await moHop(tep(3, false, KHONG_NHAN), { groupSubtotal: true }, { cheDo: "append" });
    expect(h.dongBao().some((t) => /Sheet đích đang bật Thành Tiền nhóm/.test(t))).toBe(true);
    expect(h.dongBao().some((t) => /Tổng tiền chưa khớp/.test(t))).toBe(false);
    await h.nap();
    expect(loiXacNhan).toEqual([]);
  });

  it("đích bật mà tổng file sai THẬT (400.000) → vẫn đỏ + hộp xác nhận", async () => {
    const h = await moHop(tep(3, false, 400_000), { groupSubtotal: true });
    expect(h.dongBao().some((t) => /Tổng tiền chưa khớp/.test(t))).toBe(true);
    expect(h.dongBao().some((t) => /Sheet đích đang bật Thành Tiền nhóm/.test(t))).toBe(false);
    await h.nap();
    expect(loiXacNhan.join(" | ")).toMatch(/tổng sau nạp khác tổng trong Excel/);
  });
});

// Đúng hai cờ AccountHnView truyền (AccountHnView.napBatNhom.test.tsx chốt việc truyền): Thay giữ cờ bảng đích, và tổng bảng
// không bao giờ nhân hệ số nhóm (extraTableSum).
const HN = { thayGiuCo: true, tongKhongNhan: true } as const;

describe("nhập Excel vào bảng HÀ NỘI (AccountHnView: Thay KHÔNG gán cờ theo file; tổng bảng KHÔNG nhân hệ số nhóm)", () => {
  it("THAY: bảng đích TẮT, file BẬT + nhóm SL 3 → cờ bảng đích tắt nên TỰ BẬT (lấy cờ theo file thì lọt: bảng vẫn tắt + SL 3)", async () => {
    const h = await moHop(tep(3, true), { groupSubtotal: false }, HN);
    expect(h.tuBat().length).toBe(1);
  });

  it("file tắt + nhóm SL 3 → nói đã bật, NHƯNG đúng với bảng HN: chỉ ô Thành Tiền của dòng nhóm nhân, tổng KHÔNG nhân và khớp file", async () => {
    const h = await moHop(tep(3, false, KHONG_NHAN), { groupSubtotal: false }, HN);
    const [li] = h.tuBat();
    expect(li).toMatch(TU_BAT_HN);
    expect(li).toMatch(/Tổng của bảng vẫn chỉ cộng từng hạng mục/);
    expect(li, "bảng HN không bao giờ nhân hệ số vào tổng — không được nói thế").not.toMatch(/tổng đã nhân hệ số nhóm/);
    expect(li, "bảng HN không xuất Excel").not.toMatch(/xuất Excel/);
    expect(li).toMatch(/khoá bật/);
    expect(h.tongSauNap(), "tổng bảng HN = extraTableSum, không nhân ×3").toBe(M.fmtMoney(KHONG_NHAN));
    expect(h.the("Đối chiếu tiền")!.className).toMatch(/\bok\b/);
    expect(h.the("Cấu trúc dòng")!.textContent).toMatch(/app bật Thành Tiền nhóm khi nạp/);
    await h.nap();
    expect(loiXacNhan).toEqual([]);
  });

  it("file BẬT, tổng file đã nhân ×3 → bảng HN không nhân nên khác file, chỉ do hệ số → cảnh báo vàng nói đúng lý do, không chặn", async () => {
    const h = await moHop(tep(3, true, CO_NHAN_3), { groupSubtotal: false }, HN);
    expect(h.tongSauNap()).toBe(M.fmtMoney(KHONG_NHAN));
    expect(h.the("Đối chiếu tiền")!.className).toMatch(/warn/);
    const li = h.dongBao().find((t) => /Tổng ghi trong file có nhân Số Lượng nhóm/.test(t));
    expect(li).toBeTruthy();
    expect(li).toMatch(/tổng của bảng chỉ cộng từng hạng mục/);
    expect(h.dongBao().some((t) => /Tổng tiền chưa khớp/.test(t))).toBe(false);
    await h.nap();
    expect(loiXacNhan).toEqual([]);
  });

  it("THAY: bảng đích BẬT, file TẮT + nhóm SL 3 → giữ bật, không 'tự bật', tổng vẫn không nhân", async () => {
    const h = await moHop(tep(3, false), { groupSubtotal: true }, HN);
    expect(h.tuBat()).toEqual([]);
    expect(h.tongSauNap()).toBe(M.fmtMoney(KHONG_NHAN));
  });

  it("THAY: bảng đích tắt + file tắt + nhóm SL 1 → không bật", async () => {
    const h = await moHop(tep(1, false), { groupSubtotal: false }, HN);
    expect(h.tuBat()).toEqual([]);
  });

  it("thêm bảng MỚI ở màn Hà Nội: file tắt + nhóm SL 3 → tự bật", async () => {
    const h = await moHop(tep(3, false), null, HN);
    expect(h.tuBat().length).toBe(1);
  });

  it("tổng file sai THẬT → vẫn đỏ + hộp xác nhận (không bị nuốt vì bảng HN)", async () => {
    const h = await moHop(tep(3, false, 400_000), { groupSubtotal: false }, HN);
    expect(h.dongBao().some((t) => /Tổng tiền chưa khớp/.test(t))).toBe(true);
    await h.nap();
    expect(loiXacNhan.join(" | ")).toMatch(/tổng sau nạp khác tổng trong Excel/);
  });
});

// NỐI VÀO CUỐI — người soát độc lập báo: sheet cũ đã lưu "tắt" [Nhóm cũ (SL 3), Cũ 1×100.000], nối tệp CHỈ có hạng mục [Mới
// 1×200.000], dòng Cộng của tệp 200.000. Cờ tự bật (đúng luật); "Mới" nằm dưới "Nhóm cũ" nên đóng góp 600.000, tổng sheet 100.000
// → 900.000. Bản cũ cộng riêng hàng của tệp (hệ số bắt đầu ×1) nên thẻ hiện xanh "Khớp 200.000 · Excel 200.000 · sau nạp
// 200.000". Nay "sau nạp" của Nối = phần tổng sheet THẬT SỰ tăng thêm, và thẻ nói rõ từng nguyên nhân: (a) hàng nối vào nằm
// trong nhóm cuối ×N, (b) bật Thành Tiền nhóm đổi tổng các hàng sẵn có. Cảnh báo vàng, không chặn; lệch thật vẫn đỏ.
/** Tệp một sheet với hàng tuỳ ý (các ca Nối). */
const tepHang = (items: ImportedItem[], coFile: boolean, tongFile: number | null): ImportResult => ({
  warnings: [],
  sheets: [{
    index: 0, name: "Décor", templateCode: "marico_decor", templateName: "GN (không ngày)",
    hasDays: false, numberSubs: false, groupSubtotal: coFile, showImages: false, warnings: [],
    columns: { _stt: "B", name: "C", unit: "E", quantity: "F", unitPrice: "G", _amount: "H", notes: "I" },
    headerRow: 6, firstRow: 7, lastRow: 6 + items.length,
    stats: { rows: items.length, items: items.filter((x) => x.kind === "item").length, sections: items.filter((x) => x.kind === "section").length, subsections: 0, subs: 0, infos: 0, formulas: 0, formulasDropped: 0 },
    items,
    ...(tongFile != null ? { totals: { subtotal: tongFile } } : {}),
  }],
});

describe("NỐI vào sheet có nhóm cuối SL > 1 — 'sau nạp' là phần tổng sheet THẬT SỰ tăng thêm", () => {
  const dichCu = (sl: number) => [
    { kind: "section", name: "Nhóm cũ", quantity: sl, unitPrice: 0 },
    { kind: "item", name: "Cũ", unit: "cái", quantity: 1, unitPrice: 100_000 },
  ] as unknown as M.Item[];
  const moi: ImportedItem = { kind: "item", name: "Mới", unit: "cái", quantity: 1, unitPrice: 200_000, row: 7 };
  const nhomMoi: ImportedItem = { kind: "section", name: "Nhóm mới", quantity: 1, unitPrice: 0, row: 7 };
  const tien = (n: number) => M.fmtMoney(n);
  /** (a): hàng nối vào rơi vào nhóm cuối của sheet. */
  const CAU_A = /^Các hàng nối vào nằm trong nhóm “Nhóm cũ” \(Số Lượng 3\) ở cuối sheet nên được nhân ×3: /;
  type Hop = Awaited<ReturnType<typeof moHop>>;
  const cauA = (h: Hop) => h.dongBao().filter((t) => /^Các hàng nối vào/.test(t));
  /** (b): bật cờ làm đổi tổng các hàng sẵn có. */
  const cauB = (h: Hop) => h.dongBao().filter((t) => /^Bật Thành Tiền nhóm làm tổng các hàng sẵn có đổi /.test(t));
  const doiChieu = (h: Hop) => {
    const the = h.the("Đối chiếu tiền")!;
    return { lop: the.className, chinh: the.querySelector("strong")!.textContent, phu: the.querySelector("small")!.textContent };
  };

  it("ca người soát: sheet TẮT + nhóm cuối SL 3, tệp không có dòng nhóm → KHÔNG 'Khớp': vàng, sau nạp 800.000, đủ (a) 200.000 → 600.000 và (b) 100.000 → 300.000; nạp không hỏi", async () => {
    const h = await moHop(tepHang([moi], false, 200_000), { groupSubtotal: false, items: dichCu(3) }, { cheDo: "append" });
    expect(h.tongSauNap(), "tổng sheet 100.000 → 900.000 (cách lưới tính — không đổi)").toBe(tien(900_000));
    const d = doiChieu(h);
    expect(d.chinh, "bản cũ: 'Khớp 200.000' trong khi tổng sheet tăng 800.000").toBe(`Lệch +${tien(600_000)}`);
    expect(d.phu).toBe(`Excel ${tien(200_000)} · sau nạp ${tien(800_000)}`);
    expect(d.lop, "lệch chỉ do hệ số nhóm → vàng").toMatch(/\bwarn\b/);
    expect(d.lop).not.toMatch(/\bok\b|danger/);
    const a = cauA(h);
    expect(a, "phải nói hàng nối vào bị nhân ×3").toHaveLength(1);
    expect(a[0]).toMatch(CAU_A);
    expect(a[0]).toContain(`${tien(200_000)} trong file → ${tien(600_000)} sau nạp`);
    expect(a[0]).toContain("thêm một dòng nhóm ở đầu file");
    const b = cauB(h);
    expect(b, "phải nói tổng hàng sẵn có đổi vì bật cờ").toHaveLength(1);
    expect(b[0]).toContain(`đổi ${tien(100_000)} → ${tien(300_000)}`);
    expect(h.tuBat(), "vẫn nói việc tự bật").toHaveLength(1);
    expect(h.dongBao().some((t) => /Tổng tiền chưa khớp/.test(t)), "tệp tự khớp — không phải lệch thật").toBe(false);
    // Cả hộp gọi tệp người dùng chọn là "file" ("khác tổng ghi trong file", "không còn trong file"…) — dòng (a) đứng ngay dưới dòng
    // "…khác tổng ghi trong file" thì không được đổi sang "tệp" (vòng 1 người soát).
    expect(h.dongBao().filter((t) => /tệp/.test(t)), "một cách gọi cho cùng một thứ").toEqual([]);
    const payload = await h.nap();
    expect(payload, "cảnh báo vàng không chặn").toBeTruthy();
    expect(loiXacNhan, "cảnh báo vàng không đi qua hộp xác nhận (như các lệch do hệ số nhóm khác)").toEqual([]);
    expect(payload!.plans[0]).toMatchObject({ mode: "append" });
    expect(payload!.plans[0].items, "hộp chỉ NÓI, không đổi hàng nạp").toHaveLength(1);
  });

  it("sheet đích ĐANG BẬT + nhóm cuối SL 3 → chỉ (a): sau nạp 600.000, vàng; không có (b), không có dòng 'file không nhân hệ số'", async () => {
    const h = await moHop(tepHang([moi], false, 200_000), { groupSubtotal: true, items: dichCu(3) }, { cheDo: "append" });
    expect(h.tongSauNap()).toBe(tien(900_000));
    const d = doiChieu(h);
    expect(d.chinh, "lệch này có từ trước khi tự bật: bản cũ vẫn 'Khớp 200.000'").toBe(`Lệch +${tien(400_000)}`);
    expect(d.phu).toBe(`Excel ${tien(200_000)} · sau nạp ${tien(600_000)}`);
    expect(d.lop).toMatch(/\bwarn\b/);
    expect(cauA(h)).toHaveLength(1);
    expect(cauA(h)[0]).toContain(`${tien(200_000)} trong file → ${tien(600_000)} sau nạp`);
    expect(cauB(h), "cờ không đổi → hàng sẵn có không đổi").toEqual([]);
    expect(h.tuBat()).toEqual([]);
    expect(h.dongBao().some((t) => /Sheet đích đang bật Thành Tiền nhóm/.test(t)), "tệp không có nhóm nào — nguyên nhân là (a), đã nói").toBe(false);
    expect(h.dongBao().some((t) => /Tổng tiền chưa khớp/.test(t))).toBe(false);
    await h.nap();
    expect(loiXacNhan).toEqual([]);
  });

  it("tệp có hạng mục đầu RỒI mới tới nhóm riêng (SL 2, tệp không nhân), sheet đích đang bật → (a) chỉ cho phần đầu, kèm dòng 'Sheet đích đang bật…' cho nhóm của tệp", async () => {
    const tepTron: ImportedItem[] = [
      moi,
      { kind: "section", name: "Nhóm B", quantity: 2, unitPrice: 0, row: 8 },
      { kind: "item", name: "X", unit: "cái", quantity: 1, unitPrice: 50_000, row: 9 },
    ];
    const h = await moHop(tepHang(tepTron, false, 250_000), { groupSubtotal: true, items: dichCu(3) }, { cheDo: "append" });
    expect(doiChieu(h)).toMatchObject({ phu: `Excel ${tien(250_000)} · sau nạp ${tien(700_000)}`, lop: expect.stringMatching(/\bwarn\b/) });
    const a = cauA(h);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatch(/^Các hàng nối vào \(phần đứng trước dòng nhóm đầu tiên của file\) nằm trong nhóm “Nhóm cũ” \(Số Lượng 3\) ở cuối sheet/);
    expect(a[0]).toContain(`${tien(200_000)} trong file → ${tien(600_000)} sau nạp`);
    expect(h.dongBao().some((t) => /Sheet đích đang bật Thành Tiền nhóm/.test(t)), "nhóm SL 2 của tệp: tệp không nhân mà sheet nhân").toBe(true);
    expect(cauB(h)).toEqual([]);
    await h.nap();
    expect(loiXacNhan).toEqual([]);
  });

  it("tệp MỞ ĐẦU bằng dòng nhóm của chính nó → không có (a) (hàng mới không rơi vào nhóm cũ); chỉ (b) khi cờ đổi", async () => {
    const tepNhom = [nhomMoi, { ...moi, row: 8 }];
    const tat = await moHop(tepHang(tepNhom, false, 200_000), { groupSubtotal: false, items: dichCu(3) }, { cheDo: "append" });
    expect(cauA(tat)).toEqual([]);
    expect(cauB(tat)).toHaveLength(1);
    expect(cauB(tat)[0]).toContain(`đổi ${tien(100_000)} → ${tien(300_000)}`);
    expect(doiChieu(tat)).toMatchObject({ phu: `Excel ${tien(200_000)} · sau nạp ${tien(400_000)}`, lop: expect.stringMatching(/\bwarn\b/) });
    act(() => goc.unmount()); thung.remove();
    thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung);
    const bat = await moHop(tepHang(tepNhom, false, 200_000), { groupSubtotal: true, items: dichCu(3) }, { cheDo: "append" });
    expect(cauA(bat)).toEqual([]);
    expect(cauB(bat)).toEqual([]);
    expect(doiChieu(bat)).toMatchObject({ chinh: `Khớp ${tien(200_000)}`, lop: expect.stringMatching(/\bok\b/) });
  });

  it("nhóm cuối SL 1 → 'Khớp' như cũ, không có (a) / (b)", async () => {
    const h = await moHop(tepHang([moi], false, 200_000), { groupSubtotal: false, items: dichCu(1) }, { cheDo: "append" });
    expect(doiChieu(h)).toEqual({ lop: expect.stringMatching(/\bok\b/), chinh: `Khớp ${tien(200_000)}`, phu: `Excel ${tien(200_000)} · sau nạp ${tien(200_000)}` });
    expect(cauA(h)).toEqual([]);
    expect(cauB(h)).toEqual([]);
  });

  it("tệp không có dòng Tổng → thẻ nói 'Sau nạp: 800.000' (phần tăng thêm thật), vẫn nói (a) + (b)", async () => {
    const h = await moHop(tepHang([moi], false, null), { groupSubtotal: false, items: dichCu(3) }, { cheDo: "append" });
    expect(doiChieu(h).chinh).toBe(`Sau nạp: ${tien(800_000)}`);
    expect(cauA(h)).toHaveLength(1);
    expect(cauB(h)).toHaveLength(1);
  });

  it("bảng HÀ NỘI nối vào bảng có nhóm cuối SL 3 → tổng không nhân hệ số: 'Khớp 200.000', không cảnh báo (a) / (b) oan", async () => {
    for (const coDich of [false, true]) {
      const h = await moHop(tepHang([moi], false, 200_000), { groupSubtotal: coDich, items: dichCu(3) }, { ...HN, cheDo: "append" });
      expect(h.tongSauNap(), `cờ đích ${coDich}: extraTableSum chỉ cộng hạng mục`).toBe(tien(300_000));
      expect(doiChieu(h), `cờ đích ${coDich}`).toMatchObject({ chinh: `Khớp ${tien(200_000)}`, lop: expect.stringMatching(/\bok\b/) });
      expect(cauA(h)).toEqual([]);
      expect(cauB(h)).toEqual([]);
      await h.nap();
      expect(loiXacNhan).toEqual([]);
      act(() => goc.unmount()); thung.remove();
      thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung);
    }
  });

  it("lỗi tệp THẬT (tệp ghi 150.000, hàng cộng ra 200.000) → vẫn ĐỎ + hộp xác nhận; (a) / (b) vẫn được nói, không nuốt lệch thật", async () => {
    const h = await moHop(tepHang([moi], false, 150_000), { groupSubtotal: false, items: dichCu(3) }, { cheDo: "append" });
    const d = doiChieu(h);
    expect(d.lop).toMatch(/danger/);
    expect(d.phu).toBe(`Excel ${tien(150_000)} · sau nạp ${tien(800_000)}`);
    const [dongDo] = h.dongBao().filter((t) => /^Tổng tiền chưa khớp/.test(t));
    expect(dongDo, "lệch thật phải còn dòng đỏ").toBeTruthy();
    expect(dongDo, "nêu riêng tổng các hàng đọc được để thấy đúng chỗ lệch của tệp (150.000 ≠ 200.000)")
      .toBe(`Tổng tiền chưa khớp: Excel là ${tien(150_000)}, sau nạp là ${tien(800_000)}; riêng các hàng đọc được trong file cộng lại ${tien(200_000)}. Xem các dòng màu vàng trước khi nạp.`);
    expect(cauA(h)).toHaveLength(1);
    expect(cauB(h)).toHaveLength(1);
    await h.nap();
    expect(loiXacNhan.join(" | ")).toMatch(/1 sheet có tổng sau nạp khác tổng trong Excel/);
  });

  it("(a) TÌNH CỜ bù đúng phần đọc thiếu (tệp ghi 400.000, đọc được 1 hàng 200.000, nhóm cuối SL 2 → sau nạp 400.000) → KHÔNG 'Khớp': đỏ + hộp xác nhận", async () => {
    const h = await moHop(tepHang([moi], false, 400_000), { groupSubtotal: true, items: dichCu(2) }, { cheDo: "append" });
    // Dòng phụ nêu tiền các hàng đọc được, không lặp "sau nạp 400.000" — hai số bằng nhau mà thẻ vẫn "Chưa khớp" thì người không
    // lập trình không hiểu vì sao (vòng 1 người soát).
    expect(doiChieu(h)).toEqual({ lop: expect.stringMatching(/danger/), chinh: "Chưa khớp", phu: `Excel ${tien(400_000)} · các hàng trong file ${tien(200_000)}` });
    expect(h.dongBao()).toContain(`Tổng tiền chưa khớp: Excel là ${tien(400_000)}, sau nạp là ${tien(400_000)}; riêng các hàng đọc được trong file cộng lại ${tien(200_000)}. Xem các dòng màu vàng trước khi nạp.`);
    await h.nap();
    const hoi = loiXacNhan.join(" | ");
    expect(hoi, "vẫn hỏi xác nhận — nói đúng: Excel khác các hàng đọc được").toMatch(/1 sheet có tổng trong Excel khác tổng các hàng đọc được trong file/);
    expect(hoi, "không nói 'sau nạp khác Excel' khi hai số trùng nhau").not.toMatch(/tổng sau nạp khác tổng trong Excel/);
  });
});

// VÒNG 1 người soát (c12a051). (1) Ngưỡng dung sai 2 đ / 0,5 % vốn để nuốt sai số đọc file; phần chênh do hệ số nhóm — (a), (b), nhóm
// của file bị cộng theo cờ khác — là số tiền chính xác, nên nhỏ hơn ngưỡng thì thẻ vẫn KHÔNG được hiện xanh "Khớp" (bản cũ: tệp 50
// triệu, tổng sheet tăng thêm 100.000 vì bật cờ mà vẫn "Khớp 50.000.000"). Cảnh báo vàng, không chặn, không vào hộp xác nhận — như
// mọi lệch do hệ số nhóm khác. (2) Bảng Hà Nội: mọi tổng của hộp cộng bằng extraTableSum, đúng phép "Tổng tất cả … sheet Hà Nội".
describe("VÒNG 1 — thẻ đối chiếu không gọi phần chênh do hệ số nhóm là 'Khớp'; bảng HN cộng bằng extraTableSum", () => {
  const tien = (n: number) => M.fmtMoney(n);
  const hang = (kind: "item" | "section", name: string, quantity: number, unitPrice: number, them: Partial<ImportedItem> = {}): ImportedItem => ({ kind, name, unit: kind === "item" ? "cái" : "", quantity, unitPrice, row: 7, ...them });
  const dich = (...x: [kind: "item" | "section", name: string, quantity: number, unitPrice: number, them?: Record<string, unknown>][]) =>
    x.map(([kind, name, quantity, unitPrice, them]) => ({ kind, name, unit: kind === "item" ? "cái" : "", quantity, unitPrice, ...them })) as unknown as M.Item[];
  type Hop = Awaited<ReturnType<typeof moHop>>;
  const doiChieu = (h: Hop) => {
    const the = h.the("Đối chiếu tiền")!;
    return { lop: the.className, chinh: the.querySelector("strong")!.textContent, phu: the.querySelector("small")!.textContent };
  };
  const tongHienTai = () => (thung.querySelector(".import-summary .muted")?.textContent || "");
  const moiHop = () => { act(() => goc.unmount()); thung.remove(); thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung); loiXacNhan.length = 0; };

  it("(b) nhỏ hơn ngưỡng: sheet TẮT [Nhóm cũ SL 2, Cũ 100.000], nối tệp 50 triệu mở đầu bằng nhóm riêng → 'Lệch +100.000' vàng, không 'Khớp'; nạp không hỏi", async () => {
    const h = await moHop(tepHang([hang("section", "Nhóm B", 1, 0), hang("item", "Sân khấu", 1, 50_000_000)], false, 50_000_000),
      { groupSubtotal: false, items: dich(["section", "Nhóm cũ", 2, 0], ["item", "Cũ", 1, 100_000]) }, { cheDo: "append" });
    expect(h.tongSauNap(), "tổng sheet 100.000 → 50.200.000 (cách lưới tính — không đổi)").toBe(tien(50_200_000));
    expect(doiChieu(h), "bản cũ: lớp 'ok', 'Khớp 50.000.000'").toEqual({ lop: expect.stringMatching(/\bwarn\b/), chinh: `Lệch +${tien(100_000)}`, phu: `Excel ${tien(50_000_000)} · sau nạp ${tien(50_100_000)}` });
    expect(doiChieu(h).lop).not.toMatch(/\bok\b|danger/);
    expect(h.dongBao().some((t) => t.startsWith(`Bật Thành Tiền nhóm làm tổng các hàng sẵn có đổi ${tien(100_000)} → ${tien(200_000)}`))).toBe(true);
    const [tuBat] = h.tuBat();
    expect(tuBat, "dòng tự bật nói đúng: tổng khác tổng ghi trong file").toContain(`khác tổng ghi trong file: Excel là ${tien(50_000_000)}, sau nạp là ${tien(50_100_000)}`);
    expect(h.dongBao().some((t) => /Tổng tiền chưa khớp/.test(t)), "không phải lệch thật").toBe(false);
    expect(await h.nap(), "cảnh báo vàng không chặn").toBeTruthy();
    expect(loiXacNhan, "không vào hộp xác nhận").toEqual([]);
  });

  it("(a) nhỏ hơn ngưỡng: sheet BẬT [Nhóm cũ SL 2, Cũ 1.000.000], tệp 100 triệu có 300.000 trước dòng nhóm đầu → 'Lệch +300.000' vàng, câu (a) đúng số", async () => {
    const h = await moHop(tepHang([hang("item", "Phí vận chuyển", 1, 300_000), hang("section", "Nhóm B", 1, 0), hang("item", "Sân khấu", 1, 99_700_000)], false, 100_000_000),
      { groupSubtotal: true, items: dich(["section", "Nhóm cũ", 2, 0], ["item", "Cũ", 1, 1_000_000]) }, { cheDo: "append" });
    expect(doiChieu(h)).toEqual({ lop: expect.stringMatching(/\bwarn\b/), chinh: `Lệch +${tien(300_000)}`, phu: `Excel ${tien(100_000_000)} · sau nạp ${tien(100_300_000)}` });
    const [a] = h.dongBao().filter((t) => /^Các hàng nối vào/.test(t));
    expect(a).toMatch(/^Các hàng nối vào \(phần đứng trước dòng nhóm đầu tiên của file\) nằm trong nhóm “Nhóm cũ” \(Số Lượng 2\) ở cuối sheet nên được nhân ×2: /);
    expect(a).toContain(`${tien(300_000)} trong file → ${tien(600_000)} sau nạp`);
    await h.nap();
    expect(loiXacNhan).toEqual([]);
  });

  it("THAY (không có hàng sẵn có): ô tự bật nhân nhóm của file thêm 100.000 trên tệp 100 triệu → 'Lệch +100.000' vàng, không 'Khớp'; nạp không hỏi", async () => {
    const h = await moHop(tepHang([hang("item", "Phí", 1, 99_900_000), hang("section", "Nhóm", 2, 0), hang("item", "Hàng", 1, 100_000)], false, 100_000_000),
      { groupSubtotal: false, items: [] });
    expect(doiChieu(h)).toEqual({ lop: expect.stringMatching(/\bwarn\b/), chinh: `Lệch +${tien(100_000)}`, phu: `Excel ${tien(100_000_000)} · sau nạp ${tien(100_100_000)}` });
    expect(h.tuBat()[0]).toContain(`khác tổng ghi trong file: Excel là ${tien(100_000_000)}, sau nạp là ${tien(100_100_000)}`);
    await h.nap();
    expect(loiXacNhan).toEqual([]);
  });

  it("bảng HÀ NỘI, làm tròn ,5: nối [Khung 0,7 × 163.845], tệp ghi 114.692 → sau nạp 114.691 và 'Tổng hiện tại 100.000 → 214.691' — đúng extraTableSum của bảng sau nạp", async () => {
    const cu = dich(["item", "Cũ", 1, 100_000]);
    const h = await moHop(tepHang([hang("item", "Khung", 0.7, 163_845)], false, 114_692), { groupSubtotal: false, items: cu }, { ...HN, cheDo: "append" });
    expect(doiChieu(h), "lệch 1 đ trong ngưỡng sai số → vẫn 'Khớp', nhưng 'sau nạp' là số bảng HN thật cộng").toEqual({ lop: expect.stringMatching(/\bok\b/), chinh: `Khớp ${tien(114_692)}`, phu: `Excel ${tien(114_692)} · sau nạp ${tien(114_691)}` });
    expect(tongHienTai()).toBe(`Tổng hiện tại: ${tien(100_000)} → ${tien(214_691)}`);
    const payload = await h.nap();
    // Đối chứng ĐỘC LẬP: AccountHnView cộng "Tổng tất cả … sheet Hà Nội" bằng extraTableSum trên bảng sau khi đẩy hàng nạp vào cuối.
    const sau = extraTableSum({ category: "hn", items: [...cu, ...payload!.plans[0].items] }, false);
    expect(sau - extraTableSum({ category: "hn", items: cu }, false), "bản cũ: 114.692").toBe(114_691);
  });

  it("bảng HÀ NỘI, Số Ngày −1 (mẫu có ngày): bảng bỏ qua Số Ngày ≤ 0 → 'Sau nạp: 50.000', 100.000 → 150.000; tệp tự cộng −50.000 thì đỏ + hỏi", async () => {
    const cu = dich(["item", "Cũ", 1, 100_000, { days: 1 }]);
    const hoan = hang("item", "Hoàn", 1, 50_000, { days: -1 });
    const h = await moHop(tepHang([hoan], false, null), { groupSubtotal: false, items: cu }, { ...HN, cheDo: "append", coNgay: true });
    expect(doiChieu(h).chinh, "bản cũ: 'Sau nạp: -50.000'").toBe(`Sau nạp: ${tien(50_000)}`);
    expect(tongHienTai(), "bản cũ: 100.000 → 50.000").toBe(`Tổng hiện tại: ${tien(100_000)} → ${tien(150_000)}`);
    const payload = await h.nap();
    expect(extraTableSum({ category: "hn", items: [...cu, ...payload!.plans[0].items] }, true), "tổng HN thật sau nạp").toBe(150_000);
    moiHop();
    const coTong = await moHop(tepHang([hoan], false, -50_000), { groupSubtotal: false, items: cu }, { ...HN, cheDo: "append", coNgay: true });
    expect(doiChieu(coTong)).toMatchObject({ lop: expect.stringMatching(/danger/), chinh: `Lệch +${tien(100_000)}` });
    await coTong.nap();
    expect(loiXacNhan.join(" | ")).toMatch(/1 sheet có tổng sau nạp khác tổng trong Excel/);
  });

  it("bảng HÀ NỘI nối vào nhóm cuối SL 3 (cờ tắt / bật), tệp lớn → vẫn 'Khớp', không cảnh báo (a) / (b) oan", async () => {
    for (const coDich of [false, true]) {
      const h = await moHop(tepHang([hang("item", "Sân khấu", 1, 50_000_000)], false, 50_000_000),
        { groupSubtotal: coDich, items: dich(["section", "Nhóm HN", 3, 0], ["item", "Cũ", 1, 100_000]) }, { ...HN, cheDo: "append" });
      expect(doiChieu(h), `cờ đích ${coDich}`).toEqual({ lop: expect.stringMatching(/\bok\b/), chinh: `Khớp ${tien(50_000_000)}`, phu: `Excel ${tien(50_000_000)} · sau nạp ${tien(50_000_000)}` });
      expect(h.dongBao().filter((t) => /^Các hàng nối vào|^Bật Thành Tiền nhóm làm tổng/.test(t))).toEqual([]);
      moiHop();
    }
  });
});
