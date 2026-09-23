/** @vitest-environment jsdom */
// Soát toàn diện L48 — hộp "Nhập từ Excel", chế độ mặc định "Thay toàn bộ": ảnh hạng mục của sheet
// đích phải ĐI THEO dòng khớp (tệp Excel không chở được ảnh), và ảnh của dòng sẽ bị xoá thật phải
// được NÓI RA trong hộp xác nhận — kể cả khi tệp không có cột HÌNH ẢNH (xuất lúc tắt cột ảnh, máy
// chủ không cảnh báo gì).
//
// Đi đúng đường người dùng: chọn tệp → xem trước → bấm "Nạp các thay đổi này" → payload đưa cho
// trang (QuoteEditor / AccountHnView chép `{ ...it }` vào lưới nên ảnh trong payload là ảnh vào lưới).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EditorTemplate, ImportResult } from "../lib/api";
import type * as M from "../lib/quoteMath";

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
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const MAU: EditorTemplate[] = [{ id: 1, code: "marico_decor", name: "GN (không ngày)", layout: { hasDays: false, hasDetail: false, reserveDetail: true, numberSubsections: false } }];

const tep = (): ImportResult => ({
  warnings: [],
  sheets: [{
    index: 0, name: "Décor", templateCode: "marico_decor", templateName: "GN (không ngày)",
    hasDays: false, numberSubs: false, groupSubtotal: false, showImages: false, warnings: [],
    columns: { _stt: "B", name: "C", unit: "E", quantity: "F", unitPrice: "G", _amount: "H", notes: "I" },
    headerRow: 6, firstRow: 7, lastRow: 8,
    stats: { rows: 2, items: 2, sections: 0, subsections: 0, subs: 0, infos: 0, formulas: 0, formulasDropped: 0 },
    items: [
      { kind: "item", name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 250000, row: 7 },
      { kind: "item", name: "Standee", unit: "cái", quantity: 3, unitPrice: 320000, row: 8 },
    ],
  }],
});

let thung: HTMLDivElement, goc: Root;
beforeEach(() => { thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung); loiXacNhan.length = 0; });
afterEach(() => { act(() => goc.unmount()); thung.remove(); document.body.innerHTML = ""; });

async function napTep(items: M.Item[]) {
  ketQua.v = tep();
  let payload: ImportApplyPayload | null = null;
  act(() => goc.render(
    <ImportExcelModal
      sheets={[{ name: "Décor", templateId: 1, items }]} templates={MAU}
      usesDaysOf={() => false} addrDetailOf={() => true} newSheetTemplateId={() => 1}
      onApply={(p) => { payload = p; }} onClose={() => {}}
    />,
  ));
  const input = thung.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [new File(["x"], "khach-sua.xlsx")] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  const nut = [...thung.querySelectorAll("button")].find((b) => b.textContent === "Nạp các thay đổi này") as HTMLButtonElement;
  expect(nut, "không thấy nút nạp — tệp chưa được đọc").toBeTruthy();
  await act(async () => { nut.click(); });
  return { payload: payload as ImportApplyPayload | null, html: thung.textContent || "" };
}

describe("L48: Thay toàn bộ không được âm thầm vứt ảnh", () => {
  it("dòng khớp mang ảnh sang; ảnh của dòng bị xoá thật được báo trong hộp xác nhận", async () => {
    const { payload } = await napTep([
      { kind: "item", name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 250000, images: [PNG, PNG] },
      { kind: "item", name: "Standee", unit: "cái", quantity: 3, unitPrice: 300000, images: [PNG] },
      { kind: "item", name: "Bàn bị khách xoá", unit: "cái", quantity: 1, unitPrice: 100000, images: [PNG, PNG, PNG] },
    ]);
    expect(payload, "không nạp").toBeTruthy();
    expect(payload!.plans[0].items.map((x) => x.images?.length || 0), "ảnh của dòng khớp bị vứt").toEqual([2, 1]);
    expect(payload!.plans[0].items[1].unitPrice).toBe(320000);
    expect(loiXacNhan.join(" | ")).toMatch(/3 ảnh .*sẽ bị xoá/);
  });

  it("không dòng nào mất ảnh → không thêm cảnh báo ảnh", async () => {
    const { payload } = await napTep([
      { kind: "item", name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 250000, images: [PNG] },
      { kind: "item", name: "Standee", unit: "cái", quantity: 3, unitPrice: 300000 },
    ]);
    expect(payload!.plans[0].items[0].images?.length).toBe(1);
    expect(loiXacNhan.join(" | ")).not.toMatch(/ảnh/);
  });
});
