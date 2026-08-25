// BỘ ĐO HIỆU NĂNG LƯỚI BÁO GIÁ — chạy lại được, dùng cho cả trước và sau khi tối ưu.
//
// Cách chạy:  npm --prefix web run bench   (build production rồi mở /app2/bench.html)
// Trang tự dựng lưới với số dòng cho trước rồi đo. Kết quả in ra bảng + đẩy vào window.__BENCH
// để công cụ tự động đọc. PHẢI đo trên bản BUILD PRODUCTION — React chế độ phát triển thổi mọi
// con số lên 4-9 lần nên đo trên vite dev là vô nghĩa.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { GridTable } from "./components/GridTable";
import { type ItemK, nextK } from "./lib/gridShared";
import "../../public/style.css";
import "./styles.css";

// ── dựng dữ liệu giống báo giá thật: cứ 10 dòng có 1 nhóm, hạng mục có tên 2 dòng ──────────────
function makeItems(n: number): ItemK[] {
  const out: ItemK[] = [];
  let g = 0;
  while (out.length < n) {
    out.push({ _k: nextK(), kind: "section", name: `NHÓM ${++g}` } as ItemK);
    for (let i = 0; i < 9 && out.length < n; i++) {
      out.push({
        _k: nextK(),
        name: `Banner ${g}-${i}: 11m7W x 1m7H (lần ${i + 1})\n. Hiflex xuyên đèn`,
        unit: "m2", quantity: 19.89, unitPrice: 65000,
        notes: i % 3 === 0 ? "giao trước 2 ngày" : "",
      } as ItemK);
    }
  }
  return out.slice(0, n);
}

const now = () => performance.now();
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
// KHÔNG dùng requestAnimationFrame để đo: trong tab nền nhịp vẽ bị tạm dừng, và ngay cả ở tab
// trước thì hạn chờ dự phòng cũng lấn át số thật (lần đo đầu mọi phép đều ra ~250ms = đúng bằng
// hạn chờ, tức đo cái hạn chứ không đo việc vẽ).
// Thay bằng: ép React dựng lại NGAY (flushSync) rồi ép trình duyệt tính bố cục (đọc offsetHeight).
// Cách này đo đúng phần CHẶN LUỒNG CHÍNH — cũng chính là thứ quyết định cảm giác giật/mượt.
const veXong = () => { void document.body.offsetHeight; };
const nhip = () => new Promise<void>((r) => setTimeout(r, 0));

type Row = { phep: string; soDong: number; ms: number; ghiChu?: string };

// ── các phép đo ────────────────────────────────────────────────────────────────────────────────
async function benchOne(n: number, setItems: (it: ItemK[]) => void): Promise<Row[]> {
  const rows: Row[] = [];
  const items = makeItems(n);

  // 1) Vẽ lần đầu: từ lúc giao dữ liệu tới khi trình duyệt vẽ xong
  const t0 = now();
  flushSync(() => setItems(items));
  veXong();
  rows.push({ phep: "Vẽ lần đầu", soDong: n, ms: now() - t0 });
  await nhip();

  const table = document.querySelector("table.excel-table") as HTMLElement | null;
  if (!table) { rows.push({ phep: "LỖI", soDong: n, ms: 0, ghiChu: "không thấy lưới" }); return rows; }

  const setterTA = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  const setterIN = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  const midRow = Math.floor(n / 2);

  // 2) Gõ vào ô CHỮ ở GIỮA bảng — đo phần chặn luồng chính mỗi phím
  {
    const el = table.querySelector(`tr[data-row="${midRow}"] td.col-hangmuc textarea`) as HTMLTextAreaElement | null;
    if (el) {
      el.focus(); el.readOnly = false;
      const mau: number[] = [];
      for (let i = 0; i < 20; i++) {
        const t = now();
        setterTA.call(el, el.value + "a");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        mau.push(now() - t);
      }
      rows.push({ phep: "Gõ 1 phím (ô chữ)", soDong: n, ms: median(mau) });
      el.blur();
    }
  }

  // 3) Gõ vào ô SỐ — đường này còn phải tính lại tiền
  {
    const el = table.querySelector(`tr[data-row="${midRow}"] td.col-qty input`) as HTMLInputElement | null;
    if (el) {
      el.focus(); el.readOnly = false;
      const mau: number[] = [];
      for (let i = 0; i < 20; i++) {
        const t = now();
        setterIN.call(el, String(10 + i));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        mau.push(now() - t);
      }
      rows.push({ phep: "Gõ 1 phím (ô số)", soDong: n, ms: median(mau) });
      el.blur();
    }
  }
  await nhip();

  // 4) Thêm hàng — bấm đúng nút người dùng bấm
  {
    const btn = [...document.querySelectorAll(".grid-add-bar button")].find((b) => b.textContent?.includes("Thêm hàng")) as HTMLButtonElement | null;
    if (btn) {
      const t = now();
      flushSync(() => btn.click());
      veXong();
      rows.push({ phep: "Thêm 1 hàng", soDong: n, ms: now() - t });
    }
  }

  // 5) Xoá hàng ở giữa
  {
    const btn = table.querySelector(`tr[data-row="${midRow}"] button.rm-row`) as HTMLButtonElement | null;
    if (btn) {
      const t = now();
      flushSync(() => btn.click());
      veXong();
      rows.push({ phep: "Xoá 1 hàng", soDong: n, ms: now() - t });
    }
  }

  // 6) Cuộn — 10 nhịp cuộn liên tiếp
  {
    const wrap = document.querySelector(".tbl-scroll") as HTMLElement | null;
    if (wrap) {
      const t = now();
      for (let i = 0; i < 10; i++) { wrap.scrollTop += 300; void wrap.offsetHeight; }
      rows.push({ phep: "Cuộn 10 nhịp", soDong: n, ms: now() - t });
      wrap.scrollTop = 0;
    }
  }

  // 7) Tính lại toàn bộ tiền (đường tổng) — đo qua thao tác đổi 1 ô số rồi chờ vẽ xong
  {
    const el = table.querySelector(`tr[data-row="${Math.min(midRow + 1, n - 1)}"] td.col-price input`) as HTMLInputElement | null;
    if (el) {
      el.focus(); el.readOnly = false;
      const t = now();
      flushSync(() => {
        setterIN.call(el, "123456");
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
      veXong();
      rows.push({ phep: "Đổi đơn giá → vẽ xong", soDong: n, ms: now() - t });
      el.blur();
    }
  }

  rows.push({ phep: "Số ô nhập trong lưới", soDong: n, ms: table.querySelectorAll("input,textarea").length, ghiChu: "đơn vị: ô" });
  return rows;
}

const SIZES = [10, 50, 100, 250, 500, 1000];

function Bench() {
  const [items, setItems] = useState<ItemK[]>(() => makeItems(10));
  const [, force] = useState(0);
  const [ketQua, setKetQua] = useState<Row[]>([]);
  const [dangChay, setDangChay] = useState(false);

  const chay = async () => {
    setDangChay(true);
    const all: Row[] = [];
    for (const n of SIZES) {
      const r = await benchOne(n, (it) => setItems(it));
      all.push(...r);
      setKetQua([...all]);
      await new Promise((res) => setTimeout(res, 120));
    }
    (window as unknown as { __BENCH: Row[] }).__BENCH = all;
    setDangChay(false);
  };

  return (
    <div className="shell" style={{ gridTemplateColumns: "1fr" }}>
      <main className="main" style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
          <button className="btn" id="bench-run" onClick={chay} disabled={dangChay}>
            {dangChay ? "Đang đo…" : "Chạy đo"}
          </button>
          <span className="muted">Số dòng: {SIZES.join(" · ")}</span>
        </div>
        {!!ketQua.length && (
          <table className="extra-grid" style={{ marginBottom: 16, borderCollapse: "collapse" }}>
            <thead><tr><th>Phép đo</th><th>Số dòng</th><th>ms</th></tr></thead>
            <tbody>
              {ketQua.map((r, i) => (
                <tr key={i}><td>{r.phep}</td><td style={{ textAlign: "right" }}>{r.soDong}</td>
                  <td style={{ textAlign: "right" }}>{r.ms.toFixed(1)}{r.ghiChu ? ` (${r.ghiChu})` : ""}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="editor">
          <GridTable items={items} usesDays={false} showDetail={false} numberSubs editable internalNote
            groupSubtotal fxBar onChange={() => force((x) => x + 1)} />
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Bench />);
