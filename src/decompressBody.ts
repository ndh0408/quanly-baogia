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
 *  · CHẶN THEO TỈ LỆ NÉN nữa, không chỉ theo trần tuyệt đối — xem `TRAN_TI_LE` bên dưới;
 *  · hỏng giữa chừng thì trả 400, không để luồng treo.
 *
 * Đặt TRƯỚC mọi express.json: hàm này tự parse JSON rồi đánh dấu `_body` để body-parser bỏ qua.
 */

/**
 * TRẦN TỈ LỆ NÉN (số byte ra / số byte vào).
 *
 * ── VÌ SAO TRẦN TUYỆT ĐỐI THÔI LÀ CHƯA ĐỦ ───────────────────────────────────
 * Lớp này chạy TRƯỚC xác thực và TRƯỚC bộ giới hạn tần suất: src/app.ts:270-271 gắn nó ở dòng
 * 270/271, còn `bearerAuth` mãi tới :384 và `apiLimiter` cũng nằm sau. Nghĩa là người CHƯA đăng
 * nhập chạm được vào đây.
 *
 * Trần tuyệt đối (2MB chung, 16MB cho /api/quotes) chặn được "phình thành GB", nhưng KHÔNG chặn
 * được phần khuếch đại: gói gzip ~16KB nở ra đúng 16MB rồi mới bị cắt. Mỗi request như vậy giữ
 * 16MB trong mảng `manh` trước khi bị bỏ. Vài chục request song song từ một máy là vài trăm MB,
 * và người gửi không cần tài khoản nào.
 *
 * Tỉ lệ thì phân biệt được hai thứ mà trần tuyệt đối gộp làm một: một báo giá thật 16MB gửi lên
 * kèm ~1,6MB gzip (JSON nén được khoảng 10 lần — đã đo trên chính bộ test: bài "gói lớn cỡ báo giá
 * 50 trang"), còn bom nén thì 1000 lần trở lên. Mốc 100 nằm giữa, rộng gấp 10 lần nhịp thật.
 *
 * SÀN 1MB trước khi bắt đầu kiểm: những chunk đầu tiên zlib có thể nhả ra nhiều hơn hẳn số byte
 * vừa nhận (bộ đệm nội bộ), nên tỉ lệ lúc đó vô nghĩa và sẽ báo động giả. Dưới 1MB thì lượng bộ
 * nhớ cũng không đáng để chặn — trần tuyệt đối là đủ.
 */
const TRAN_TI_LE = Math.max(2, Number(process.env.BODY_MAX_COMPRESS_RATIO) || 100);
const SAN_KIEM_TI_LE = 1024 * 1024;

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
    let vaoByte = 0;
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
      // `vaoByte` LUÔN đi trước: chunk tới `req` được đếm ở listener dưới rồi mới được pipe vào
      // zlib, và zlib nhả kết quả sau đó. Nên phép chia này không bao giờ dùng mẫu số cũ hơn tử số.
      if (tong > SAN_KIEM_TI_LE && tong > vaoByte * TRAN_TI_LE) {
        return dungLai(413, "Tỉ lệ nén bất thường — dữ liệu gửi lên bị từ chối");
      }
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
    // Đếm byte VÀO. Phải gắn TRƯỚC `req.pipe(...)`: nhiều listener `data` cùng nhận được chunk,
    // nhưng gắn sau khi luồng đã chảy thì bỏ lỡ những chunk đầu — đúng chỗ tỉ lệ nhạy cảm nhất.
    req.on("data", (c: Buffer) => { vaoByte += c.length; });
    req.pipe(giaiNen);
  };
}
