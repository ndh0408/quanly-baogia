// Cổng giới hạn đồng thời cho việc xuất file (Excel/PDF) — CPU nặng, bộ nhớ nặng.
//
// Hai lỗi mà bộ test này chốt lại:
//
//  1) HÀNG ĐỢI KHÔNG CÓ TRẦN. Bản cũ đẩy resolver vào một mảng `workerWaiters` không giới hạn.
//     Mỗi request đang chờ giữ NGUYÊN payload báo giá trong bộ nhớ (báo giá 50 trang × 500 dòng
//     ≈ 4MB JSON). Người dùng không bao giờ nhận được tín hiệu "hệ thống đang bận" — họ chỉ thấy
//     treo cho tới khi proxy bỏ cuộc, còn tiến trình thì phình cho tới khi OOM.
//
//  2) CHEN NGANG (barging) LÀM VƯỢT TRẦN. Bản cũ:
//         release: activeWorkers--; const w = waiters.shift(); if (w) w();
//         acquire: if (activeWorkers < MAX) { activeWorkers++; return resolved }
//                  else waiters.push(res) ... .then(() => { activeWorkers++ })
//     Người chờ được đánh thức bằng MICROTASK. Ai xin chỗ ĐỒNG BỘ ngay sau `release()` sẽ thấy
//     biến đếm vừa bị hạ và chiếm luôn chỗ; sau đó microtask của người chờ CŨNG tăng biến đếm →
//     hai việc nặng CPU chạy cùng lúc dù trần là một.
//
//     ĐÃ ĐO CỤ THỂ, và cần nói đúng mức độ: lỗi này KHÔNG với tới được từ hai request HTTP khác
//     nhau — microtask luôn chạy hết trước macrotask kế tiếp, nên người chờ nhận chỗ trước khi
//     request sau kịp xin. Nó CHỈ với tới được khi hai lượt xuất file cùng bắt đầu trong MỘT khối
//     đồng bộ (vd một handler xuất hàng loạt gọi Promise.all trên nhiều báo giá). Tức là: lỗi
//     tiềm ẩn trong nguyên thuỷ đồng bộ hoá, chưa phải sự cố đang xảy ra ở production. Vẫn sửa,
//     vì tính đúng đắn của một cái trần không nên phụ thuộc vào việc chỗ gọi tình cờ ra sao.
import { describe, it, expect } from "vitest";
import { createConcurrencyGate } from "../src/exportQueue.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Bám sát cách dùng thật ở runExportJob: xin chỗ → làm việc → LUÔN trả chỗ trong finally.
 * `gate.release()` nằm trong finally nên chỗ được trả kể cả khi việc ném lỗi.
 */
function makeRunner(gate, state) {
  return async function run(name, work) {
    await gate.acquire();
    state.running++;
    state.peak = Math.max(state.peak, state.running);
    state.order.push(name);
    try {
      return await work();
    } finally {
      state.running--;
      gate.release();
    }
  };
}

const newState = () => ({ running: 0, peak: 0, order: [] });

describe("createConcurrencyGate", () => {
  it("không bao giờ cho vượt maxActive, kể cả khi có request chen ngang lúc trả chỗ", async () => {
    const gate = createConcurrencyGate({ maxActive: 3, maxPending: 50 });
    const state = newState();
    const run = makeRunner(gate, state);

    // Mỗi việc chiếm chỗ vài vòng event loop — đủ để việc trả chỗ và request mới đan vào nhau.
    const work = () => new Promise((r) => setTimeout(r, 5));

    const jobs = [];
    for (let i = 0; i < 12; i++) {
      jobs.push(run(`job${i}`, work));
      // Nhả luồng giữa các lần gọi: đây chính là khe mà bản cũ cho request mới chen vào đúng lúc
      // một người chờ vừa được đánh thức bằng microtask.
      if (i % 3 === 0) await tick();
    }
    await Promise.all(jobs);

    expect(state.peak).toBeLessThanOrEqual(3); // bản cũ vượt lên 4
    expect(state.running).toBe(0);
    expect(gate.active()).toBe(0);
    expect(gate.pending()).toBe(0);
  });

  it("chặn CHEN NGANG ĐỒNG BỘ ngay sau khi trả chỗ (khe mà bản cũ để lọt)", async () => {
    // Đây là kịch bản TỐI THIỂU tái hiện lỗi bản cũ: xin chỗ đồng bộ ngay sau release(), trong
    // cùng một tick, trước khi microtask đánh thức người chờ kịp chạy. Với cổng cũ, kiểm tra cuối
    // ra active=2 dù trần là 1.
    const gate = createConcurrencyGate({ maxActive: 1, maxPending: 10 });
    await gate.acquire(); // active = 1
    const waiter = gate.acquire(); // xếp hàng
    gate.release(); // chuyển chỗ THẲNG cho người chờ — không hạ biến đếm
    // Đồng bộ, cùng tick: phải KHÔNG được đi thẳng (đã có người xếp hàng và chỗ đã có chủ).
    let bargerGotIn = false;
    const barger = gate.acquire().then(() => { bargerGotIn = true; });
    await waiter;
    expect(gate.active()).toBe(1); // bản cũ ra 2
    expect(bargerGotIn).toBe(false); // kẻ chen chưa được vào

    gate.release(); // người chờ xong → tới lượt kẻ chen
    await barger;
    expect(gate.active()).toBe(1);
    gate.release();
    expect(gate.active()).toBe(0);
  });

  it("từ chối khi hàng đợi đầy, kèm status 503 + Retry-After thay vì treo vô hạn", async () => {
    const gate = createConcurrencyGate({ maxActive: 1, maxPending: 2 });
    const state = newState();
    const run = makeRunner(gate, state);
    let letGo;
    const blocked = new Promise((r) => { letGo = r; });

    const inFlight = run("holder", () => blocked); // chiếm chỗ duy nhất
    await tick();
    const q1 = run("q1", () => Promise.resolve());
    const q2 = run("q2", () => Promise.resolve());
    await tick();
    expect(gate.active()).toBe(1);
    expect(gate.pending()).toBe(2); // hàng đợi đã đầy (2/2)

    // Người thứ tư phải bị TỪ CHỐI NGAY, không được xếp hàng.
    await expect(gate.acquire()).rejects.toMatchObject({ status: 503, retryAfter: expect.any(Number), code: "export_capacity" });
    expect(gate.pending()).toBe(2); // lượt bị từ chối KHÔNG rò rỉ vào bộ đếm hàng đợi

    letGo();
    await Promise.all([inFlight, q1, q2]);
    expect(gate.active()).toBe(0);
    expect(gate.pending()).toBe(0);
  });

  it("phục vụ theo thứ tự FIFO — request tới sau không cướp chỗ của người đang chờ", async () => {
    const gate = createConcurrencyGate({ maxActive: 1, maxPending: 10 });
    const state = newState();
    const run = makeRunner(gate, state);
    let letGo;
    const blocked = new Promise((r) => { letGo = r; });

    const a = run("a", () => blocked);
    await tick();
    const b = run("b", () => Promise.resolve());
    const c = run("c", () => Promise.resolve());
    await tick();
    // "late" tới SAU khi b và c đã xếp hàng → phải chạy sau cùng.
    const late = run("late", () => Promise.resolve());
    await tick();

    letGo();
    await Promise.all([a, b, c, late]);
    expect(state.order).toEqual(["a", "b", "c", "late"]);
  });

  it("chỗ vẫn được trả lại khi việc đang chạy NÉM LỖI (không rò rỉ chỗ)", async () => {
    const gate = createConcurrencyGate({ maxActive: 1, maxPending: 5 });
    const state = newState();
    const run = makeRunner(gate, state);

    await expect(run("boom", () => Promise.reject(new Error("xuất file hỏng")))).rejects.toThrow("xuất file hỏng");
    expect(gate.active()).toBe(0);

    // Nếu chỗ bị rò rỉ thì lượt kế tiếp sẽ treo mãi.
    await expect(run("sau", () => Promise.resolve("ok"))).resolves.toBe("ok");
    expect(gate.active()).toBe(0);
  });

  it("dưới tải liên tục vẫn giữ đúng trần và không bỏ đói ai", async () => {
    const gate = createConcurrencyGate({ maxActive: 2, maxPending: 100 });
    const state = newState();
    const run = makeRunner(gate, state);

    const jobs = Array.from({ length: 40 }, (_, i) =>
      run(`j${i}`, () => new Promise((r) => setTimeout(r, i % 3)))
    );
    await Promise.all(jobs);

    expect(state.peak).toBeLessThanOrEqual(2);
    expect(state.order).toHaveLength(40); // mọi việc đều được phục vụ, không ai bị bỏ đói
    expect(gate.active()).toBe(0);
    expect(gate.pending()).toBe(0);
  });
});
