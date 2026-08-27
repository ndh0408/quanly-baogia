# ADR 0003 — Ảnh chứng từ nằm ở kho object, không nằm trong CSDL

**Trạng thái:** đã chấp nhận · **Ngày:** 2026-08-11

## Bối cảnh

Ảnh chứng từ thanh toán từng lưu dưới dạng data-URL base64 ngay trong cột
`PersonnelRecord.paymentProof`.

## Quyết định

Ghi mới luôn vào kho object S3-compatible. CSDL chỉ giữ **khoá object, MIME, kích
thước, SHA-256, thời điểm tải lên**. Đọc thì ưu tiên object, thiếu mới rơi về cột
base64 cũ (giai đoạn chuyển tiếp).

## Lý do

- Mọi bản dump CSDL cõng theo toàn bộ ảnh — dump phình, khôi phục chậm, và ảnh đi
  theo mỗi bản dump được sao chép ra ngoài.
- Đọc một hàng là kéo cả ảnh vào bộ nhớ tiến trình (base64 còn phình thêm 33%).
- Không cách nào đặt vòng đời/kiểm soát riêng cho ảnh như một tài nguyên độc lập.

## Hệ quả — cái này quan trọng nhất

**Bản dump CSDL một mình KHÔNG còn khôi phục được hệ thống.** Khôi phục đầy đủ
cần đủ ba: dump + `PII_ENC_KEY` + bản sao kho object.

Đó là lý do có `scripts/backup/backup-objects.sh` và `restore-drill.sh`. Bài test
khôi phục cũ (nạp dump, đếm user) **vẫn báo PASS** trong khi mọi hàng chứng từ
trỏ vào hư không — nên nó không còn đủ.

Quyền tải ảnh bám vào **bản ghi nghiệp vụ** (ai đọc được hồ sơ thì đọc được chứng
từ của nó), không bám vào "ai là người đã tải lên". Kế toán tải ảnh lên, nhưng
người có quyền xem hồ sơ cũng phải xem được.

## Đường lùi

Giai đoạn chuyển tiếp **cố ý** giữ đường đọc cũ: thiếu object thì rơi về cột base64. Nên lùi =
ngừng ghi vào kho object (gỡ `S3_*`), và mọi bản ghi CŨ vẫn đọc được như trước.

Cái KHÔNG lùi được: những **tệp đã ghi SAU khi bật kho object** không có bản base64 tương ứng. Muốn
lùi thật thì phải kéo chúng về CSDL trước — chưa có script cho việc đó, và viết nó là điều kiện bắt
buộc nếu quyết định này bị lật. `scripts/backup/backup-objects.sh` + bài diễn tập khôi phục là thứ
bảo đảm dữ liệu vẫn còn để kéo về.
