/** @vitest-environment jsdom */
//
// THỨ TỰ MẪU ở ô chọn (chủ repo chốt 2026-10-06): mỗi công ty Không ngày → Banner → Có ngày.
// /api/meta/templates trả theo TÊN (collation CSDL): "GN (có ngày)", "GN (không ngày)", "GN Banner (không ngày)"
// → ô chọn hiện Có ngày đứng đầu. Nay ô chọn sắp ở mã (sapMauHienThi); thứ tự API — và vì thế "mẫu đầu"
// làm mặc định cho bảng thiếu templateId — GIỮ NGUYÊN (đổi nó là đổi tiền báo giá cũ).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("./venueCatalog", async (goc) => ({ ...(await goc<typeof import("./venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
vi.mock("./ui", async (goc) => ({ ...(await goc<typeof import("./ui")>()), toast: () => {}, confirmModal: async () => true }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { sapMauHienThi, nhomMau } from "./thuTuMau";
import { ExtraTables, type ExtraTable } from "../components/ExtraTables";
import { HnTables, mauBangHn, type HnTable } from "../components/HnTables";
import type { EditorTemplate } from "./api";

const mau = (id: number, code: string, name: string, companyId: number, hasDays: boolean) =>
  ({ id, code, name, companyId, layout: { hasDays, hasDetail: false, reserveDetail: false, numberSubsections: false } }) as EditorTemplate;
// Đúng thứ tự API (ORDER BY name, collation en_US.utf8 của CSDL) và đúng seed: id KHÔNG theo thứ tự mong muốn.
const API: EditorTemplate[] = [
  mau(6, "clofull_conngay", "CLF (có ngày)", 2, true),
  mau(4, "clofull_decor", "CLF (không ngày)", 2, false),
  mau(5, "clofull_banner", "CLF Banner (không ngày)", 2, false),
  mau(2, "unibenfood", "GN (có ngày)", 1, true),
  mau(1, "marico_decor", "GN (không ngày)", 1, false),
  mau(3, "gn_banner", "GN Banner (không ngày)", 1, false),
];

describe("sapMauHienThi — Không ngày → Banner → Có ngày", () => {
  it("GN và CLF đều đúng thứ tự, không phụ thuộc id", () => {
    expect(sapMauHienThi(API.filter((t) => t.companyId === 1)).map((t) => t.name)).toEqual(["GN (không ngày)", "GN Banner (không ngày)", "GN (có ngày)"]);
    expect(sapMauHienThi(API.filter((t) => t.companyId === 2)).map((t) => t.name)).toEqual(["CLF (không ngày)", "CLF Banner (không ngày)", "CLF (có ngày)"]);
    const daoId = API.map((t, k) => ({ ...t, id: 100 - k }));
    expect(sapMauHienThi(daoId.filter((t) => t.companyId === 1)).map((t) => t.code)).toEqual(["marico_decor", "gn_banner", "unibenfood"]);
  });
  it("ổn định với mọi thứ tự đầu vào; không đổi mảng gốc", () => {
    const goc = [...API];
    const a = sapMauHienThi(API).map((t) => t.id);
    expect(sapMauHienThi([...API].reverse()).map((t) => t.id)).toEqual(a);
    expect(API).toEqual(goc);
  });
  it("nhóm theo cấu trúc: banner theo mã hoặc tên; có cột Số Ngày → Có ngày", () => {
    expect(nhomMau({ code: "x_banner", name: "X" })).toBe(1);
    expect(nhomMau({ code: "x", name: "Banner X", layout: { hasDays: true } })).toBe(1);
    expect(nhomMau({ code: "x", name: "X", layout: { hasDays: true } })).toBe(2);
    expect(nhomMau({ code: "x", name: "X" })).toBe(0);
  });
  it("mẫu mặc định (mẫu đầu theo thứ tự API) KHÔNG đổi — bảng thiếu templateId vẫn tính như cũ", () => {
    expect(mauBangHn({}, API, 1)?.id).toBe(2);
  });
});

let thung: HTMLDivElement, goc: Root;
beforeEach(() => { thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung); });
afterEach(() => { act(() => goc.unmount()); thung.remove(); document.body.innerHTML = ""; });
const tuyChon = () => Array.from(thung.querySelectorAll("select.extra-tpl option")).map((o) => o.textContent);

describe("ô chọn Mẫu của bảng nội bộ / Hà Nội", () => {
  it("HnTables: Không ngày → Banner → Có ngày; bảng thiếu templateId vẫn hiện mẫu mặc định cũ", () => {
    const t = [{ name: "HN", groupSubtotal: false, items: [] }] as unknown as HnTable[];
    act(() => { goc.render(<HnTables moMacDinh tables={t} templates={API} companyId={1} editable onMarkDirty={() => {}} />); });
    expect(tuyChon()).toEqual(["GN (không ngày)", "GN Banner (không ngày)", "GN (có ngày)"]);
    expect((thung.querySelector("select.extra-tpl") as HTMLSelectElement).value).toBe("2");
  });
  it("ExtraTables (Chi phí HCM): Colorfull cũng Không ngày → Banner → Có ngày", () => {
    const s = { id: 1, templateId: 4, extraTables: [{ category: "hcm", templateId: 5, name: "HCM", items: [] }] as unknown as ExtraTable[] };
    act(() => { goc.render(<ExtraTables sheet={s} templates={API} companyId={2} editable canApprove={false} onMarkDirty={() => {}} />); });
    act(() => { (thung.querySelectorAll(".khoi-sheet-nut")[0] as HTMLButtonElement).click(); });   // mở khối Chi phí HCM
    expect(tuyChon()).toEqual(["CLF (không ngày)", "CLF Banner (không ngày)", "CLF (có ngày)"]);
    expect((thung.querySelector("select.extra-tpl") as HTMLSelectElement).value).toBe("5");
  });
});
