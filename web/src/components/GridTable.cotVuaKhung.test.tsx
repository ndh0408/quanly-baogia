/** @vitest-environment jsdom */
/**
 * ============================================================================
 * CỘT LƯỚI PHẢI VỪA KHUNG KHI CO — không bật thanh cuộn ngang "ma" (soát giao diện 2026-11-25).
 *
 * Đo Chromium 1280×720, menu mở (khung .tbl-scroll 908px), mẫu GN có ngày + Ghi chú nội bộ: cột cố định ra 659px + Hạng Mục
 * 260px = 919px > 908px → lưới cuộn ngang 11px, cột ✕ bị cắt mép. Gốc: COLS co ĐỀU mọi cột theo một tỉ lệ rồi mới kẹp từng cột
 * lên mức sàn — STT (sàn 38), Đơn giá (sàn 92), nút ✕ (sàn 36) bị kẹp lên làm tổng vượt phần được chia; cộng thêm bảng chỉ rộng
 * calc(100% − 4px) và làm tròn từng cột.
 *
 * jsdom không dàn trang: bài giả ResizeObserver + clientWidth của .tbl-scroll (như GridTable.doLaiKhiMo.test.tsx) rồi đọc
 * bề rộng <col> GridTable khai.
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (k: number): ItemK =>
  ({ _k: nextK(), kind: "item", name: `Hạng ${k}`, unit: "bộ", quantity: 1, days: 1, unitPrice: 1000, notes: "" }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
let beNgang = 908;
const baoRO: Array<() => void> = [];

beforeEach(() => {
  baoRO.length = 0;
  vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { baoRO.push(cb); } observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("tbl-scroll") ? beNgang : 0; });
});
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const khungHinh = async (n = 4) => {
  for (let k = 0; k < n; k++) await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
};

async function doCot(khung: number) {
  beNgang = khung;
  hop = document.createElement("div"); document.body.appendChild(hop); root = createRoot(hop);
  act(() => root!.render(<GridTable items={[mk(1), mk(2)]} usesDays showDetail={false} numberSubs={false} editable internalNote
    groupSubtotal={false} fxBar onChange={() => {}} />));
  await khungHinh();
  act(() => { baoRO.forEach((cb) => cb()); });
  await khungHinh();
  return [...hop.querySelectorAll("colgroup col")].map((c) => parseFloat((c as HTMLElement).style.width) || null);
}

describe("Bề rộng cột lưới khi khung hẹp hơn bề rộng lý tưởng", () => {
  it("1280×720 menu mở (khung 908px): cột cố định + Hạng Mục (sàn 260) + 6px viền ≤ khung", async () => {
    const cot = await doCot(908);
    const coDinh = cot.filter((w): w is number => w != null);
    expect(cot.filter((w) => w == null), "chỉ cột Hạng Mục để trống bề rộng (ăn phần dư)").toHaveLength(1);
    const tong = coDinh.reduce((a, b) => a + b, 0);
    expect(tong + 260 + 6, `cột cố định ${tong}px — cộng Hạng Mục 260px vượt khung 908px → thanh cuộn ngang`).toBeLessThanOrEqual(908);
  });

  it("không cột nào xuống dưới mức SÀN (STT 38 · ĐVT 54 · SL 62 · Số ngày 54 · Đơn giá 92 · Thành tiền 96 · Ghi chú 96 · ✕ 36)", async () => {
    const coDinh = (await doCot(908)).filter((w): w is number => w != null);
    // Thứ tự <col>: STT, (Hạng Mục), ĐVT, SL, Số ngày, Đơn giá, Thành tiền, Ghi chú, Ghi chú nội bộ, ✕.
    const san = [38, 54, 62, 54, 92, 96, 96, 96, 36];
    coDinh.forEach((w, k) => expect(w, `cột thứ ${k}`).toBeGreaterThanOrEqual(san[k]));
  });

  it("khung rộng (1600px): giữ nguyên bề rộng lý tưởng, không co", async () => {
    const coDinh = (await doCot(1600)).filter((w): w is number => w != null);
    expect(coDinh).toEqual([50, 80, 90, 80, 130, 140, 150, 150, 40]);
  });
});
