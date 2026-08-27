# Rủi ro còn lại — việc chưa làm

Lập ngày 2026-08-26, từ một đợt rà soát toàn bộ mã nguồn (12 mảng, chạy song song
bằng nhiều tác nhân đọc mã thật).

> ## Đọc kỹ trước khi hành động
>
> **Những mục dưới đây CHƯA ĐƯỢC XÁC MINH ĐỘC LẬP.** Đây là kết quả **một lượt
> đọc**, chưa có ai phản biện lại.
>
> Kinh nghiệm ngay trong chính đợt này cho thấy tỉ lệ nhầm là có thật: vài phát
> hiện hoá ra là lỗi tiềm ẩn không với tới được, vài phát hiện khác thì mức độ bị
> thổi lên. **Hãy TÁI HIỆN trước khi sửa.** Đừng mở PR dựa vào bảng này.
>
> Những mục ĐÃ được tôi tự tái hiện và ĐÃ VÁ thì không có trong đây — xem lịch sử
> commit của nhánh này.

---

## ĐÃ ĐỐI SOÁT LẠI VỚI MÃ NGUỒN (2026-08-26)

Bảng bên dưới **từng sai**. Câu "mục đã vá thì không có trong đây" đúng lúc viết ra,
rồi 24 commit vá trôi qua mà không ai dọn bảng — nên nó vẫn liệt kê những lỗ đã
đóng, và không thể nhìn nó mà biết còn lại bao nhiêu việc thật.

Đã rà lại **cả 131 mục** bằng cách đọc mã thật (8 tác nhân song song), rồi cho một
lớp phản biện riêng **cố gắng bác bỏ** từng kết luận "đã vá" — vì hướng sai nguy
hiểm nhất là đóng hồ sơ một lỗ vẫn còn mở. Lớp đó **bác bỏ 32/70** kết luận, tức
gần một nửa; không có nó thì bảng này sẽ sạch một cách giả tạo.

| | |
|---|---|
| Đã vá, đã gỡ khỏi bảng | **72** |
| Còn lại trong bảng | **59** (8 P1 · 39 P2 · 12 P3) |
| — trong đó *còn mở hoàn toàn* | 11 |
| — *vá một phần* (còn đường đi vòng) | 48 |
| Mức **nghiêm trọng** còn lại | **0** |
| Mức trung bình | 11 |

Mỗi dòng còn lại nay mang nhãn **còn mở** / **vá một phần** cùng **mức thật** đo
sau khi đọc mã — có thể khác hẳn nhãn P1/P2/P3 gốc, vốn là phỏng đoán của một lượt
đọc chưa ai phản biện.

**Hai lỗ do chính lớp phản biện tìm ra đã vá ngay trong lượt này** (cả hai là chỗ
bản vá trước tự nhận đã đóng mà chưa đóng hết):

* `reset-invite-token-in-logs` — chốt che chỉ phủ `req.url`, trong khi trình xử lý
  lỗi ghi một khoá `path` **phẳng**. Token mời 48 hex trong
  `GET /api/auth/invite/:token` ra log **và** sang Sentry nguyên văn; token đó là
  đầu vào duy nhất của `/accept-invite`, tức chiếm được tài khoản.
  → `tests/qua-token-in-flat-path-key.test.js`
* `hn-save-unvalidated-body` — lớp gác thanh toán khớp theo `rid` **do client
  gửi**. Chép `rid` của một hàng đã trả sang một hàng bịa 50 triệu thì hàng bịa
  nhận `paid`, người trả thật và **cả ảnh chứng từ thật**.
  → `tests/qua-extra-pay-rid-cloning.test.js`

Ba kết luận của lớp phản biện thì **tôi kiểm lại và bác bỏ ngược**, ghi ra đây để
không ai đi sửa nhầm:

* `hanoi-tables-unprotected-on-main-save` — cần một tác nhân có `quote:update` mà
  **không** có `quote:hn:fill`; nhưng ai có `quote:hn:fill` đã bị chặn 403 ở
  `PUT /api/quotes/:id` (`src/routes/quotes.routes.ts:223`). Người chủ báo giá xoá
  một sheet là thao tác họ vốn được phép, không phải phá vòng duyệt.
* `logout-leaves-refresh-tokens-alive` — đã đo bằng request thật: `POST
  /api/auth/logout` chỉ với `Authorization: Bearer` trả **200** và
  `refreshToken.count({ revokedAt: null })` về **0**. `bearerAuth`
  (`src/middleware.ts:78-81`) gán `req.session.userId` nên nhánh thu hồi có chạy.
* phần "rid bịa đặt được `paid`" — sai: `rid` chưa từng có trong CSDL cho `p =
  null` nên `paid` bị ép về `false`. Lỗ thật là **chép lại** rid, hẹp hơn hẳn.

## ⚠️ Bốn thứ PHẢI đọc trước khi tin nhánh này ở production

(Ba việc còn phải làm, cộng một ghi chép về lớp lỗi đã vá — mục 4.)

Cả bốn đều là hệ quả TRỰC TIẾP của các bản vá trong chính nhánh này. Chúng không
phải lỗi có sẵn — chúng là chỗ bản vá đi xa hơn mức đã đo được.

### 1. Trần RAM container là số PHỎNG ĐOÁN, chưa đo trên VM thật

`docker-compose.prod.yml` / `.staging.yml` nay đặt `deploy.resources.limits.memory`
(app 1536m, worker 2g). **Chưa ai đo đỉnh RSS thật.**

Đặt cgroup limit mà không bảo V8 biết là tự bắn vào chân: Node không đọc cgroup
limit để chỉnh heap, nó nới theo RAM của **host** rồi bị kernel SIGKILL nguyên
container. Lúc đó không phải một request hỏng — mà mọi request đang bay của mọi
người đứt, SSE đứt, lần Lưu báo giá đang gửi dở mất trắng.

Đã giảm nhẹ bằng `NODE_OPTIONS=--max-old-space-size` ở ~70% trần, để V8 GC gắt rồi
ném heap-OOM **bắt được** (hỏng đúng một request) thay vì để kernel giết container.
Nhưng đó là lưới an toàn, không phải phép đo.

**Việc phải làm:** chạy `docker stats` trên VM một tuần, xem đỉnh RSS thật khi xuất
báo giá lớn nhất, rồi thay hai con số đó bằng số đo được. Repo còn đường tiêu bộ
nhớ chưa chặn (nhập Excel nạp cả workbook trên event loop), nên số đo phải lấy ở
tình huống xấu nhất, không phải ngày thường.

### 2. `infra/k8s/backup-objects-cronjob.yaml` CHƯA TỪNG CHẠY THẬT

File này mới chỉ qua `kubeconform` — chỉ kiểm hình dạng YAML, không kiểm ảnh
`minio/mc` có sẵn lệnh mà script dùng hay không. Ảnh đó dựng trên UBI-micro, cắt
rất sâu. Bản đầu dùng `find -printf` (GNU-only) và `xargs`; với `set -e`, một lệnh
không tồn tại là job chết lúc 02:30 — không ai thấy, và đội vận hành vẫn tin rằng
**chứng từ tài chính đã có bản sao lưu**.

Đã viết lại để mọi thao tác liệt kê/xoá đều qua chính `mc`, và đặt
`HOME=/tmp` + `MC_CONFIG_DIR=/tmp/.mc` (pod chạy `readOnlyRootFilesystem` nên `mc`
không ghi nổi config ở `$HOME` mặc định). Nhưng `sha256sum`, `sed`, `sort`, `wc`,
`tr` thì **vẫn chưa xác minh được** — sandbox không có Docker daemon.

**Việc phải làm:** `kubectl create job --from=cronjob/quanly-object-backup thu-1`
trên kind/minikube, đọc log, xác nhận kết thúc bằng `OBJECT_BACKUP_DONE` và
`manifest_*.tsv` có nội dung, rồi **diễn tập khôi phục từ bản gương đó**.

**Cho tới lúc đó: nhánh đang chạy thật là docker-compose +
`scripts/backup/backup-objects.sh`.** Đừng ghi ở đâu rằng k8s đã sao lưu kho object.


### 3. Nhập Excel: đã rời event loop, nhưng CHƯA có hàng rào bộ nhớ thật

`POST /api/quotes/import-excel` nay đọc workbook trong **worker thread** — điều này
đã đo được (`tests/import-worker-thread.test.js` đo độ trễ event loop trong lúc
worker chạy). Server không còn đứng khi ai đó nhập file nặng.

**Nhưng trần bộ nhớ thì chưa có thật.** Tôi đặt
`resourceLimits.maxOldGenerationSizeMb` rồi **đo lại**, và nó KHÔNG chặn: với trần
32MB, một worker vẫn cấp phát thoải mái `Buffer.alloc(300MB)` và ba triệu object.
Buffer là bộ nhớ ngoài heap V8, còn old-space thì V8 co giãn theo cách riêng.

Hàng rào thật hiện nay chỉ là **trần tải lên 10MB** (multer) cộng **timeout 30s**.
Mà `.xlsx` là ZIP: 10MB nén bung ra hàng trăm MB.

**Việc phải làm:** đọc theo LUỒNG bằng `exceljs.stream.xlsx.WorkbookReader` thay cho
`workbook.xlsx.load()`, để `MAX_SHEETS` / `MAX_SCAN_ROWS` có tác dụng **trong lúc**
đọc chứ không phải sau khi đã dựng xong cả workbook trong RAM. Đó là thay đổi lớn
hơn một lượt vá và cần bộ test round-trip Excel chạy kèm từng bước — nên chưa làm.

**Đừng ghi ở đâu rằng trần heap của worker bảo vệ được gì.**

### 4. Worker thread TỪNG không chạy ở dev/test suốt thời gian dài

Không phải rủi ro còn mở — đã vá — nhưng đáng ghi lại vì nó cho thấy một lớp lỗi:
**đường lui im lặng che mất việc đường chính chưa bao giờ chạy.**

`new Worker(new URL("./exportWorker.js", import.meta.url))` chạy tốt ở production
(image chỉ chứa `dist/`, mọi thứ là `.js`) nhưng **luôn hỏng** ở dev/test — `npm run
dev` là `tsx src/server.ts`, mà worker thread KHÔNG kế thừa loader của tsx, nên
`./excel.js` không giải được (trên đĩa chỉ có `excel.ts`). `runExportJob` bắt lỗi,
ghi một dòng `warn`, rồi rơi về chạy **nội tuyến trên luồng chính** — đúng thứ mà
worker sinh ra để tránh. Bộ test vẫn xanh vì đường lui cho kết quả đúng.

Nay cả hai worker tự đăng ký loader tsx khi chạy từ nguồn. Bài học: **một đường lui
tự động che được việc đường chính chưa bao giờ hoạt động.** Khi thêm đường lui, hãy
thêm luôn cách nhìn thấy nó đang được dùng.

Đúng lớp lỗi đó lặp lại một lần nữa ở tiến trình worker BullMQ, và cũng đã vá trong
nhánh này: processor xuất nền gọi thẳng `buildQuoteBuffer` nên **không đi qua trần
thời gian nào**, trong khi ân hạn dừng 90s của k8s/Helm/compose lại tự xưng neo vào
trần đó (xem mục "Ân hạn dừng worker = 90s" bên dưới). Cách vá lấy luôn bài học ở
trên: `sinhFileXuat` đặt `choPhepNoiTuyen: false`, tức **bỏ hẳn đường lui** trên
nhánh cần một cái trần thật — vì một đường lui không có trần thì vô hiệu hoá đúng
cái trần vừa đặt, và lại làm nó im lặng.

## Mã hoá PII: MẶC ĐỊNH TẮT, và cột thô vẫn được ghi — QUYẾT ĐỊNH GIỮ NGUYÊN (2026-08-26)

Chủ dự án đã đọc và **chọn giữ nguyên**. Mục này không phải việc còn tồn — nó là bản ghi
trạng thái thật, để không ai đọc tên biến `PII_ENC_KEY` rồi tưởng dữ liệu đã được bảo vệ.

**Ba điều đã kiểm bằng cách đọc mã, không suy đoán:**

1. `PII_ENC_KEY` là **tuỳ chọn** — `src/config.ts:107` khai `.optional()`. Không đặt khoá thì
   `encodePiiForWrite` (`src/piiFields.ts:53-55`) trả `data` **nguyên xi**: không có mã hoá nào,
   CCCD / số tài khoản / lương nằm thô trong CSDL.
2. Ở production, thiếu khoá chỉ in **một dòng `console.warn`** (`src/config.ts`, khối `console.warn` về PII_ENC_KEY — grep `PII_ENC_KEY` trong file đó) rồi chạy
   tiếp. Cố ý — chú thích ở `src/config.ts:237-239` giải thích: chặn khởi động vì một tính năng phụ
   còn tệ hơn. Đánh đổi hợp lý, nhưng hệ quả là **im lặng trong log của một lần deploy bình thường**.
3. Kể cả khi ĐÃ đặt khoá, cột thô **vẫn được ghi song song** (`src/piiFields.ts:47-48`: "cột thô GIỮ
   NGUYÊN cho tới khi cutover"). Giai đoạn đọc-song-song cần nó. Migration bỏ cột thô **chưa tồn
   tại** — `scripts/migration/pii-backfill.mjs:29-31` ghi rõ đó là việc riêng, và việc riêng đó
   chưa ai làm.

**Nghĩa là:** mối đe doạ mà cả hệ con này sinh ra để chặn — *"bản dump CSDL bị lộ"* — **chưa được
giảm nhẹ**, ở cả hai trạng thái. Chưa đặt khoá thì không có gì mã hoá. Đặt rồi thì bản dump vẫn
chứa cột thô nguyên vẹn bên cạnh cột mã hoá.

**Việc phải làm khi bạn quyết định làm:** (a) đặt `PII_ENC_KEY` trên production, (b) chạy
`npm run pii:backfill` cho dữ liệu cũ, (c) xác minh bằng `dist/tools/verifyIntegrity.js`, (d) **rồi
mới** viết migration bỏ ba cột thô. Bước (d) là **không hoàn tác được** — đừng chạy trước (c).

**Đừng ghi ở đâu rằng PII đã được mã hoá cho tới khi (d) xong.**

## Báo giá > 20.000 dòng: có đường xuất, nhưng CHƯA có nút bấm (2026-08-26)

Đường xuất ĐỒNG BỘ chặn ở 100 trang / 20.000 dòng rồi trả 413 kèm lời khuyên *"vui lòng
dùng xuất nền (async)"*. Trước đợt này lời khuyên đó **không thực hiện được**, và một
bản vá trong chính đợt này suýt làm nó tệ hơn — chi tiết ở đầu
`tests/b2-quote-size-cap.test.js` và `src/validators.ts`.

**Đã đóng:** đường xuất NỀN nay nhận trọn sức chứa của đường lưu (60 trang × 1000 dòng =
60.000). Mọi báo giá **lưu được** đều **xuất được** qua `POST /api/quotes/:id/export`.

**Chưa đóng:** SPA React **chưa nối** đường đó — `grep -rn "/jobs" web/src` không ra kết
quả; hai chỗ xuất file (`QuoteEditor`, `QuoteList`) đều mở thẳng `/api/export/:id.xlsx|pdf`.
Nên với người dùng cuối, báo giá 20.001–60.000 dòng vẫn là: bấm Xuất → nhận lỗi kèm một
lời khuyên không bấm được ở đâu.

**Việc phải làm:** bắt 413 ở client, gọi `POST /api/quotes/:id/export`, poll
`GET /api/jobs/export/:id`, rồi mở `returnvalue.url`. Cần thêm: hàng đợi phải bật
(`REDIS_URL`) và kho object phải có (`S3_*`) — thiếu một trong hai thì route trả 503 kèm
`code: "export_async_unavailable"`, và client phải nói ra điều đó thay vì im lặng.

**Đừng đóng lại bằng cách siết trần LƯU.** Trần đó chưa từng tồn tại, nên siết là khoá
chủ những báo giá lớn đã lưu từ trước ra khỏi chính dữ liệu của họ — kể cả khỏi thao tác
tách bớt trang, vì tách cũng là một lần Lưu.

## Ưu tiên đề xuất

1. **Xoay mật khẩu demo trên dev/staging.** Chuỗi cũ đã bị gỡ khỏi cây làm việc
   nhưng **vẫn còn trong lịch sử git của một repo công khai**. Gỡ file không thu
   hồi được nó. Đây là việc phải làm bằng tay, không code nào làm thay được.
2. Nhóm P0/P1 về **đường lưu báo giá** — chúng đụng tới dữ liệu tiền và trạng
   thái duyệt, tức là chỗ mất mát khó phát hiện nhất.
3. Nhóm P1 về **hàng đợi/worker** — ảnh hưởng độ tin cậy của xuất file và job nền.
4. Phần còn lại theo thứ tự thuận tiện.

## Cách đọc bảng

`id` là định danh nội bộ của phát hiện, dùng để tra lại trong ghi chép rà soát.
Cột "hệ quả nếu đúng" là lập luận của người rà soát, **chưa kiểm chứng**.


## P1 — 8 mục còn lại

| Mục | Vấn đề | Hệ quả nếu đúng | Trạng thái sau đối soát |
|---|---|---|---|
| `import-xlsx-oom-eventloop` | Nhập Excel: toàn bộ workbook được nạp vào RAM TRÊN EVENT LOOP trước khi mọi trần MAX_SHEETS/MAX_SCAN_ROWS có tác dụng — treo server + OOM | Một tài khoản có quyền quote:create tải lên file .xlsx 3 MB gồm 150k dòng: Node đơn luồng đứng im 5 giây (mọi request khác — SSE, lưu báo giá của người khác — treo theo), RSS +1 GB. importLi… | **vá một phần** · mức thật: trung-binh |
| `decompressbody-before-auth` | decompressBody chạy TRƯỚC auth và TRƯỚC rate-limit, không có trần tỉ lệ nén → khuếch đại bộ nhớ ~1000× cho người CHƯA đăng nhập | Kẻ tấn công KHÔNG có tài khoản gửi `POST /api/quotes` với `Content-Encoding: gzip` và ~16 KB dữ liệu toàn số 0 (gzip nén ~1000×). Server bung ra 16 MB + `Buffer.concat` → ~32 MB đỉnh mỗi req… | **vá một phần** · mức thật: trung-binh |
| `bullmq-export-blocks-worker-loop-stalls` | Async export processor runs exceljs/PDF on the BullMQ worker's main event loop → lock expiry, stalled re-delivery, duplicate exports | A user hits the 413 at export.routes.ts:67 on a 100-sheet / 20 000-item quote and follows the message to POST /api/quotes/:id/export. The worker picks it up and blocks its event loop inside … | **vá một phần** · mức thật: khong-dang-ke |
| `optimistic-lock-advisory-and-racy` | Optimistic concurrency check is opt-in (legacy SPA omits it → silent overwrite) and is a TOCTOU even when sent | (a) Two managers open the same quote in the React editor at t0. Both press Lưu within the ~50-200 ms window between :254 (read) and :329 (transaction start). Both read the same `existing.upd… | **vá một phần** · mức thật: nho |
| `hanoi-tables-unprotected-on-main-save` | Approved Hà Nội prices can be rewritten through the ordinary quote save, bypassing the hn approval state machine entirely | A manager assigns the Hà Nội part, the account fills it (5.000.000 đ), submits, the manager approves → hnStatus="approved", hnReviewedAt stamped. Any member with quote:update:own on that quo… | **vá một phần** · mức thật: khong-dang-ke |
| `plaintext-pii-columns-still-authoritative` | Plaintext PII columns are still written on every request and there is no executable cutover — the stated threat (leaked DB dump) is not mitigated at all | The entire justification for this subsystem (src/piiBox.ts:1-2, "dành cho các trường có sức sát thương cao nhất nếu bản dump CSDL bị lộ") is currently unrealised: `backup-db.sh` produces a d… | **còn mở** · mức thật: trung-binh |
| `no-pii-key-rotation-path` | Key rotation is documented in the DR runbook but not implementable — no old-key support, no key id in the ciphertext, and backfill skips already-encrypted rows | An operator who suspects PII_ENC_KEY leaked follows the runbook: sets the new key, runs `npm run pii:backfill`. The script prints `còn 0` (every row has piiVersion=1) and exits 0 — a green r… | **vá một phần** · mức thật: khong-dang-ke |
| `prod-deploy-bypasses-supply-chain` | Prod build image NGAY TRÊN VM — toàn bộ chuỗi cung ứng của CI (smoke image, SBOM, digest) bị bỏ qua | Deploy prod ngày 2026-08-25 từ ref X: image chạy ở gianguyen.cloud được dựng lại trên VM từ `git archive X`, không phải image mà CI đã smoke-test. Nếu VM có cache layer khác, npm registry tr… | **còn mở** · mức thật: trung-binh |

## P2 — 39 mục còn lại

| Mục | Vấn đề | Hệ quả nếu đúng | Trạng thái sau đối soát |
|---|---|---|---|
| `backup-codes-40-bit-unsalted-sha256` | MFA backup codes are 40-bit values stored as unsalted SHA-256 — trivially recovered from any DB dump, and the app ships a DB-dump endpoint | 2^40 ≈ 1.1e12 candidates; commodity GPU SHA-256 runs ~1e10/s, so each stored digest inverts in roughly a minute or two, and the search is shared across all users because there is no per-user… | **vá một phần** · mức thật: nho |
| `employee-directory-own-scope-not-enforced` | Danh bạ nhân sự: quyền employee:read/edit/delete:own KHÔNG lọc theo chủ sở hữu — mọi manager sửa/xoá được mục của người khác, và ai được tick 'Xem danh bạ của mình' đọc được CCCD + số tài khoản của TẤT CẢ | (a) Mặc định: manager A thêm 5 nhân công vào danh bạ; manager B (cũng vai trò manager) gọi DELETE /api/employees/<id-của-A> → xoá mềm được, hoặc PUT đổi số tài khoản ngân hàng của người khác… | **vá một phần** · mức thật: nho |
| `endpoint-inventory-cannot-detect-unguarded-route` | scripts/endpoint-inventory.mjs (chốt CI được coi là 'gác ma trận phân quyền') KHÔNG phân tích middleware — nó chỉ so MỘT con số tổng, nên một route mutation không gác quyền vẫn qua CI xanh | NHỮNG GÌ NÓ BẮT ĐƯỢC: route khai bằng literal trên `app.<method>(...)` trong src/app.ts và trên `router.<method>(...)` trong file được import đúng dạng `import X from "./routes/<tên>.js"` rồ… | **vá một phần** · mức thật: nho |
| `neutralize-apostrophe-visible` | neutralizeFormula để lọt dấu nháy ' vào file gửi khách với mọi hạng mục bắt đầu bằng "-" hoặc "+"; đồng thời bỏ sót khoảng trắng đứng trước = | Tên hạng mục tiếng Việt rất hay bắt đầu bằng gạch đầu dòng ("- Banner mặt tiền", "+ Phụ kiện") — mọi dòng như vậy in ra file .xlsx gửi khách hàng kèm một dấu nháy lạ ở đầu. Đây là tài liệu c… | **còn mở** · mức thật: nho |
| `quote-counter-lock-across-heavy-tx` | Khoá hàng QuoteCounter được giữ suốt transaction tạo báo giá (gồm ghi 60k dòng + snapshot) | Toàn công ty dùng chung một prefix (`Company.quotePrefix`, mặc định "GN" — `prisma/schema.prisma:328`), nên MỌI lượt tạo báo giá tranh cùng một hàng QuoteCounter. Hai người bấm "Tạo báo giá"… | **còn mở** · mức thật: trung-binh |
| `merge-venue-n-plus-1-in-tx` | Gộp rạp: 1 UPDATE/DELETE cho MỖI hạng mục bên trong interactive transaction 5s | Gộp một rạp có 200 hạng mục trùng tên khác cách gọi (đúng ca mà chú thích ở dòng 169-170 mô tả: "sheet gốc gọi cùng một rạp bằng nhiều tên") phát sinh tới 400 round-trip tuần tự trong một tr… | **vá một phần** · mức thật: nho |
| `gdpr-export-unbounded-memory` | Xuất dữ liệu GDPR kéo 1000 báo giá KÈM toàn bộ items/ảnh base64 rồi JSON.stringify + JSON.parse | Giới hạn ảnh mỗi item là 10 ảnh × 2.800.000 ký tự (`src/validators.ts:147-149`). Một tài khoản kỳ cựu có 1000 báo giá; chỉ cần trung bình 200KB ảnh/báo giá là 200MB rows. `JSON.stringify` dự… | **còn mở** · mức thật: trung-binh |
| `hn-internal-list-pulls-base64-proofs` | Danh sách báo giá cho tài khoản HN/nội bộ select nguyên extraTables — kéo cả ảnh chứng từ base64 của cả trang | Một tài khoản kế toán chi phí có `quote:read:all` + `quote:internal:view` mở trang danh sách với size=100: server SELECT jsonb extraTables của mọi sheet thuộc 100 báo giá, trong đó có ảnh ch… | **vá một phần** · mức thật: khong-dang-ke |
| `projectref-recomputes-from-items` | buildProjectRef kéo TOÀN BỘ QuoteItem của tới 1000 báo giá để tính lại subtotal đã được materialize | Mở trang Nhân sự (mặc định size=50 — `src/routes/personnel.routes.ts:51`) sinh tới ~200 mã ứng viên (`projectRef.ts:38-46` nhân 4 biến thể mỗi mã) → truy vấn kéo về tới 1000 báo giá kèm MỌI … | **vá một phần** · mức thật: khong-dang-ke |
| `update-quote-triple-full-read` | Một lần Lưu báo giá đọc toàn bộ sheets+items (kèm ảnh base64) BA lần | Với báo giá có cột "Hình ảnh" bật (`QuoteSheet.showImages`), mỗi item mang tới 10 ảnh base64 × 2.8MB (`src/validators.ts:147-149`). Một lần bấm Lưu kéo khối đó qua dây DB ba lượt, hai trong … | **vá một phần** · mức thật: trung-binh |
| `no-bullmq-metrics-worker-unscraped` | Zero metrics on the BullMQ queues, and the worker process exposes no /metrics endpoint at all so its counters are never scraped | Every metric the worker produces — `export_jobs_total{status="error"}`, default process metrics, memory — is written to a registry no one ever reads and discarded when the pod restarts. Comb… | **vá một phần** · mức thật: trung-binh |
| `sse-backplane-silent-degradation` | SSE Redis backplane can be absent or broken with no signal, and its publisher uses the infinite-retry options the codebase elsewhere documents as dangerous | With replicaCount 2, a failed or not-yet-ready backplane means a notification created on pod-1 (src/notifications.ts:71 `publish(userId, "notification", ...)`) and, more seriously, a `sessio… | **vá một phần** · mức thật: khong-dang-ke |
| `no-job-idempotency-no-async-export-limit` | No jobId/idempotency key on any enqueue, and the async export route has neither a dedicated rate limit nor a size cap | The async export route sits behind only the generic 120/min per-IP api limiter (src/app.ts:250-256). A user double-clicking "xuất nền", or the SPA retrying a POST whose response was lost, pr… | **vá một phần** · mức thật: nho |
| `uniform-job-options-across-queues` | One defaultJobOptions for five queues with different risk profiles; retention is count-only with no age bound, and maintenance inherits 3 retries | (a) Retention is count-only, so a queue that starts failing on a Friday keeps 5000 job payloads per queue in Redis indefinitely with no age ceiling — on the 256 MB instance, webhook payloads… | **vá một phần** · mức thật: khong-dang-ke |
| `counter-row-locked-for-whole-create` | The quote-number counter row is held locked for the entire create transaction, serialising all quote creation behind the slowest write | Two people create quotes for the same company at the same time — say both importing a large Excel (50 sheets). A grabs the GN/2026 counter row and holds it while writing ~25,000 items and a … | **còn mở** · mức thật: nho |
| `backup-files-world-readable` | DB dumps containing every CCCD/bank account/salary are created 0644 in a 0755 directory, contradicting the runbook's own claim | Any non-root local account or any container that bind-mounts a parent path on the Coolify host can `cat /opt/quanly-backups/quanly-*.sql.gz` and read the complete personnel database in clear… | **vá một phần** · mức thật: khong-dang-ke |
| `nas-password-in-process-table` | NAS_PASS is interpolated into a docker run argv, exposing it in the host process table on every backup | Any local user on the Coolify host running `ps aux` during the 02:00/02:30 window (or `docker inspect` on the transient container) reads the SMB credential for the Synology share that stores… | **vá một phần** · mức thật: nho |
| `object-mirror-count-check-silently-skipped` | backup-objects.sh's bucket↔mirror completeness check is silently skipped whenever `mc ls` fails | `mc mirror` (line 68) can succeed partially — e.g. it transfers what it can and returns 0 after a mid-run credential expiry or a transient endpoint error — while a subsequent `mc ls` fails o… | **vá một phần** · mức thật: khong-dang-ke |
| `orphan-staging-objects-never-deleted` | Abandoned presigned uploads leave their staging objects in the bucket forever — retention deletes the DB row but never the object | A client that calls /sign-upload, PUTs up to 10 MB (files.routes.ts:18 MAX_UPLOAD_BYTES) and never calls /finalize leaves that object under `uploads/staging/uN/...` permanently. Twenty such … | **vá một phần** · mức thật: khong-dang-ke |
| `exports-objects-never-pruned` | Every quote export is written to the bucket and never deleted — unbounded growth, now amplified into every backup | Every re-export of the same quote mints a new timestamped object (the key includes `Date.now()`), so a quote exported 50 times leaves 50 objects. Since 2026-08-11 the bucket is mirrored dail… | **vá một phần** · mức thật: trung-binh |
| `restore-drill-fills-production-volume` | Weekly restore-test/restore-drill create a full second copy of the production DB inside the production Postgres container with no disk-space precheck | Both timers fire on Sunday (install-backup.sh:92-93: restore-test 03:00, restore-drill 03:30) and each materialises a full copy of the production database on the same volume as production da… | **vá một phần** · mức thật: nho |
| `k8s-backup-path-incomplete` | The k8s/Helm deploy path has no PII key, no object-storage backup, and its DB CronJob writes non-atomically with no verification | Three separate failures. (a) A deploy from secret.example.yaml crash-loops immediately on config.ts:110. (b) If someone adds MFA_ENC_KEY but not PII_ENC_KEY and points the pod at the existin… | **vá một phần** · mức thật: trung-binh |
| `prod-compose-no-container-hardening` | Compose prod/staging — đường deploy THẬT — không có read_only / cap_drop / no-new-privileges, trong khi k8s và Helm đã siết hết | Prod thật sự chạy bằng compose (deploy.sh:23 `COMPOSE=docker-compose.prod.yml`), k8s/Helm mới là dự phòng. Nghĩa là lớp hardening duy nhất đang được kiểm ở CI (kubeconform, helm template) lạ… | **vá một phần** · mức thật: nho |
| `prod-compose-no-resource-limits` | Compose prod/staging không giới hạn RAM/CPU cho service nào — một job export chạy loạn hạ cả VM kể cả Postgres | Worker prod chạy exceljs + pdfkit + xlsxStitcher trên workbook nhiều sheet trong bộ nhớ (upload dùng memoryStorage). Một báo giá bất thường lớn → worker leo RAM không trần → OOM killer của k… | **vá một phần** · mức thật: nho |
| `no-migration-drift-or-destructive-gate` | CI không có gác trôi schema (`migrate diff`) lẫn gác SQL huỷ dữ liệu, dù repo đã có migration DROP COLUMN/TABLE | Hai lỗ riêng biệt. (1) TRÔI SCHEMA: sửa prisma/schema.prisma mà quên sinh migration — `migrate deploy` trên DB rỗng vẫn xanh nếu bộ test không chạm đúng cột đó; lên prod, `migrate deploy` là… | **vá một phần** · mức thật: nho |
| `sbom-not-attached-and-latest-tag-pushed` | SBOM chỉ là workflow artifact (hết hạn 90 ngày), không gắn vào image; đồng thời vẫn đẩy tag di động `latest` lên ghcr | Ba tháng sau, một CVE mới công bố. Image đang chạy prod tương ứng một digest cũ; artifact SBOM của run đó đã bị GitHub xoá theo retention → phải đoán từ package-lock.json của commit nào đó, … | **vá một phần** · mức thật: khong-dang-ke |
| `audit-not-append-only-actorid-nulled` | Nhật ký kiểm toán KHÔNG append-only: admin purge xoá cứng User làm AuditEvent.actorId bị set NULL hàng loạt | Một tài khoản bị vô hiệu hoá 30 ngày trước, chưa từng tạo báo giá/khách hàng (đúng hồ sơ của tài khoản bị lạm dụng rồi khoá), lọt qua mọi guard và bị xoá cứng. Postgres im lặng NULL hoá acto… | **còn mở** · mức thật: trung-binh |
| `env-schema-drift-secrets-undocumented` | .env.example thiếu gần hết biến bắt buộc/quan trọng; nhiều biến chỉ đọc thẳng process.env, không qua schema | Người dựng lại hệ thống (kịch bản DR ở docs/DR-runbook.md:28 nói "điền `.env`") không có nguồn nào liệt kê đủ biến: .env.example thiếu, docker-compose.prod.yml chỉ có dòng comment nói "toàn … | **vá một phần** · mức thật: nho |
| `retain-audit-days-unvalidated` | RETAIN_AUDIT_DAYS: nút xoá nhật ký kiểm toán, không nằm trong schema, không kiểm giá trị, chạy tự động hằng ngày | `RETAIN_AUDIT_DAYS=-1` (gõ nhầm, hoặc ai đó nghĩ số âm nghĩa là "tắt") cho `days(-1)` = NGÀY MAI → điều kiện `createdAt < ngày mai` đúng với MỌI dòng → 03:00 hôm sau xoá sạch toàn bộ nhật ký… | **vá một phần** · mức thật: nho |
| `api-process-crashes-never-reach-sentry` | Tiến trình API không báo crash lên Sentry và không flush khi tắt — trong khi worker thì có đủ | Lỗi lọt ra ngoài errorHandler — timer, callback stream (ví dụ stream pg_dump ở src/routes/admin.routes.ts:88-94), promise trong `void`/`.then()` như src/db.ts:76 hay src/server.ts:36 — chỉ h… | **còn mở** · mức thật: nho |
| `metrics-unreachable-shipped-scrape-config` | /metrics không thể scrape được với chính cấu hình giám sát repo ship: prod fail-closed 404, ServiceMonitor không mang token | Hai nhánh, cả hai đều mù: không đặt METRICS_TOKEN → prod trả 404 cho mọi lần scrape; đặt METRICS_TOKEN → ServiceMonitor scrape không kèm bearer → 401. Toàn bộ số liệu đã dựng công phu trong … | **vá một phần** · mức thật: khong-dang-ke |
| `sentry-receives-webhook-job-payload-pii` | Payload job (dữ liệu khách hàng/báo giá) được gửi nguyên vẹn sang Sentry khi job lỗi | Mỗi lần một webhook đích trả 500 hoặc timeout (chuyện bình thường với tích hợp bên thứ ba), toàn bộ payload — tên khách hàng, thông tin liên hệ, dữ liệu báo giá — được gửi ra dịch vụ Sentry … | **vá một phần** · mức thật: khong-dang-ke |
| `payment-proof-read-not-audited` | Xem ảnh chứng từ thanh toán (chứng cứ tài chính) không để lại dấu vết, trong khi tải hợp đồng thì có | Ảnh chứng từ là ảnh uỷ nhiệm chi / màn hình chuyển khoản — chứa số tài khoản, tên chủ tài khoản, số tiền. Ai xem, xem hồ sơ của ai, lúc nào: không có dữ liệu. Khi có tranh chấp chi trả hoặc … | **vá một phần** · mức thật: khong-dang-ke |
| `missing-limiters-token-endpoints` | Thiếu limiter riêng cho các endpoint đoán token và cho truy vấn nặng (search, analytics) | Token mời/reset là 48 ký tự hex (authService.ts:121) nên không brute-force được về mặt toán học, nhưng 120 req/phút không giới hạn cho phép quét liên tục và, quan trọng hơn, không có tín hiệ… | **vá một phần** · mức thật: nho |
| `codex-security-336mb-postinstall` | A 336 MB vendored Codex binary is pulled by a dev-only scanner CI never runs, plus a 503-line postinstall hook that only does anything on Windows | Every CI run downloads ~672 MB of a Codex CLI binary that no CI step executes, and the Docker `build` stage downloads it a third time into a layer that is then thrown away. The postinstall t… | **vá một phần** · mức thật: nho |
| `paintsel-quadratic` | paintSel dò DOM O(hàng²) — Ctrl+A / Ctrl+Space / kéo chọn trên sheet vài trăm dòng làm treo giao diện | Sheet 800 dòng × 8 cột dữ liệu. Bấm Ctrl+A để copy cả bảng: 6.400 lần querySelector, mỗi lần quét tối đa 800 <tr> ≈ 5 triệu phép so khớp thuộc tính → tab đứng vài giây. Vùng chọn còn giữ sau… | **vá một phần** · mức thật: khong-dang-ke |
| `extra-table-delete-no-confirm` | Xoá cả một sheet BẢNG NỘI BỘ (chi phí HCM / HN / phí KH) chỉ bằng một cú bấm ✕, không hỏi, không undo | Kế toán muốn chuyển từ tab "Bảng 1" sang "Bảng 2" của Chi Phí HCM, bấm trượt vào ✕ ngay bên phải nhãn. Cả bảng chi phí HCM (vài chục dòng nhân công/vật tư + trạng thái duyệt + đánh dấu thanh… | **vá một phần** · mức thật: khong-dang-ke |
| `accounthn-no-optimistic-lock` | Màn hình "Phần Giá Hà Nội" lưu đè không kiểm tra xung đột — khoá lạc quan 409 chỉ có ở QuoteEditor | Account HN mở báo giá lúc 9:00 và điền dần 3 bảng HN. 9:20 sale mở cùng báo giá ở editor chính, sửa hạng mục rồi Lưu. 9:35 Account HN bấm 💾 Lưu — request đi thẳng, không mốc, ghi đè lên bản … | **vá một phần** · mức thật: nho |
| `meta-inputs-force-full-grid-rerender` | Ô VAT / Giảm giá / Ngày / Tên sheet gọi redraw() mỗi phím → vẽ lại TOÀN BỘ GridTable (không memo, không throttle) | Sheet 600 dòng. Kế toán gõ ô "Giảm giá" số 3500000 (7 phím) → 7 lần setTick → 7 lần vẽ lại ~4.800 ô của GridTable, mỗi lần cỡ 40-70ms theo chính đo đạc ghi trong comment → nuốt phím, con trỏ… | **còn mở** · mức thật: nho |

## P3 — 12 mục còn lại

| Mục | Vấn đề | Hệ quả nếu đúng | Trạng thái sau đối soát |
|---|---|---|---|
| `logout-leaves-refresh-tokens-alive` | POST /api/auth/logout destroys the cookie session but leaves every refresh token of that user valid | A user who has used both surfaces from the same device — the SPA cookie plus a token obtained from POST /api/auth/token (src/routes/auth.routes.ts, route `router.post("/token", …)`) — clicks "Đăng xuất", sees the UI log … | **vá một phần** · mức thật: khong-dang-ke |
| `username-email-case-sensitivity` | Login/invite lookups are byte-exact, so email casing splits one human into two accounts and locks the other out with a generic 401 | Two failure modes, both real for an internal tool where accounts are created by typing an address into an invite form. (1) An admin invites `Nam.Tran@giaNguyen.vn` today and `nam.tran@giangu… | **vá một phần** · mức thật: nho |
| `webp-logo-silently-dropped` | Logo WEBP được zod chấp nhận nhưng excel.ts bỏ qua im lặng, để lại chữ placeholder của mẫu trong file gửi khách | Khách gửi logo .webp (định dạng mặc định khi lưu ảnh từ Chrome). Thuộc tính `accept` của input chỉ là gợi ý — hệ điều hành vẫn cho chọn — và API thì chấp nhận, UI hiện logo bình thường. Nhưn… | **vá một phần** · mức thật: nho |
| `emitchange-broadcast-not-authz-filtered` | emitChange broadcasts entity/action/id to every connected user — the same leak class that was already fixed for presence | Any logged-in account — including `account_hn`, which is explicitly barred from seeing pricing (src/routes/export.routes.ts:22-27) — can sit on the SSE stream and record that quote id 4711 w… | **vá một phần** · mức thật: khong-dang-ke |
| `queue-dead-code-and-readyz-blind` | createQueueEvents is dead code and exportGateStats is exported but never used, so /readyz stays green on a saturated app pod | A pod whose export gate is completely full (3 active + 20 queued, exportQueue.ts:98-99) is answering /api/export/* with 503 for everyone, yet /readyz returns `{ ok: true }` (app.ts:290), so … | **vá một phần** · mức thật: khong-dang-ke |
| `savable-but-unexportable-quotes` | The save validator allows 3x more items than the synchronous export will accept, so a user can build a quote they can never export | A user builds the owner-described 50 sheets × 500 rows quote (25,000 items). It saves (under the 60/1000 caps). Then Xuất Excel returns 413 "Báo giá quá lớn để xuất trực tiếp — vui lòng dùng… | **còn mở** · mức thật: nho |
| `upload-objects-have-no-stored-hash` | uploads/ and exports/ objects store no content hash, so backup integrity can only ever be verified for payment proofs | After a bucket restore from the mirror, silent bit-rot or a partial `mc mirror` in an attachment or an export is undetectable — there is no recorded digest to compare against. The manifest s… | **vá một phần** · mức thật: nho |
| `compose-mutable-tags-and-no-log-rotation` | Compose dùng tag di động (:latest, :16-alpine, :7-alpine) và không giới hạn log — đĩa VM prod đầy dần | (1) `docker compose pull` bất kỳ lúc nào có thể kéo postgres:16-alpine bản patch mới, khởi động lại prod với binary khác mà không ai chủ ý — trái với chính sách bất biến mà chart đang thi hà… | **vá một phần** · mức thật: khong-dang-ke |
| `dead-config-vars` | Biến cấu hình chết: WEBHOOK_SECRET không nơi nào đọc; STRIPE_* trong Helm không tồn tại trong code | WEBHOOK_SECRET nằm trong schema tạo ấn tượng có cơ chế xác thực webhook vào — người bảo trì sau sẽ đặt giá trị cho nó rồi tin là đã bật một lớp bảo vệ không hề tồn tại. STRIPE_* còn tệ hơn: … | **vá một phần** · mức thật: nho |
| `demo-seed-hardcoded-password-no-prod-guard` | Mật khẩu demo hard-code trong repo và seed demo thiếu chốt NODE_ENV mà hai script phá huỷ khác đều có | Chỉ cần một dòng lệnh gõ nhầm trong thư mục repo trên VM prod với `.env` prod đang nạp (`ALLOW_DEMO_SEED=1 npm run seed:demo`) là tạo hàng loạt tài khoản trên CSDL production với mật khẩu "G… | **vá một phần** · mức thật: nho |
| `dead-exports-src` | Four exported symbols in src/ have zero references anywhere in the repo, including their own file | `exportGateStats` is the visible cost: a reader adding export-queue observability finds a ready-made stats function, wires it up, and ends up publishing the same numbers twice under two nami… | **còn mở** · mức thật: nho |
| `unreferenced-root-and-scripts` | editor.png plus four operational scripts are reachable from nothing — no npm script, no CI step, no Dockerfile, no doc | `editor.png` is 155 KB of tracked binary that every clone and every `git archive` in deploy.sh:36 carries to both servers for no reason, and it is the kind of file nobody dares delete becaus… | **vá một phần** · mức thật: khong-dang-ke |

---

## Đối chiếu PHASE của MASTER PROMPT — cái gì XONG, cái gì CHƯA (2026-08-27)

Đối chiếu mục **49. THỨ TỰ TRIỂN KHAI** (PHASE 0→9) của prompt gốc với repo ở HEAD.
Mỗi dòng đều kiểm bằng file thật, không kiểm bằng trí nhớ.

| Phase | Trạng thái | Bằng chứng / chỗ hụt |
|---|---|---|
| 0 · Baseline | **xong** | `docs/` 26 file, 6 ADR, `web/src/bench.tsx`, 166 file test |
| 1 · P0 Production Risk | **xong** | `scripts/backup/backup-objects.sh` · `BACKUP_RESTORE.md` + `DISASTER_RECOVERY.md` · `src/tools/piiRotate.ts` + `verifyIntegrity.ts` · 31 file test bảo mật |
| 2 · Security | **xong** | ADR-0005 CSRF · `ROLES_PERMISSIONS.md` + `endpoint-inventory.mjs` (137/137 hai chiều) · break-glass ở `userService.ts` |
| 3 · Production Runtime | **xong** | `tsconfig.build.json` · 4 khối `cap_drop` trong compose · `exportGateStats` |
| 4 · CI/CD | **CHƯA — xem dưới** | mọi thứ nằm trong `.github/workflows/ci.yml`, mà file đó **không chạy** |
| 5 · Observability | **một phần** | có: `src/observability.ts`, `SLO.md`, `/metrics`. Thiếu: **không một rule cảnh báo nào**; Loki/Grafana mới chỉ có trong `MONITORING.md`, chưa có cấu hình chạy |
| 6 · Performance | **xong** | 92 lệnh `CREATE INDEX` · bench frontend · lưu báo giá ghép sheet thay vì xoá-tạo |
| 7 · Architecture Cleanup | **xong** | tách service/route, `quoteUtils`/`money`/`permissions` tách bạch, ADR ghi ranh giới |
| 8 · Repository Cleanup | **xong** | gỡ SPA cũ, dọn gốc repo, `docs/` tái cấu trúc, `repo-stats --check` canh số |
| 9 · Final QA | **một phần** | `npm run verify` xanh trọn (1271 test + web 187). Thiếu: quét bảo mật và mô phỏng deploy **chưa chạy thật lần nào** |

### PHASE 4 hụt hẳn — và đây là chỗ hụt lớn nhất còn lại

Prompt đòi 5 thứ. Đo ở HEAD:

| Đòi | Thật |
|---|---|
| Playwright smoke | **không có** — `find . -name "*e2e*"` ra 0, `package.json` không có playwright |
| Helm checks | chỉ `helm lint`; 4 bất biến chart trong `ci.yml` (render đầy đủ, từ chối `image.tag=latest`, từ chối mật khẩu rỗng, kubeconform) **không chạy ở đâu** |
| Docker smoke | **không có** — không nơi nào dựng image rồi thử nó |
| SBOM | chỉ là văn bản trong `ci.yml` |
| Ghim nguồn cung | **có** — 2 image ghim `sha256:` trong compose |

Gốc rễ: tài khoản GitHub không bật Actions, nên `ci.yml` là **tài liệu về những cổng
cần chạy, không phải cổng đang chạy**. `scripts/verify-local.sh` thay được phần lớn,
nhưng **không** thay được ba thứ cần Docker/trình duyệt: smoke test artifact
production, dựng + smoke image Docker, và job `security` (gitleaks · trivy · semgrep).

Chúng canh đúng thứ đi ra production, mà hiện không ai canh cả. Đây là việc đáng làm
tiếp nhất.

### Những mục nhỏ hơn còn mở

- `verify-local.sh` bước `[0/9]` kiểm Postgres/Redis ở địa chỉ **mặc định**, không phải
  địa chỉ trong `DATABASE_URL`/`REDIS_URL` (chốt hạ tầng mới đã ép chúng phải cục bộ,
  nên hậu quả hẹp lại — nhưng vẫn là kiểm nhầm thứ).
- Không bước nào chạy `npm ci`: `package.json` lệch `package-lock.json` thì verify vẫn
  xanh, còn Docker và `ci.yml` đỏ ngay ở bước cài.
- `npm run build` ở bước `[2b]` **không dọn** `dist/`. Xoá một file nguồn thì artifact cũ
  nằm lại và bài `node dist/...` vẫn xanh. (Đã kiểm: hiện **0 file mồ côi**, và Dockerfile
  dựng `dist/` trong container sạch nên production không dính. Rủi ro chỉ ở máy local.)
- Ngưỡng của `tests/b2-update-quote-no-image-read.test.js` tự hiệu chuẩn từ một phép đo
  **chỉ có chặn dưới** (`toBeGreaterThan(200)`). Một lượt hiệu chuẩn bị nhiễu đẩy ngưỡng
  lên cao sẽ làm khẳng định chính trở nên rỗng mà không ai biết.
- Bước `[1b]` in ✓ kể cả khi **không bài đo nào chạy** — nó không khẳng định phép đo đã
  thật sự diễn ra (chỉ khẳng định lệnh thoát 0).

### Định nghĩa HOÀN THÀNH (mục 52) — chỗ chưa đạt

Mọi ô khác đã đạt. Ba ô chưa:

- **Security → security scans pass**: chưa chạy thật lần nào (gitleaks/trivy/semgrep).
- **Operations → dashboards, alerts**: không có rule cảnh báo, không có dashboard chạy.
- **Backup → off-host copy**: script có, nhưng chưa có bằng chứng đã chạy trên máy chủ thật.

## Đối chiếu PHỤ LỤC "TECHNOLOGY MODERNIZATION & MIGRATION AUTHORITY" (2026-08-27)

Phụ lục này nằm ngay sau mục 52 của MASTER PROMPT, gồm 21 mục. Tinh thần của nó (mục 21):
chọn **công nghệ đơn giản nhất đủ đáp ứng 3–5 năm tới**, không giữ bằng mọi giá và cũng
không thay bằng mọi giá.

Phần lớn phụ lục là các quyết định **giữ nguyên có lý do**, và mục 2 mô tả "PREFERRED
TARGET STACK" đúng bằng thứ repo đang chạy:

```
React SPA → Express → Domain/Service → Prisma → PostgreSQL
Redis (session · rate limit phân tán · Pub/Sub · BullMQ) · BullMQ workers
Storage Adapter → kho object S3-compatible
```

| Mục | Trạng thái | Ghi chú |
|---|---|---|
| 1 · Decision matrix | áp dụng | mọi quyết định giữ/thay đều ghi lý do trong ADR |
| 2 · Preferred target stack | **khớp sẵn** | không phải làm gì — repo đã đúng hình dạng đó |
| 3 · TypeScript production | **xong** | `tsx src/server.ts` → `node dist/server.js`; 5 chỗ dùng `dist/` (Dockerfile + Helm); ADR-0002 |
| 4 · Background job | giữ BullMQ | đúng khuyến nghị |
| 5 · Redis | giữ | đúng khuyến nghị |
| 6 · Realtime | giữ SSE | ADR-0004 ghi lý do không dùng WebSocket |
| 7 · Storage | **xong** | Storage Adapter → S3; ADR-0003 |
| 8 · Auth | giữ | session + Bearer + MFA |
| 9 · Database | giữ PostgreSQL | đúng khuyến nghị |
| 10 · ORM | giữ Prisma | đúng khuyến nghị |
| 11 · Framework | giữ Express | đúng khuyến nghị |
| 12 · Microservices | **cố ý KHÔNG** | ADR-0001 modular monolith |
| 13 · Message broker | **cố ý KHÔNG Kafka** | BullMQ đủ cho tải thật |
| 14 · Search | giữ PostgreSQL | cột `searchText` trong `schema.prisma` |
| 15 · Deployment | Level 1→2 | compose đang chạy; Helm/k8s sẵn sàng nhưng chưa bắt buộc |
| 16 · Observability | **CHƯA XONG** | xem dưới |
| 17 · Secrets | **CHƯA XONG** | xem dưới |
| 18 · Build & release | **một phần — theo quyết định của chủ dự án** | xem dưới |
| 19 · Migration rule | tuân thủ | không có big-bang migration nào trong đợt này |
| 20 · Implement, don't recommend | tuân thủ | mọi phát hiện đều vá + test + kiểm ngược, không dừng ở báo cáo |
| 21 · Final target | tuân thủ | không thêm công nghệ nào mới |

### 16 · Observability — thiếu nửa sau của chuỗi

Có: Pino (`src/logger.ts`), Prometheus (`src/observability.ts`, `/metrics` cho cả app lẫn
worker), Sentry, `SLO.md`.

Thiếu: **Loki và Grafana mới chỉ tồn tại trong `docs/operations/MONITORING.md`** — không có
cấu hình chạy, không có datasource, không có dashboard. Và **không một rule cảnh báo nào**
(`find infra -iname "*alert*"` ra rỗng).

Nghĩa là: số liệu có được sinh ra, nhưng không ai đang nhìn và không gì đánh thức người
trực. `SLO.md` mô tả mục tiêu mà không có thứ gì đo được vi phạm.

### 17 · Secrets — chưa có lớp trừu tượng

Phụ lục đòi thiết kế abstraction để production dùng được Docker secrets / Kubernetes
Secrets / Vault. Hiện `src/config.ts` chỉ đọc `process.env`; không có quy ước `*_FILE`
(cách chuẩn để nhận Docker/K8s secret dạng file), không có lớp nạp thay thế.

Hệ quả thực tế hôm nay: hẹp — mọi bí mật đi qua `.env` trên VM. Nhưng nó chặn đường lên
Level 2/3 của mục 15, vì Helm/k8s muốn dùng Secret dạng file thì ứng dụng phải đọc được.

### 18 · Build & release — lệch có CHỦ Ý, không phải bỏ sót

Phụ lục viết: *"Production không build source lại trên server."* Hiện `deploy.sh` **mặc định
vẫn `docker compose build` ngay trên VM**.

Đây **không phải** thiếu sót của đợt này. Khi được hỏi, chủ dự án đã chọn: *"Thêm đường kéo
digest, mặc định giữ nguyên"*. Nên đường kéo theo digest đã được làm (`IMAGE_REF=…`, 11 chỗ
tham chiếu trong `deploy.sh`) và để **tuỳ chọn**; mặc định giữ build-trên-VM theo đúng ý đó.

Muốn tuân thủ hẳn mục 18 thì phải đảo mặc định — và điều đó cần CI dựng image, tức phụ
thuộc PHASE 4 ở mục trên. Hai việc này đi cùng nhau.

## Ghim phụ thuộc bằng `overrides` (2026-08-27)

`package.json` có ba mục `overrides`. Chúng KHÔNG có chỗ ghi chú (npm từ chối khoá `"//"` bên
trong `overrides` — đã thử, lỗi `Override without name`), nên lý do nằm ở đây.

| Gói | Ghim | Vì sao |
|---|---|---|
| `deepmerge-ts` | `^8.0.2` | `@prisma/config@7.9.1` ghim **chính xác** `7.1.5`, dính GHSA-ggr8-5vv4-36mx (stack exhaustion khi merge đồ thị object đệ quy, mức **high**). Không có bản prisma 7.x nào thoát. |
| `@opentelemetry/core` | `^2.8.0` | (có từ trước đợt này) |
| `uuid` | `^11.1.1` | (có từ trước đợt này) |

### Vì sao không `npm audit fix --force`

Nó tụt `prisma` về **6.12.0** — đổi lớn, và repo đang ở schema/API của prisma 7.

### Đã kiểm những gì trước khi ghim `deepmerge-ts@8`

`deepmerge-ts@8.0.2` **không có phụ thuộc nào** (`npm view deepmerge-ts@8.0.2 dependencies` trả
rỗng), nên bề mặt rủi ro của chính bản ghim là nhỏ nhất có thể. Đo trên máy, cùng lượt:

- `npx prisma generate` · `validate` · `migrate status` · `migrate deploy` — cả bốn chạy trọn
- `npm run verify` đầy đủ: 162 file test / 1227 xanh, web 163 xanh, build backend + web xanh
- `npm audit --omit=dev --audit-level=high` → `found 0 vulnerabilities`

### Khi nào gỡ

Khi `@prisma/config` tự nâng lên `deepmerge-ts@8`. **Không phải chuyện tuỳ hứng: để lâu là có
hại.** `overrides` không giới hạn theo gói cha, nên khi prisma nâng lên `deepmerge-ts@9` thì dòng
`^8.0.2` của ta sẽ **âm thầm kéo nó xuống 8.x** — prisma chạy với bản thư viện nó không được thử
cùng, và không có gì báo.

### ⚠️ `npm audit` KHÔNG canh chuyện này — đừng trông vào nó

Bản đầu của mục này viết: *"Gỡ dòng override rồi chạy `npm run verify`: bước `[9/9] Phụ thuộc` sẽ
đỏ ngay"*. **Đo lại thì SAI.** `npm audit` đọc **cây đã cài** (`node_modules` + `package-lock`),
không đọc `overrides` trong `package.json`. Xoá dòng override mà chưa `npm install` → audit vẫn
thoát 0, toàn bộ cổng xanh. Người xoá nó tin là an toàn; lần `npm ci` kế tiếp (máy khác, hoặc
trong Dockerfile) mới cài lại 7.1.5 dính lỗ hổng — lúc đó không ai đang nhìn.

Thứ **thật sự** canh là `tests/x2-override-deepmerge.test.js`. Nó đọc `package.json` và bản ghim
thật của `@prisma/config` trong `node_modules`, rồi bắt hai bên nhất quán theo cả hai chiều:

- gỡ override khi prisma còn ghim 7.x → **đỏ**;
- giữ override khi prisma đã lên >= 8 → **đỏ**, kèm hướng dẫn gỡ.

Nói cách khác: ngày cần gỡ, bộ test sẽ tự nói. Không phải nhớ.

## Hạn chế đã biết của hệ thống (không phải lỗi, là đánh đổi)

Những cái này là lựa chọn có chủ ý, ghi ra để không ai phải phát hiện lại:

- **`style-src 'unsafe-inline'` vẫn bật** — hai SPA render rất nhiều `style=""`.
  Bỏ nó đòi refactor hàng trăm chỗ. `script-src` thì đã `'self'` thuần.
- **Presence SSE là in-process** — nhiều replica thì danh sách "ai đang sửa"
  không đầy đủ. Bản thân sự kiện SSE thì đã lan qua Redis Pub/Sub.
- **Chưa có tổng hợp log tập trung** (Loki hoặc tương đương). Log dừng ở stdout.
- **Chưa có Prometheus/Grafana chạy production** — nên mọi mục tiêu độ trễ trong
  [operations/SLO.md](operations/SLO.md) còn là giả định, chưa phải số đo.
- **Chưa có E2E trình duyệt trong CI** — clipboard, IME tiếng Việt và undo/redo
  chỉ được bảo vệ bởi test đơn vị trên hàm phân tích.
- **Rate limit bỏ qua khi Redis chết** — đánh đổi có chủ ý; khoá tài khoản khi
  sai mật khẩu nhiều lần nằm ở CSDL nên vẫn còn.
- **VM production là điểm hỏng đơn** — xem
  [operations/DEPLOYMENT.md](operations/DEPLOYMENT.md).

---

## Còn nợ sau đợt siết xác thực (cụm auth-session, 2026-08-26)

Ba việc dưới đây KHÔNG được vá bằng mã trong đợt này. Ghi ra vì mỗi cái đều là
rủi ro đang chạy thật, không phải giả định.

- **Mã dự phòng MFA CŨ vẫn còn nguyên trong CSDL và vẫn dùng được.** Bản vá tăng
  entropy (`src/mfa.ts`: `randomBytes(5)` → `randomBytes(10)`, băm SHA-256 trần →
  bcrypt) chỉ áp cho mã **sinh mới**. Người đã bật MFA trước bản vá vẫn giữ 8 mã
  40 bit băm SHA-256 KHÔNG MUỐI, và `consumeBackupCode` cố ý còn nhận chúng để
  không khoá họ ra khỏi tài khoản. Không có đường tự nâng cấp: mã cũ chỉ biến mất
  khi người dùng **tắt rồi bật lại MFA**. Ai lấy được một bản dump CSDL quét cạn
  không gian 2^40 trong vài giờ trên một GPU, rồi dùng mã tìm ra để VƯỢT và TẮT
  MFA — mà mã dự phòng không bị vô hiệu khi đổi mật khẩu, nên nó là thông tin
  đăng nhập sống rất dai.
  **Việc phải làm bằng tay:** yêu cầu mọi tài khoản có `mfaEnabled = true` từ
  trước 2026-08-26 tắt rồi bật lại MFA (hoặc viết một endpoint sinh lại mã dự
  phòng). Danh sách:
  `SELECT id, username FROM "User" WHERE "mfaEnabled" AND EXISTS (SELECT 1 FROM unnest("mfaBackupCodes") c WHERE c !~ '^\$2');`
- **Không có endpoint admin nào gỡ / đặt lại MFA hộ người dùng.** Từ khi
  `/accept-invite` có cổng MFA, người bật MFA mà mất thiết bị **và** mất luôn mã
  dự phòng thì không còn đường phục hồi nào trong sản phẩm — giao diện đã được vá
  để nhập được mã dự phòng ở cả màn đăng nhập lẫn màn đặt-lại-mật-khẩu, nhưng ai
  mất cả hai thì phải nhờ người có quyền vào CSDL:
  `UPDATE "User" SET "mfaEnabled" = false, "mfaSecret" = NULL, "mfaBackupCodes" = '{}', "mfaLastStep" = NULL WHERE username = '...';`
  (sau đó thu hồi refresh token của tài khoản đó). Nên làm hẳn một endpoint có
  ghi nhật ký kiểm toán thay cho thao tác tay này.
- **`POST /auth/logout` thu hồi MỌI refresh token của tài khoản**, không riêng
  phiên đang đăng xuất. Hôm nay vô hại vì chưa client nào dùng `/auth/token`.
  Khi có client di động thì đăng xuất trên điện thoại sẽ giết luôn quyền gọi API
  của máy tính (còn cookie máy tính thì vẫn sống) — hành vi bất đối xứng, cần
  thu hồi theo HỌ token của đúng phiên đó.
- **Bật trần tuổi thọ tuyệt đối cho phiên cookie sẽ ĐÁ MỌI NGƯỜI ĐANG ĐĂNG NHẬP
  RA ĐÚNG MỘT LẦN, ngay lần triển khai đầu tiên.** `enforceActiveUser`
  (`src/middleware.ts`, `SESSION_MAX_AGE_DAYS = 30`) huỷ phiên khi
  `Date.now() - session.authAt` vượt trần, **và cũng huỷ phiên KHÔNG có
  `authAt`** — fail-closed, vì chọn hướng ngược lại thì xoá một khoá trong phiên
  là vô hiệu hoá được chốt. `authAt` chỉ được đặt trong `establishSession`, nên
  mọi phiên sinh ra trước bản vá đều thiếu nó. **Việc phải làm:** báo trước cho
  người dùng là họ phải đăng nhập lại một lần sau lần triển khai này; các lần
  triển khai sau không còn hiện tượng đó. Chưa đo trên production (không có
  Docker/cluster trong môi trường phát triển) — mới chỉ chứng minh bằng test tích
  hợp `tests/authsess-session-absolute-ttl.test.js` chạy qua express-session thật.

## Chứng từ thanh toán di sản — cần một lần chạy TRÊN PRODUCTION

`PersonnelRecord.paymentProof` (base64 trong CSDL) đã được thay bằng kho object từ
migration `20260811200000_payment_proof_object`, nhưng migration đó **chỉ thêm cột** —
việc chuyển dữ liệu nằm ở script chạy tay `scripts/migration/payment-proof-migrate.mjs`.

Đợt này đã vá phần **mã**: hai route ghi (`/api/quotes/:id/extra/:sheetId/:rid/pay`,
`/api/personnel/:id/payment`) nay kiểm data-URL **toàn chuỗi** thay vì chỉ tiền tố, và
`readProofDataUrl` (`src/paymentProof.ts`) trả `null` + ghi log cảnh báo nếu giá trị di
sản không phải data-URL ảnh hợp lệ. Đo được bằng `tests/qua-proof-dataurl.test.js`.

**Chưa kiểm chứng được ở đây:** có bao nhiêu hàng di sản còn lại trên production, và
trong đó có hàng nào thực sự chứa chuỗi dị dạng hay không — môi trường phát triển
không có dữ liệu thật. Bản vá là **hỏng-an-toàn** (ảnh dị dạng biến mất khỏi giao
diện) chứ không sửa dữ liệu, nên nếu có hàng hợp lệ-nhưng-lạ (ví dụ base64 xuống dòng)
thì người dùng sẽ thấy "chưa có ảnh chứng từ" thay vì ảnh.

**Việc phải làm:**

```sql
-- 1) còn bao nhiêu hàng chưa chuyển
SELECT count(*) FROM "PersonnelRecord" WHERE "paymentProof" IS NOT NULL;
-- 2) trong đó bao nhiêu hàng KHÔNG khớp kiểm toàn chuỗi (sẽ bị trả null sau bản vá)
SELECT id FROM "PersonnelRecord"
 WHERE "paymentProof" IS NOT NULL
   AND "paymentProof" !~* '^data:image/(png|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}$';
```

Chạy `scripts/migration/payment-proof-migrate.mjs`, xác minh truy vấn (1) trả về 0, rồi
mới bỏ cột cũ ở một migration riêng.

## Lưu được 60.000 dòng nhưng xuất đồng bộ chỉ tới 20.000 — ĐÃ NỐI đường nền (2026-08-27)

`src/validators.ts:270` cho **60 trang** × `:194` **1000 dòng/trang** = tối đa
**60.000 item** một báo giá. Đường xuất đồng bộ `src/routes/export.routes.ts:35-41`
lại từ chối từ **20.000 item** (trả 413 ở `:67` và `:105`) với lời nhắn "vui lòng
dùng xuất nền (async)". Nhưng **không client nào gọi đường nền**: `grep -rn
"api/jobs\|/jobs" web/src` không ra kết quả nào — route `POST /api/quotes/:id/export`
(`src/routes/jobs.routes.ts:17`) chỉ có thể gọi bằng tay, và nó còn trả 503 nếu
thiếu Redis hoặc kho object. Người dùng lưu được báo giá rồi mới phát hiện không
tải được, không có cảnh báo nào từ trước.

**Trần 20.000 KHÔNG nên nâng.** Đo trên máy này (Node 22, `buildQuoteBuffer`,
template `marico_decor`, 1000 dòng/trang):

| Kích thước | Thời gian | File | RSS sau |
|---|---|---|---|
| 5.000 item | 2,6 s | 2,5 MB | 172 MB |
| 20.000 item | 7,7 s | 10,1 MB | 270 MB |
| 60.000 item | 20,8 s | 30,7 MB | 393 MB |

20,8 giây chặn event loop cho một request là không chấp nhận được, nên chốt chặn
hiện tại đúng — vấn đề nằm ở phía LƯU và phía giao diện, không phải ở phía xuất.

**Chưa xảy ra trong thực tế:** tải trọng thật theo tài liệu là 50 trang × 200 dòng
= 10.000 item, tức mới dùng một nửa headroom. Vì vậy đây là mục **UX/headroom**,
không phải lỗi đang gây hại.

### ĐÃ NỐI (2026-08-27) — ngõ cụt đã đóng

`web/src/lib/exportQuote.ts` thay cho `window.open` ở cả hai nơi gọi
(`QuoteList.tsx`, `QuoteEditor.tsx`). `window.open` giao thẳng phản hồi cho trình
duyệt nên **413 không bao giờ tới được JavaScript** — đó là lý do gốc khiến lời
nhắn "vui lòng dùng xuất nền" không dẫn tới đâu.

Luồng mới: `fetch` đường đồng bộ → 200 thì tải ngay (không đổi gì với người dùng)
→ gặp 413 thì tự `POST /api/quotes/:id/export`, hỏi `GET /api/jobs/export/:jobId`
tới khi xong, rồi tải từ URL đã ký worker trả về.

Tải bằng thẻ `<a download>` chứ không `window.open`/`location.href`: bước nền là
bất đồng bộ, mà mọi cách mở cửa sổ **sau** một `await` đều có thể bị chặn pop-up.

Chốt bằng `web/src/lib/exportQuoteAsync.test.ts` (8 bài, chặn `fetch` ở mức mạng).
Đã kiểm ngược: gỡ nhánh 413 ra thì 4/8 bài đỏ ngay.

**Vẫn cần Redis + kho object.** Thiếu thì `POST /api/quotes/:id/export` trả 503
kèm `code: "export_async_unavailable"`, và giao diện nói thẳng là phải nhờ quản
trị viên bật — thay vì để người dùng đoán. Trần 20.000 **giữ nguyên**, không nâng.

**Còn lại (chưa làm):** cảnh báo NGAY LÚC LƯU khi báo giá vượt ngưỡng xuất đồng
bộ, để người dùng biết trước chứ không phải tới lúc bấm Tải mới biết. Muốn làm thì
đưa `MAX_EXPORT_SHEETS`/`MAX_EXPORT_ITEMS` vào `src/config.ts` cho cả hai phía đọc
chung rồi báo trong `src/services/quoteService.ts`.

## Logo khách hàng định dạng .webp vẫn KHÔNG hiện trong file Excel

`src/validators.ts:132` và `web/src/pages/NewQuoteWizard.tsx:15` đều chấp nhận
`data:image/webp`, còn `insertCustomerLogo` (`src/excel.ts`) chỉ nhúng được
png/jpeg/gif. Đợt này **chỉ vá phần tệ nhất**: ô C3 nay được xoá trước khi hàm
`return`, nên file gửi khách không còn in dòng hướng dẫn "logo cty khách hàng"
(`tests/xp3-excel-cells.test.js`). **Logo vẫn biến mất**, chỉ là mất im lặng vào
một ô trống thay vì thành chữ sai.

Cố ý **không** gỡ `webp` khỏi validator: người dùng có thể đã lưu logo webp, và
lưới hạng mục (`web/src/components/GridTable.tsx:89`) cũng nhận webp — siết
validator sẽ làm **hỏng nút Lưu** của những báo giá đó, tệ hơn hẳn một logo thiếu.

**Chưa kiểm chứng:** ExcelJS ghi content-type `image/webp` một cách máy móc
(`node_modules/exceljs/.../content-types-xform.js:19`), nhưng chưa mở thử bằng
Excel thật nên **không biết** bản Excel nào của khách đọc được. Vì thế không nhúng
thẳng webp. **Việc nên làm:** tái mã hoá logo sang JPEG ngay ở client
(`NewQuoteWizard.tsx`), đúng cách `GridTable.tsx` đang làm cho ảnh hạng mục.

## Số liệu hàng đợi BullMQ: CHƯA có ai scrape ở production

`/metrics` nay có gauge `bullmq_jobs{queue,state}` (đọc `getJobCounts()` của cả 5
hàng đợi ngay tại thời điểm scrape — `src/queue.ts` `capNhatDoSauHangDoi`). Đã đo
được qua Redis cục bộ trong `tests/hq3-bullmq-metrics.test.js`.

**Chưa kiểm chứng ở production, và còn thiếu hai mảnh:**

1. **Không có Prometheus nào đang chạy.** Production là docker-compose/Coolify;
   trong repo không có deployment Prometheus/Grafana. Bộ số này hiện chỉ đọc được
   bằng cách gọi tay `/metrics`. Cấu hình ServiceMonitor trong `infra/helm/` đã có
   token nhưng chart đó chưa được dùng.
2. **Tiến trình worker KHÔNG được scrape.** `src/worker.ts` không mở cổng HTTP nào,
   nên `export_jobs_total` mà nó tăng (`worker.ts:22/:25`) ghi vào một registry
   không ai đọc. Gauge `bullmq_jobs` không bị ảnh hưởng vì nó được đọc từ phía API,
   nhưng mọi số liệu SINH RA TRONG worker thì vẫn vô hình. Muốn có: mở một server
   `/metrics` riêng trong worker + thêm `ports:`/annotation `prometheus.io/*` vào
   `infra/helm/quanly/templates/worker-deployment.yaml` (hiện thiếu cả hai, khác với
   `app-deployment.yaml`).

## Băm SHA-256 của tệp tải lên đã được LƯU, nhưng CHƯA có ai đối chiếu

`UploadObject.sha256` (cột đã có sẵn trong schema từ lâu) nay được điền ở cả hai
đường ghi trong `src/routes/files.routes.ts`: multipart băm buffer vừa nhận, và
`/finalize` băm nội dung thật đọc từ kho object. Có test qua HTTP + MinIO thật
(`tests/hq3-upload-sha256.test.js`).

**Còn thiếu phía ĐỐI CHIẾU.** `src/tools/verifyIntegrity.ts` mới chỉ có `--pii` và
`--proof`; chưa có chế độ duyệt `UploadObject` đã `finalized` để so lại hash như
`paymentProofSha256` đang được so. Nghĩa là: từ nay có BẢN GHI để đối chiếu, nhưng
diễn tập khôi phục (`scripts/backup/restore-drill.sh`) vẫn chưa kiểm tệp đính kèm.
**Cố ý không làm ở đợt này** vì thêm một bước mới vào diễn tập hàng tuần mà không
chạy thử được trên dữ liệu production là cách dễ nhất để biến một diễn tập đang
xanh thành đỏ vì lý do sai. Hàng cũ (tải lên trước thay đổi này) có `sha256 = NULL`
và phải được coi là "không đối chiếu được", không phải "sai hash".

**Lưu ý về giá phải trả:** `/finalize` nay tải NGUYÊN nội dung object về (trước chỉ
tải với .xlsx) để băm — thêm một lượt GET tối đa 10 MB mỗi tệp, đúng một lần trong
đời tệp đó.

## Ân hạn dừng worker = 90s là số CHỌN, không phải số ĐO (cụm ha-tang-trienkhai)

`docker-compose.prod.yml` / `.staging.yml` nay khai `stop_grace_period: 90s` cho
service `worker`, và `infra/k8s/worker.yaml` + `values.yaml` khai
`terminationGracePeriodSeconds: 90`. Trước đó compose không khai gì — tức dùng
**mặc định 10s của Docker**, nhỏ hơn cả trần cứng 30s của riêng bước sinh file
trong một job xuất (`EXPORT_GEN_TIMEOUT_MS` ở `src/exportQueue.ts`, áp vào tiến trình worker qua
`sinhFileXuat` trong `src/worker.ts`).

**90 đến từ đâu:** 3× trần 30s đó, chừa chỗ cho tải lên kho object và ghi CSDL sau
khi file đã dựng xong. Đó là suy luận từ hằng số có thật trong mã, **không phải
phép đo**. Chưa ai bấm giờ một lượt `docker compose down` trên VM production để
xem worker thật sự cần bao lâu mới đóng hết job.

**Trần 30s đó trước đây KHÔNG áp cho worker — nay thì có.** Cho tới bản vá này
`src/worker.ts` không hề import `exportQueue.js`: processor `QUEUES.EXPORT` gọi
thẳng `buildQuoteBuffer`/`renderQuotePdf`, tức job xuất nền chạy **không có trần
thời gian nào cả**, và con số 90 neo vào một cái trần không nằm trên đường thực
thi của nó. Nay `sinhFileXuat` (src/worker.ts) đi qua
`runExportJob(..., { choPhepNoiTuyen: false })`, nên bước sinh file chạy trong
`worker_threads` và hết hạn là `terminate()` — **trần thật**, vì luồng bị giết chứ
không phải lời hứa bị bỏ mặc. Quá hạn ném `UnrecoverableError` để BullMQ hỏng ngay
với `failedReason` người dùng đọc được ở `GET /api/jobs/:queue/:id`, thay cho hành
vi cũ: chờ mãi, bị SIGKILL, rồi chết vĩnh viễn vì `maxStalledCount`.

**Vẫn còn là số CHỌN:** trần 30s (`EXPORT_GEN_TIMEOUT_MS`) chưa neo vào phân vị đo
được của `export_jobs_total`/`exportDuration`. Báo giá lớn hơn mức đó nay **hỏng
có thông báo** thay vì treo — tốt hơn, nhưng nếu p99 thật vượt 30s thì phải nâng
biến môi trường đó **và** nâng ân hạn dừng theo cùng tỉ lệ.

**Đã kiểm được tới đâu:** `docker compose config` (chạy phía client, không cần
daemon) parse cả hai file và chuẩn hoá đúng `90s → 1m30s` trên đúng service
`worker`; `kubeconform` xác nhận manifest hợp schema. Cả hai chỉ nói **khai báo
đúng hình dạng**, không nói hành vi lúc dừng.

**Việc phải làm:** một lần deploy có người canh, đo thời gian từ SIGTERM tới lúc
tiến trình worker thoát khi đang có job xuất chạy. Nếu vượt 90s thì nâng số; nếu
luôn dưới 20s thì hạ xuống cho lượt deploy nhanh lại. Ba chỗ phải đổi CÙNG NHAU —
`tests/ht3-k8s-drain-and-grace.test.js` đỏ nếu chúng lệch nhau.

**Đồng thời:** `infra/k8s/pdb.yaml` (PodDisruptionBudget) là file MỚI, **chưa từng
chạy trên cụm k8s nào**. Nó mới chỉ qua `kubeconform` — đúng hình dạng schema, chứ
không phải "đã thấy `kubectl drain` kết thúc". Đường triển khai thật vẫn là compose
(`deploy.sh`), nên toàn bộ nhánh k8s/Helm ở đây là bản tham chiếu chưa được xác minh.

## Khoá bộ đếm số báo giá giữ suốt transaction TẠO — CỐ Ý chưa vá (cụm csdl-truyvan)

`nextQuoteNumber` (`src/quoteNumber.ts`) upsert-increment hàng `QuoteCounter(prefix, year)` và nó
vẫn là LỆNH ĐẦU của transaction tạo báo giá (`src/services/quoteService.ts`, `createQuote` và
đường nhân bản). Postgres giữ khoá hàng đó tới COMMIT, tức suốt cả phần chèn sheet + hạng mục +
`snapshotQuoteVersion`. Hai người CÙNG công ty bấm "Tạo báo giá" chồng nhau thì người sau xếp hàng
sau người trước — vấn đề THÔNG LƯỢNG, không phải lỗi đúng-sai, và với đội vài chục người thì hiếm.

**Vì sao chưa vá.** Cách chữa gốc là tạo báo giá với số TẠM (`TMP-<uuid>`) rồi cấp số thật bằng
một UPDATE ở cuối transaction. Đổi như vậy đụng ba thứ trên đường ghi nóng nhất của hệ thống:
(1) thêm một lượt ghi Quote trong cùng transaction ⇒ extension realtime ở `src/db.ts` bắn HAI sự
kiện SSE cho một lần tạo (né được bằng `$executeRaw`, nhưng rồi);
(2) `$executeRaw` không cho ra `P2002` mà cho `P2010` kèm mã `23505` ⇒ vòng thử lại chống trùng số
phải đổi cách nhận diện lỗi;
(3) `searchText` chứa số báo giá nên phải cập nhật cùng lệnh đó.
Đổi lấy một cải thiện thông lượng chưa từng có ai báo là đang đau.

**Và chưa có phép đo nào không chập chờn.** Thứ duy nhất đo được là "hàng bộ đếm bị khoá bao lâu
so với độ dài transaction", đo bằng cách bắn `SELECT … FOR UPDATE NOWAIT` liên tục từ một kết nối
khác. Đó là bài test phụ thuộc thời gian — đúng loại làm CI đỏ ngẫu nhiên. Không viết một bài như
thế chỉ để có cho đủ.

**Phần ĐÃ vá trong đợt này** (có test đi kèm, `tests/db3-quote-manual-number-counter.test.js`):
số báo giá NHẬP TAY nay đẩy bộ đếm lên theo (`syncQuoteCounter`), và vòng thử lại khi đụng số
trùng nay THOÁT ra được — trước đó nó vô tác dụng vì lần tăng bộ đếm bị rollback cùng transaction
hỏng, nên bốn lượt thử đều sinh lại đúng một số.

## Truy vấn `existing` khi LƯU báo giá vẫn kéo toàn bộ hạng mục + ảnh (cụm csdl-truyvan)

`updateQuote` (`src/services/quoteService.ts`) mở đầu bằng `findFirst({ include: QUOTE_INCLUDE })`,
tức đọc mọi sheet, mọi hạng mục và cả cột `images` (base64) — trong khi phần lớn chỉ dùng vài
trường phẳng. `tx.quote.update` bên trong transaction cũng `include: QUOTE_INCLUDE` để trả về client.

**Chưa thu hẹp** vì `existing` được dùng rải rác (quyền sửa, khoá lạc quan, `hnStatus`, nhánh tính
lại tổng từ `existing.sheets`, audit trước/sau, thông báo). Một `select` hẹp bỏ sót một trường sẽ
thành `undefined` LẶNG LẼ ở production chứ không phải lỗi biên dịch — cái giá của việc sai lớn hơn
nhiều so với phần đọc tiết kiệm được. Nếu làm thì phải làm kèm bài test đi qua đủ các nhánh dùng
`existing`, không phải sửa một dòng.

**Phần ĐÃ vá:** lần đọc thứ BA — `snapshotQuoteVersion` (`src/quoteVersion.ts`) — nay có `select`
liệt kê đúng 13 trường payload dùng, nên không còn giải TOAST ảnh base64 bên trong transaction lưu.
Đo được bằng `pg_statio_all_tables`: 612 block TOAST → 0 (`tests/db3-snapshot-no-images.test.js`).
