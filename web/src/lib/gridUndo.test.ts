// Ctrl+Z / Ctrl+Y của lưới — §3 nêu ĐÍCH DANH trong danh sách nghiệp vụ phải bảo toàn, nhưng
// trước bài này KHÔNG có bài kiểm nào: cả ngăn xếp nằm trong closure của `GridTableInner`, muốn
// gọi tới phải dựng React + DOM mà `web/` chạy vitest ở môi trường node (không jsdom, và cấm cài
// thêm gói). Nên phần THUẦN đã được tách sang `gridUndo.ts` (chỉ DI CHUYỂN, xem git diff của
// GridTable.tsx) và đây là chốt cho nó.
//
// PHẠM VI — nói thẳng cái bài này KHÔNG phủ: phần đụng DOM vẫn nằm trong component và không được
// kiểm ở đây — `restore()` (nhồi lại `items` tại chỗ + `recomputeAll`), `syncActiveCell()` (vẽ lại
// ô đang focus sau khi lùi) và `flushSoft()` (chốt nhịp gõ 180ms trước khi lùi). Cái được khoá là
// TRẬT TỰ và TRẠNG THÁI của ngăn xếp: lùi/tiến ra đúng mốc nào, nhánh redo sống chết lúc nào,
// trần 100 cắt đầu nào, và tổ hợp phím nào ra lệnh gì.
import { describe, it, expect } from "vitest";
import { createUndoStack, undoRedoKey, UNDO_LIMIT } from "./gridUndo";

/**
 * "Lưới giả": một ô dữ liệu duy nhất, nối đúng thứ tự mà GridTable nối.
 *   · `sua()`  = pushUndo() rồi mới đổi dữ liệu — đúng thứ tự bắt buộc của mã thật (chụp TRƯỚC khi
 *     ghi giá trị mới, xem chú thích của `markEditUndo` trong GridTable.tsx).
 *   · `bam()`  = onGridKeyDown: hỏi `undoRedoKey`, rồi gọi stepBack/stepForward và nạp lại kết quả.
 * Nhờ vậy bài kiểm chạy trên đúng chuỗi gọi của người dùng thật, không phải gọi lẻ từng hàm.
 */
function luoiGia(limit?: number) {
  const h = createUndoStack(limit);
  let data = "s0";
  return {
    kho: h,
    doc: () => data,
    sua(v: string) { h.mark(data); data = v; },
    /** Trả về true nếu phím được NHẬN là lệnh lùi/tiến (dù có lùi được hay không). */
    bam(ctrl: boolean, shift: boolean, key: string): boolean {
      const cmd = undoRedoKey(ctrl, shift, key);
      if (!cmd) return false;
      const got = cmd === "undo" ? h.stepBack(() => data) : h.stepForward(() => data);
      if (got !== null) data = got;
      return true;
    },
    ctrlZ() { return this.bam(true, false, "z"); },
    ctrlY() { return this.bam(true, false, "y"); },
  };
}

describe("Ctrl+Z / Ctrl+Y — vòng lùi rồi tiến", () => {
  it("lùi một bước rồi tiến lại về đúng giá trị cũ", () => {
    const g = luoiGia();
    g.sua("s1");
    expect(g.doc()).toBe("s1");
    g.ctrlZ();
    expect(g.doc()).toBe("s0");
    g.ctrlY();
    expect(g.doc()).toBe("s1");
  });

  it("lùi nhiều bước đi ngược đúng thứ tự, rồi tiến lại đúng thứ tự", () => {
    const g = luoiGia();
    g.sua("s1"); g.sua("s2"); g.sua("s3");
    g.ctrlZ(); expect(g.doc()).toBe("s2");
    g.ctrlZ(); expect(g.doc()).toBe("s1");
    g.ctrlZ(); expect(g.doc()).toBe("s0");
    g.ctrlY(); expect(g.doc()).toBe("s1");
    g.ctrlY(); expect(g.doc()).toBe("s2");
    g.ctrlY(); expect(g.doc()).toBe("s3");
  });

  it("Ctrl+Shift+Z tiến y như Ctrl+Y (nếp macOS)", () => {
    const g = luoiGia();
    g.sua("s1");
    g.ctrlZ();
    expect(g.doc()).toBe("s0");
    expect(g.bam(true, true, "Z")).toBe(true);   // giữ Shift → key là chữ HOA
    expect(g.doc()).toBe("s1");
  });

  it("lùi rồi SỬA TIẾP → nhánh tiến mất hiệu lực (không tiến lại vào lịch sử đã bỏ)", () => {
    const g = luoiGia();
    g.sua("s1"); g.sua("s2");
    g.ctrlZ();
    expect(g.doc()).toBe("s1");
    g.sua("nhanh-khac");
    g.ctrlY();
    expect(g.doc()).toBe("nhanh-khac");   // Ctrl+Y không làm gì
    expect(g.kho.redo).toEqual([]);
    g.ctrlZ();
    expect(g.doc()).toBe("s1");           // nhưng lùi vẫn về được mốc thật
  });
});

describe("bấm lùi/tiến khi hết mốc — không được sinh rác", () => {
  it("Ctrl+Z lúc chưa sửa gì: dữ liệu đứng yên và KHÔNG đẩy gì vào nhánh tiến", () => {
    const g = luoiGia();
    expect(g.ctrlZ()).toBe(true);          // phím vẫn được NHẬN (mã thật preventDefault ở đây)
    expect(g.doc()).toBe("s0");
    expect(g.kho.redo).toEqual([]);        // chốt phép chụp là LƯỜI — chụp bừa thì redo có rác
    expect(g.kho.undo).toEqual([]);
    g.ctrlY();
    expect(g.doc()).toBe("s0");
  });

  it("lùi quá đáy rồi tiến lại vẫn về đúng đỉnh, không lệch một nhịp", () => {
    const g = luoiGia();
    g.sua("s1");
    g.ctrlZ(); g.ctrlZ(); g.ctrlZ();       // hai nhịp thừa
    expect(g.doc()).toBe("s0");
    g.ctrlY();
    expect(g.doc()).toBe("s1");
    g.ctrlY();
    expect(g.doc()).toBe("s1");
  });

  it("stepBack/stepForward chỉ gọi hàm chụp khi THẬT SỰ đi được", () => {
    const h = createUndoStack();
    let lanChup = 0;
    const chup = () => { lanChup++; return "x"; };
    expect(h.stepBack(chup)).toBeNull();
    expect(h.stepForward(chup)).toBeNull();
    expect(lanChup).toBe(0);
    h.mark("a");
    expect(h.stepBack(chup)).toBe("a");
    expect(lanChup).toBe(1);
  });
});

describe("trần ngăn xếp — chống phình bộ nhớ mà không mất mốc mới", () => {
  it("mặc định là 100 mốc", () => {
    expect(UNDO_LIMIT).toBe(100);
    const h = createUndoStack();
    for (let i = 0; i < 150; i++) h.mark(`m${i}`);
    expect(h.undo.length).toBe(100);
  });

  it("vượt trần thì rụng mốc CŨ NHẤT, giữ mốc mới nhất", () => {
    const h = createUndoStack(3);
    h.mark("a"); h.mark("b"); h.mark("c"); h.mark("d");
    expect(h.undo).toEqual(["b", "c", "d"]);   // "a" rụng ở đáy, KHÔNG phải "d" rụng ở đỉnh
  });

  it("lùi hết trần thì đứng lại ở mốc cũ nhất CÒN GIỮ, không lùi ra ngoài", () => {
    const g = luoiGia(3);
    g.sua("s1"); g.sua("s2"); g.sua("s3"); g.sua("s4");
    g.ctrlZ(); expect(g.doc()).toBe("s3");
    g.ctrlZ(); expect(g.doc()).toBe("s2");
    g.ctrlZ(); expect(g.doc()).toBe("s1");
    g.ctrlZ(); expect(g.doc()).toBe("s1");     // mốc "s0" đã rụng theo trần
  });

  it("phép TIẾN không cắt theo trần (giữ nguyên hành vi cũ) — đi lại đủ đường vừa lùi", () => {
    // Cố ý: tiến/lùi qua lại là đi trên CÙNG một dòng lịch sử, cắt ở đây sẽ ăn mất đúng cái mốc
    // người dùng vừa định quay về.
    const h = createUndoStack(3);
    h.mark("a"); h.mark("b"); h.mark("c");
    expect(h.undo.length).toBe(3);
    expect(h.stepBack(() => "now")).toBe("c");
    expect(h.stepForward(() => "cur")).toBe("now");
    expect(h.undo).toEqual(["a", "b", "cur"]);
    expect(h.undo.length).toBe(3);
  });
});

describe("dropMark — Esc huỷ phiên gõ thì bỏ luôn mốc của phiên đó", () => {
  it("bỏ mốc vừa ghi để Ctrl+Z kế tiếp lùi thao tác THẬT, không nuốt một nhịp rỗng", () => {
    const g = luoiGia();
    g.sua("thao-tac-that");     // mốc "s0"
    g.kho.mark(g.doc());        // vào ô gõ → markEditUndo ghi mốc "thao-tac-that"
    g.kho.dropMark();           // Esc huỷ phiên gõ → bỏ mốc đó
    g.ctrlZ();
    expect(g.doc()).toBe("s0"); // lùi thẳng về thao tác thật, không kẹt một nhịp
  });

  it("dropMark KHÔNG đụng nhánh tiến (chưa hề lùi qua nó)", () => {
    const h = createUndoStack();
    h.mark("a");
    h.stepBack(() => "now");    // redo = ["now"]
    h.undo.push("b");           // giả lập mốc mới do stepForward đẩy vào
    expect(h.dropMark()).toBe("b");
    expect(h.redo).toEqual(["now"]);
  });

  it("dropMark lúc rỗng trả undefined, không ném lỗi", () => {
    const h = createUndoStack();
    expect(() => h.dropMark()).not.toThrow();
    expect(h.dropMark()).toBeUndefined();
  });
});

describe("mỗi lưới một ngăn xếp riêng", () => {
  it("Ctrl+Z ở lưới nội bộ không kéo theo lưới chính", () => {
    const chinh = luoiGia(), noiBo = luoiGia();
    chinh.sua("chinh-1");
    noiBo.sua("nb-1"); noiBo.sua("nb-2");
    noiBo.ctrlZ();
    expect(noiBo.doc()).toBe("nb-1");
    expect(chinh.doc()).toBe("chinh-1");   // không suy suyển
    expect(chinh.kho.undo).toEqual(["s0"]);
  });
});

describe("bảng phím lùi/tiến (undoRedoKey)", () => {
  it("Ctrl+Z là LÙI, cả chữ thường lẫn chữ hoa", () => {
    expect(undoRedoKey(true, false, "z")).toBe("undo");
    expect(undoRedoKey(true, false, "Z")).toBe("undo");
  });

  it("Ctrl+Y và Ctrl+Shift+Z đều là TIẾN", () => {
    expect(undoRedoKey(true, false, "y")).toBe("redo");
    expect(undoRedoKey(true, false, "Y")).toBe("redo");
    expect(undoRedoKey(true, true, "z")).toBe("redo");
    expect(undoRedoKey(true, true, "Z")).toBe("redo");   // giữ Shift → key thành chữ HOA
  });

  it("Shift+Z KHÔNG bao giờ là lùi — nếu không sẽ nuốt mất phép tiến của macOS", () => {
    expect(undoRedoKey(true, true, "z")).not.toBe("undo");
  });

  it("thiếu Ctrl/⌘ thì gõ chữ z/y bình thường, không phải lệnh", () => {
    expect(undoRedoKey(false, false, "z")).toBeNull();
    expect(undoRedoKey(false, true, "Z")).toBeNull();
    expect(undoRedoKey(false, false, "y")).toBeNull();
  });

  it("phím khác có Ctrl (Ctrl+C/V/X/D/A) không bị nhận nhầm", () => {
    for (const k of ["c", "v", "x", "d", "a", "s", "Enter", "ArrowDown", "F2"]) {
      expect(undoRedoKey(true, false, k)).toBeNull();
      expect(undoRedoKey(true, true, k)).toBeNull();
    }
  });
});
