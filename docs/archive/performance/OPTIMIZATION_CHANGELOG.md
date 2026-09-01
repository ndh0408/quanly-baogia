> ## ⚠️ TÀI LIỆU LỊCH SỬ — ĐÃ LƯU TRỮ
>
> Giữ lại vì nó ghi lại VÌ SAO hệ thống thành ra như hiện nay, không phải để mô tả hiện trạng.
> **Nhiều phát hiện trong đây ĐÃ ĐƯỢC SỬA.** Đừng mở một issue hay viết một bản vá dựa trên tài
> liệu này mà chưa đối chiếu với mã nguồn đang chạy.
>
> **Nguồn sự thật là MÃ NGUỒN.** Tài liệu đang hiệu lực nằm ở [docs/README.md](../../README.md).

---

# OPTIMIZATION_CHANGELOG

Mỗi mục ghi đúng thứ đã làm, vì sao, và **số đo thật** — không có mục nào dựa trên cảm tính.
Số đo lấy từ `docs/archive/performance/PERFORMANCE_BENCHMARK.md` (bản build production, lưới 1000 dòng, đo A/B cùng phiên).

---

## 1. Ô số: cập nhật một ô DOM thay vì vẽ lại cả lưới

**File** `web/src/components/GridTable.tsx` — `onNumInput`

**Đổi gì** Kết thúc bằng `recomputeAll(); onChange();` mỗi phím → nay cập nhật trực tiếp đúng ô
"Thành Tiền" của hàng đang gõ, phần còn lại (tính lại công thức + vẽ lại lưới) gộp về sau 180ms.

**Vì sao** `onChange()` khiến React dựng lại toàn bộ lưới. Ở 1000 dòng là 5.900 ô nhập.

**Ảnh hưởng mong đợi** Gõ số không còn phụ thuộc số dòng.

**Đo được** 179,9ms → **0,2ms** mỗi phím (900×). Ô "Thành Tiền" vẫn đổi ngay trong cùng nhịp gõ —
đã kiểm trên trình duyệt: gõ số lượng 10 thì ô hiện `650.000` tức thì.

**Rủi ro** Tổng nhóm / tổng sheet cập nhật trễ 180ms. Đã chốt ngay khi rời ô, copy, dán, undo/redo
nên không có đường nào lưu ra dữ liệu cũ. Mắt thường không thấy độ trễ này.

---

## 2. Ô Hạng Mục và ô tên nhóm: dùng chung nhịp hoãn

**File** `web/src/components/GridTable.tsx` — handler `onInput` của `td.col-hangmuc`

**Đổi gì** Hai ô này gọi `onChange()` thẳng mỗi phím, trong khi các ô chữ khác đã đi qua nhịp hoãn.
Nay dùng `onChangeSoft()`. Thêm luôn `markEditUndo` cho ô Hạng Mục (trước đây gõ tay vào ô này
không ghi mốc hoàn tác).

**Vì sao** Đây là cột gõ nhiều nhất. Sót nó thì tối ưu ô số không có ý nghĩa thực tế.

**Ảnh hưởng mong đợi** Gõ tên hạng mục mượt như gõ ghi chú.

**Đo được** 196,6ms → **0,0ms** mỗi phím.

**Rủi ro** Không có gì mới — dùng đúng cơ chế mà ô Chi Tiết / Ghi Chú đã chạy ổn.

---

## 3. Tra danh mục rạp: chờ ngưng gõ

**File** `web/src/components/GridTable.tsx` — `nameSuggest`

**Đổi gì** Tra danh mục mỗi phím → chờ ngưng gõ 150ms rồi mới tra.

**Vì sao** Mỗi lần có kết quả là một `setState`, mà `setState` ở đây vẽ lại cả lưới.

**Ảnh hưởng mong đợi** Gõ liên tục không tạo ra loạt lần vẽ lại.

**Đo được** Nằm trong con số 196,6 → 0,0 ở mục 2 (hai thay đổi cùng nằm trên một đường).

**Rủi ro** Gợi ý hiện chậm hơn 150ms. Đây là nếp quen thuộc của mọi ô tìm kiếm.

---

## 4. Bỏ lượt quét toàn bộ ô khi lần vẽ đó chỉ do gõ

**File** `web/src/components/GridTable.tsx` — `useEffect` đồng bộ ô về model

**Đổi gì** Effect này **không có mảng phụ thuộc** nên chạy sau *mỗi* lần vẽ: quét toàn bộ `[data-f]`,
mỗi ô gọi `closest()` + so chuỗi. Nay bỏ qua lượt quét khi lần vẽ đó chỉ do gõ chữ; vẫn quét đủ khi
undo/redo, dán, tính lại công thức, chèn/xoá hàng.

**Vì sao** Khi gõ, ô đang gõ tự có giá trị đúng, các ô khác không đổi — quét lại là thừa và tốn
O(số ô).

**Đo được** Góp phần vào "Đổi đơn giá → vẽ xong" 206,1ms → **26,3ms** (7,8×).

**Rủi ro** Đây là thay đổi rủi ro nhất trong loạt này: bỏ sót một đường cần quét sẽ khiến ô hiển thị
lệch model. Đã kiểm tay: gõ tên/số hiển thị đúng, tổng sheet cập nhật sau nhịp hoãn, xoá hàng rồi
Ctrl+Z khôi phục đúng cả số hàng lẫn nội dung ô.

---

## 5. Gộp phép đo chiều cao ô về cuối khung hình

**File** `web/src/lib/gridShared.ts` — `autoGrow` (commit `ada703f`)

**Đổi gì** Mỗi ký tự đọc `scrollHeight` ngay → gom các ô cần đo vào một `Set`, đo một lượt ở cuối
khung hình.

**Vì sao** Đọc `scrollHeight` buộc trình duyệt tính lại bố cục ngay lúc đó.

**Đo được** Đo tách riêng: 30 lần đọc kiểu cũ tốn 6,5ms, kiểu mới ~0ms. **Nhưng** đây *không* phải
nút thắt chính — lúc đầu tôi tưởng là nó và đã nói vậy; đo tách bạch mới thấy phần lớn chi phí nằm
ở `setState` (mục 1–2). Giữ lại vì vẫn đúng hướng và không có mặt trái.

**Rủi ro** Thấp. Có nhánh dự phòng khi không có `requestAnimationFrame`.

---

## 6. Chống dao động cho phép đo bề ngang

**File** `web/src/components/GridTable.tsx` — `ResizeObserver` (commit `f2fe193`)

**Đổi gì** Chỉ nhận thay đổi bề ngang từ 24px trở lên, đo bằng `clientWidth`, dồn về cuối khung hình.

**Vì sao** Cột co lại → bảng cao/thấp khác đi → thanh cuộn dọc hiện rồi tắt → bề ngang đổi ~15px →
cột lại co/nở. Về lý thuyết là vòng lặp vô tận.

**Đo được** **Không tái hiện được** vòng lặp trên máy đo (bảng đứng yên, 0 lần đổi kích thước trong
3 giây). Giữ lại như một lớp phòng thủ, **không** tuyên bố nó đã sửa lỗi treo mà người dùng gặp.

**Rủi ro** Thấp.

---

## 7. Bộ đo chạy lại được

**File** `web/bench.html`, `web/src/bench.tsx`, `web/vite.config.ts`, `web/package.json`

**Đổi gì** Thêm `npm --prefix web run bench` → build production kèm trang đo tại `/app2/bench.html`.
Build thường **không** kèm trang này.

**Vì sao** Yêu cầu "đo trước / đo sau" chỉ có nghĩa khi phép đo chạy lại được và cho số ổn định.

**Rủi ro** Không ảnh hưởng bản giao cho người dùng (khác `--mode`).


---

## 8. Mở giới hạn quy mô báo giá — sửa lỗi CHẶN CHỨC NĂNG

**File** `src/validators.ts`, `src/app.ts`, `web/src/components/ImportExcelModal.tsx`

**Đổi gì** Số trang tối đa 20 → **60**; số dòng mỗi trang 500 → **1000**; trần gói gửi lên nâng từ
2 MB lên **16 MB** nhưng chỉ cho nhóm route báo giá, phần API còn lại giữ 2 MB.

**Vì sao** Thực tế một báo giá có thể tới 50 trang × hơn 200 dòng. Kiểm bằng chính bộ kiểm tra dữ
liệu của app: **21 trang trở lên bị chặn**, **501 dòng/trang bị chặn**. Nghĩa là báo giá 50 tab
**không lưu được** — đây là lỗi chức năng, không phải chuyện tốc độ.

**Đo được** Sau khi mở: 50 trang × 500 dòng (1,8 MB) OK; 60 trang × 1000 dòng (4,3 MB) OK; 61 trang
vẫn bị chặn với thông báo rõ ràng.

**Rủi ro** Trần lớn hơn là bề mặt tấn công lớn hơn — nên chỉ nâng cho nhóm route báo giá, và giữ
nguyên lớp chặn số lượng của bộ kiểm tra dữ liệu phía sau.

---

## 9. Nén gói dữ liệu khi gửi lên — lời giải cho "sau này còn nhiều hơn"

**File** `src/decompressBody.ts` (mới), `src/app.ts`, `web/src/lib/api.ts`

**Đổi gì** Trình duyệt tự nén thân **trả về** nhưng không nén thân **gửi lên**. Nay client tự nén khi
gói lớn hơn 256 KB, server có lớp giải nén đặt trước mọi bước đọc JSON.

**Vì sao** Nâng trần mãi không phải lời giải. Nén giữ cho đường truyền nhẹ bất kể báo giá to dần.

**Đo được** 50 trang × 200 dòng: **1.344 KB → 21 KB (65×)**. 60 trang × 1000 dòng: 8.082 KB → 195 KB
(41×). Nén tốn 3–18 ms. Xác minh đầu-cuối trên trình duyệt thật: 553 KB gửi đi còn 9 KB, server nhận
đúng header và mở ra đủ 50 trang.

**Rủi ro** Đây là đường đi của **dữ liệu lưu thật**, sai là mất dữ liệu. Vì vậy:
· client nén hỏng thì tự gửi nguyên văn, không bỏ dữ liệu;
· trình duyệt cũ không có `CompressionStream` thì gửi như cũ;
· server chỉ nhận gzip/deflate, kiểu khác trả 415 thay vì đoán;
· đếm byte **sau giải nén** và cắt khi vượt trần — chặn "bom nén";
· 9 test phủ: gzip, deflate, không nén, tiếng Việt nhiều byte, bom nén, kiểu lạ, dữ liệu hỏng,
  JSON hỏng, và gói cỡ báo giá 50 trang.
