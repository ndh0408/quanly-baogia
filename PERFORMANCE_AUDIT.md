# PERFORMANCE_AUDIT

Rà hiệu năng hệ báo giá QuanLY, tập trung vào màn hình nhập báo giá — nơi người dùng ngồi lâu nhất
và là chỗ được báo là "lag khi nhập nhiều".

Bối cảnh thực tế (chủ sở hữu cung cấp): **một báo giá có thể tới 50 sheet, mỗi sheet hơn 200 dòng**,
và **máy văn phòng cấu hình yếu (i5/i7 đời cũ, RAM 8GB)**. Mọi số đo trong tài liệu này đo trên máy
i9-14900HX, nên **nhân 3–5 lần** khi ước lượng cho máy văn phòng.

---

## 1. Kiến trúc — đường đi của một phím gõ

```
người dùng gõ 1 ký tự vào ô
  → handler onInput của ô ghi thẳng vào items[i] (dữ liệu là object thường, sửa tại chỗ)
  → gọi onChange()  →  QuoteEditor: mark() bật cờ "có thay đổi" + redraw() (setState giả)
      → React dựng lại toàn bộ trang soạn báo giá:
          · cộng tổng mọi sheet
          · bảng tóm tắt các sheet
          · GridTable của sheet đang mở  ← 5.900 ô nhập ở mức 1000 dòng
          · bảng nội bộ (nếu sheet đó có)
      → useEffect không mảng phụ thuộc: quét lại toàn bộ ô, kéo giá trị về đúng model, tô vùng chọn
  → bấm Lưu: PUT toàn bộ báo giá (mọi sheet, mọi dòng) → xoá sheet cũ + ghi lại toàn bộ → lưu bản
    phiên bản
```

Điểm mấu chốt: dữ liệu **không** nằm trong React state mà là object thường bị sửa tại chỗ; React chỉ
được đánh thức bằng một biến đếm. Hệ quả là **không thể memo hoá theo tham chiếu** — đây là lý do
kiến trúc hiện tại chọn cách vẽ lại toàn bộ, và cũng là lý do mọi thao tác đều tuyến tính theo số
dòng.

---

## 2. Nút thắt đã xác định — bằng đo, không phải bằng đọc code

### 2.1 Gõ một phím làm vẽ lại toàn bộ lưới — ĐÃ SỬA

**Bằng chứng** Ở 1000 dòng: gõ ô chữ 196,6ms/phím, ô số 179,9ms/phím. Khoanh vùng: phát sự kiện
`input` với `bubbles:false` (React không bắt được) → **0ms**; chỉ đặt giá trị → **0ms**; đọc
`scrollHeight` → **0ms**. Toàn bộ chi phí nằm trong handler React. So từng cột: Ghi Chú **0ms**,
Hạng Mục **72,6ms**, Số Lượng **73,4ms** — đúng hai ô gọi `setState` mỗi phím.

**Nguyên nhân gốc** `onChange()` gọi mỗi phím → vẽ lại 5.900 ô.

**Đã sửa** Xem `OPTIMIZATION_CHANGELOG.md` mục 1–4.

**Kết quả** ô chữ 196,6 → **0,0ms**; ô số 179,9 → **0,2ms**; đổi đơn giá đến khi vẽ xong 206,1 →
**26,3ms**.

**Mức nghiêm trọng** Cao nhất — đây chính là cảm giác "lag khi nhập liệu".

### 2.2 Dựng lưới / thêm / xoá hàng vẫn tuyến tính — CHƯA SỬA

**Bằng chứng** Vẽ lần đầu: 64ms ở 100 dòng, 231ms ở 250, 447ms ở 500, **852ms ở 1000**. Thêm 1 hàng
ở 1000 dòng: 310ms. Xoá 1 hàng: 258ms.

**Nguyên nhân gốc** Mỗi hàng dựng ~6 ô nhập; không có memo hoá (toàn bộ `web/src` không có `React.memo`
nào). Thêm/xoá một hàng vẫn dựng lại tất cả các hàng.

**Ảnh hưởng thực tế** Với 200 dòng/sheet như thực tế mô tả, dựng lưới khi chuyển tab tốn ~100–130ms
trên máy đo, tức **~0,3–0,6 giây trên máy văn phòng**. Chấp nhận được nhưng không tốt. Nếu có sheet
500–1000 dòng thì thành 1,5–4 giây.

**Hướng xử lý** (chưa làm, cần đo trước khi chọn)
1. **Chỉ vẽ phần nhìn thấy** (virtualization). Giải quyết triệt để, nhưng phải xử lý cẩn thận:
   chọn vùng bằng bàn phím, cuộn tới ô đang sửa, copy/dán khối lớn, ô gộp dọc của hàng con. Rủi ro
   cao với lưới kiểu Excel này.
2. **Memo hoá từng hàng.** Rẻ hơn nhưng vướng chỗ dữ liệu bị sửa tại chỗ: memo so sánh theo tham
   chiếu sẽ không nhận ra thay đổi. Muốn làm phải gắn "số phiên bản" cho từng hàng và bảo đảm mọi
   chỗ sửa đều tăng nó — sót một chỗ là hiển thị sai số tiền.

Khuyến nghị: chỉ làm khi thực sự có sheet vài trăm dòng trở lên gây khó chịu, và **đo trước** bằng
`npm --prefix web run bench`.

### 2.3 Báo giá nhiều tab — nghi ngờ ban đầu đã bị bác bỏ

**Giả thuyết** "Mỗi lần vẽ lại phải cộng tổng mọi sheet nên báo giá 50 tab sẽ chậm."

**Đo** 50 sheet × 200 dòng (10.000 dòng): cộng tổng toàn báo giá **0,11ms**. Ở 25.000 dòng: 0,29ms.

**Kết luận** Sai. Phép tính tiền không phải vấn đề. Không sửa gì ở đây.

### 2.4 Gói dữ liệu khi Lưu — CHƯA SỬA, đây là việc lớn nhất còn lại

**Bằng chứng** Mỗi lần bấm Lưu gửi toàn bộ báo giá:

| Quy mô | Kích thước gói |
| --- | ---: |
| 1 sheet × 200 dòng | 32 KB |
| 10 sheet × 200 dòng | 316 KB |
| **50 sheet × 200 dòng** | **1.581 KB** |
| 50 sheet × 500 dòng | 3.954 KB |

Đóng/mở gói chỉ 4ms nên **không** nghẽn CPU. Nghẽn ở đường truyền và ở cơ sở dữ liệu: mỗi lần lưu
xoá toàn bộ sheet rồi ghi lại 10.000 hàng, sau đó còn lưu thêm một bản phiên bản nữa.

**Ảnh hưởng thực tế** Mạng văn phòng chậm hoặc 4G thì 1,6 MB mỗi lần bấm Lưu là đáng kể; rủi ro
timeout khi báo giá lớn.

**Hướng xử lý** (chưa làm)
- Chỉ gửi sheet **có thay đổi** thay vì toàn bộ báo giá.
- Bật nén cho phản hồi/yêu cầu nếu chưa có.
- Xem lại việc ghi bản phiên bản: hiện chép nguyên khối dữ liệu bảng nội bộ, trong đó có ảnh chứng
  từ dạng base64.

### 2.5 Điểm cần soi tiếp (chưa đo, không kết luận)

- **Ảnh chứng từ base64 trong bảng nội bộ**: có dấu hiệu được chép nguyên khối vào bản phiên bản mỗi
  lần lưu. Cần đo trên một báo giá thật có ảnh trước khi kết luận.
- **Thời gian mở báo giá lớn**: chưa đo trên báo giá 50 tab thật vì chưa có dữ liệu mẫu cỡ đó.
- **Xuất Excel/PDF với 1.000 dòng**: chưa đo trong đợt này.

---

## 3. Những gì kiểm tra rồi và thấy **không** cần sửa

- **Cộng tổng nhiều sheet** — 0,11ms ở 10.000 dòng (mục 2.3).
- **Danh mục rạp** — tải một lần rồi giữ trong bộ nhớ, không gọi mạng mỗi phím.
- **Cuộn** — ~0,1ms ở mọi kích thước, không cần đụng.
- **Đo bề ngang cột** — đã có chống dao động; thử tái hiện vòng lặp trên máy đo thì **không xảy ra**.
- **Danh sách báo giá** — truy vấn đã chọn cột hẹp, không kéo theo hạng mục.

---

## 4. Trạng thái

| Hạng mục | Trạng thái |
| --- | --- |
| Gõ phím không phụ thuộc số dòng | ✅ đã sửa, có số đo |
| Cuộn mượt | ✅ vốn đã tốt |
| Dựng lưới / thêm / xoá hàng | ⚠️ vẫn tuyến tính, có hướng xử lý, chưa làm |
| Gói dữ liệu khi Lưu (báo giá nhiều tab) | ⚠️ 1,58 MB, chưa sửa |
| Ảnh base64 trong bản phiên bản | ❓ nghi ngờ, chưa đo |
| Xuất Excel/PDF quy mô lớn | ❓ chưa đo đợt này |
| Bộ đo chạy lại được | ✅ `npm --prefix web run bench` |
| Test | ✅ 409 pass |
