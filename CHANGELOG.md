# Nhật ký thay đổi

> **File này SINH TỪ LỊCH SỬ GIT, không viết tay.** Dựng lại:
> ```bash
> npm run changelog      # = node scripts/ci/gen-changelog.mjs --write
> ```
> Vì sao không viết tay: §34 của quy ước dự án cấm ghi số liệu dễ trôi mà không có gì sinh ra
> chúng. Một CHANGELOG chép tay sẽ lệch khỏi lịch sử ngay commit thứ ba, và không ai biết bản nào
> đúng. Ở đây lịch sử git là nguồn duy nhất.

Hệ thống **không đánh phiên bản theo semver** — nó là công cụ nội bộ, triển khai theo commit chứ
không phát hành gói. Nên nhật ký gom **theo ngày**, và "phiên bản" của một bản triển khai chính là
git SHA của nó (xem [docs/operations/DEPLOYMENT.md](docs/operations/DEPLOYMENT.md)).

**661 commit**, từ 2026-05-29 tới 2026-09-23.

---

## 2026-09-23

- `c450a46` fix(Colorfull): màu CHỮ hàng nhóm trên màn hình soạn khớp lại với tệp Excel

## 2026-09-22

- `3388e4f` fix(Colorfull): màu CHỮ hàng nhóm theo đúng tệp mẫu + đáy khối tổng liền nét như GN
- `344e2c0` fix(Colorfull): chữ đỏ còn nằm trong ô PHỤ của vùng gộp + màu hàng tiêu đề trên màn hình
- `2a4db21` fix(Colorfull): tiền cộng đôi khi khách gửi lại tệp, chữ đỏ ở "Kính gửi", và bốn chỗ che chữ
- `f019dd3` fix(Colorfull): bỏ dòng mã + lời chào trên bảng; khung ngoài dừng đúng chỗ
- `90c312c` fix(Colorfull): trình bày tệp gửi khách theo đúng nếp Gia Nguyễn + gỡ hẳn logo khách hàng

## 2026-09-18

- `5597dae` fix(Colorfull + người gửi): sáu lỗi làm sai TỆP GỬI KHÁCH, tìm bằng soi chéo với GN
- `f2b7245` feat(Colorfull): đủ ba mẫu như GN — không ngày · banner · có ngày, mẫu nào cũng có cột Chi Tiết
- `26e78d8` feat(Colorfull): trả lại cột Chi Tiết cho mẫu CLF — và CHỈ cho Colorfull
- `d115228` feat(quản trị): ba lỗ hổng cuối của cụm hồ sơ — bản chụp quyền · cột PII khi XUẤT · nút đặt lại MFA
- `2dc851e` fix(phiên): /login thiếu email + mfaEnabled — trang Hồ sơ báo "MFA chưa bật" cho người ĐANG bật
- `21553d4` fix(quản trị): canSign không được ghi · email không sửa được · me cũ sau khi tự sửa · xoá nhật ký đăng nhập cho ĐÚNG
- `a59ff23` fix(GDPR + quản trị): tên thật sống sót sau lệnh "xoá tôi" · chức danh ghi được mà không đọc được

## 2026-09-17

- `dc84ffc` fix(hồ sơ): ba đường nữa làm mất dữ liệu — cùng một luật bị vi phạm ở ba chỗ
- `7a2cd21` docs(cảnh báo): ghi lại việc production đã bật kênh Telegram vào NHÓM
- `2bca9b8` style(báo giá): thẻ trạng thái Hà Nội về sát tiêu đề, không dạt sang cạnh nút Thêm sheet
- `4a4aaa6` refactor(báo giá): dồn phần Hà Nội về MỘT khối · nhãn thanh đáy nói đúng phạm vi
- `c0a8af2` fix(giao diện): màn 2K phí hơn nửa bề ngang · laptop 14" bị thanh đáy ăn 16% chiều cao
- `41f76d6` feat(bảng nội bộ): một thanh "+ Thêm hàng" bám theo bảng đang đứng · đủ bộ Excel · bảng tổng từng luồng
- `36aab98` refactor(bảng nội bộ): ba luồng thành ba khối GẬP — đóng vẫn đọc được tiền
- `01ad2ff` fix(tài khoản): đặt lại mật khẩu XOÁ TRẮNG SĐT/chức danh/tên người gửi
- `c767d52` fix(công thức): trỏ vào hàng NHÓM luôn ra 0, và ô Đơn Giá của nhóm không bấm được
- `7ec7d1f` fix(mẫu có ngày): khối màu RỖNG lơ lửng bên trái "Tổng Cộng" trong file khách nhận
- `b3e0b4a` fix(soạn báo giá): sau khi Lưu báo giá MỚI, nút bấm vẫn thao tác lên báo giá CŨ
- `b5116bd` fix(giao diện): cuộn BÊN TRONG menu làm chính menu tự đóng
- `e1b4950` fix(giao diện): menu "⋯" và bảng phím tắt bị thanh nút đáy CẮT trên màn thấp
- `b89d01e` fix(mẫu có ngày): dựng lại trên nền mẫu KHÔNG NGÀY — bản cũ để lọt hạng mục của khách khác
- `e09ca56` feat(cảnh báo): kênh Telegram cho cảnh báo hệ thống — mặc định TẮT, bật thì thay hẳn email
- `24720e6` fix(cảnh báo): awk bóp méo giá trị SMTP IM LẶNG — và bộ kiểm chỉ đọc văn bản script
- `ea67f2b` fix(GDPR): bản xuất bị CẮT mà không khai — và khối giới hạn còn khẳng định ngược lại
- `fcdf780` fix(test): hook dựng CSDL bóng hết giờ ở trần 30s — chi phí bò theo số migration
- `35511fa` fix(test): hai bài nặng CPU hết giờ ở trần 20s khi cả bộ chạy song song
- `83b994e` fix(SPA): ô ngày nhận chuỗi ISO đầy đủ — hiện đúng chỉ nhờ Chrome dễ dãi
- `8676e34` fix(xuất file): cổng xuất ĐẾM DÒNG, không chỉ đếm suất — 3 lượt lớn cùng lúc là HỎNG CẢ BA
- `31894c8` fix(báo cáo): doanh thu ĐỌC số đã chốt — cột convertedTotal được ghi mà KHÔNG ai đọc
- `b36e121` fix(xuất Excel): BỎ nhãn danh xưng "Ms." nhúng cứng trong file mẫu
- `9c6b461` fix(chốt báo giá): BẮT quyết từng trang — không cho chốt khi còn trang chưa ai duyệt/từ chối
- `a0fbcee` fix(chốt báo giá): doanh thu TRỪ trang khách không duyệt, và nút nói rõ nó áp cho CẢ báo giá

## 2026-09-16

- `45853bd` docs: số tệp test web 24 → 25, và ADR giữ nguyên con số CŨ vì đó là số lịch sử
- `a1e4892` docs(chú thích): validators.ts khai "SPA chưa nối nút xuất nền" — lời khai đó đã SAI từ 2026-08-27
- `766a59a` fix(test): bài Bearer-không-sinh-phiên CHẬP CHỜN — đo hiệu số ròng trong khi có tác vụ dọn nền
- `35e8c10` perf(lưới): bỏ ghi–đọc xen kẽ trong autoGrow — 1.627 ms → 81 ms trên máy yếu
- `98cb686` fix(sẵn sàng): /readyz có pool RIÊNG — pool cạn không được kéo cả hai replica ra khỏi tải
- `bfbfed5` fix(GDPR): trần dòng cho bản xuất — nhưng KHÔNG từ chối quyền truy cập dữ liệu
- `e222ead` perf(tạo báo giá): bộ đếm số không còn bị khoá suốt lượt tạo — 22% → 79% thời gian rảnh
- `798e2f5` fix(xuất nền): trần thời gian RIÊNG 90s — thay vì siết trần kích thước và nhốt dữ liệu cũ lại
- `9d75652` feat(ngân sách lưu): 40.000 dòng đang bay — và sửa lời khuyên ĐANG dẫn thẳng tới oom-kill
- `4808375` feat(bộ nhớ): trần container 1,5→3 GB và heap V8 đi CÙNG nó — cả compose, k8s lẫn Helm
- `79782ef` fix(giám sát): mount THƯ MỤC thay vì tệp lẻ — cấu hình mới chưa từng tới được container
- `d54ace6` docs: README ghi 210 file test, repo có 211 — cổng repo-stats bắt đúng
- `440b2ca` feat(cảnh báo): Alertmanager — cảnh báo ĐI TỚI được một con người, không dừng ở màn hình
- `a57b6ba` feat(chống phình): trần TỔNG cho cột extraTables — nhưng vẫn cho GỠ ảnh
- `8ce139e` feat(chống sập): đường ĐỌC báo giá cũng có trần đồng thời — GET 0 byte lặp vô hạn được
- `a57ce01` docs: giám sát ĐÃ BẬT trên production — sửa lời khai "chưa kích hoạt"
- `2765363` fix(cổng): [1b] báo "lỗi lúc nạp file" mà KHÔNG in thông điệp — bổ sung cấp suite
- `c64d891` fix(cổng): bản vá "khai lý do" của chính tôi làm verify CHẾT ở [11] — sai tên biến
- `e789615` fix(cổng): [11] docker-smoke và [12] ui-smoke cũng nuốt lý do — in 25 dòng cuối khi đỏ
- `b20fefd` fix(cổng): [S4] SBOM đếm 0 thành phần tuỳ CÁCH GỌI script — đường dẫn MSYS lọt vào node
- `7d685e9` fix(chống sập): chặn file Excel quá nhiều dòng TRƯỚC khi exceljs nạp — hai bản vá trước KHÔNG đủ
- `97d0a14` fix(cổng): [13] bảo mật đỏ mà KHÔNG nói vì sao — in 30 dòng cuối khi đỏ
- `7bb6419` fix(cổng): tách bài xoay khoá PII ra chạy riêng — và chặn luôn cái bẫy "xanh vì bỏ qua"
- `a8ec57e` fix: ba cổng đỏ sau đợt chống-sập — một là lỗi THẬT của bản vá, hai là hệ quả
- `dac6027` feat(chống sập): chặn ba đường OOM đã TÁI HIỆN được, và sửa cảnh báo đang mù
- `ee9849f` docs(env): khai DB_STATEMENT_TIMEOUT + DB_IDLE_TX_TIMEOUT vào .env.example
- `c240f0c` fix(cổng): verify ĐỎ NGẪU NHIÊN vì cạn kết nối Postgres, không phải vì mã
- `91d1d40` feat(csdl): phanh thời gian ở Postgres + cảnh báo sớm khi kết nối sắp cạn
- `59e8e0a` docs: ui-smoke nay 19 bước — vá 8 chỗ còn ghi 18, và thêm [U15b] vào bảng liệt kê
- `b76c267` fix(ha-noi): bấm "Lưu" MỘT lần sau khi gõ giá KHÔNG lưu gì — mà màn hình vẫn hiện số mới
- `a66877b` fix(cổng): [1b] TOAST đỏ mà KHÔNG nói vì sao — moi `failureMessages` ra
- `dbfbefb` fix(cong): ui-smoke đọc TỆP ĐÃ TẢI, không đọc `response.body()`
- `85fdb63` chore(deps): ĐO THỬ nâng gói — CHƯA MERGE, nhánh nháp
- `73a80d5` docs: tự bác bỏ một "lỗi production" mà chính tôi vừa ghi vào REMAINING_RISKS
- `e75c0aa` fix(ha-noi): màn account HN hiện HAI con số tiền đá nhau khi đang gõ
- `c509770` fix(test): b3-import-concurrency đỏ vì ĐUA GHI PHIÊN trong helper CSRF, không phải vì phễu
- `e6993b4` docs: AGENTS.md + CLAUDE.md — khai cổng changelog, ghi chú graphify, vá số liệu trôi
- `0065eab` docs: sinh lại CHANGELOG từ lịch sử git
- `875c826` docs: soát lại tài liệu cho khớp mô hình MỚI của phần Hà Nội và account phụ
- `c16c674` fix(soi): đóng 7 lỗ còn hở của hai vòng soi đối kháng — production đang chạy thật

## 2026-09-15

- `d18b428` fix(bao-mat): gitleaks trong cổng chưa từng đọc được repo — và 6 "phát hiện" là báo nhầm
- `4600def` fix(bao-mat): vá 9 lỗ HIGH + 3 lỗ vừa — không lỗ nào còn bản vá mà chưa dùng
- `ec5f9b1` fix(cong): cổng bảo mật chưa từng chạy được trên Windows — vá rồi mới thấy 9 lỗ HIGH
- `9600f7c` fix(cong): smoke "artifact production" phải CHẠY Ở production, không mượn env của người gọi
- `60ee147` fix(ha-noi): vá 8 lỗ vòng soi đối kháng tìm ra trong chính bản chuyển HN
- `caf3a6f` feat(ha-noi): phần Hà Nội lên CẤP BÁO GIÁ — account HN có trình soạn riêng, đầy đủ
- `7c3c095` fix(cong): `**` trong pathspec git bỏ sót tệp nằm THẲNG trong web/src
- `f84a4ff` feat(bao-gia): "account phụ" — thêm người vào MỘT báo giá kèm phạm vi sửa 4 vùng

## 2026-09-09

- `e30ff8f` fix(test): vá 3 bài đỏ sau đợt fix ultracode audit 2026-09-09
- `8a8a106` docs: cập nhật số tệp/bài test web (22→23, 293→307) sau khi thêm App.draftleak.test.ts
- `5a9cdef` docs(bao-mat): sửa 2 lỗi đang làm npm run verify đỏ + cập nhật tài liệu theo PII cutover
- `20f4cec` fix(bao-mat): siết PII_ENC_KEY (khi đã đặt) ngang SESSION_SECRET/JWT_SECRET [LOW]
- `4e6a88a` fix(bao-mat): bản nháp lộ sang người khác [M-DRAFT] + tự gỡ MFA không thu hồi phiên/mã [F1/F2, LOW]
- `fc82173` fix(bao-mat): Cache-Control no-store mặc định cho mọi /api/* [MEDIUM]
- `7330b9e` fix(ha-tang): thêm MinIO vào docker-compose.staging.yml [MEDIUM]
- `ef4b8fb` fix(hang-doi): processor Telegram phải NÉM khi gửi hỏng [MEDIUM]
- `f1529a2` fix(bao-gia): reviewHn (duyệt/trả giá Hà Nội) nguyên tử [MEDIUM]
- `1caecd3` fix(quan-sat): chuẩn hoá nhãn method của Prometheus — chống nổ cardinality [HIGH]
- `19c5815` fix(sao-luu): mc() gắn đúng network của MinIO thay vì --network host [HIGH]
- `f6c6340` fix(hang-doi): xuất-nền/poll có trần thời gian cho lệnh Redis [HIGH]
- `2783532` fix(nhan-su): giải mã PII trước khi in hợp đồng + tính tổng lương [HIGH]
- `10dc5b3` fix(bao-mat): zipSafety giải nén THẬT thay vì tin số khai trong metadata [HIGH]

## 2026-09-08

- `03048f1` feat(quan-tri): nạp pg_stat_statements cho Postgres (prod + staging)
- `6a7bc05` fix(bao-mat): trần request đặt TRƯỚC giải nén + JSON.parse [HIGH]
- `2dd14df` fix: 3 lỗi cuối vòng 2 — bộ đếm mã dự án · lịch prune · tải .docx [MEDIUM]
- `5552919` perf(truy-van): kiểm quyền thôi kéo cột base64 nặng (2 chỗ) [MEDIUM/LOW]
- `3134e1a` fix(mfa): mã dự phòng đã tiêu không sống lại khi hai mã dùng song song [LOW]
- `57da616` fix(bao-mat): xoá bản nháp cục bộ khi Đăng xuất / bị thu hồi phiên [MEDIUM]
- `e90c92f` fix(bao-gia): tích thanh toán dòng nội bộ không còn tự đâm 409 giả [HIGH]
- `f582296` fix(hang-doi): xếp việc có TRẦN thời gian — Redis chạy-nhưng-chết không treo lượt Lưu [HIGH]
- `5ecc63e` fix(bao-gia): mốc nước mã sản xuất — không cấp lại mã sheet đã phát hành [HIGH]
- `60e4e23` fix(xuat-file): ghép sheet ghi đè trang 1 · CCCD trong log · 4 lỗi từ ultracode vòng 2
- `497eaf2` fix(ha-tang): minio đạt cổng b7/ic (ghim digest + trần RAM/CPU) · khai PII_PLAINTEXT_CUTOVER
- `fc053c2` feat(bao-mat): cutover PII (ngừng ghi cột thô) + dựng MinIO trên production
- `6f38786` docs(env): khai SSE_MAX_LIFETIME_MS ở .env.example (cổng b8-env-drift)
- `2ca8c8c` fix(ui): 5 lỗi UX bàn phím/trạng thái từ ultracode audit 2026-09-07 [MEDIUM×4, LOW×1]
- `7d44e88` fix(bao-gia): hệ số Số Ngày chuẩn hoá theo MẪU ở server, trước khi tính tiền [MEDIUM]
- `bf3ade7` fix(sse): thu hồi phiên ĐÓNG socket thật · tuổi thọ tối đa 30 phút/kết nối [MEDIUM]
- `d80cd00` fix(gdpr): self-export kẹp phạm vi quyền hiện tại [MEDIUM]
- `8e469d9` fix(tep): sign-download namespace exports/ đòi cả quote:export [MEDIUM]
- `9ff7c47` fix(dang-nhap): trần đăng nhập khoá theo TÀI KHOẢN, không theo IP · 401 mfaRequired không tính là sai [MEDIUM]
- `be163f8` test(mfa-reset): kiểm thẳng SQL của destroyAllSessions thay vì qua HTTP
- `f4f6cb2` fix(a11y): wizard tạo báo giá dùng được bằng bàn phím [HIGH]
- `3f83325` fix(bao-mat): /api/csrf-token vào chung trần rate-limit apiLimiter [HIGH]

## 2026-09-07

- `45cb7f3` fix(nhan-su): gỡ MFA hộ huỷ phiên thật · cắt PII khỏi 3 đường ghi riêng lẻ [HIGH]
- `2b69ba4` fix(bao-gia): chặn sửa số tiền hàng đã duyệt qua chép rid [CRITICAL]
- `61848d0` fix(tai-khoan): chặn tự kích hoạt lại tài khoản đã bị khoá qua "Quên mật khẩu" [CRITICAL]
- `b5828c5` fix(mat-khau): chặn mật khẩu phổ biến (password1, admin123…)
- `db4f6be` fix(dang-nhap): lớp phủ "phiên hết hạn" không tự đóng dù phiên vẫn sống
- `37f6d0c` fix(tai-khoan): gỡ ngõ cụt "quên mật khẩu" · hàng đợi email thôi nuốt lỗi · báo đúng lý do gửi hỏng
- `68947be` fix(xuat-file): bỏ tiền tố "BaoGia_" thừa · danh sách hiện tiêu đề rút gọn
- `1db2d61` feat(bao-gia): năm tính theo GIỜ VN · tiêu đề rút gọn · tên file tải về theo mã KH
- `13a6565` feat(ma-du-an): năm do hệ thống tự thêm · mã sheet ĐÓNG BĂNG trong CSDL · khoá sửa theo hoá đơn
- `23da0bf` fix(import): bỏ thẻ "Công thức Excel" khi không mất công thức nào
- `b5d1da8` fix(bao-gia): tổng từng sheet là số ĐÃ TRỪ discount + vá 3 lỗi nhập từ Excel
- `ce610f4` fix(deploy): dọn file mồ côi cả trong web/src — deploy vừa chết vì 19 file không còn trong repo
- `c54c555` feat(bao-gia): Discount theo TỪNG SHEET, trừ TRƯỚC khi tính VAT

## 2026-09-04

- `751a4e2` fix(excel): công thức nhóm lồng nhau ở template banner ra đúng số của lưới web

## 2026-09-01

- `ad017aa` fix(ui): bỏ `body:has()` khỏi CSS toast — nó đua với cú bấm trên thanh dính
- `98246b3` feat(ui): gộp nút "+ Thêm hàng…" và nút Lưu vào MỘT thanh dính đáy
- `93cd05a` fix(deploy): ÉP recreate + đối chiếu ảnh — deploy đang báo thành công cho việc chưa xảy ra
- `ce87109` chore(test-on-dev): in cả số BÀI test và danh sách bài bị bỏ qua
- `5eb20f3` fix(ci): cổng check:docnum chạy được trên Windows + đồng bộ 10 con số tài liệu
- `f553730` fix(test): bộ chạy trên dev thật sự chạy ĐỦ — 14 file đỏ còn 0
- `10c70af` fix(audit): thêm `user.mfa.reset` vào bộ lọc Hoạt động của trang Nhật ký
- `9cfa6a4` chore(test-on-dev): in DANH SÁCH FILE ĐỎ, không chỉ 20 dòng cuối log
- `5356e03` fix(deploy): dọn file MỒ CÔI trong src/ + shared/, không chỉ .js bị .ts thay
- `5e1ef6e` fix(ratelimit): keyGenerator theo IP phải gom prefix IPv6, không dùng req.ip thô
- `e388cfe` fix: 8 lỗi nghiệp vụ của nhánh hardening + bộ test chạy được trên Windows

## 2026-08-31

- `846934a` docs: 39/39 cổng xanh sau khi nối 4 cổng vốn chỉ sống trong ci.yml
- `cdbae11` Soát lại bằng chính thước đo cũ — và nó bắt được một lỗi do bản vá trước SINH RA
- `75d3130` docs: đóng số bài backend còn để ngỏ — verify 35/35 xanh trọn
- `7859eb6` GridTable lần đầu có bài kiểm mức component, và một cổng chặn số liệu tài liệu trôi

## 2026-08-28

- `af932e4` GridTable lần đầu có bài kiểm mức component, và một cổng chặn số liệu tài liệu trôi
- `7142903` chore(sync): web — giao diện React (lô 2/6) [c/4]

## 2026-08-27

- `4a06f75` docs: đóng số bài test còn để ngỏ trong báo cáo §53
- `acf13b2` Vá hai cổng đỏ mà lượt verify trọn bắt được từ chính bản vá trước
- `3ef9639` Đóng 28 mục còn hở của prompt — và ba vòng soát bắt được lỗi của chính bản vá
- `0ae6535` chore(sync): web — giao diện React (lô 2/6) [b/4]
- `ce12f01` chore(sync): web — giao diện React (lô 2/6) [a/4]
- `29dc7fa` chore(sync): src — sửa 4 dòng chú thích quoteService.ts cho khớp từng byte (lô 1/6) [d-fix/4]
- `5f25d0a` chore(sync): src — mã nguồn backend (lô 1/6) [d/4]
- `0236af4` chore(sync): src — sửa 3 dòng chú thích middleware.ts cho khớp từng byte (lô 1/6) [c-fix/4]
- `a8891d0` chore(sync): src — mã nguồn backend (lô 1/6) [c/4]
- `a98189d` chore(sync): src — mã nguồn backend (lô 1/6) [b/4]
- `3765c14` chore(sync): src — mã nguồn backend (lô 1/6) [a/4]
- `90338f4` Vá lỗ bảo mật còn sót, chặn migration Prisma xoá index, và ba file root §32 còn thiếu (phần 4/4)
- `5e975e2` Vá lỗ bảo mật còn sót, chặn migration Prisma xoá index, và ba file root §32 còn thiếu (phần 3/3)
- `32f9908` Vá lỗ bảo mật còn sót, chặn migration Prisma xoá index, và ba file root §32 còn thiếu (phần 2/3)
- `1fa7651` Vá lỗ bảo mật còn sót, chặn migration Prisma xoá index, và ba file root §32 còn thiếu (phần 1/2)
- `2be2109` docs: sinh lại CHANGELOG theo lịch sử git
- `eb782c4` docs: báo cáo tổng kết theo §53 (A–L), sau khi verify 13 bước xanh trọn
- `3925941` docs: đối chiếu lại phần "PHASE 4 hụt hẳn" — nó không còn đúng, và Excel import xếp lại là KEEP
- `3f5f52e` docs: sinh lại CHANGELOG theo lịch sử git
- `81e1f51` §9 phân trang một chỗ · §2 khoá ranh giới bằng cổng thay vì đổi cây thư mục · §0 hai loại nhãn còn thiếu
- `97cc155` Đo trước rồi mới sửa: lưu báo giá nhanh 3,5× · index còn thiếu · log đủ trường · Loki+Grafana
- `4b7a56b` Ba khoảng trống hồi quy được vá: IME tiếng Việt, phiên hết hạn, và bản nháp cục bộ
- `5d75a8c` docs: sinh lại CHANGELOG theo lịch sử git
- `9fa4892` E2E đi hết luồng người dùng — và phát hiện bundle giao cho người dùng là BẢN DEV của React
- `9fa1064` Vá lỗ bảo mật còn sót, chặn migration Prisma xoá index, và ba file root §32 còn thiếu
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
- `3cf83c2` docs(security): ghi lại đợt rà soát 2 + cập nhật số liệu thật
- `649aa05` security(files): tách vùng tạm — chống ghi đè SAU khi đã xác minh (TOCTOU)
- `abcff4b` test(auth): khoá TÍNH CHẤT chống dò tài khoản thay vì khoá lỗ hổng
- `76994ce` security(session): vô hiệu hoá phiên bằng mốc thời gian, không phụ thuộc kho phiên
- `19761c0` security: đợt rà soát 2 — vá 7 lỗ, gồm 2 lỗ trong bản vá đợt 1
- `e377989` docs(security): cập nhật báo cáo theo kết quả kiểm chứng THẬT
- `25e7de2` feat(pii): nền mã hoá PII khi lưu trữ — cơ chế + cột (bước 1/6)
- `47c354a` fix(crypto): ghim độ dài thẻ xác thực GCM — chặn giả mạo bằng thẻ cắt ngắn
- `3bc7e5c` chore(scan): dọn phát hiện của gitleaks/trivy — allowlist hẹp + hardening k8s
- `283a609` fix(files): kiểm quyền TRƯỚC khi kiểm cấu hình lưu trữ
- `62365d1` fix(build): postinstall codex-security không được làm gãy npm ci
- `bfb2427` security: vá rò rỉ còn lại + 45 ca test hồi quy + dọn CI
- `3764a58` chore: gitignore ảnh chụp + script kiểm bố cục modal nhập Excel
- `1a23ca3` fix(ui): chữ trong ô 'Cách nạp' bị cắt ở màn hẹp
- `1e39aed` fix(ui): checkbox trong modal bị kéo rộng 100% làm vỡ nhãn
- `3f480cc` feat(import): cho nạp vào SHEET MỚI khi file nhiều sheet hơn báo giá
- `318aa13` fix(ui): vỡ bố cục bảng "Sheet trong file" ở modal nhập Excel
- `b0d58cf` security: chặn mặc-định-từ-chối cho phạm vi đọc + bỏ tài khoản admin ẩn
- `34c0bc3` fix(ui): bỏ chặn thừa khi ghi ý kiến khách + gộp thông báo trùng
- `2ef5abf` fix(docker): copy scripts/ vào deps stage — postinstall làm gãy npm ci
- `6eb4dee` chore(repo): dọn phần cài BMAD/codex-security cho khỏi gãy build Docker
- `a749154` feat(import): nạp file Excel khách gửi lại vào báo giá + khách duyệt từng sheet
- `865f6a5` feat(grid): lưới báo giá đúng chuẩn thao tác Excel — đủ 3 chế độ ô, gõ là đè

## 2026-08-05

- `0f34948` feat(venues): làm lại trang theo kiểu DANH BẠ — bỏ hết thứ sinh ra từ file Excel
- `956433a` fix(venues): gom cách viết trùng của khu vực khi nạp danh mục
- `01e9d81` feat(venues): thiết kế lại trang Danh mục rạp + từ khóa nhanh do người dùng đặt

## 2026-07-30

- `8ccedd1` chore: gitignore agent/editor state directories
- `34ca9ba` docs: correct auth/stack details in README
- `debcffc` docs: portfolio-facing README; move internal docs under docs/

## 2026-07-28

- `1d9cf80` fix(authz): gác quyền quote:create ở server + chặn route trình soạn ở frontend
- `d3f5905` fix(grid): sau Ctrl+Z/Ctrl+Y, ô đang gõ vẽ lại theo model
- `45b2f9d` fix(grid): Ctrl+Z hoàn tác được việc gõ ô + Esc trả tổng về đúng ngay
- `dcb26a6` docs: HANDOFF.md — bàn giao trạng thái phiên (prod/dev/commit, việc đã xong, việc dang dở, quy ước)
- `5ec5f5d` fix(grid): bấm ra ngoài bảng thì BỎ tô vùng chọn (ô về màu bình thường)
- `c25ebad` fix(grid): Ctrl+A khi ĐANG SỬA bôi đen chữ trong ô (không nuốt thành chọn cả bảng) + đồng bộ khóa ô
- `5b97857` feat(grid): ô lưới KHÓA khi chỉ được chọn — bấm nhầm/đè bàn phím không sửa được gì
- `08cc3b2` feat(grid): thao tác Excel đầy đủ hơn — mọi ô nhập click-1-lần là CHỌN, Enter/Tab chạy trong vùng, Alt+Enter xuống dòng, Ctrl+Shift++ chèn hàng / Ctrl+- xóa hàng
- `6e7dc71` fix(grid): nhấp đúp đặt con trỏ đúng chỗ + vùng chọn tô liền qua hàng nhóm
- `03d4e52` feat(quotes): bỏ cột Chi Tiết + thao tác ô lưới chuẩn Excel (Windows & macOS)

## 2026-07-26

- `0d76d89` fix(venues): xem trước m² dùng qtyRound — khớp đúng số app điền vào ô Số Lượng
- `14fd879` fix(venues): nhãn nhật ký cho rạp/hạng mục + bump ?v SPA sau khi đổi nguồn dữ liệu
- `c1abeb7` feat(venues): danh mục kích thước theo rạp vào DB + trang quản lý (thêm/sửa/xoá/gộp)
- `81dfc07` feat(quotes): port gợi ý kích thước theo rạp sang editor React (/app2)

## 2026-07-24

- `cba8971` feat(quotes): gợi ý kích thước theo rạp khi tạo báo giá (demo trên SPA)

## 2026-07-22

- `3385402` chore: gitignore file tạm đo modal
- `ca44184` fix(ui): modal co theo nội dung (Danh bạ 262px, Thêm hồ sơ hẹp) — backdrop grid thiếu cột
- `a898ea4` chore: gitignore e2e-birthdate.mjs
- `7f3f53c` fix(hr): Ngày sinh thành LỊCH CHỌN NGÀY ở form Danh bạ + Nhân sự — hết cảnh chỉ nhập năm
- `a7de71d` feat(invoices+hr): nhấp đúp mới sửa ô Hóa đơn (chống sửa nhầm) + Ngày sinh đủ dd/mm/yyyy cho HĐ
- `58b9525` chore: gitignore e2e-contract.mjs
- `7448fdf` feat(personnel): nút TẢI HỢP ĐỒNG DỊCH VỤ (.docx) sinh từ mẫu công ty + dữ liệu hồ sơ

## 2026-07-20

- `db8c8b1` feat(invoices): add smart and quick filters
- `d6f074c` fix(personnel): align and pin table action buttons
- `78572a3` feat(personnel): make contract name independently editable
- `d9dfae3` fix(invoices): highlight every empty input cell

## 2026-07-16

- `e974e20` feat(invoices): bỏ ô ngưỡng nợ toolbar (hạn đã set riêng từng công ty) + thêm lọc theo THÁNG
- `32dda7a` chore: gitignore file tạm test freeze
- `884fa8a` fix(invoices): nới cột Tình trạng HĐ 112->132px — badge "Hoàn tất" hết bị cắt
- `2461f4c` feat(invoices): đóng băng 5 cột đầu như Excel freeze panes (đến Tình trạng HĐ) + gạch dọc ranh giới
- `3295ba7` chore: gitignore file tạm verify UI
- `68ac639` feat(ui): đồng bộ + chuyên nghiệp hóa toàn bộ giao diện React (trừ trang tạo báo giá)

## 2026-07-13

- `52d0b5d` chore: gitignore file tạm E2E (inv-v2.png, e2e-invoice-v2.mjs)
- `de7f08a` feat(customers): hạn CÔNG NỢ RIÊNG từng công ty — trang Hóa đơn báo đỏ theo hạn của khách
- `e4581aa` feat(sign): badge Ký hiện thẳng TÊN + NGÀY ký (✓ Tên · dd/mm/yyyy) ở cả Dự án lẫn Hóa đơn
- `094e2d5` feat(invoices): công nợ + ký chứng từ + ngày thanh toán + nhắc ngày thiếu

## 2026-07-06

- `43dc5dd` fix(security): vá 10 lỗ hổng từ audit bảo mật đa-agent (2026-07-06)
- `05ab048` fix(docker): prepare 'husky 
- `9f7179e` chore(tooling): ESLint phủ TypeScript + react-hooks; Prettier + Husky/lint-staged pre-commit; vá 9 lỗi lint thật
- `bc18d12` refactor(web): tách web/src phẳng → pages/ (16 trang) + components/ (Shell, GridTable, ExtraTables) + lib/ (api, ui, query, toán tiền…)
- `628866d` refactor(service): hoàn tất tầng service — auth/mfa/audit/search/meta hết gọi Prisma trong route; quoteService.ts về đúng src/services/
- `fcca604` fix(hóa đơn): lưu xong invalidate cache quoteProjects — trang Dự án/Dashboard tham chiếu thấy ngay giá trị mới
- `7a3dc6b` feat(hóa đơn): trang HÓA ĐƠN cho kế toán (thay bảng Excel) — QLDA chuyển thành THAM CHIẾU read-only
- `3e45b58` feat(chuyển đổi công nghệ)!: PRODUCTION chính thức chạy app REACT tại gốc "/" (bỏ gate hostname)
- `8bc6bf7` chore(cache): bump style.css ?v → 20260706d (11 mục UI review sửa style.css nhưng quên bump — SPA sẽ dính cache cũ)
- `58b8206` fix(vụn vặt): menu "⋯" thao tác báo giá + ẩn pager 1 trang + link Chi tiết đều
- `0252473` fix(route): thống nhất namespace báo giá + redirect #/quotes/new và #/quotes
- `67f30fe` fix(wizard b2): thẻ mẫu hiện mô tả thân thiện thay codename nội bộ
- `e30e5c9` fix(dashboard): biểu đồ doanh số dạng CỘT theo tuần/tháng (hết phẳng-1-spike)
- `d445df1` fix(dashboard): kỳ trước rỗng → KPI hiện "—" thay vì "▲ mới" tràn lan
- `43706c1` fix(thông báo): nhãn loại thân thiện thay token "quote" + khử trùng lặp (2 lớp)
- `9df0600` fix(chức danh): rút gọn placeholder cho vừa ô hẹp (Tài khoản / Onboard / wizard b3)
- `7de1308` fix(tài khoản): thanh độ mạnh mật khẩu chỉ hiện khi gõ + tách khỏi label "Nhập lại"
- `5afaeb1` fix(nhân sự): ghim tổng Σ vào ô "Tổng" luôn hiện (dòng tổng không còn trống)
- `d70900b` fix(nhân sự/danh bạ): guard quyền ở frontend + thẻ mobile (Danh bạ) — layout responsive, không lộ trang
- `c5151e7` fix(dự án): cột STATUS không cắt chữ 'Thanh toán' — nới cột 1 (92→132px), pill nowrap
- `ca9e4c8` fix(retarget): dữ liệu TUẦN HOÀN — tie-break khoảng-cách-ref chọn đúng diễn giải (không lệch chu kỳ)
- `b0ef81d` feat(paste): TỰ DỊCH công thức Excel trong khối dán → toạ độ web; ca không chắc → Ô ĐỎ sửa tay
- `37ce9e4` feat(fx→Excel): công thức tham chiếu THÀNH TIỀN xuất được ra Excel (chặn vòng bằng đồ thị phụ thuộc)
- `3efbd30` fix(ảnh Excel): xếp DỌC 1 ảnh/tầng — hết đè nhau (vị trí không phụ thuộc bề rộng cột); khung 74px, tự thu khi nhiều ảnh (trần 409pt)
- `73900a6` feat(ảnh): cột "HÌNH ẢNH" theo TỪNG HẠNG MỤC (bật/tắt mỗi sheet) + nhúng thật vào Excel + ESC thoát ô

## 2026-07-01

- `fbb9fe9` fix(fx): SÁNG ô tham chiếu cho công thức nhóm (đơn giá nhóm là ô TÍNH, không có input)
- `07f9498` fix(banner): double-click ĐƠN GIÁ nhóm CHA hiện công thức =SUM(đơn giá nhóm con)
- `fa8da52` fix(paste): GN (không ngày) — nhận NHÓM CON theo STT TRỐNG (kể cả có ĐVT/giá)

## 2026-06-30

- `76e952d` feat(banner): ĐƠN GIÁ nhóm CHA = tổng các nhóm con (cuộn lên 1 cấp)
- `99ad4ef` feat(SL): LÀM TRÒN Số Lượng về 1 chữ số thập phân (bỏ cắt-2-số)
- `d47c342` fix(paste): SỐ LƯỢNG "13.524" bị đọc thành 13524 → tổng sai gấp NGÀN lần
- `abc919a` fix(paste/Mac): nhận export khi Excel-Mac bỏ cột rỗng cuối (maxCols == fieldCount)
- `9ade4a3` fix(paste): đọc HÀNG TIÊU ĐỀ để map cột + nhận nhóm con theo DATA — dán đúng dù khác template
- `2dac9d4` fix(paste): tự bỏ hàng tiêu đề cột "STT
- `5577b74` feat(bảng nội bộ - React): tên loại đang chọn TO + đậm + nhãn 'Đang ở: <loại>' tô màu theo loại
- `215a9f6` feat(bảng nội bộ - React): lưới nằm NGAY trong loại đang chọn (rõ "đang ở đâu")
- `2203664` feat(màu): lưới web editor theo công ty — màu mới chỉ cho Gia Nguyễn, Colorfull giữ màu cũ
- `48e4813` fix(paste): template Banner dán từ Excel nhận đúng nhóm con (đánh SỐ) — không vỡ mẫu cũ
- `7ecfa5b` fix(màu): màu MỚI chỉ cho Gia Nguyễn — Colorfull (clofull) giữ màu cũ trong Excel
- `d8e87ee` feat(màu): đổi nền hàng tiêu đề (header) → #f3c9a1 (web SPA + React + Excel mọi mẫu)
- `429707c` feat(màu): đổi nền nhóm chính #fae9db + nhóm con #c9d9ef (web SPA + React + Excel khớp nhau)
- `ae69e8a` feat(báo giá): bấm sang ô khác tự về số (như Excel) — auto-revert công thức đang hiện
- `0dc0f7a` feat(báo giá): hiện công thức NGAY TRONG ô khi bấm đúp (toggle) — SPA + React
- `746ee6c` fix(cache): bump ?v= editor.js + app.js → 20260630a (SPA nhận double-click mới, hết kẹt cache CF)
- `dc21e10` feat(excel): công thức SỐNG cho dòng nhóm + subtotal — khách sửa SL/ĐG là tự tính lại cả tổng
- `6c7c56a` feat(báo giá): bỏ "ⓘ giải thích", thay bằng double-click ô khóa xem công thức (như Excel)
- `d45af9a` feat(báo giá): đánh số sheet (1. 2. 3.) + tiêu đề từng sheet nối tên sheet ra Excel

## 2026-06-26

- `f8437f8` feat(authz): nút XEM THỬ — admin trải nghiệm app với quyền 1 tài khoản (sandbox, không lưu thật)
- `6e9a7ea` feat(authz): nâng cấp khung XEM TRƯỚC quyền — gom năng lực theo nhóm + đếm số quyền (giám đốc đọc 1 phát hiểu)
- `359a7e9` feat(bảng nội bộ): màn hình CHỈ XEM NỘI BỘ (quote:internal:view) — tài khoản chi phí
- `3460569` feat(authz): ADMIN default += quote:internal:pay (toàn quyền đánh dấu thanh toán nội bộ)
- `a0346e2` feat(bảng nội bộ - frontend): cột THANH TOÁN per-hàng + dialog up ẢNH trong lưới nội bộ (quote:internal:pay)
- `e8dfa41` feat(bảng nội bộ - backend): thanh toán per-HÀNG + ảnh + quyền internal:view/pay (an toàn, additive)
- `c10ea04` test: cập nhật permissions.test sang quyền atomic (personnel edit/delete; canScoped customer edit) sau khi tách
- `bb62e9a` feat(authz): tách quyền NGUYÊN TỬ khách hàng/nhân sự/danh bạ (create/edit/delete riêng) + bỏ duplicate/members thừa
- `6bc3f1c` feat(authz): tách invoice:manage → invoice:edit (sửa HĐ) + invoice:pay (đánh dấu thanh toán) RIÊNG
- `331e7cf` feat(authz): XEM TRƯỚC quyền — tích xong hiện ngay 'tài khoản này thấy menu gì + làm được gì' (giám đốc duyệt nhanh)
- `142b5eb` fix(authz): bỏ nhóm 'Sản phẩm' khỏi ma trận quyền (app không có tính năng sản phẩm — quyền thừa) + preset lọc quyền ẩn
- `3652b69` feat(authz Phase D#1 + hoàn thiện ma trận): kế toán xem/sửa hóa đơn + gộp KÝ vào ma trận + mô tả + vá role-cứng
- `c855b6c` feat(authz Phase C): UI TÍCH QUYỀN per-user khi tạo/sửa tài khoản (bỏ chọn vai trò)
- `57f6c73` feat(authz Phase B): chuyển hard-code role → QUYỀN (hệ thống permission-driven hoàn toàn)
- `153784f` feat(authz Phase A): nền PHÂN QUYỀN PER-USER — User.permissions là nguồn quyền, ghi đè role
- `dbe732a` fix(test): size 100 (≤ MAX_PAGE_SIZE) cho 3 test audit mới + bổ sung nhãn field Việt (email/họ tên/CCCD/ngân hàng…) cho chi tiết nhật ký
- `44a740b` feat(nhật ký): hiện TÊN thật đối tượng (admin) + chi tiết thay đổi trước→sau; đổi 'Danh bạ nhân viên'→'Danh bạ nhân sự'
- `54c6922` fix(docker): copy public/style.css vào webbuild stage (Vite import design-system cần file ngoài web/, như shared/)
- `eb887da` refactor(css): import design-system /style.css vào bundle Vite (tự hash) thay <link ?v=> gõ tay
- `4099705` fix(cache): bump ?v=20260626c cho /style.css — buộc browser tải CSS mới (fix layout topbar mobile bị cache immutable 1 năm)
- `e7074c1` fix(UI mobile): shell dùng FLEX column thay grid (grid auto/1fr bị quirk kéo giãn topbar khi trang ngắn) — topbar đúng chiều cao mọi trang
- `9567a2c` fix(UI mobile): topbar bị KÉO GIÃN cao bất thường khi trang ngắn (.shell grid thiếu rows → align-content stretch lấp 100vh vào hàng topbar). Thêm grid-template-rows: auto 1fr
- `ec2acb1` fix(UI): ô tìm toolbar cao bất thường trên mobile (.grow flex-basis 220px thành chiều cao khi toolbar đổi cột)
- `ce3b125` feat(UI): Danh sách báo giá — responsive THẺ React (mobile) + nút thao tác ICON gọn (hết xếp dọc xấu)
- `4662c3c` feat(UI): hoàn thiện Tổng quan + tìm kiếm thông minh + dọn Quản lý nhân viên
- `d47d5bc` feat(HR): sửa-tại-chỗ theo ROLE + thanh toán kèm ẢNH + form lọc theo role + responsive thẻ mobile
- `10b201c` fix(RBAC động): khóa 5 quyền cấp-quản-trị trong ma trận (cấp cho non-admin vô tác dụng → honest UI)

## 2026-06-25

- `38245d6` fix(test): tắt rate-limit trong NODE_ENV=test (limiter Redis chung gây 429 giả khi chạy song song)
- `eb11398` feat(RBAC động A): admin sửa quyền vai-trò sẵn có qua giao diện (ghi đè DB)
- `5f47be1` feat(realtime Mức 1): xử lý 409 ghi-đè rõ ràng + presence 'X đang sửa báo giá này'
- `37005f3` test(GD1): fix retention.test beforeAll — Quote.createdById bắt buộc (tạo user trong DB test sạch)
- `d53bae3` test(GD1): +11 integration test phủ logic mới — retention prune / Personnel tìm-không-dấu / audit before-after
- `2ffa8b9` test(GD1 #6): Excel regression-lock — golden semantic snapshot 5 mẫu/cấu trúc (khóa output xuất khách)
- `401e479` perf(GD1 #2): materialize QuoteSheet.subtotal — listProjects bỏ kéo 2000 báo giá×items vào RAM
- `890ea7d` feat(GD1): #1 httpError module + #3 audit before/after + #4 Personnel searchText + #5 retention prune
- `33871c7` ops(backup): backup DB tự động off-host + restore-test + DR runbook (Critical từ audit)
- `44be02f` perf/sec(GĐ0): vá 5 finding audit ưu tiên cao — GIỮ HÀNH VI nghiệp vụ
- `a13cd98` test(search): unit test chốt normalizeSearch + searchTextFilter (chống regression)
- `2b5e8cf` fix: vá 4 phát hiện từ audit đối kháng (full-text + PWA)
- `d95b071` fix(search): duplicateQuote set searchText (báo giá nhân bản cũng tìm được)
- `d96b5d2` docs(readme): full strict + PWA + Vite 8 + Dependabot + tìm kiếm không dấu
- `cd5d4df` feat(search): tìm KHÔNG dấu / sai dấu — cột searchText chuẩn-hóa + GIN trigram (pg_trgm)
- `02d417a` fix(web): bỏ @vitejs/plugin-legacy (phá app vì CSP) — thay bằng build.target es2017
- `fb01b06` chore(ci): Dependabot tự cập nhật deps (gom minor/patch, major tách PR riêng)
- `168167b` feat(web): PWA (cài như app) + plugin-legacy (máy/ĐT cũ) + nâng Vite 6→8
- `195d939` feat(ts): full strict backend (noImplicitAny + null-safety) — 0 lỗi type, giữ hành vi y hệt
- `9faa740` feat(ts): bật strict mode backend (null-safety) — vá 122 lỗi, giữ hành vi y hệt
- `eb67c74` docs(readme): đồng bộ sau Prisma 7 + compose versioned + git mv .js→.ts
- `01df519` infra: version hóa docker-compose.staging/prod.yml (sanitize secret → ${VAR}) + vá worker
- `615caef` fix(worker): entry-check robust .js/.ts (tsx nạp worker.ts dù lệnh trỏ .js → khối worker bị skip, thoát ngay)
- `4c87ee8` fix(seed): dùng Pool(pg)+PrismaPg đúng pattern db.ts (Prisma 7 adapter)
- `6448467` fix(seed): seed.js + seed-demo.js dùng driver adapter (Prisma 7 bắt buộc adapter)
- `dbc8fa9` fix(deploy): dọn .js cũ shadow .ts sau migrate (tar x không xóa → app chạy code .js CŨ)
- `c64a2e4` fix(docker): cấp DATABASE_URL giả cho prisma generate lúc build (Prisma 7 env() throw nếu thiếu)
- `39021cf` feat(db): nâng Prisma 5→7 (driver adapter @prisma/adapter-pg + prisma.config.ts)
- `0511904` refactor(db): $use → $extends (soft-delete + realtime) — chuẩn bị Prisma 6/7, giữ hành vi y hệt
- `fe455ee` docs(readme): backend 100% TS + kiến trúc tầng; frontend TanStack Query + code-split
- `c2b54d1` refactor(backend): tách tầng service quotes.routes (33→0 prisma, route 249 dòng) → quoteService
- `0b6bffc` refactor(backend): nhân rộng tầng service — users/settings/personnel/employees/gdpr/admin/analytics/webhooks/notifications
- `f29bac7` refactor(backend): tách tầng service domain Khách hàng (customerService) — route mỏng (mẫu kiến trúc tầng)
- `4aec9bf` perf(web): code-split lazy-load editor/wizard/AccountHn → bundle chính 436KB→352KB
- `db8d800` feat(web): chuyển 10 trang list sang TanStack Query (useQuery) — giữ hành vi
- `455cd36` feat(web): adopt TanStack Query — nền (provider + SSE→invalidate + useDebouncedValue) + trang Customers (mẫu)
- `f8fe9f1` test: thêm test-on-dev.sh — chạy 268 integration test trên Docker DEV (CI đang khóa billing)
- `9927a74` refactor(backend): chuyển 57 file src/*.js → TypeScript (giữ hành vi y hệt)
- `6fde7fb` feat(shared): tách lõi toán tiền sang shared/quote-math.ts (1 nguồn BE↔FE) + Vitest cho web
- `d5c2d7f` chore(g0): migrate vào deploy.sh + pin Node 22 + hard-fail MFA_ENC_KEY ở prod
- `31bcba7` feat(quote): khóa lạc quan khi lưu báo giá — chống MẤT DỮ LIỆU khi 2 người sửa cùng lúc
- `a425ac6` ci: gác typecheck backend + build web (React) + chạy CI trên nhánh chore/**
- `f0c10a0` docs(readme): cập nhật kiến trúc dual-frontend (SPA cũ + React đã port 100%) + module Nhân sự
- `be890be` fix(web): vá 6 phát hiện sweep cuối — 4 medium tiền/hiển thị + 2 low parity

## 2026-06-24

- `06de90e` fix(web): gate nav Tổng-quan + Quản-lý-dự-án theo quote:create (khớp SPA) — account_hn hết thấy nhầm + hết rơi vào Dashboard 403
- `22ccdac` fix(web): onGridBlur vẽ ô công thức về KẾT QUẢ khi rời focus (onGridFocus hiện =… lúc focus, blur không re-render nên tự set lại)
- `bac45a6` fix(web): vá 2 lỗi correctness review + toggle "Hiện Thành Tiền nhóm"
- `5ead772` feat(web): port view điền-HN account_hn sang React — HẾT iframe HOÀN TOÀN
- `869bca9` feat(web): port Wizard "Tạo báo giá mới" sang React — #/new HẾT iframe
- `66498b5` feat(web): hoàn tất parity editor — kebab ⋯ gom nút + Tổng-sheet chân lưới + seed có công thức demo
- `140b46c` fix(web): GIỮ landing Nhân sự (HR-first chủ đích) cho ai có quyền HR; account_hn fallback nav đầu
- `6165754` fix(web): vá audit đợt 3 — dán 1-ô-số US-safe + QuoteList thẻ mobile + Versions so-sánh-diff
- `44f74d6` fix(web): vá audit đợt 2 — MFA/Quên-MK/Onboard + Members khóa creator + landing theo role + tìm báo giá
- `d1c4c90` fix(web): vá audit P0/P1 đợt 1 — clipboard đúng số + SSE bảo mật + guard chưa-lưu + notes + days
- `7b76be2` feat(web): React Editor STAGE 7 — UX công thức ĐẦY ĐỦ (fx-bar + chọn vùng + chèn-ref chuột + autocomplete)
- `6832073` feat(web): React Editor STAGE 5+6 — panel giao/duyệt HN + FLIP #/quotes/:id sang React
- `2c69cef` feat(web): React Editor STAGE 4 — tách GridTable dùng chung + Bảng nội bộ (HCM/HN/Khách)
- `c5f6406` fix(web): editor Enter-nav luôn redraw để focus ô đích (khi không tạo hàng mới)
- `2e2afa0` feat(web): React Editor STAGE 3 — dán Excel nhiều ô + Enter-nav + undo/redo (Ctrl+Z/Y)
- `fb7fdb3` fix(web): editor hiện lỗi field CỤ THỂ (details[0]) khi lưu thay vì 'Dữ liệu không hợp lệ' chung
- `82e873b` feat(web): React Editor STAGE 2 — công thức Excel + gom nghìn LIVE + cột "Ghi chú nội bộ"
- `f8c3937` feat(web): React Editor báo giá — STAGE 1 (form + lưới Excel + sheets + lưu) [hidden route]
- `3310c47` feat(web): port ĐẦY ĐỦ "Quản lý dự án" (Projects) sang React (increment 9)
- `82710d2` feat(web): port ĐẦY ĐỦ "Danh sách báo giá" (QuoteList) sang React (increment 8)
- `311168c` feat(web): port ĐẦY ĐỦ "Tổng quan" (Dashboard) sang React (increment 7)
- `92df347` feat(web): port ĐẦY ĐỦ "Thông báo" (Notifications) sang React (increment 6) + badge shell
- `62a90e4` feat(web): port ĐẦY ĐỦ "Tài khoản" (Profile) sang React (increment 5)
- `66c6673` feat(web): port ĐẦY ĐỦ "Phân quyền" (Permissions) sang React (increment 4)
- `372b4e5` fix(web): Audit nhãn ĐẦY ĐỦ — map hết action/resource thật (HR/HN/gdpr/login) thay vì raw code
- `64514b1` feat(web): port ĐẦY ĐỦ "Nhật ký hoạt động" (Audit) sang React (increment 3)
- `6b39658` feat(web): port ĐẦY ĐỦ "Quản lý nhân viên" (Users) sang React (increment 2)
- `d28dec4` chore: xóa tính năng "Sản phẩm/Vật tư" (dead — không có nav/route, không ai vào được)
- `6a1280c` chore: gỡ ảnh test e2e khỏi repo + gitignore (artifacts)
- `1f858e4` feat(web): React DÙNG CHUNG design-system SPA + rebuild Shell/Login + đổi tên "Quản Lý"
- `97f2d0c` fix(web): Customers pager giống Y SPA ("Hiển thị x–y / total" + ← Trước/Trang/Sau →)
- `4739314` fix(web): Customers React khớp KÍCH THƯỚC SPA + bỏ footer "Tổng" thừa
- `fe84e1c` fix(web): Customers React giống Y SPA cũ (.list-table sạch + nút khớp)
- `cd92f21` feat(web): port màn "Mã khách hàng" sang React (increment 1/N — khai tử iframe)
- `c96c7d1` feat(ux): audit UX toàn diện + sửa Đợt 1/2 (sort/URL-filter, toast/modal, admin pagination, React guard/ErrorBoundary, gỡ preview)
- `430f490` feat(hr): ADMIN bấm cột "Xác nhận (C.Hồng)" → đã ký + lưu ngày
- `d48ebb5` feat(hr): KẾ TOÁN bấm cột "Thanh toán" → đánh dấu đã TT + lưu ngày
- `8f713b0` feat(hr): chọn dự án BẮT BUỘC + ẩn ô tham chiếu (chỉ hiện "đã chọn") cho gọn form
- `1cb0690` test(hr): seed Danh bạ + hồ sơ ĐÚNG LUỒNG (dự án của chính account) + e2e Stage 2
- `2ccbbf4` feat(hr): chọn DỰ ÁN đã chốt khi tạo hồ sơ → tự điền Tên/Mã dự án · Account · CTY (chỉ dự án của mình)
- `0df9827` feat(hr): Danh bạ nhân viên (CRUD) + chọn từ danh bạ khi tạo hồ sơ Nhân sự (tự điền)
- `8bb614f` style(hr): làm đẹp bảng Nhân sự — kẻ lưới như Excel, sọc ngựa vằn, màu header dịu lại
- `3e327ae` feat(hr): bảng Nhân sự khớp Y HỆT Excel gốc — cột STT + gộp "THỜI GIAN LÀM VIỆC" + màu từng cột (hồng/vàng)
- `2a3e766` feat(hr): bảng Nhân sự ĐỦ MỌI CỘT + tiêu đề khớp Excel gốc (STK, THỜI GIAN LÀM VIỆC, CTY, Xác nhận C.Hồng)

## 2026-06-23

- `d7bdaf3` fix(excel): Số Lượng lẻ ở hàng nhân bản in ra số nguyên (7,70→8) — định dạng 0.00 không "ăn"
- `f04e11f` feat(template): thêm "GN Banner (không ngày)" — nhóm con đánh số 1,2,3; mục bên dưới không đánh số
- `e32cccf` style(editor): "Giải thích Tổng sheet" gọn/đẹp/dễ hiểu hơn — bỏ nút Lưu, mỗi nhóm 1 thẻ + tổng riêng
- `9460a34` feat(editor): nút "ⓘ giải thích" Tổng sheet — bảng minh bạch cách cộng (CHỈ web, không đổi logic)
- `61d05da` feat(quote): Số Lượng CẮT 2 số (giữ công thức, bọc TRUNC) + Thành Tiền làm tròn + ghi chú nội bộ đồng màu hàng
- `7d0ba69` feat(quote-ui): hoán đổi màu nhóm (A/B/C=kem, nhóm con=xanh) + bỏ dấu ↳ + cột nội bộ để trắng
- `34f12ee` feat(quote-ui): Số Lượng hiện tối đa 2 số lẻ (cắt, không làm tròn) + nhóm con đổi màu cho dễ phân biệt
- `219bd08` feat(excel): xuất CÔNG THỨC người dùng tự gõ (Số Lượng/Đơn Giá/Số Ngày) ra file Excel
- `1a14854` chore(seed): hồ sơ nhân sự demo trỏ mã sản xuất báo giá ĐÃ CHỐT (DEMO*) → cột HĐ/thanh toán tự kéo; bỏ seed field công thức/tham chiếu
- `af3416e` feat(hr): Thuế TNCN/Thu nhập chịu thuế TỰ TÍNH (Lương/9, ×10/9) + cột HĐ/thanh toán TỰ LẤY từ Dự án theo mã sản xuất
- `fda0ac7` fix(hr): bỏ chấm '•' (nav-ext) cạnh menu — sidebar khớp app cũ
- `df1074e` fix(hr): dark mode KHÔNG áp do CSP chặn inline script → chuyển theme-init vào main.tsx (module). Đồng bộ sáng/tối với app cũ
- `b118d0f` fix(hr): khớp thiết kế app cũ — nút Xóa đỏ đặc, tiêu đề h1, brand 'Báo Giá', bảng list-table, ô tìm

## 2026-06-22

- `45e8124` fix(hr): embed mode render nội dung trang (gọi renderMain) — sửa iframe trống. Bump ?v 20260622r
- `9ba4f2a` feat(hr): sidebar + màu GIỐNG HỆT app cũ + nhúng trang chưa port (bỏ nút "mở bản cũ")
- `74ac36f` feat(hr): app React thành app CHÍNH trên dev (/ thay vì /app2) + CSS đầy đủ + dark mode
- `36b3627` feat(hr): hợp nhất thành 1 app React (sidebar đầy đủ) — Nhân sự là trang đầu tiên
- `ec1377e` fix(test): personnel integration dùng size mặc định (200 > MAX_PAGE_SIZE 100 → tránh 400 ở CI)
- `dd4f4b4` feat(hr): hoàn thiện trang Nhân sự — màu trạng thái, phân trang, sort, tổng, toast/modal, brand gold
- `c3c6dca` test(hr): e2e trình duyệt (Playwright) cho trang Nhân sự React /app2
- `4b427a5` feat(hr): trang Nhân sự bằng React + Vite + TypeScript (/app2) + test RBAC đầy đủ
- `efd7830` feat(hr): nền tảng module Nhân sự + chuyển backend sang TypeScript (tsx)
- `1ec5b70` feat(projects): thay 2 ô tổng kết (số dự án/số dòng) bằng Đã thanh toán / Chưa thanh toán
- `a6fff88` fix(security): remaining hardening — pg_dump header-race, DoS caps, REDIS guard, settings schema, Permissions-Policy
- `df64419` fix(seed-demo): raw PrismaClient xoá thật (bỏ hardDelete) + đúng thứ tự FK (customer trước user)
- `c6755fb` fix(security): hardening follow-ups (MFA lockout, export gating, /metrics, SSRF IPv6)
- `150bfc5` feat(projects): đèn đỏ/trắng theo dõi chứng từ + Số HĐ HN + sửa bug status "Done"
- `0d323c2` refactor(quotes): dọn sạch tàn dư luồng duyệt nội bộ (draft→converted/lost)
- `29163cb` feat(projects): luồng hoá đơn → thanh toán → done ở Quản lý dự án (admin)
- `fc58e8c` docs(readme): cập nhật theo trạng thái hiện tại
- `755fca9` feat(internal): duyệt theo HÀNG cho Chi Phí HCM + Phí Khách Hàng (chỉ admin)
- `e4c9ae6` feat(account-hn): danh sách hiện SỐ SHEET HN + TỔNG HN của account
- `1d2a3ec` refactor(workflow): bỏ duyệt nội bộ — luồng gọn Nháp → Khách chốt/Không chốt
- `a5b22e3` refactor(role): nhãn vai trò manager "Quản lý" → "Account" (tránh nhầm Quản trị)
- `35c6573` style(account-hn): polish giao diện màn Phần Giá Hà Nội cho chuyên nghiệp
- `abe8dbd` fix(account-hn): chuyển tab khi đã gửi (read-only) + tổng gộp mọi sheet
- `2428fd1` feat(account-hn): chọn Mẫu (có ngày / không ngày) cho từng sheet HN
- `8e2ef75` test(account-hn): khoá bất biến "giữ mọi sheet HN + dữ liệu" khi lưu
- `9c53cfe` fix(account-hn): "+ Thêm sheet" dạng tab giống Bảng nội bộ của quản lý
- `3da9701` feat(account-hn): thêm bảng Hà Nội + ẩn Tổng quan/Dự án + chặn analytics
- `238a6c1` feat(account-hn): danh sách báo giá riêng cho role Account Hà Nội
- `7139c43` fix(editor): tự bật "Hiện Thành Tiền nhóm" khi nhập SL nhóm > 1

## 2026-06-19

- `d4667a8` chore(deploy): thêm deploy.sh <staging
- `217981c` fix(security): vá nhóm phát hiện audit — formula injection, RBAC, auth hardening
- `b18e800` docs: nội dung README cập nhật + dọn ref deploy/windows (phần sửa nội dung)
- `b2cfc31` docs: cập nhật README đúng hạ tầng hiện tại + xóa dead docs
- `6460f18` fix(notify): Telegram gửi plain text — chặn Markdown injection từ nội dung người dùng (FIND-003)
- `b73f28b` chore(deps): vá toàn bộ lỗ hổng npm audit (0 vulnerabilities)
- `776ccc4` fix(quotes): chặn race "Bản mới cùng mã dự án" tạo trùng version
- `1bbd671` fix(mfa): yêu cầu nhập lại mật khẩu khi BẬT MFA (step-up, đối xứng với /disable)
- `20aa4e8` fix(validation): thay z.coerce.boolean() bằng zbool — "false" không còn bị hiểu thành true
- `8105594` refactor(api-keys): gỡ bỏ tính năng API key chết (phát khóa nhưng không xác thực)
- `9f8968f` refactor(billing): gỡ bỏ scaffold SaaS billing/quota chết (Stripe + Plan/Subscription/UsageRecord)
- `f5f3edc` chore(repo-hygiene): add .gitattributes/.editorconfig, harden ignores, share VS Code settings
- `ba212fe` refactor(spa-step8): tách js/editor.js — renderEditor + drawItems + grid (byte-for-byte)
- `2d240bb` refactor(spa-step7): tách js/pages/quotes.js — list + wizard + Account-HN (byte-for-byte)
- `edc3f83` refactor(spa-step6): tách 10 trang admin ra js/pages/admin.js (byte-for-byte)
- `bc15e96` refactor(spa-step5): tách js/preview.js + đưa sheetSubtotalGrouped vào util.js
- `9080282` refactor(spa-step4): tách js/ui.js — toast/skeleton/modal/theme/keyboard/field-errors
- `dcc6915` refactor(spa-step3): tách core/api.js — fetch wrapper + xử lý lỗi/401
- `f86c8ee` refactor(spa-step2): tách core/state.js — state singleton + can/canOnQuote/landingPage/sheetUsesDays/clearDaysIfUnused

## 2026-06-18

- `7d28792` feat(extra-tables): gộp gọn — khu bảng nội bộ THU GỌN được ở màn quản lý (A)
- `8c4e39f` fix(account-hn): cho phép TẠO/GÁN user role account_hn (form + validator + nhãn)
- `f8ecf3e` feat(account-hn): UI màn Account + panel quản lý (phase 4) — verified e2e
- `846737a` feat(account-hn): SERVER role Account Hà Nội + luồng duyệt phần HN (phase 1-3)
- `4ad1dc3` feat(items): cột "Ghi chú nội bộ" trên lưới chính — hiện trong app, KHÔNG xuất Excel

## 2026-06-17

- `79384b1` feat(extra-tables): tách RIÊNG theo loại (HCM/HN/Phí KH) + Tổng từng loại khớp Quản lý dự án
- `4392c7c` feat(extra-tables): dãy TAB SHEET nội bộ + "Tổng sheet" (như báo giá chính)
- `52ac92d` feat(extra-tables): bảng nội bộ = lưới ĐẦY ĐỦ y hệt báo giá (tái dùng drawItems)
- `9ef3aee` feat(extra-tables): nâng cấp Bảng nội bộ đầy đủ như lưới chính
- `a3f32dd` feat(grid): dán nguyên bảng export giữ công thức "=…" (reconstructExportRows)
- `6766f6d` feat(grid): paste khối nhận "=công thức" thành công thức thật (có nút ƒ)
- `4ec0a33` fix(excel): stitcher remap row/col default styles → hết "khung"/nền lạc sheet 2+
- `61e9d60` fix(export): no-store + cache-bust → Cloudflare hết phục vụ file .xlsx/.pdf cũ
- `49545f5` fix(excel): dọn ô rỗng-có-style ngoài bảng → hết "khung" lạc ở sheet 2+ khi stitch
- `ff7d05e` feat(excel): nhóm con bỏ nền ô STT+Ghi Chú; "Thành Tiền nhóm" mặc định bật
- `8b8b70d` refactor(spa) + cleanup(approval): module hóa SPA bước 1 + gỡ Approval Matrix chết
- `252f553` refactor(quotes): đưa submit/approve/reject vào quoteService (hoàn tất Service layer)
- `dc3277a` refactor(quotes): tách create/update vào quoteService.js (Service layer)
- `6607be3` refactor(quotes): tách presenter + helper thuần ra src/quoteUtils.js
- `2ef7d4e` test(jwt): sửa thứ tự test rotation — verify chain trước khi replay burn family
- `9ec78d9` chore(deploy): script bật Memurai (Redis 7.2) trên cổng riêng cho quanly
- `ef51a45` feat(security): mã hóa webhook secret at-rest (AES-256-GCM)
- `5336bee` fix(security+quotes): hardening bảo mật/toàn vẹn + gỡ chức năng hết hạn
- `e6900b1` chore(devops): siết CI security gate, backup tự động, hardening container

## 2026-06-15

- `e2b7f81` @ fix(review): sửa lỗi từ đợt code review + cập nhật CODE_REVIEW.md
- `03c364d` @ docs(readme): cập nhật copy/paste chuẩn đa nền tảng + dán-dựng-lại nhóm từ Excel + trang Quản lý dự án (quản lý xem dự án của mình, khóa 4 cột, tìm kiếm/lọc)
- `1c562b4` feat(projects): quản lý xem dự án đã duyệt của mình (chỉ xem) + khóa 4 cột đầu + tìm kiếm/lọc
- `346d06a` feat(editor): dán nguyên báo giá từ Excel → dựng lại nhóm/nhóm con/hàng con + Ctrl+Z sau khi dán
- `870c1f9` feat(editor): copy/paste chuẩn như Excel trên mọi thiết bị/bộ gõ (macOS, Windows, chuột, bàn phím, cảm ứng)
- `a776984` fix(excel): nhóm con KHÔNG có chữ A/B/C (STT trống, chỉ tô màu) + hàng nhóm tự cao theo chữ
- `7ac0154` fix(editor): bấm chuột → khung chọn + thanh fx nhảy theo ngay (như Excel)
- `e4d04ee` feat(editor+excel): ai cũng bấm ƒ xem được công thức + nhóm con xuất Excel khớp màn hình
- `c0c34c6` fix(quote): cho phép kind 'subsection' (sửa 500 mất dữ liệu) + dán Excel vào nhóm/nhóm con
- `4963920` fix(editor): "Tổng sheet" cập nhật realtime khi gõ (không chỉ lúc redraw)
- `d8b4f08` feat(editor): "+ Thêm nhóm con" (subsection) — tổng riêng, không gộp nhóm chính, vẫn vào Tổng cộng
- `1fee789` feat(editor+responsive): tên nhóm wrap chữ dài + polish responsive phần mới
- `47df4a8` fix(editor grid): bỏ qua keydown khi đang gõ IME (Enter xác nhận từ tiếng Việt)
- `4fd6d04` feat(projects): Team client = Mã khách hàng, Account = người tạo dự án
- `98dd53a` feat(projects): Ký Chứng từ theo sheet — admin + user có quyền "Được ký"
- `62dc8fa` fix(editor): đưa bảng "Tổng báo giá" lên trên khu bảng nội bộ
- `d9f0a9d` feat(quote): bảng nội bộ theo sheet (Chi Phí HCM/Báo Giá HN/Phí KH) — không xuất Excel
- `3ada65b` feat(projects): thêm cột "Chi Phí HCM" trước "Báo Giá Hà Nội"
- `55aa8dd` feat(rbac): bỏ HẲN vai trò "employee" khỏi enum Role + dọn dead-code
- `c91929d` feat(rbac): quản lý tự duyệt báo giá của mình + bỏ vai trò "nhân viên"
- `478d69e` feat(quote): thêm "Ngày thi công" (executionDate) — nội bộ, không xuất Excel
- `fbb8b1b` feat(projects): tách dòng theo sheet + bỏ 5 cột (Total/Q.7/T.Phú/HN/Ngày Tháo dỡ)
- `63d91a2` feat(projects): trang "Quản lý dự án" GĐ1 — bảng báo giá đã duyệt (read-only)
- `1733c33` chore(deploy): bump asset version 20260615d→e để bust cache Cloudflare
- `ed128d9` feat: công thức Excel trong lưới báo giá + email thương hiệu + mục Quản lý dự án
- `6f381c1` feat(editor UI): sửa hàng nút chân lưới (flex, hết vỡ ô tick) + bỏ "Xem trước bản in"
- `6c8ac8e` feat(editor UI): redesign nút thao tác — rõ ràng, đẹp, không đụng chức năng/export
- `adc845f` feat(quote list): redesign — bấm dòng để mở, nút thao tác icon rõ ràng/đẹp hơn
- `9b30254` feat(quote list): thêm cột "Người tạo" sau Mã dự án (chỉ admin)
- `d9480c2` fix(GN export): canh giữa cả "Rất mong" và "Trân trọng" trong cột trái
- `8383e6d` fix(GN export): "Trân trọng kính chào" canh giữa dưới "Rất mong"
- `3beed29` fix(GN export): lời chào canh trái + Ý Kiến Khách Hàng canh phải cùng hàng (cân đối)
- `f0c4211` fix(GN export): Ghi chú hiện nâu ngay khi mở file (bỏ richText) + khôi phục Ý Kiến Khách Hàng
- `ea7c068` fix(GN export): bỏ khối chữ ký người gửi, chỉ chừa chỗ đóng dấu

## 2026-06-14

- `799de9d` fix(projectCode): strip accidental _NNN sequence suffix from a user's Mã dự án
- `f29693b` fix(GN export): bỏ "Ý Kiến Khách Hàng" cho khớp mẫu (chỉ chữ ký giữa)
- `cc1dea5` fix(GN export): chữ ký canh giữa theo mẫu (tên/chức danh/SĐT) + chừa chỗ đóng dấu
- `ff08501` feat(GN export): vùng chữ ký kiểu công văn, chừa chỗ đóng dấu
- `746a591` feat(GN export): chữ ký 2 cột — Người gửi (trái) 
- `915f0f0` fix(GN export): chữ ký lấy tiền tố Ms./Mr. từ ô From (E3), không hardcode
- `80f358d` feat(GN export): thêm khối chữ ký người gửi (tên đậm/chức danh/SĐT) canh giữa cuối báo giá
- `a49069e` fix(GN export): giữ màu nâu dòng Ghi chú (set style canh-trái TRƯỚC richText)
- `b3a87cc` fix(GN export): footer "Rất mong/Trân trọng" canh giữa + Ghi chú canh trái
- `d32aece` feat(GN export): dùng layout Marico_Decor (Chi Tiết + From labels + màu) + Ghi chú/footer
- `811afb3` chore: bump asset version 20260613i (app.js: preview notes + batch UI)
- `e8f7304` feat: commit prior uncommitted batch (Vietnamese errors, GN palette, end-quote notes) + fixes

## 2026-06-13

- `a5010c3` fix(money+editor): close 5 parity gaps found by adversarial audit
- `0142802` fix(preview): render sections (nhóm A/B/C) faithfully to exported Excel
- `c18e28c` feat(editor): remember & re-show cell formulas (Excel-like)
- `8237827` feat(editor): Excel-like formulas + section row color/notes + selection sum
- `33ef3f2` fix: export VAT/total consistency, PDF pagination, settings access, cleanups
- `2ad8dd1` perf: offload Excel/PDF generation to a worker thread (no Redis needed)
- `4f81b38` perf: template cache, export serialization, static cache, parallel notify, indexes
- `2b2bb15` style(ui): clean-enterprise typography pass — consistent heading hierarchy
- `9812b6b` feat(ui/ux): a11y keyboard, deep-link routing, unsaved guard, states, nav
- `db977be` harden: security + DB integrity fixes, RBAC/workflow guards, migrations

## 2026-06-01

- `eae706d` @ feat(quotes): hàng con, info rows, negative-discount lines, CLF export fixes
- `58c81a1` fix(editor): show each template's real columns (CLF was missing 'Chi Tiết')
- `b5cb74c` feat(a11y+ux): accessibility, hash routing, approval nav, password UX
- `12d1d23` fix(backend): correct dashboard revenue + terminal-state & RBAC guards
- `9613569` fix(ui): status labels for all states + show login errors + zero-total guard
- `aefe38c` style(responsive): full coverage for phones + tablets
- `3ee67ad` style: adopt Gia Nguyễn design-system tokens (indigo/violet, from handoff bundle)
- `046642b` Revert "style: re-theme to Gia Nguyễn brand identity (orange + eco-green)"

## 2026-05-31

- `e6b2305` style: re-theme to Gia Nguyễn brand identity (orange + eco-green)
- `d6406da` feat: RBAC permission system + multi-step quote wizard + customer logo
- `2673a04` fix(templates): CLF border fidelity + keep coloured guide notes
- `cf59572` feat(templates): replace no-date forms with new GN + Clofull (CLF)

## 2026-05-29

- `b4156eb` feat(ui): enterprise design-system redesign — dark mode, responsive, skeletons
- `27e5fc5` fix(quotes): repair broken quote UPDATE (500) + complete quote lifecycle UI
- `6669a1d` feat(ui): simplify sidebar + fix quote-number soft-delete collision
- `bc00cb0` feat(phase4): Helm + observability + GDPR + search + billing + channels
- `41b8353` feat(phase3): scale-ready foundations — JWT, S3, BullMQ, SSE, webhooks, API keys, Telegram, K8s, backup
- `a79e9d0` feat(phase2): enterprise modules — CRM, products, approval, versioning, MFA, PDF, analytics, settings
- `f219400` feat(phase1): production hardening — security, integrity, observability
- `a880485` Initial commit: Quote management web app with multi-sheet Excel export
