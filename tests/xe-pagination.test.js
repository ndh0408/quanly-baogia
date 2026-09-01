// ── §9: PHONG BÌ PHÂN TRANG — MỘT hình dạng, MỘT chỗ dựng ────────────────────
//
// Năm service (audit · customer · employee · notification · personnel) trước đây mỗi nơi tự viết
// `{ data, meta: { total, page, size, pageCount: Math.ceil(total / size) } }`. Năm bản chép tay của
// cùng một phép tính là năm chỗ phải nhớ vá khi phép tính đó sai. Nay tất cả đi qua `phanTrang`.
//
// Bài này canh HAI điều, và điều thứ hai mới là điều quan trọng:
//   1. `phanTrang` tính đúng, kể cả những ca biên mà bản chép tay tính sai;
//   2. GỘP VỀ MỘT CHỖ KHÔNG ĐỔI PHẢN HỒI. Đây là refactor trên API đang có client thật
//      (`web/src/lib/api.ts`) — nhanh hơn/đẹp hơn mà lệch một trường là hỏng giao diện của người
//      dùng, và §9 gọi đúng đó là thay đổi PHÁ VỠ.
import { describe, it, expect } from "vitest";
import { phanTrang, skipTake } from "../src/pagination.js";
import { config } from "../src/config.js";

/** Chính xác cái mà năm service viết tay TRƯỚC đợt gộp. Giữ ở đây làm mốc đối chiếu. */
const banChepTay = (data, total, page, size) => ({
  data,
  meta: { total, page, size, pageCount: Math.ceil(total / size) },
});

describe("§9 phanTrang — phong bì phân trang", () => {
  it("giống HỆT bản chép tay ở mọi ca THƯỜNG GẶP (refactor không đổi phản hồi)", () => {
    const ca = [
      [[], 0, 1, 20],
      [[1, 2, 3], 3, 1, 20],
      [[1], 21, 2, 20],
      [[1], 100, 5, 20],
      [[1], 99, 1, 10],
      [[1], 1, 1, 1],
      [[{ id: "1" }], 7, 3, 3],
    ];
    for (const [data, total, page, size] of ca) {
      expect(phanTrang(data, total, page, size), `total=${total} page=${page} size=${size}`).toEqual(
        banChepTay(data, total, page, size),
      );
    }
  });

  it("giữ NGUYÊN mảng data — không sao chép, không sắp xếp lại", () => {
    const data = [{ id: 1 }, { id: 2 }];
    const kq = phanTrang(data, 2, 1, 20);
    expect(kq.data).toBe(data); // cùng tham chiếu
  });

  it("size = 0 → pageCount 0, KHÔNG phải Infinity (bản chép tay ra `null` sau JSON.stringify)", () => {
    // Đây là ca mà năm bản chép tay đều tính sai. Chưa nổ ở production vì `ListQuerySchema` ép
    // `size >= 1` — nhưng "chưa nổ nhờ một lớp khác" không phải là "đúng".
    expect(banChepTay([], 5, 1, 0).meta.pageCount).toBe(Infinity);
    expect(JSON.parse(JSON.stringify(banChepTay([], 5, 1, 0))).meta.pageCount).toBeNull();
    expect(phanTrang([], 5, 1, 0).meta.pageCount).toBe(0);
    expect(JSON.parse(JSON.stringify(phanTrang([], 5, 1, 0))).meta.pageCount).toBe(0);
  });

  it("đầu vào rác (NaN / âm / undefined) không lọt vào phản hồi", () => {
    expect(phanTrang([], NaN, NaN, NaN).meta).toEqual({ total: 0, page: 1, size: 0, pageCount: 0 });
    expect(phanTrang([], -5, -2, -20).meta).toEqual({ total: 0, page: 1, size: 0, pageCount: 0 });
    expect(phanTrang([], undefined, undefined, undefined).meta).toEqual({ total: 0, page: 1, size: 0, pageCount: 0 });
  });

  it("số lẻ bị cắt xuống, không để lọt số thực vào JSON", () => {
    expect(phanTrang([], 10.9, 2.7, 5.4).meta).toEqual({ total: 10, page: 2, size: 5, pageCount: 2 });
  });
});

describe("§9 skipTake — trần size nằm CÙNG CHỖ với phép tính skip", () => {
  it("trang 1 không bỏ qua dòng nào", () => {
    expect(skipTake(1, 20)).toEqual({ skip: 0, take: 20 });
  });

  it("skip = (page-1) × size", () => {
    expect(skipTake(3, 20)).toEqual({ skip: 40, take: 20 });
    expect(skipTake(10, 5)).toEqual({ skip: 45, take: 5 });
  });

  it("size KHỔNG LỒ bị cắt về MAX_PAGE_SIZE — `?size=1000000` không kéo cả bảng vào RAM", () => {
    expect(skipTake(1, 1_000_000).take).toBe(config.MAX_PAGE_SIZE);
    // …và `skip` phải tính theo size ĐÃ CẮT, nếu không trang 2 sẽ nhảy qua cả triệu dòng.
    expect(skipTake(2, 1_000_000)).toEqual({ skip: config.MAX_PAGE_SIZE, take: config.MAX_PAGE_SIZE });
  });

  it("trần lấy TỪ config, không phải số chép tay", () => {
    // Nếu ai đó đổi MAX_PAGE_SIZE thì hàm phải đi theo — bài này đỏ ngay nếu số bị chép cứng lại.
    expect(config.MAX_PAGE_SIZE).toBeGreaterThan(0);
    expect(skipTake(1, config.MAX_PAGE_SIZE + 1).take).toBe(config.MAX_PAGE_SIZE);
  });

  it("page/size rác → trang đầu, size mặc định", () => {
    expect(skipTake(0, 0)).toEqual({ skip: 0, take: config.DEFAULT_PAGE_SIZE });
    expect(skipTake(-3, "abc")).toEqual({ skip: 0, take: config.DEFAULT_PAGE_SIZE });
    expect(skipTake(undefined, undefined)).toEqual({ skip: 0, take: config.DEFAULT_PAGE_SIZE });
  });
});
