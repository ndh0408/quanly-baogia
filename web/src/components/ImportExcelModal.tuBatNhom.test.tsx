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
/** Mở hộp, đọc `ketQua`, chọn tệp → dựng xem trước. `dich` = sheet đang có trong báo giá (null → không có sheet nào → sheet MỚI). */
async function moHop(ket: ImportResult, dich: Dich, them: { thayGiuCo?: boolean; tongKhongNhan?: boolean; cheDo?: "append" | "skip" } = {}) {
  ketQua.v = ket;
  let payload: ImportApplyPayload | null = null;
  const dong: { name: string; templateId: number; groupSubtotal: boolean; items: M.Item[] }[] = dich ? [{ name: "Décor", templateId: 1, groupSubtotal: dich.groupSubtotal, items: dich.items ?? [] }] : [];
  act(() => goc.render(
    <ImportExcelModal
      sheets={dong} templates={MAU}
      usesDaysOf={() => false} addrDetailOf={() => true} newSheetTemplateId={() => 1}
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
