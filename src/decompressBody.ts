import zlib from "node:zlib";
import type { Request, Response, NextFunction } from "express";

/**
 * Giải nén THÂN REQUEST khi client gửi kèm `Content-Encoding: gzip|deflate`.
 *
 * Vì sao cần: trình duyệt tự nén thân TRẢ VỀ nhưng KHÔNG tự nén thân GỬI LÊN. Báo giá lớn (50 trang
 * × vài trăm dòng) nặng vài MB mỗi lần bấm Lưu, mà JSON nén được khoảng 10 lần — nên client tự nén
 * (web/src/lib/api.ts) và server phải biết mở ra. Không có lớp này thì thân nén tới nơi là rác.
 *
 * An toàn:
 *  · chỉ nhận gzip/deflate, kiểu khác trả 415 thay vì đoán mò;
 *  · đếm số byte SAU GIẢI NÉN và cắt ngay khi vượt trần — chặn "bom nén" (gói vài KB phình thành GB);
 *  · hỏng giữa chừng thì trả 400, không để luồng treo.
 *
 * Đặt TRƯỚC mọi express.json: hàm này tự parse JSON rồi đánh dấu `_body` để body-parser bỏ qua.
 */
export function decompressBody(tranByte = 16 * 1024 * 1024) {
  return (req: Request, res: Response, next: NextFunction) => {
    const enc = String(req.headers["content-encoding"] || "").toLowerCase().trim();
    if (!enc || enc === "identity") return next();
    if (enc !== "gzip" && enc !== "deflate") {
      res.status(415).json({ error: "Kiểu nén không hỗ trợ" });
      return;
    }

    const giaiNen = enc === "gzip" ? zlib.createGunzip() : zlib.createInflate();
    const manh: Buffer[] = [];
    let tong = 0;
    let ketThuc = false;

    const dungLai = (ma: number, loi: string) => {
      if (ketThuc) return;
      ketThuc = true;
      giaiNen.destroy();
      res.status(ma).json({ error: loi });
    };

    giaiNen.on("data", (c: Buffer) => {
      tong += c.length;
      if (tong > tranByte) return dungLai(413, "Dữ liệu gửi lên quá lớn");
      manh.push(c);
    });

    giaiNen.on("end", () => {
      if (ketThuc) return;
      ketThuc = true;
      const chu = Buffer.concat(manh).toString("utf8");
      // Thân rỗng là hợp lệ (vd DELETE kèm Content-Encoding) → coi như không có body.
      if (!chu.trim()) {
        req.body = {};
      } else {
        const ct = String(req.headers["content-type"] || "");
        if (ct.includes("application/json")) {
          try {
            req.body = JSON.parse(chu);
          } catch {
            res.status(400).json({ error: "Dữ liệu JSON gửi lên không hợp lệ" });
            return;
          }
        } else {
          // Không phải JSON → trả lại dạng chuỗi, để tầng sau tự xử.
          req.body = chu;
        }
      }
      // Đánh dấu đã đọc xong thân: body-parser thấy cờ này thì bỏ qua, không cố đọc luồng đã cạn.
      (req as unknown as { _body?: boolean })._body = true;
      delete req.headers["content-encoding"];
      req.headers["content-length"] = String(Buffer.byteLength(chu));
      next();
    });

    giaiNen.on("error", () => dungLai(400, "Không giải nén được dữ liệu gửi lên"));
    req.pipe(giaiNen);
  };
}
