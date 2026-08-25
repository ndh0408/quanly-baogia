# PERFORMANCE_BENCHMARK

Số đo của lưới nhập báo giá (`web/src/components/GridTable.tsx`) — màn hình quan trọng nhất.

## Cách đo (chạy lại được)

```bash
npm --prefix web run bench      # build production KÈM trang đo → public/app2/bench.html
```

Rồi phục vụ `public/` và mở `/app2/bench.html`, bấm **Chạy đo**. Kết quả hiện thành bảng và nằm ở
`window.__BENCH`.

Hai điều đã trả giá mới biết, ghi lại để lần sau khỏi mắc:

- **Phải đo trên bản BUILD.** React chế độ phát triển thổi con số lên 4–9 lần. Có lúc đo trên
  `vite dev` ra 76ms rồi tưởng mình làm code chậm đi, trong khi bản build là 8,6ms.
- **Không dùng `requestAnimationFrame` làm mốc "vẽ xong".** Tab ở nền bị dừng nhịp vẽ nên phép đo
  treo vĩnh viễn; đặt hạn chờ dự phòng thì mọi phép đều ra đúng bằng cái hạn đó (lần đầu ra ~250ms
  cho mọi thứ = chính là hạn 250ms). Nay dùng `flushSync` + đọc `offsetHeight` để đo phần **chặn
  luồng chính** — cũng chính là thứ quyết định cảm giác giật hay mượt.
- **So sánh phải cùng phiên, cùng máy.** Baseline đo lúc máy rảnh thấp hơn hẳn lúc máy bận. Bảng
  dưới đây là cặp A/B đo liên tiếp trong cùng một phiên: cất thay đổi bằng `git stash` → build →
  đo bản cũ → khôi phục → build → đo bản mới.

Máy đo: i9-14900HX. **Máy văn phòng (i5/i7 đời cũ, RAM 8GB) chậm hơn khoảng 3–5 lần** — cần nhân
lên khi đọc các số này.

## Lưới báo giá — bản cũ so với bản mới

Đơn vị: mili giây. Càng nhỏ càng tốt.

| Phép đo | Số dòng | Trước | Sau | Cải thiện |
| --- | ---: | ---: | ---: | ---: |
| Gõ 1 phím (ô chữ) | 100 | 16,5 | 0,0 | ~∞ |
| Gõ 1 phím (ô chữ) | 500 | 86,6 | 0,0 | ~∞ |
| Gõ 1 phím (ô chữ) | 1000 | 196,6 | 0,0 | ~∞ |
| Gõ 1 phím (ô số) | 100 | 17,2 | 0,1 | 172× |
| Gõ 1 phím (ô số) | 500 | 88,1 | 0,1 | 881× |
| Gõ 1 phím (ô số) | 1000 | 179,9 | 0,2 | 900× |
| Đổi đơn giá → vẽ xong | 500 | 116,5 | 12,4 | 9,4× |
| Đổi đơn giá → vẽ xong | 1000 | 206,1 | 26,3 | 7,8× |
| Vẽ lần đầu | 100 | 76,7 | 64,0 | 1,2× |
| Vẽ lần đầu | 1000 | 937,6 | 852,1 | 1,1× |
| Thêm 1 hàng | 1000 | 327,1 | 310,7 | 1,05× |
| Xoá 1 hàng | 1000 | 217,5 | 258,1 | ≈ (trong sai số) |
| Cuộn 10 nhịp | 1000 | 0,1 | 0,1 | — |

Đọc bảng này cho đúng: **thao tác gõ đã hết chậm ở mọi kích thước**, còn **dựng lưới / thêm / xoá
hàng vẫn tuyến tính theo số dòng** và chưa được cải thiện đáng kể. Xem phần "Còn lại" trong
`PERFORMANCE_AUDIT.md`.

## Báo giá nhiều tab (50 sheet × 200 dòng = 10.000 dòng)

| Phép đo | 1 sheet × 200 | 10 × 200 | 50 × 200 | 50 × 500 |
| --- | ---: | ---: | ---: | ---: |
| Cộng tổng toàn báo giá | 0,02 ms | 0,08 ms | **0,11 ms** | 0,29 ms |
| Kích thước gói gửi khi Lưu | 32 KB | 316 KB | **1.581 KB** | 3.954 KB |
| Đóng gói JSON | 0,1 ms | 1,0 ms | 4,3 ms | 9,8 ms |
| Mở gói JSON | 0,1 ms | 0,8 ms | 4,0 ms | 9,7 ms |

Kết luận rút ra từ đây: nghi ngờ ban đầu rằng "mỗi lần vẽ lại phải cộng tổng mọi sheet nên chậm"
là **sai** — 0,11ms. Vấn đề thật của báo giá nhiều tab nằm ở **1,58 MB mỗi lần bấm Lưu** và ở việc
ghi lại 10.000 hàng xuống cơ sở dữ liệu, chứ không phải ở phép tính.

## Khoanh vùng nguyên nhân (cách đã dùng để không đoán mò)

Đo trên lưới 1000 dòng, gõ vào một ô:

| Cách gõ | ms |
| --- | ---: |
| Đặt giá trị + phát sự kiện `input` (đi qua handler React) | 74,8 |
| Chỉ đặt giá trị, không phát sự kiện | 0 |
| Phát sự kiện `input` nhưng `bubbles: false` (React không bắt được) | 0 |
| Phát `keydown` | 0 |
| Đọc `scrollHeight` 30 lần | 6,5 |

→ Toàn bộ chi phí nằm **trong handler React**, không phải ở DOM. Rồi so từng cột:

| Ô | ms/phím @1000 dòng |
| --- | ---: |
| Hạng Mục | 72,6 |
| Số Lượng | 73,4 |
| Ghi Chú | 0 |
| Ghi chú nội bộ | 0 |
| ĐVT | 0,1 |

→ Đúng hai ô gọi `setState` mỗi phím. Ô Ghi Chú 0ms chứng minh cơ chế hoãn vẽ đã đúng, chỉ là hai
ô kia chưa dùng nó.
