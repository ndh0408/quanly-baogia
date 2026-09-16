// ── CHỐT CHẶN ĐƯỜNG LƯU BÁO GIÁ: KÍCH THƯỚC + NGÂN SÁCH ĐỒNG THỜI ───────────
//
// Hai chốt, hai chế độ hỏng KHÁC NHAU, đừng gộp làm một:
//
//   1. KÍCH THƯỚC (`gacKichThuocLuu`)  — MỘT người gửi một báo giá quá lớn.
//      ĐO ĐƯỢC: 60.000 dòng → node bị nhân giết (oom-kill, anon-rss 1,5 GB), CẢ APP SẬP.
//      Cổng ngân sách KHÔNG cứu được ca này: lúc hệ thống rảnh, request đó là request DUY NHẤT
//      đang bay nên được cấp chỗ ngay rồi giết tiến trình.
//
//   2. NGÂN SÁCH (`gacNganSachLuu`)    — NHIỀU người, mỗi người một việc HỢP LỆ.
//      ĐO ĐƯỢC: ~36 MB mỗi 1.000 dòng, và con số đó là của MỖI REQUEST. Hai người cùng lưu
//      20.000 dòng = 1,5 GB = OOM. Tức hệ thống sập vì nhiều người làm ĐÚNG cùng lúc.
//      Trần kích thước KHÔNG cứu được ca này: cả hai request đều dưới trần.
//
// Đường cong đã đo (container 1.536 MB, heap V8 1.024 MB):
//     10.000 dòng →  7,1s, RSS   460 MB
//     20.000 dòng → 13,1s, RSS   756 MB
//     30.000 dòng → 18,1s, RSS 1.154 MB (77% — sống một mình, KHÔNG còn chỗ cho ai khác)
//     60.000 dòng → oom-kill
import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";
import { demTongDongLuu, MAX_SAVE_TOTAL_ROWS } from "./validators.js";
import { prisma } from "./db.js";

type NguoiCho = { tra: () => void; bo: (e: unknown) => void; can: number; thao: () => void };

export type BudgetGate = {
  xin: (can: number, signal?: AbortSignal) => Promise<void>;
  tra: (can: number) => void;
  dangBay: () => number;
  dangCho: () => number;
};

export const loiQuaTai = (retryAfter: number) =>
  Object.assign(new Error("Hệ thống đang bận xử lý các lần lưu lớn khác. Vui lòng thử lại sau ít giây."), {
    status: 503,
    retryAfter,
    code: "save_budget_full",
  });

export const loiQuaTo = (soDong: number, tran: number) =>
  Object.assign(
    new Error(
      `Báo giá có ${soDong.toLocaleString("vi-VN")} dòng, vượt trần ${tran.toLocaleString("vi-VN")} dòng cho một lần lưu. ` +
        "Hãy tách bớt trang sang một báo giá khác rồi lưu lại.",
    ),
    { status: 413, code: "save_too_large" },
  );

/**
 * FIFO, KHÔNG CHO CHEN NGANG — cùng bài học đã ghi ở src/exportQueue.ts: khi trả suất mà đang có
 * người xếp hàng thì CHUYỂN THẲNG cho họ, không hạ biến đếm rồi mới đánh thức. Hạ trước tạo ra một
 * khe mà người xin ĐỒNG BỘ chen vào được, và thế là vượt trần dù trần vẫn "đúng" trên giấy.
 *
 * Khác `createConcurrencyGate` của exportQueue ở đúng một điểm, nhưng là điểm quyết định: cổng kia
 * đếm SUẤT, cổng này đếm TRỌNG SỐ. Một lần lưu 20.000 dòng tốn bộ nhớ bằng HAI MƯƠI lần lưu 1.000
 * dòng — đặt `maxActive = 3` thì ba lần lưu nhỏ vẫn rảnh rang mà ba lần lưu lớn vẫn OOM.
 */
export function createBudgetGate({
  nganSach,
  toiDaCho,
  onTuChoi,
}: {
  nganSach: number;
  toiDaCho: number;
  onTuChoi?: (ly: "day" | "qua-to") => void;
}): BudgetGate {
  let dangBay = 0;
  const hang: NguoiCho[] = [];

  const chuyenSuat = () => {
    // Cấp cho người ĐỨNG ĐẦU nếu đủ chỗ. KHÔNG nhảy cóc tìm ai vừa chỗ hơn: nhảy cóc là bỏ đói
    // người xin nhiều nhất — họ chờ mãi trong khi việc nhỏ chen liên tục.
    while (hang.length > 0 && dangBay + hang[0].can <= nganSach) {
      const n = hang.shift()!;
      dangBay += n.can;
      n.thao();
      n.tra();
    }
  };

  return {
    xin(canGoc, signal) {
      // ── KẸP, KHÔNG TỪ CHỐI ────────────────────────────────────────────────
      // Bản đầu từ chối thẳng khi `can > nganSach`, và ĐO ĐƯỢC trên máy chủ thật rằng nó vô hiệu
      // hoá quyền miễn trừ của `gacKichThuocLuu`: một báo giá CŨ 25.000 dòng (lưu hợp lệ từ trước
      // khi có trần) được chốt kích thước cho qua, rồi bị CỔNG NÀY chặn 413 — tức chủ báo giá lại
      // bị khoá ra khỏi chính dữ liệu của mình, đúng cái lỗi mà khối "ĐÃ GỠ. ĐỪNG ĐẶT LẠI" ở
      // src/validators.ts cảnh báo, chỉ là lần này nấp ở một tầng khác.
      //
      // Việc từ chối theo KÍCH THƯỚC thuộc về `gacKichThuocLuu` — nơi DUY NHẤT biết báo giá đang
      // có bao nhiêu dòng. Cổng này chỉ lo ĐỒNG THỜI, nên request lớn hơn cả ngân sách được kẹp
      // xuống bằng ngân sách: nó chiếm TRỌN chỗ và chạy MỘT MÌNH, thay vì treo hoặc bị loại.
      const can = Math.min(canGoc, nganSach);
      if (signal?.aborted) return Promise.reject(loiQuaTai(5));
      if (hang.length === 0 && dangBay + can <= nganSach) {
        dangBay += can;
        return Promise.resolve();
      }
      if (hang.length >= toiDaCho) {
        // Trần hàng đợi KHÔNG phải cho đẹp: mỗi người đang chờ đã parse xong payload và đang ÔM nó
        // trong bộ nhớ. Hàng đợi không trần là một đường OOM khác, chỉ chậm hơn.
        onTuChoi?.("day");
        return Promise.reject(loiQuaTai(5));
      }
      return new Promise<void>((tra, bo) => {
        const huy = () => {
          const i = hang.indexOf(n);
          if (i >= 0) hang.splice(i, 1);
          n.thao();
          bo(loiQuaTai(5));
        };
        const n: NguoiCho = {
          can,
          tra,
          bo,
          thao: () => {
            if (signal) signal.removeEventListener("abort", huy);
          },
        };
        if (signal) signal.addEventListener("abort", huy, { once: true });
        hang.push(n);
      });
    },
    tra(can) {
      dangBay = Math.max(0, dangBay - can);
      chuyenSuat();
    },
    dangBay: () => dangBay,
    dangCho: () => hang.length,
  };
}

export const congLuu = createBudgetGate({
  nganSach: config.SAVE_BUDGET_ROWS,
  toiDaCho: config.SAVE_MAX_PENDING,
});

/**
 * CHỐT 1 — KÍCH THƯỚC. Đặt SAU `validate(...)`, TRƯỚC `gacNganSachLuu`.
 *
 * Áp theo HƯỚNG chứ không theo con số tuyệt đối — đọc khối chú thích dài ở
 * src/validators.ts (`MAX_SAVE_TOTAL_ROWS`) và khối "ĐÃ GỠ. ĐỪNG ĐẶT LẠI" ngay dưới nó:
 *   · TẠO MỚI (không có `:id`) → chặn thẳng ở trần.
 *   · LƯU LẠI (có `:id`)       → cho qua nếu dòng mới ≤ max(trần, số dòng ĐANG CÓ trong CSDL).
 * Nhờ vế thứ hai, chủ một báo giá 25.000 dòng lưu hợp lệ từ trước vẫn sửa được, vẫn GIẢM được,
 * chỉ không PHÌNH THÊM quá trần. Một trần tuyệt đối sẽ khoá họ ra khỏi chính dữ liệu của mình —
 * đúng lý do trần cũ đã bị gỡ.
 */
export async function gacKichThuocLuu(req: Request, _res: Response, next: NextFunction) {
  try {
    const soDong = demTongDongLuu(req.body);
    if (soDong <= MAX_SAVE_TOTAL_ROWS) return next();

    const id = Number((req.params as { id?: string }).id);
    if (!Number.isInteger(id) || id <= 0) return next(loiQuaTo(soDong, MAX_SAVE_TOTAL_ROWS));

    // `count` chứ KHÔNG nạp hàng: nạp 25.000 hàng chỉ để đếm chúng thì chính phép kiểm này trở
    // thành đường OOM mà nó sinh ra để chặn.
    const [dongSheet, quote] = await Promise.all([
      prisma.quoteItem.count({ where: { sheet: { quoteId: id } } }),
      prisma.quote.findFirst({
        where: { id },
        select: { hnTables: true, sheets: { select: { extraTables: true } } },
      }),
    ]);
    const demTrongJson = (v: unknown) =>
      (Array.isArray(v) ? (v as Array<{ items?: unknown[] }>) : []).reduce(
        (n, t) => n + (Array.isArray(t?.items) ? t.items.length : 0),
        0,
      );
    const dangCo =
      dongSheet +
      demTrongJson(quote?.hnTables) +
      (quote?.sheets ?? []).reduce((n, s) => n + demTrongJson(s.extraTables), 0);

    const tran = Math.max(MAX_SAVE_TOTAL_ROWS, dangCo);
    if (soDong > tran) return next(loiQuaTo(soDong, tran));
    return next();
  } catch (e) {
    return next(e);
  }
}

/**
 * CHỐT 2 — NGÂN SÁCH ĐỒNG THỜI. Đặt NGAY SAU `gacKichThuocLuu`.
 *
 * VÌ SAO KHÔNG ĐẶT TRƯỚC express.json: trước khi parse thì chưa biết số dòng, chỉ có
 * Content-Length — mà tương quan byte↔dòng phụ thuộc độ dài tên hạng mục, nên trần theo byte hoặc
 * quá chặt (chặn báo giá hợp lệ có tên dài) hoặc quá lỏng (cho lọt đúng thứ cần chặn). ĐO ĐƯỢC: ở
 * 30.000 dòng, JSON thô chỉ 3,4 MB trong khi đỉnh RSS là 1.154 MB — ~97% chi phí nằm SAU parse.
 * Gác ở đây bắt được gần trọn phần đắt, và bắt CHÍNH XÁC.
 */
export function gacNganSachLuu(req: Request, res: Response, next: NextFunction) {
  const soDong = demTongDongLuu(req.body);
  if (soDong === 0) return next(); // đổi mỗi tiêu đề / trạng thái — không tốn gì.

  const boDi = new AbortController();
  const khiDut = () => boDi.abort();
  req.once("aborted", khiDut);

  // Kẹp ở đây nữa để lượt TRẢ khớp lượt XIN: cổng kẹp bên trong, nên trả đúng con số đã kẹp.
  const canKep = Math.min(soDong, config.SAVE_BUDGET_ROWS);
  congLuu.xin(soDong, boDi.signal).then(
    () => {
      req.off("aborted", khiDut);
      // TRẢ SUẤT ĐÚNG MỘT LẦN, TRÊN MỌI ĐƯỜNG THOÁT. `finish` bắn khi phản hồi gửi xong; `close`
      // bắn cả khi client ngắt giữa chừng. Nghe cả hai mà không có cờ thì trả HAI lần — biến đếm
      // tụt xuống âm, trần thành vô nghĩa. Nghe mỗi `finish` thì client ngắt giữa chừng là RÒ một
      // suất, rò dần tới khoá cứng: mọi lần lưu sau đều 503 trong khi chẳng có ai đang lưu.
      let daTra = false;
      const tra = () => {
        if (!daTra) {
          daTra = true;
          congLuu.tra(canKep);
        }
      };
      res.once("finish", tra);
      res.once("close", tra);
      next();
    },
    (e) => {
      req.off("aborted", khiDut);
      next(e);
    },
  );
}
