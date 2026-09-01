# Lưu báo giá: đo trước, rồi mới quyết

> §16 của quy ước dự án đề xuất chuyển sang *incremental mutation*, và ghi rõ điều kiện:
>
> > "Không thực hiện full incremental rewrite nếu benchmark chứng minh complexity > benefit.
> > **Phải benchmark trước/sau.**"
>
> Nên bước đầu không phải viết mã, mà là con số. Đây là con số đó.

Đo lại bất cứ lúc nào:

```bash
npm run bench:quote-save                      # 100 500 2000 5000 dòng, 5 lần mỗi cỡ
BENCH_LAP=7 npm run bench:quote-save -- 10000  # tự chọn kích cỡ
INCREMENTAL_QUOTE_SAVE=true npm run bench:quote-save
```

Máy đo: Postgres 16 cục bộ, container dev, 5 lần mỗi kích cỡ, lấy **trung vị**. **Đọc tỉ lệ, đừng
chép số tuyệt đối sang máy khác.**

---

## 1. Vấn đề, bằng số

Trần thật của validator là **1000 dòng mỗi trang, 60 trang mỗi báo giá** (`src/validators.ts`), nên
"10.000 dòng" trong đời thật là **10 trang**, không phải một trang khổng lồ.

Kịch bản đo là kịch bản thường ngày nhất: **sửa ĐÚNG MỘT ô rồi bấm Lưu.**

| dòng | trang | thân JSON | LƯU (trung vị) | p95 |
|---:|---:|---:|---:|---:|
| 100 | 1 | 30 KB | 80,8 ms | 91,6 ms |
| 1 000 | 1 | 281 KB | 341,3 ms | 348,7 ms |
| 2 000 | 2 | 564 KB | 651,9 ms | 670,9 ms |
| 5 000 | 5 | 1 414 KB | 1 536,3 ms | 1 646,3 ms |
| 10 000 | 10 | 2 829 KB | **3 255,1 ms** | 3 854,1 ms |

Hơn ba giây để đổi một con số. Và toàn bộ quãng đó nằm trong MỘT transaction đang giữ khoá
`FOR UPDATE` trên mọi `QuoteSheet` của báo giá — tức không ai khác động vào báo giá đó được.

## 2. Thời gian nằm ở đâu

| dòng | JSON.parse | zod | tính tiền (Decimal) | ba phần trên | phần CSDL |
|---:|---:|---:|---:|---:|---:|
| 100 | 0,1 ms | 0,9 ms | 0,3 ms | 1,3 ms (2%) | **79,4 ms (98%)** |
| 2 000 | 1,4 ms | 6,5 ms | 2,1 ms | 10,1 ms (2%) | **641,8 ms (98%)** |
| 10 000 | 7,2 ms | 38,7 ms | 17,1 ms | 62,9 ms (2%) | **3 192,2 ms (98%)** |

**Đây là con số quyết định.** Nếu phần lớn thời gian nằm ở phân giải JSON + zod duyệt từng dòng +
tính tiền bằng `Decimal` — những việc chạy trên TOÀN BỘ thân request dù chỉ đổi một ô — thì ghi tăng
dần cỡ nào cũng không cứu được, và §16 tự trả lời là "đừng làm". Thực tế ngược lại: **98% là ghi
CSDL**, đúng phần mà ghi tăng dần chạm tới.

## 3. Cái KHÔNG nhỏ đi dù có incremental

| dòng | `snapshotQuoteVersion` | % tổng | đọc lại mọi trang+dòng để SO SÁNH |
|---:|---:|---:|---:|
| 100 | 10,9 ms | 13% | 3,2 ms |
| 2 000 | 91,5 ms | 14% | 15,7 ms |
| 10 000 | 554,2 ms | 16% | 93,1 ms |

* **Chụp phiên bản** đọc lại cả báo giá rồi ghi một khối JSON, sau MỖI lần lưu. Việc đó không nhỏ đi
  khi ta chỉ ghi một ô — nó là **sàn thật** của mọi đường lưu còn giữ lịch sử phiên bản.
* **Lần đọc để so sánh** là cái giá bắt buộc của đường an toàn (phải biết trang nào đổi). Nó rẻ hơn
  hai bậc độ lớn so với lần ghi mà nó giúp tránh — 93 ms để tránh 3 200 ms.

## 4. Quyết định: có làm, nhưng ở MỨC TRANG

`INCREMENTAL_QUOTE_SAVE` (mặc định **TẮT**) bỏ qua việc xoá-tạo-lại những **trang không đổi**.

**Vì sao mức trang chứ không mức dòng.** Mức dòng đòi id bền cho `QuoteItem`, luật ghép dòng
mới/cũ, và xử lý dòng bị chèn giữa — một tầng lỗi mới đặt ngay giữa đường tiền bạc, đổi lấy phần
tăng tốc còn lại sau khi đã bỏ qua trang. Vì trần là 1000 dòng/trang, mức trang đã lấy được phần
lớn khoản tiết kiệm: báo giá càng lớn thì càng nhiều trang, và người dùng sửa một ô chỉ chạm một
trang.

**Nguyên tắc an toàn.** `src/quoteSheetDiff.ts` so trên ĐÚNG tập trường mà lệnh ghi sẽ đặt, và gặp
bất kỳ khoá lạ nào (ai đó thêm trường vào `buildSheetsCreate` mà quên chỗ này) thì trả ngay
`false`. Sai về phía "khác nhau" chỉ mất phần tăng tốc; sai về phía "giống nhau" là **mất dữ liệu
âm thầm** — máy chủ vẫn trả 200 và người dùng vẫn thấy "Đã lưu".

## 5. Trước / sau / chênh

Cùng máy, cùng lượt chạy, cùng kịch bản (sửa một ô ở trang đầu):

| dòng | trang | TRƯỚC | SAU | trang giữ nguyên | chênh |
|---:|---:|---:|---:|---:|---:|
| 100 | 1 | 80,8 ms | 78,8 ms | 0/1 | — |
| 1 000 | 1 | 341,3 ms | 360,9 ms | 0/1 | **−6% (chậm hơn)** |
| 2 000 | 2 | 651,9 ms | 434,8 ms | 1/2 | **1,5× nhanh hơn** |
| 5 000 | 5 | 1 536,3 ms | 493,1 ms | 4/5 | **3,1× nhanh hơn** |
| 10 000 | 10 | 3 255,1 ms | 930,7 ms | 9/10 | **3,5× nhanh hơn** |

Cột "trang giữ nguyên" là bằng chứng trực tiếp, không phải suy từ thời gian: trang bị xoá-tạo-lại
thì `QuoteSheet.id` MỚI, trang được giữ thì id CŨ.

### Cái giá, nói thẳng

Báo giá **một trang** chậm hơn khoảng 6% (341 → 361 ms ở 1000 dòng): nó trả tiền cho lần đọc so
sánh mà không có gì để bỏ qua. Đó là đánh đổi có chủ ý — kích cỡ đó vốn đã đủ nhanh, còn kích cỡ
gây đau (5–10 trang) thì nhanh lên 3 lần.

## 6. Bật thế nào

```bash
INCREMENTAL_QUOTE_SAVE=true   # 1 | true | yes | on ; mọi giá trị khác = tắt
```

Thứ tự đề nghị:

1. Bật ở **staging**, dùng thật vài ngày — đặc biệt là luồng có trạng thái mức trang (khách duyệt
   từng trang, ký, số hoá đơn, bảng Hà Nội).
2. Đối chiếu: mở lại báo giá vừa lưu, kiểm số hoá đơn / trạng thái khách duyệt / bảng nội bộ còn
   nguyên.
3. Rồi mới bật production. Có sự cố thì **gỡ biến môi trường và khởi động lại** — không cần rollback
   mã, không cần migration.

## 7. Bộ test canh cái gì

`tests/xc-incremental-quote-save.test.js` — 7 bài, tất cả chạy **cả hai chiều cờ**:

* cờ TẮT vẫn xoá-tạo-lại mọi trang (hành vi cũ không đổi);
* cờ BẬT, lưu lại y nguyên → **không đụng trang nào**;
* cờ BẬT, sửa một ô ở trang 1 → chỉ trang 1 tạo lại;
* **BẬT và TẮT cho ra CÙNG nội dung** trên cùng một chuỗi 5 thao tác (đổi giá · thêm dòng · đổi tên
  trang · xoá trang · đảo thứ tự) — bài đắt nhất, và là bài duy nhất bắt được lệch dữ liệu;
* trạng thái mức trang sống sót ở CẢ trang giữ lẫn trang tạo lại;
* đảo thứ tự: hai trang đổi chỗ bị tạo lại, trang đứng yên giữ id;
* khoá lạc quan vẫn trả 409, không bị đường mới lách qua.

## 8. Chưa làm (có chủ ý)

* **Ghi tăng dần ở mức DÒNG.** Xem §4. Đo lại nếu báo giá thật thường xuyên là một trang 1000 dòng —
  cảnh đó là cảnh duy nhất mức trang không giúp được gì.
* **Thu nhỏ `snapshotQuoteVersion`.** Ở cỡ 5 000–10 000 dòng nó đã chiếm **42–43%** thời gian còn
  lại sau khi bật cờ (bảng §3 đo lại với cờ bật). Đó là mục tiêu TIẾP THEO rõ ràng nhất — nhưng nó
  đụng vào lịch sử phiên bản, tức đụng vào khả năng khôi phục, nên phải là một đợt riêng có bộ test
  riêng.
* **Phân trang keyset cho danh sách.** Không liên quan đường lưu; xem `scripts/db/explain-hot-paths.mjs`.
