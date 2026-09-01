// `safeImgSrc` chạy trên MỌI ảnh ở MỌI lần render — chốt cả tính đúng lẫn chi phí.
//
// ── HAI THỨ BÀI NÀY GIỮ ─────────────────────────────────────────────────────
// 1. ĐÚNG: nguồn ảnh phải khớp TOÀN CHUỖI data-URL base64. Kiểm tiền tố sẽ cho lọt chuỗi kiểu
//    `data:image/png;base64,AAA"><a …>` — chuỗi đó thoát khỏi src="" ở bất cứ chỗ nào sau này nội
//    suy nó vào HTML (Excel/PDF). Server đã neo cả chuỗi (src/validators.ts); client phải khớp.
// 2. RẺ: ảnh trong lưới là data-URL vài trăm KB tới ~2MB, mà regex neo cả chuỗi phải quét TOÀN BỘ.
//    `imagesCell` chạy lại ở MỌI lần render lưới (mỗi phím ở ô meta, mỗi lần kéo chọn vùng) nhân
//    với số ảnh của mọi hàng — đúng loại chi phí mà lượt vá `paintSel` vừa dọn, nay mọc lại ngay
//    bên cạnh. Nên kết quả được NHỚ theo chính chuỗi ảnh.
import { describe, it, expect } from "vitest";
import { safeImgSrc } from "./GridTable";

const b64 = (n: number) => "A".repeat(n);

describe("safeImgSrc — chỉ nhận data-URL ảnh base64, khớp TOÀN chuỗi", () => {
  it.each([
    ["data:image/png;base64,AAAA", "png"],
    ["data:image/jpeg;base64,AAAA", "jpeg"],
    ["data:image/jpg;base64,AAAA", "jpg"],
    ["data:image/gif;base64,AAAA", "gif"],
    ["data:image/webp;base64,AAAA", "webp"],
    ["data:image/png;base64,AAA=", "đệm ="],
    ["data:image/png;base64,AA==", "đệm =="],
  ])("nhận %j (%s)", (s) => expect(safeImgSrc(s)).toBe(s));

  it.each([
    ['data:image/png;base64,AAA"><a href=x>', "thoát khỏi thuộc tính src — ca nguy hiểm nhất"],
    ["data:image/png;base64,AAA<script>", "chèn thẻ"],
    ["javascript:alert(1)", "lược đồ khác"],
    ["data:text/html;base64,AAAA", "không phải ảnh"],
    ["data:image/svg+xml;base64,AAAA", "SVG — chạy được script, cố ý KHÔNG nhận"],
    ["https://vidu.com/a.png", "URL ngoài — ảnh lưới luôn là data-URL"],
    ["data:image/png,AAAA", "thiếu ;base64"],
    ["", "rỗng"],
  ])("từ chối %j (%s)", (s) => expect(safeImgSrc(s)).toBe(""));

  it("null/undefined/không phải chuỗi → rỗng, không ném", () => {
    expect(safeImgSrc(null)).toBe("");
    expect(safeImgSrc(undefined)).toBe("");
    expect(safeImgSrc(123 as unknown as string)).toBe("");
  });

  it("gọi LẠI cùng một ảnh lớn phải RẺ hơn hẳn lần đầu (kết quả được nhớ)", () => {
    const anh = "data:image/png;base64," + b64(2_000_000);   // ~2MB, cỡ ảnh thật sau khi nén
    const t0 = performance.now();
    expect(safeImgSrc(anh)).toBe(anh);
    const lanDau = performance.now() - t0;

    // 200 lần render tiếp theo của cùng ảnh đó.
    const t1 = performance.now();
    for (let i = 0; i < 200; i++) safeImgSrc(anh);
    const sau200 = performance.now() - t1;

    // Không nhớ thì 200 lượt quét 2MB tốn ÍT NHẤT ~200× lần đầu. Ngưỡng để rộng cho máy CI chậm:
    // chỉ cần chứng minh nó KHÔNG tuyến tính theo số lần gọi.
    expect(sau200, `lần đầu ${lanDau.toFixed(1)}ms · 200 lần sau ${sau200.toFixed(1)}ms`).toBeLessThan(Math.max(lanDau * 20, 50));
  });

  it("bộ nhớ tạm KHÔNG phình vô hạn (có trần, bỏ mục cũ nhất)", () => {
    // Nạp quá trần rồi kiểm ảnh đầu tiên vẫn cho ĐÚNG kết quả — bị đẩy ra chỉ tốn lại một lượt
    // quét, không được sai.
    const dau = "data:image/png;base64," + b64(32);
    expect(safeImgSrc(dau)).toBe(dau);
    for (let i = 0; i < 400; i++) safeImgSrc("data:image/png;base64," + b64(8) + i);
    expect(safeImgSrc(dau), "bị đẩy khỏi bộ nhớ tạm vẫn phải tính lại ĐÚNG").toBe(dau);
  });

  it("chuỗi hỏng cũng được nhớ (không quét lại mỗi lần render)", () => {
    const xau = "data:image/png;base64,AAA\"><img>" + b64(500_000);
    expect(safeImgSrc(xau)).toBe("");
    const t = performance.now();
    for (let i = 0; i < 200; i++) expect(safeImgSrc(xau)).toBe("");
    expect(performance.now() - t).toBeLessThan(50);
  });
});
