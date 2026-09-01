/** @vitest-environment jsdom */
//
// BÀI KIỂM MỨC COMPONENT CHO GridTable — Ctrl+Z/Y đi qua DÂY NỐI THẬT.
//
// ── VÌ SAO TỆP NÀY TỒN TẠI ──────────────────────────────────────────────────
// `gridUndo.test.ts` (ngăn xếp THUẦN) và `gridSelect.test.ts` (neo/đích THUẦN) kiểm rất kỹ hai
// hàm ở tầng dưới, nhưng cả hai đều KHÔNG chạm vào `GridTable.tsx`. Nghĩa là toàn bộ đoạn dây
// nối — `onGridKeyDown` gọi `undoRedoKey()`, cổng `if (editable)`, cổng IME, `moveTo(…, extend)`,
// `snap()/restore()` — chưa hề có cổng nào gác. Cắt đứt một sợi dây trong số đó thì 251 bài hiện
// có vẫn XANH hết. Đó chính là lỗ mà `docs/REMAINING_RISKS.md` ghi.
//
// Ba thứ chỉ lộ ra ở mức component, không cách nào kiểm ở tầng thuần:
//   1. THỨ TỰ: `pushUndo()` phải chụp ảnh TRƯỚC khi ghi vào `items`. Hàm thuần nhận sẵn chuỗi
//      snapshot nên nó không biết chuỗi ấy được chụp lúc nào — đúng chỗ dễ trôi nhất.
//   2. CỔNG `editable`: `undoRedoKey()` trả "undo" cho MỌI lưới; chỉ `GridTable` biết lưới này
//      có cho sửa không. Lưới chỉ-đọc mà Ctrl+Z đổi được dữ liệu là hở nghiệp vụ.
//   3. CỔNG IME: `dangGoIME()` thuần đã có bài kiểm (`imeGuard.test.ts`), nhưng việc nó được gọi
//      TRƯỚC khối phím tắt — tức bộ gõ tiếng Việt giữ được ↑↓/Enter của nó — thì nằm ở component.
//
// ── VÌ SAO DOCBLOCK `@vitest-environment jsdom` Ở ĐẦU TỆP ───────────────────
// `web/` chạy vitest ở environment "node" và 21 tệp test hiện có (251 bài) sống nhờ điều đó —
// đổi mặc định sang jsdom là làm chậm cả bộ và đổi hành vi của chúng (window/document bỗng có
// mặt, các nhánh `typeof window === "undefined"` đảo chiều). Docblock chỉ bật jsdom cho ĐÚNG tệp
// này, không đụng ai. `jsdom` vào `devDependencies` của `web/` chính là để phục vụ dòng đó.
//
// ── VÌ SAO KHÔNG DÙNG @testing-library ──────────────────────────────────────
// `createRoot` + `act` của chính React đủ cho mọi việc ở đây, và các bài dưới đây bắn THẲNG
// `KeyboardEvent` gốc vào ô nhập — tức đi đúng đường mà trình duyệt thật đi (React uỷ quyền sự
// kiện ở gốc cây, không gắn listener lên từng ô). Thêm 2-3 gói nữa chỉ để có `render()` là nuôi
// phụ thuộc không cần thiết, ngược với luật `tests/ch3-npm-manifest.test.js` đang gác ở gốc repo.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable, type GridTableProps } from "./GridTable";
import * as M from "../lib/quoteMath";
import { nextK, type ItemK } from "../lib/gridShared";
import { norm, type VenueEntry } from "../lib/venueCatalog";

// `nameSuggest` và modal "Chèn từ rạp" gọi `loadCatalog()` → `fetch("/api/venues/catalog")`. Trong
// jsdom không có server nên lời gọi ấy chỉ đẻ ra promise bị từ chối lang thang. Chặn ngay ở cửa:
// giữ nguyên mọi hàm THUẦN của module (searchEntries/dimLabel/fillItemFromEntry/norm — lưới vẫn
// dùng bản THẬT, đó mới là thứ quyết định hạng mục nào được điền), chỉ thay đúng lối ra mạng.
// `vi.hoisted` là bắt buộc: nhà máy của `vi.mock` chạy lúc nạp module, tức TRƯỚC khi các `const`
// ở thân tệp này được khởi tạo.
const kho = vi.hoisted(() => ({ danhMuc: { entries: [] as unknown[], venues: [] as unknown[] } }));
vi.mock("../lib/venueCatalog", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/venueCatalog")>();
  return { ...goc, loadCatalog: () => Promise.resolve(kho.danhMuc) };
});

// `act()` của React 19 đòi cờ này; đặt ở đây thay vì tạo `test-setup.ts` để khỏi phải sửa
// `vite.config.ts` (tệp dùng chung với 21 bài test khác).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── giàn dựng ────────────────────────────────────────────────────────────────

/** Đổi prop của lưới ĐANG SỐNG (không dựng lại) — cần cho bài "lưới chỉ đọc": ngăn xếp undo phải
 *  là CÙNG MỘT ngăn xếp thì phép so sánh có-sửa-được / không-sửa-được mới có nghĩa. */
let datProp: ((o: Partial<GridTableProps>) => void) | null = null;

function Vo({ items, banDau }: { items: ItemK[]; banDau: Partial<GridTableProps> }) {
  const [them, setThem] = useState(banDau);
  const [, buoc] = useState(0);
  datProp = setThem;
  return (
    <GridTable
      items={items}
      usesDays={false}
      showDetail={false}
      numberSubs={false}
      editable={true}
      internalNote={false}
      groupSubtotal={false}
      // Cha vẽ lại mỗi khi lưới báo dữ liệu đổi — đúng như QuoteEditor thật. Thiếu bước này thì
      // sau Ctrl+Z model đã lùi mà DOM còn treo hàng cũ.
      onChange={() => buoc((v) => v + 1)}
      {...them}
    />
  );
}

let root: Root | null = null;
let hop: HTMLDivElement | null = null;

function moLuoi(items: ItemK[], them: Partial<GridTableProps> = {}) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(<Vo items={items} banDau={them} />));
}

/** Ô nhập của (hàng, cột) — đúng bộ chọn mà chính GridTable dùng để dò ô. */
function o(row: number, field: string): HTMLInputElement | HTMLTextAreaElement {
  const el = hop!.querySelector(`tr[data-row="${row}"] [data-f="${field}"]`);
  if (!el) throw new Error(`không thấy ô (${row}, ${field})`);
  return el as HTMLInputElement | HTMLTextAreaElement;
}

/** <td> chứa ô — nơi vùng chọn được tô bằng class `cell-selected`. */
function td(row: number, field: string): HTMLElement {
  return o(row, field).closest("td") as HTMLElement;
}

type MoPhim = { ctrl?: boolean; shift?: boolean; alt?: boolean; ime?: boolean; keyCode?: number };

/** Bắn keydown GỐC (không phải sự kiện tổng hợp của React) — React uỷ quyền ở gốc cây nên đây
 *  đúng là đường mà một phím thật đi. */
function phim(el: Element, key: string, mo: MoPhim = {}) {
  const init: KeyboardEventInit & { keyCode?: number } = {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: !!mo.ctrl,
    shiftKey: !!mo.shift,
    altKey: !!mo.alt,
    isComposing: !!mo.ime,
  };
  if (mo.keyCode != null) init.keyCode = mo.keyCode;
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", init));
  });
}

function vaoO(el: HTMLElement) {
  act(() => el.focus());
}

/** DÁN. jsdom 30 KHÔNG có `ClipboardEvent` lẫn `DataTransfer` (đã đo: cả hai đều `undefined`), nên
 *  dựng bằng `Event` thường + gắn `clipboardData` tối thiểu. `onPaste` của lưới chỉ đụng đúng hai
 *  thứ: `getData(kiểu)` và `preventDefault()` — không giả lập thừa cái gì. */
function dan(el: HTMLElement, text: string) {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    value: { getData: (kieu: string) => (kieu === "text/plain" || kieu === "text" ? text : "") },
  });
  act(() => {
    el.dispatchEvent(ev);
  });
}

/** Gõ vào ô như trình duyệt: đặt value rồi bắn `input` — đúng lối mà chính GridTable.tsx dùng
 *  (xem `ae.dispatchEvent(new Event("input", …))` ở nhánh AutoSum/Alt+Enter). */
function go(el: HTMLInputElement | HTMLTextAreaElement, chu: string) {
  act(() => {
    el.value = chu;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Nạp danh mục rạp giả cho `loadCatalog` đã bị chặn ở trên. `_hay` (chuỗi so khớp không dấu) do
 *  `loadCatalog` thật tính lúc tải, nên ở đây phải tính bằng CHÍNH `norm` của module — dùng chuỗi
 *  bịa thì `searchEntries` thật sẽ không tìm ra gì và bài kiểm xanh vì lý do sai. */
function datDanhMuc(entries: VenueEntry[]) {
  entries.forEach((e) => {
    e._hay = norm(`${e.venue} ${e.name} ${e.region || ""} ${e.cat || ""} ${(e.tags || []).join(" ")}`);
  });
  kho.danhMuc = { entries, venues: [] };
}

const mucRap = (venue: string, name: string): VenueEntry => ({
  cat: "Quầy", region: "HCM", venue, name, dim: "(2W x 1H)m", w: 2, h: 1, unit: "m2", qty: null, note: null, tags: [],
});

/** Chờ mốc thời gian thật (hẹn giờ gõ 150ms / vẽ-hoãn 180ms) VÀ các promise kèm theo, tất cả
 *  trong `act` để React kịp xử lý setState do chúng sinh ra. */
async function cho(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** Chờ cho hẹn giờ vẽ-hoãn 180ms (`onChangeSoft`) nổ TRONG act — nếu để nó nổ sau khi bài kiểm
 *  kết thúc thì React setState trên cây đã tháo, log đầy cảnh báo không liên quan. */
async function xaHen() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 220));
  });
}

// `_k` đặt sẵn bằng CHÍNH bộ cấp khoá của lưới. Không đặt thì `restore()` sẽ tự gán khoá cho hàng
// nào còn thiếu (đúng theo thiết kế: khoá React phải có sau khi lùi), và phép so `JSON.stringify`
// ở nhóm (e) sẽ đỏ vì một trường KHÔNG PHẢI dữ liệu nghiệp vụ — tức đỏ sai chỗ.
const hang = (name: string, unit = "", quantity = 0, unitPrice = 0): ItemK =>
  ({ ...M.blankItem(false), name, unit, quantity, unitPrice, _k: nextK() }) as ItemK;

beforeEach(() => {
  datProp = null;
  // Danh mục rạp là biến MODULE (nhà máy `vi.mock` đóng gói nó) → không dọn thì bài chạy sau thừa
  // hưởng danh mục của bài trước và thứ tự chạy trở thành một biến ẩn.
  kho.danhMuc = { entries: [], venues: [] };
});

afterEach(async () => {
  await xaHen();
  if (root) act(() => root!.unmount());
  root = null;
  hop?.remove();
  hop = null;
  document.body.innerHTML = "";
});

// ── (0) giàn dựng có thật sự chạm được component không ───────────────────────

describe("GridTable — giàn dựng", () => {
  it("dựng được lưới thật trong jsdom: đủ hàng, đủ ô nhập có data-f", () => {
    const items = [hang("Banner"), hang("Standee")];
    moLuoi(items);
    expect(hop!.querySelectorAll("tr[data-row]").length).toBe(2);
    expect((o(0, "name") as HTMLTextAreaElement).value).toBe("Banner");
    expect(o(1, "unitPrice")).toBeTruthy();
  });

  it("bắn KeyboardEvent gốc thì handler của lưới NHẬN được (nếu không, mọi bài dưới vô nghĩa)", () => {
    const items = [hang("Banner"), hang("Standee")];
    moLuoi(items);
    vaoO(o(0, "name"));
    // Ctrl+A = chọn cả bảng (nhánh riêng, không đụng undo) → chứng minh sự kiện tới được nơi cần.
    phim(o(0, "name"), "a", { ctrl: true });
    expect(td(1, "unitPrice").classList.contains("cell-selected")).toBe(true);
  });
});

// ── (a) Ctrl+Z lùi · Ctrl+Y và Ctrl+Shift+Z làm lại ──────────────────────────

describe("GridTable — Ctrl+Z / Ctrl+Y qua dây nối thật", () => {
  it("gõ sửa một ô rồi Ctrl+Z → giá trị QUAY LẠI như cũ", () => {
    const items = [hang("Banner"), hang("Standee")];
    moLuoi(items);
    const el = o(0, "name");
    vaoO(el);
    go(el, "Banner ĐÃ SỬA");
    expect(items[0].name).toBe("Banner ĐÃ SỬA");

    phim(el, "z", { ctrl: true });
    expect(items[0].name).toBe("Banner");
    // Ô đang focus bị effect đồng-bộ-ô BỎ QUA (để không cướp chữ đang gõ) → `syncActiveCell` phải
    // tự vẽ lại đúng ô đó. Thiếu bước này thì model đã lùi mà người dùng vẫn thấy chữ cũ.
    expect((o(0, "name") as HTMLTextAreaElement).value).toBe("Banner");
  });

  it("Ctrl+Y LÀM LẠI thao tác vừa lùi", () => {
    const items = [hang("Banner")];
    moLuoi(items);
    const el = o(0, "name");
    vaoO(el);
    go(el, "Banner ĐÃ SỬA");
    phim(el, "z", { ctrl: true });
    expect(items[0].name).toBe("Banner");

    phim(o(0, "name"), "y", { ctrl: true });
    expect(items[0].name).toBe("Banner ĐÃ SỬA");
  });

  it("Ctrl+Shift+Z cũng LÀM LẠI (nếp macOS) — chữ hoa 'Z' không được rơi lọt", () => {
    const items = [hang("Banner")];
    moLuoi(items);
    const el = o(0, "name");
    vaoO(el);
    go(el, "Banner ĐÃ SỬA");
    phim(el, "z", { ctrl: true });
    expect(items[0].name).toBe("Banner");

    // Giữ Shift làm `key` thành "Z" hoa — đúng thứ trình duyệt gửi.
    phim(o(0, "name"), "Z", { ctrl: true, shift: true });
    expect(items[0].name).toBe("Banner ĐÃ SỬA");
  });

  it("⌘+Z (metaKey) chạy y hệt Ctrl+Z — người dùng macOS không mất phép lùi", () => {
    const items = [hang("Banner")];
    moLuoi(items);
    const el = o(0, "name");
    vaoO(el);
    go(el, "Banner ĐÃ SỬA");
    act(() => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true }));
    });
    expect(items[0].name).toBe("Banner");
  });

  it("Ctrl+Z lùi cả PHIÊN GÕ, không phải từng ký tự (gõ 3 nhịp vào cùng ô = 1 mốc)", () => {
    const items = [hang("Banner")];
    moLuoi(items);
    const el = o(0, "name");
    vaoO(el);
    go(el, "B");
    go(el, "Ba");
    go(el, "Bao");
    expect(items[0].name).toBe("Bao");

    phim(el, "z", { ctrl: true });
    expect(items[0].name).toBe("Banner");   // về thẳng giá trị lúc VÀO ô, không phải "Ba"
  });

  it("Ctrl+Z lúc ngăn xếp RỖNG không làm hỏng gì (và không ném lỗi)", () => {
    const items = [hang("Banner")];
    moLuoi(items);
    vaoO(o(0, "name"));
    phim(o(0, "name"), "z", { ctrl: true });
    expect(items[0].name).toBe("Banner");
    expect(items.length).toBe(1);
  });
});

// ── (b) cổng `editable` ──────────────────────────────────────────────────────

describe("GridTable — lưới CHỈ ĐỌC thì phím tắt không được đổi dữ liệu", () => {
  it("cùng một ngăn xếp undo: editable=false thì Ctrl+Z/Ctrl+Y đứng im, bật lại thì lùi được", () => {
    const items = [hang("Banner")];
    moLuoi(items);
    const el = o(0, "name");
    vaoO(el);
    go(el, "Banner ĐÃ SỬA");
    const truoc = JSON.stringify(items);

    // Cùng INSTANCE, cùng histRef — chỉ đổi mỗi cờ. Nếu dựng lưới mới thì ngăn xếp rỗng và bài
    // kiểm sẽ xanh vì lý do sai (không có gì để lùi), chứ không phải vì cổng `editable` chặn.
    act(() => datProp!({ editable: false }));
    phim(o(0, "name"), "z", { ctrl: true });
    expect(JSON.stringify(items)).toBe(truoc);
    phim(o(0, "name"), "y", { ctrl: true });
    expect(JSON.stringify(items)).toBe(truoc);

    act(() => datProp!({ editable: true }));
    phim(o(0, "name"), "z", { ctrl: true });
    expect(items[0].name).toBe("Banner");
  });

  it("lưới chỉ đọc: Ctrl+'-' (xoá hàng) và Ctrl+'+' (chèn hàng) cũng không đổi số hàng", () => {
    const items = [hang("Banner"), hang("Standee")];
    moLuoi(items, { editable: false });
    const el = o(0, "name");
    phim(el, "-", { ctrl: true });
    expect(items.length).toBe(2);
    phim(el, "+", { ctrl: true });
    expect(items.length).toBe(2);
  });

  it("lưới chỉ đọc: Delete không xoá nội dung vùng chọn", () => {
    const items = [hang("Banner")];
    moLuoi(items, { editable: false });
    const el = o(0, "name");
    vaoO(el);
    phim(el, "Delete");
    expect(items[0].name).toBe("Banner");
  });
});

// ── (c) cổng IME — gõ tiếng Việt không bị lưới cướp phím ─────────────────────

describe("GridTable — bộ gõ tiếng Việt (IME) giữ được phím của nó", () => {
  it("ĐỐI CHỨNG: ↓ THƯỜNG thì lưới nhận, con trỏ xuống hàng dưới", () => {
    const items = [hang("Banner"), hang("Standee")];
    moLuoi(items);
    vaoO(o(0, "name"));
    phim(o(0, "name"), "ArrowDown");
    expect(document.activeElement).toBe(o(1, "name"));
  });

  it("đang dựng ký tự (isComposing) → ↓ KHÔNG bị lưới cướp, con trỏ đứng yên", () => {
    const items = [hang("Banner"), hang("Standee")];
    moLuoi(items);
    vaoO(o(0, "name"));
    phim(o(0, "name"), "ArrowDown", { ime: true });
    expect(document.activeElement).toBe(o(0, "name"));
  });

  it("dấu hiệu keyCode 229 (quy ước cũ) cũng chặn được ↓", () => {
    const items = [hang("Banner"), hang("Standee")];
    moLuoi(items);
    vaoO(o(0, "name"));
    phim(o(0, "name"), "ArrowDown", { keyCode: 229 });
    expect(document.activeElement).toBe(o(0, "name"));
  });

  it("dấu hiệu key='Process' (Firefox): ô đang KHOÁ được mở + xoá để cụm chữ đè lên", () => {
    // Đây mới là việc mà nhánh IME LÀM, không chỉ là việc nó tránh: ở chế độ READY ô bị `readOnly`
    // nên nhịp đầu của cụm chữ sẽ bị nuốt — chữ đầu của mỗi ô biến mất, lỗi CHỈ người gõ tiếng
    // Việt gặp. Nhánh IME mở khoá + xoá NGAY trong keydown, trước khi composition bắt đầu.
    const items = [hang("Banner"), hang("Standee")];
    moLuoi(items);
    vaoO(o(0, "name"));
    phim(o(0, "name"), "ArrowDown");   // đi bằng phím → ô đích ở trạng thái CHỌN (khoá)
    const el = o(1, "name") as HTMLTextAreaElement;
    expect(el.readOnly, "ô đích phải đang khoá thì bài kiểm mới có nghĩa").toBe(true);

    phim(el, "Process");
    expect(el.readOnly).toBe(false);
    expect(el.value).toBe("");         // gõ là ĐÈ — nội dung cũ nhường chỗ cho cụm chữ sắp tới
    expect(items.length).toBe(2);      // và không phím tắt nào của lưới bị kích hoạt
  });

  it("Enter XÁC NHẬN cụm chữ của bộ gõ KHÔNG bị hiểu là 'xuống hàng'", () => {
    const items = [hang("Banner"), hang("Standee")];
    moLuoi(items);
    vaoO(o(0, "name"));
    phim(o(0, "name"), "Enter", { ime: true });
    expect(document.activeElement).toBe(o(0, "name"));
  });

  it("phím thường 'z' khi đang dựng ký tự KHÔNG kích hoạt phép lùi", () => {
    const items = [hang("Banner")];
    moLuoi(items);
    const el = o(0, "name");
    vaoO(el);
    go(el, "Banner ĐÃ SỬA");
    phim(el, "z", { ime: true });
    expect(items[0].name).toBe("Banner ĐÃ SỬA");
  });

  it("CỐ Ý: Ctrl+Z VẪN chạy khi đang dựng ký tự — cổng IME chỉ gác phím KHÔNG-Ctrl", () => {
    // Ghi lại như một quyết định, không phải tai nạn: `onGridKeyDown` viết `!ctrl && dangGoIME(e)`,
    // và `gridShared.ts` nói rõ `dangGoIME` KHÔNG xét Ctrl vì "phím tắt là việc của nơi gọi".
    // Ctrl+Z là LỆNH, không phải một nhịp của cụm chữ — bộ gõ không dùng tới nó.
    const items = [hang("Banner")];
    moLuoi(items);
    const el = o(0, "name");
    vaoO(el);
    go(el, "Banner ĐÃ SỬA");
    phim(el, "z", { ctrl: true, ime: true });
    expect(items[0].name).toBe("Banner");
  });
});

// ── (d) Shift+mũi tên mở rộng vùng chọn TRONG component ──────────────────────

describe("GridTable — Shift+mũi tên mở rộng vùng chọn", () => {
  it("Shift+↓ nới vùng xuống hàng dưới (neo đứng yên) — cả hai ô được tô", () => {
    const items = [hang("Banner"), hang("Standee"), hang("Backdrop")];
    moLuoi(items);
    vaoO(o(0, "name"));
    expect(td(1, "name").classList.contains("cell-selected")).toBe(false);

    phim(o(0, "name"), "ArrowDown", { shift: true });
    expect(td(0, "name").classList.contains("cell-selected")).toBe(true);
    expect(td(1, "name").classList.contains("cell-selected")).toBe(true);
    expect(td(2, "name").classList.contains("cell-selected")).toBe(false);
    // NEO vẫn là ô xuất phát — đây là thứ khiến Shift+↑ sau đó THU vùng lại chứ không nới ngược.
    expect(td(0, "name").classList.contains("cell-anchor")).toBe(true);
  });

  it("Shift+↓ rồi Shift+↑ THU vùng lại về đúng một ô (không nới thêm)", () => {
    const items = [hang("Banner"), hang("Standee"), hang("Backdrop")];
    moLuoi(items);
    vaoO(o(0, "name"));
    phim(o(0, "name"), "ArrowDown", { shift: true });
    phim(o(1, "name"), "ArrowUp", { shift: true });
    expect(td(0, "name").classList.contains("cell-selected")).toBe(true);
    expect(td(1, "name").classList.contains("cell-selected")).toBe(false);
  });

  it("Shift+→ nới vùng sang cột kế; ↓ TRƠN thì bỏ vùng, chỉ còn một ô", () => {
    const items = [hang("Banner"), hang("Standee")];
    moLuoi(items);
    vaoO(o(0, "name"));
    phim(o(0, "name"), "ArrowRight", { shift: true });
    expect(td(0, "name").classList.contains("cell-selected")).toBe(true);
    expect(td(0, "unit").classList.contains("cell-selected")).toBe(true);

    phim(o(0, "unit"), "ArrowDown");
    expect(td(0, "name").classList.contains("cell-selected")).toBe(false);
    expect(td(1, "unit").classList.contains("cell-selected")).toBe(true);
  });

  it("Shift+↓ ở hàng CUỐI đứng yên — vùng chọn không tràn ra ngoài bảng", () => {
    const items = [hang("Banner"), hang("Standee")];
    moLuoi(items);
    vaoO(o(1, "name"));
    phim(o(1, "name"), "ArrowDown", { shift: true });
    expect(document.activeElement).toBe(o(1, "name"));
    expect(td(1, "name").classList.contains("cell-selected")).toBe(true);
  });
});

// ── (e) 19 chỗ pushUndo(): mốc có được chụp TRƯỚC khi ghi vào items không? ────
//
// Câu hỏi mà docs/REMAINING_RISKS.md bỏ ngỏ. Cách trả lời KHÔNG cần đọc mã: với mỗi thao tác,
// chụp `JSON.stringify(items)` trước, làm thao tác, đòi dữ liệu PHẢI ĐỔI (kẻo bài kiểm xanh vì
// thao tác không chạy), rồi Ctrl+Z và đòi chuỗi JSON quay về Y HỆT. Mốc chụp SAU khi ghi thì phép
// lùi trả về đúng trạng thái đã hỏng, và phép so chuỗi này đỏ.

/** Chạy một thao tác rồi đòi Ctrl+Z trả `items` về đúng chuỗi JSON ban đầu. */
function mocPhaiChupTruoc(items: ItemK[], lam: () => void, oLui: () => HTMLElement) {
  const truoc = JSON.stringify(items);
  lam();
  expect(JSON.stringify(items), "thao tác không đổi gì → bài kiểm này vô nghĩa").not.toBe(truoc);
  phim(oLui(), "z", { ctrl: true });
  expect(JSON.stringify(items)).toBe(truoc);
}

describe("GridTable — pushUndo() chụp ảnh TRƯỚC khi ghi vào items", () => {
  it("gõ ô CHỮ (markEditUndo)", () => {
    const items = [hang("Banner", "cái", 2, 1000)];
    moLuoi(items);
    vaoO(o(0, "name"));
    mocPhaiChupTruoc(items, () => go(o(0, "name"), "Banner mới"), () => o(0, "name"));
  });

  it("gõ ô SỐ (onNumInput ghi thẳng vào model mỗi phím — chụp sau là dính luôn số mới)", () => {
    const items = [hang("Banner", "cái", 2, 1000)];
    moLuoi(items);
    vaoO(o(0, "unitPrice"));
    mocPhaiChupTruoc(items, () => go(o(0, "unitPrice"), "9000"), () => o(0, "unitPrice"));
    expect(items[0].unitPrice).toBe(1000);
  });

  it("Ctrl+'-' xoá hàng đang chọn", () => {
    const items = [hang("Banner"), hang("Standee"), hang("Backdrop")];
    moLuoi(items);
    vaoO(o(1, "name"));
    mocPhaiChupTruoc(items, () => phim(o(1, "name"), "-", { ctrl: true }), () => o(1, "name"));
    expect(items.map((i) => i.name)).toEqual(["Banner", "Standee", "Backdrop"]);
  });

  it("Ctrl+'+' chèn hàng dưới", () => {
    const items = [hang("Banner"), hang("Standee")];
    moLuoi(items);
    vaoO(o(0, "name"));
    mocPhaiChupTruoc(items, () => phim(o(0, "name"), "+", { ctrl: true }), () => o(0, "name"));
    expect(items.length).toBe(2);
  });

  it("Ctrl+D chép xuống (fillDown)", () => {
    const items = [hang("Banner", "cái", 2, 1000), hang("Standee", "bộ", 5, 7000)];
    moLuoi(items);
    vaoO(o(0, "unitPrice"));
    mocPhaiChupTruoc(
      items,
      () => {
        phim(o(0, "unitPrice"), "ArrowDown", { shift: true });
        phim(o(1, "unitPrice"), "d", { ctrl: true });
      },
      () => o(1, "unitPrice"),
    );
    expect(items[1].unitPrice).toBe(7000);
  });

  it("Ctrl+R chép sang phải (fillRight)", () => {
    const items = [hang("Banner", "cái", 2, 1000)];
    moLuoi(items);
    vaoO(o(0, "quantity"));
    mocPhaiChupTruoc(
      items,
      () => {
        phim(o(0, "quantity"), "ArrowRight", { shift: true });
        phim(o(0, "unitPrice"), "r", { ctrl: true });
      },
      () => o(0, "unitPrice"),
    );
    expect(items[0].unitPrice).toBe(1000);
  });

  it("Delete xoá sạch VÙNG đang chọn (clearRange)", () => {
    const items = [hang("Banner", "cái", 2, 1000), hang("Standee", "bộ", 5, 7000)];
    moLuoi(items);
    vaoO(o(0, "name"));
    mocPhaiChupTruoc(
      items,
      () => {
        phim(o(0, "name"), "ArrowDown", { shift: true });
        phim(o(1, "name"), "Delete");
      },
      () => o(1, "name"),
    );
    expect(items.map((i) => i.name)).toEqual(["Banner", "Standee"]);
  });

  it("Enter ở hàng CUỐI đẻ thêm hàng mới", () => {
    const items = [hang("Banner")];
    moLuoi(items);
    vaoO(o(0, "name"));
    mocPhaiChupTruoc(items, () => phim(o(0, "name"), "Enter"), () => o(0, "name"));
    expect(items.length).toBe(1);
  });

  it("nút '+ Thêm hàng' (pushItem)", () => {
    const items = [hang("Banner")];
    moLuoi(items);
    vaoO(o(0, "name"));
    const nut = [...hop!.querySelectorAll("button")].find((b) => b.textContent?.includes("Thêm hàng"))!;
    mocPhaiChupTruoc(items, () => act(() => nut.click()), () => o(0, "name"));
    expect(items.length).toBe(1);
  });

  it("nút '↳' thêm hàng con (addSubAfter)", () => {
    const items = [hang("Banner")];
    moLuoi(items);
    vaoO(o(0, "name"));
    const nut = hop!.querySelector("tr[data-row='0'] button.add-sub") as HTMLButtonElement;
    mocPhaiChupTruoc(items, () => act(() => nut.click()), () => o(0, "name"));
    expect(items.length).toBe(1);
  });

  it("nút '✕' xoá hàng (removeRow)", () => {
    const items = [hang("Banner"), hang("Standee")];
    moLuoi(items);
    vaoO(o(0, "name"));
    const nut = hop!.querySelector("tr[data-row='1'] button.rm-row") as HTMLButtonElement;
    mocPhaiChupTruoc(items, () => act(() => nut.click()), () => o(0, "name"));
    expect(items.map((i) => i.name)).toEqual(["Banner", "Standee"]);
  });

  it("dán 1 SỐ vào ô số", () => {
    const items = [hang("Banner", "cái", 2, 1000)];
    moLuoi(items);
    vaoO(o(0, "unitPrice"));
    mocPhaiChupTruoc(items, () => dan(o(0, "unitPrice"), "9000"), () => o(0, "unitPrice"));
    expect(items[0].unitPrice).toBe(1000);
  });

  it("dán 1 CHỮ vào ô đang chọn (chưa vào chế độ sửa)", () => {
    const items = [hang("Banner", "cái", 2, 1000)];
    moLuoi(items);
    vaoO(o(0, "name"));
    mocPhaiChupTruoc(items, () => dan(o(0, "name"), "Backdrop"), () => o(0, "name"));
    expect(items[0].name).toBe("Banner");
  });

  it("dán 1 giá trị ra CẢ VÙNG đang chọn", () => {
    const items = [hang("Banner", "cái", 2, 1000), hang("Standee", "bộ", 5, 7000)];
    moLuoi(items);
    vaoO(o(0, "unitPrice"));
    mocPhaiChupTruoc(
      items,
      () => {
        phim(o(0, "unitPrice"), "ArrowDown", { shift: true });
        dan(o(1, "unitPrice"), "4200");
      },
      () => o(1, "unitPrice"),
    );
    expect(items.map((i) => i.unitPrice)).toEqual([1000, 7000]);
  });

  it("dán KHỐI 2×2 kiểu Excel", () => {
    const items = [hang("Banner", "cái", 2, 1000), hang("Standee", "bộ", 5, 7000)];
    moLuoi(items);
    vaoO(o(0, "unit"));
    mocPhaiChupTruoc(items, () => dan(o(0, "unit"), "hộp\t11\nthùng\t22"), () => o(0, "unit"));
    expect(items.map((i) => i.unit)).toEqual(["cái", "bộ"]);
  });

  it("Ctrl+Enter điền nội dung ra CẢ VÙNG (nhánh riêng, không dùng mốc của phiên gõ)", () => {
    // Nhánh này có cổng `if (!(m && m.i === i && m.f === f)) pushUndo()`: phiên gõ đã có mốc thì
    // không ghi thêm. Muốn tới được lượt pushUndo THẬT phải xoá mốc phiên gõ trước — và cách duy
    // nhất bằng bàn phím là bấm Ctrl+Z (syncActiveCell đặt editUndoRef = null), trong khi cờ
    // "đang sửa" và vùng chọn 2 hàng vẫn còn nguyên. Đó chính là chuỗi thao tác dưới đây.
    const items = [hang("Banner", "cái", 2, 1000), hang("Standee", "bộ", 5, 7000)];
    moLuoi(items);
    vaoO(o(0, "unit"));
    phim(o(0, "unit"), "ArrowDown", { shift: true });   // vùng = 2 hàng, con trỏ ở hàng 1
    go(o(1, "unit"), "gõ tạm");                          // mở phiên gõ (mốc 1)
    phim(o(1, "unit"), "z", { ctrl: true });             // lùi → mốc phiên gõ bị xoá, vẫn "đang sửa"
    expect(items[1].unit).toBe("bộ");

    mocPhaiChupTruoc(items, () => phim(o(1, "unit"), "Enter", { ctrl: true }), () => o(1, "unit"));
    expect(items.map((i) => i.unit)).toEqual(["cái", "bộ"]);
  });

  it("chọn một GỢI Ý theo rạp trong ô Hạng Mục (applySug)", async () => {
    datDanhMuc([mucRap("CGV Landmark", "Quầy bắp")]);
    const items = [hang("")];
    moLuoi(items);
    const el = o(0, "name");
    vaoO(el);
    go(el, "quay bap");
    await cho(280);   // hẹn giờ gõ 150ms + promise danh mục + hẹn giờ vẽ-hoãn 180ms

    const truoc = JSON.stringify(items);
    phim(o(0, "name"), "ArrowDown");   // mở dòng gợi ý đầu
    phim(o(0, "name"), "Tab");         // Tab = điền
    expect(items[0].name, "dropdown gợi ý không mở → bài kiểm này vô nghĩa").toContain("Quầy bắp");
    expect(items[0].quantity).toBe(2);   // SL tự tính 2m × 1m

    // applySug dời con trỏ sang ô Đơn Giá — bấm Ctrl+Z ở đúng chỗ người dùng đang đứng.
    phim(o(0, "unitPrice"), "z", { ctrl: true });
    expect(JSON.stringify(items)).toBe(truoc);
  });

  it("modal '📐 Chèn từ rạp' chèn hàng loạt (insertCatalogRows)", async () => {
    datDanhMuc([mucRap("CGV Landmark", "Quầy bắp"), mucRap("CGV Landmark", "Quầy vé")]);
    const items = [hang("Banner")];
    moLuoi(items);
    vaoO(o(0, "name"));
    const truoc = JSON.stringify(items);

    const mo = [...hop!.querySelectorAll("button")].find((b) => b.textContent?.includes("Chèn từ rạp"))!;
    act(() => mo.click());
    await cho(20);   // promise danh mục của modal
    act(() => (hop!.querySelector(".vs-venue-row") as HTMLElement).click());   // chọn rạp → tick sẵn tất cả
    const gui = [...hop!.querySelectorAll("button")].find((b) => b.textContent?.includes("Chèn vào báo giá"))!;
    act(() => gui.click());
    expect(items.length, "modal không chèn được → bài kiểm này vô nghĩa").toBe(3);

    phim(o(0, "name"), "z", { ctrl: true });
    expect(JSON.stringify(items)).toBe(truoc);
  });

  it("xoá một ẢNH của hạng mục (removeImage)", () => {
    const items = [hang("Banner")];
    (items[0] as unknown as Record<string, unknown>).images = ["data:image/png;base64,iVBORw0KGgo="];
    moLuoi(items, { showImages: true });
    vaoO(o(0, "name"));
    const nut = hop!.querySelector("tr[data-row='0'] button.img-rm") as HTMLButtonElement;
    mocPhaiChupTruoc(items, () => act(() => nut.click()), () => o(0, "name"));
    expect((items[0] as unknown as Record<string, unknown>).images).toEqual(["data:image/png;base64,iVBORw0KGgo="]);
  });

  it("Esc huỷ phiên gõ thì BỎ LUÔN mốc của nó — Ctrl+Z kế tiếp lùi thao tác THẬT trước đó", () => {
    // `dropMark()` là hành vi tinh tế nhất của ngăn xếp: thiếu nó thì Ctrl+Z sau khi bấm Esc chỉ
    // "nuốt" một nhịp rỗng, người dùng tưởng phép lùi hỏng.
    const items = [hang("Banner"), hang("Standee")];
    moLuoi(items);
    vaoO(o(0, "name"));
    go(o(0, "name"), "Banner v2");          // thao tác THẬT (mốc 1)
    vaoO(o(1, "name"));
    go(o(1, "name"), "gõ dở rồi Esc");      // phiên gõ sẽ bị huỷ (mốc 2)
    phim(o(1, "name"), "Escape");
    expect(items[1].name).toBe("Standee");

    phim(o(1, "name"), "z", { ctrl: true });
    expect(items[0].name).toBe("Banner");   // lùi đúng thao tác thật, không nuốt nhịp rỗng
  });
});
