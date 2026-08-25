# OPTIMIZATION_CHANGELOG

Mỗi mục ghi đúng thứ đã làm, vì sao, và **số đo thật** — không có mục nào dựa trên cảm tính.
Số đo lấy từ `PERFORMANCE_BENCHMARK.md` (bản build production, lưới 1000 dòng, đo A/B cùng phiên).

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
