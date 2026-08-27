# Nhật ký thay đổi

> **File này SINH TỪ LỊCH SỬ GIT, không viết tay.** Dựng lại:
> ```bash
> node scripts/ci/gen-changelog.mjs > CHANGELOG.md
> ```
> Vì sao không viết tay: §34 của quy ước dự án cấm ghi số liệu dễ trôi mà không có gì sinh ra
> chúng. Một CHANGELOG chép tay sẽ lệch khỏi lịch sử ngay commit thứ ba, và không ai biết bản nào
> đúng. Ở đây lịch sử git là nguồn duy nhất.

Hệ thống **không đánh phiên bản theo semver** — nó là công cụ nội bộ, triển khai theo commit chứ
không phát hành gói. Nên nhật ký gom **theo ngày**, và "phiên bản" của một bản triển khai chính là
git SHA của nó (xem [docs/operations/DEPLOYMENT.md](docs/operations/DEPLOYMENT.md)).

**95 commit**, từ 2026-08-11 tới 2026-08-27.

---

## 2026-08-27

- `78decd3` Bí mật đọc từ file (*_FILE), vá 5 lỗ của verify, và gộp smoke image về MỘT chỗ
- `cfb13e2` Quét bảo mật chạy thật + 14 quy tắc cảnh báo Prometheus có bài kiểm logic
- `40d3fce` PHASE 4: dựng image + mở trình duyệt + render chart — ba cổng kiểm THỨ ĐƯỢC TRIỂN KHAI
- `3a08f55` docs: đối chiếu TỪNG PHASE của prompt gốc với repo — cái gì xong, cái gì chưa
- `d4e77d4` fix: bộ test SSE không biết mình chạy đường nào — cộng hai lời khai sai trong tài liệu
- `5c617a5` fix: hai cổng test lặng lẽ bỏ qua, và dọn sạch lớp chú thích trỏ sai chỗ
- `fdfbb77` fix: cờ chống nhiễu của phép đo TOAST canh NHẦM BẢNG — và db3 vẫn nhấp nháy
- `ae52497` fix: bộ dò phủ mã nhật ký bỏ sót 10 mã — và không hề biết mình bỏ sót
- `6a62bbd` fix: chặn `npm run verify` chạy lên hạ tầng THẬT + cổng bắt chú thích trỏ sai chỗ
- `8da5c03` test: đo lại xem bài nào THẬT SỰ bắt được lỗi SSE, và sửa lời khai cho đúng
- `09fbdcd` fix: SSE mất sự kiện lúc khởi động + 3 cổng test không canh gì
- `d63eb71` fix: 11 lỗi ngầm trong chính bản vá xuất nền, cộng một cổng npm audit không canh gì
- `782243d` fix: nối nút Xuất với đường nền — đóng ngõ cụt "lưu 60.000 dòng, tải cụt ở 20.000"
- `417d579` fix: đóng 13 mục "nên sửa" + hai test hỏng thật + cổng npm audit
- `02adf92` feat: `npm run verify` — cổng kiểm chạy LOCAL, vì CI GitHub không chạy được
- `3075997` fix: bốn mục "nên sửa" đụng tiền và dữ liệu — phần tôi tự làm

## 2026-08-26

- `223d269` fix: khắc phục 4 blocker của vòng phản biện 8 nhóm
- `87d5954` fix: đóng 5 mục mà việc chia nhóm bỏ sót, và gỡ một bài test chập chờn
- `d2f6f38` wip: vá 41/57 mục còn lại sau đối soát — MỐC LƯU, CHƯA QUA PHẢN BIỆN
- `f86314a` docs(pii): ghi đúng trạng thái thật của mã hoá PII — theo quyết định giữ nguyên
- `3679aa3` fix(bảo mật): token mời vẫn ra log/Sentry, và rid client gửi giả mạo được chứng từ
- `2b83ad8` docs(rui-ro): sửa hai lỗi trong chính mục "phải đọc trước khi tin nhánh này"
- `972f7af` fix: khắc phục 9 blocker của vòng phản biện P3 — nhánh xanh hoàn toàn
- `528640d` fix(pii): đóng ba lỗ hổng trong chính quy trình xoay khoá — mốc lưu giữa wave P3
- `9ec9006` fix(import): đọc file Excel trong worker thread — và sửa lại lời hứa cho đúng thứ đo được
- `659a2a6` fix: khắc phục blocker của vòng phản biện — nhánh trở lại XANH hoàn toàn
- `67c8fb4` wip: mốc lưu giữa chừng — wave P2 đã áp, đang khắc phục blocker
- `e13524a` fix(web): proxy trả HTML không còn nuốt lỗi; tab sheet dùng được bằng bàn phím
- `76dbeda` fix(web): 401 không còn xoá trắng báo giá đang soạn
- `21496c6` fix(excel,grid): tên sheet không còn chặn xuất file; chèn-từ-rạp không còn làm sai tiền
- `e75a889` refactor!: gỡ hẳn SPA vanilla cũ (/app) + chặn rò rỉ lịch sử báo giá
- `9a38386` fix(hn): chặn account Hà Nội giả mạo trạng thái duyệt/thanh toán qua PUT /quotes/:id/hn
- `383b89f` fix(queue+shutdown): Redis xoá mất job, file nhồi vào Redis, và SSE chặn tắt máy êm
- `b4b7eb1` docs: ghi lại rủi ro CHƯA xử lý, kèm cảnh báo chúng chưa được kiểm chứng
- `57bc18d` fix(auth): mỗi request Bearer sinh một phiên cookie 7 ngày trong CSDL
- `c088c35` fix(deploy): deploy hỏng nay BÁO HỎNG; mật khẩu Postgres của chart đổi được; TRUST_PROXY tường minh
- `67a0442` fix(quote): Lưu báo giá XOÁ SẠCH cờ đã-thanh-toán của bảng nội bộ
- `19b0c60` fix(security+dr): gỡ mật khẩu demo khỏi repo công khai; diễn tập khôi phục nay chạy được
- `51acc83` docs: dựng lại tài liệu, và chặn số liệu README trôi khỏi mã nguồn
- `1ddb65b` fix(config): .env.example thiếu biến BẮT BUỘC — production không khởi động nổi
- `a19c32c` feat(security): CSRF không còn fail-open — token đồng bộ hoá gắn với phiên
- `c62c736` fix(quote): tổng tiền âm làm MẤT TRẮNG lần Lưu — 500 đổi thành 400 chỉ rõ chỗ sai
- `1d8d16a` fix(export): trần hàng đợi xuất file + bootstrap bucket + CI hết đỏ
- `dad306d` feat(dr): sao lưu KHO OBJECT + diễn tập khôi phục đầy đủ + canh độ tươi

## 2026-08-25

- `3b3f777` fix(deploy): Helm/k8s khởi động file không tồn tại — thống nhất một artifact dist/
- `e811dc0` fix(security): trần giải nén ăn theo route, không dùng chung 16MB
- `d74f8c2` docs(perf): bổ sung số đo kiểm trên dev thật
- `8eee129` feat(scale): báo giá 50+ trang lưu được, và nén gói gửi lên 65 lần
- `b5c874e` docs: hồ sơ rà hiệu năng — audit, benchmark, changelog
- `a05039c` perf(grid): gõ phím không còn vẽ lại cả lưới + bộ đo chạy lại được
- `ada703f` perf(grid) + fix(import): gộp phép đo chiều cao ô; vá trần dòng lệch nhau
- `e74037e` feat(grid): chèn/xoá hàng dịch tham chiếu như Excel; gõ chữ hết khựng
- `282e4b0` fix(import): file thiếu cả cột STT lẫn ĐVT không còn nạp ra 0đ
- `c9c9f31` fix(grid): vá hồi quy lệch cột khi dán, và $ tuyệt đối cho trọn đường
- `9409a39` feat(grid): dán khối nguyên hàng ghép cột theo TÊN TRƯỜNG (chịu được khác mẫu)
- `f2fe193` fix(grid): chống dao động ResizeObserver làm lưới khựng/treo
- `b05046c` fix(grid): khoá hẳn cột STT — bỏ ô nhập nhãn nhóm
- `ffb6e0b` feat(formula): hiểu $ tuyệt đối kiểu Excel ở mọi chặng
- `56a77e7` fix(grid): nốt các chỗ còn lấy Số Lượng thô sau loạt vá trước
- `aa82b8e` feat(grid): chọn/copy được cột STT, dán và fill dịch tham chiếu như Excel
- `84811a4` fix(pdf): khai hàm toán cục bộ, không import shared/ (app không khởi động được)
- `c0e961e` fix(money): hệ số nhân nhóm + bảng PDF dùng đúng số đang hiển thị
- `2b5c9cd` fix(excel): ref ô Số Lượng khi xuất công thức lấy số đã làm tròn
- `1258271` fix(grid): công thức tham chiếu ô Số Lượng lấy số ĐÃ làm tròn
- `0e62f80` fix(grid): nhấp đúp chỉ đặt con trỏ, không bôi đen cả từ
- `2ae1182` fix(grid): nhấp đúp đặt con trỏ ngay chỗ bấm, hết nhảy về cuối chữ
- `edd2c2b` fix(grid): vùng chọn nhiều ô có màu trở lại
- `793493a` fix(grid): cột báo giá co dãn thông minh, hết bóp cột Hạng Mục
- `e99232a` fix(grid): giữ vùng chọn khi bấm nút thêm hàng/nhóm

## 2026-08-24

- `6e9d1bc` fix(venues): add reliable multiline shortcut
- `7d4a126` fix(venues): insert multiline item break explicitly
- `eb309ac` fix(ui): preserve multiline venue items and modal state
- `1e6f784` feat(venues): simplify item entry
- `92a5dfe` fix(venues): restore item input focus
- `0cec0d3` fix(venues): return typed advisory lock result
- `37c5334` fix(venues): prevent duplicate submissions
- `7d31ffd` fix(excel): buộc workbook tự tính lại công thức
- `7a5c733` fix(excel): liên kết công thức sống cho sheet tổng
- `94a9588` fix(excel): giữ đúng số lượng và kế hoạch sheet khi nhập
- `a914a25` fix(excel): ghi nhớ chính xác template khi nhập lại
- `db735c4` feat(excel): nhập và xuất báo giá theo đúng template
- `30cfc2b` fix(grid): giữ nguyên màu chữ khi chọn ô
- `2aaec4c` fix(grid): ổn định Enter, focus và màu chọn ô
- `d9d8b0f` fix(grid): đưa con trỏ về cuối ô khi nhấp đúp
- `b2a4e01` fix(grid): giữ con trỏ đúng chỗ khi nhấp đúp

## 2026-08-11

- `a1f0a7b` fix(reliability): Redis chết không được làm treo toàn bộ API
- `21e02c9` docs(files): chú thích khớp cơ chế THẬT của trạng thái tải lên
- `0d5ba96` test(rc): QA nghiệp vụ + ma trận vai trò + hiệu năng trên DEV đang chạy
- `a1d83e3` fix(ui): trang Danh mục rạp cuộn ngang ở khổ 901-1180px
- `e638187` docs(dr): sao lưu CSDL một mình không còn khôi phục được
- `d19c4c7` test(dev): tự tạo bucket riêng cho bộ test
- `3263cdb` test(dev): bộ test chạy với kho object + khoá PII thật
- `9dd321c` fix(proof): bỏ qua bản ghi đã xoá-mềm khi chuyển chứng từ
- `a966fff` feat(storage): chứng từ thanh toán ra kho object riêng tư (bước 2/3)
- `83fc923` feat(pii): ghi/đọc song song + backfill — bước 2-5 của lộ trình mã hoá
