# Triển khai và phát hành

## Artifact: một lệnh cho mọi nơi

Production chạy **JavaScript đã biên dịch**, không chạy TypeScript qua loader:

```
npm run build          →  dist/
node dist/server.js       API
node dist/worker.js       worker nền
```

Docker, docker-compose, Helm và manifest k8s **đều gọi đúng lệnh đó**.
`scripts/ci/check-runtime-command.sh` bắt chúng lệch nhau — và nó chạy ở bước **[9/13] của
`npm run verify`**. **CI của repo này LÀ `scripts/verify-local.sh`** (chủ repo chốt 2026-09-23):
GitHub Actions không dùng — tài khoản bị khoá vì billing nên mọi lượt từng kích hoạt đều hỏng sau
2–3 giây, và `.github/workflows/*.yml` nay chỉ chạy tay (`workflow_dispatch`). Mọi câu kiểu "CI sẽ
bắt" đều sai ở repo này — xem `AGENTS.md`.

Lý do có chốt này rất cụ thể: Dockerfile từng chạy `node --import tsx src/server.js`
trong khi Helm và `infra/k8s/app.yaml` chạy `node src/server.js` — **file đó không
tồn tại**. Mọi pod chết vòng lặp ngay lần deploy k8s đầu tiên, và không bước CI
nào phát hiện vì chart chưa từng được render, manifest chưa từng đối chiếu.

### Vì sao `rootDir: "src"` là bắt buộc

`tsconfig.build.json` đặt `rootDir: "src"`, `outDir: "dist"`. Không phải tuỳ chọn
thẩm mỹ: mã tính đường dẫn tài nguyên bằng `__dirname/..`.

| rootDir | File đầu ra | `__dirname/../public` | Kết quả |
|---|---|---|---|
| `"src"` | `dist/app.js` | `/app/public` | đúng |
| `"."` | `dist/src/app.js` | `/app/dist/public` | **toàn bộ frontend 404** |

Và nó **404 âm thầm** — typecheck vẫn xanh, server vẫn báo khoẻ.
`scripts/ci/smoke-dist.sh` bắt đúng lớp lỗi này bằng cách gọi thật `/style.css`.

Cho tới 2026-08-31 câu trên **đúng về nguyên lý nhưng sai về thực tế**: script chỉ được
gọi ở `.github/workflows/ci.yml:217`, mà Actions không bật trên tài khoản này — nghĩa là
lớp lỗi đó chưa từng có ai gác. Nay nó là bước `[10b/13]` của `scripts/verify-local.sh`
và chạy ở cả `npm run verify` lẫn `npm run verify:nhanh`. Chạy riêng:

```bash
DATABASE_URL=... REDIS_URL=... bash scripts/ci/smoke-dist.sh
```

Ngoài `/style.css`, cùng lượt đó còn đòi `/livez` `/readyz` `/api/health` trả `ok`,
`/metrics` phải đòi token khi `METRICS_TOKEN` đã đặt, `/api/auth/login` trả `401` chứ
không phải `5xx`, và `node dist/worker.js` phải thoát khi nhận `SIGTERM` — không có vế
cuối thì rolling update cắt ngang job đang chạy.

### Stack trace đọc được: source map lúc chạy

`tsconfig.build.json` bật `sourceMap: true`, nên `dist/*.js.map` nằm sẵn trong image từ lâu.
Nhưng CÓ map không có nghĩa là DÙNG map: Node chỉ đọc chúng khi được bảo, và trước đây không đường
triển khai nào bảo cả — mọi stack trace (log lẫn Sentry) trỏ vào `dist/*.js`, số dòng vô nghĩa với
người đọc lẫn với `git blame`.

Nay `--enable-source-maps` được bật ở **hai chỗ trong Dockerfile**, vì không chỗ nào phủ hết một mình:

| Đường triển khai | Nó ghi đè cái gì | Cờ tới từ đâu |
|---|---|---|
| `docker run` trần | không ghi đè gì | `ENV NODE_OPTIONS` |
| compose app | ghi đè `NODE_OPTIONS` (`--max-old-space-size`) | wrapper ở `ENTRYPOINT` |
| compose worker | ghi đè **cả** `NODE_OPTIONS` **lẫn** `command` | wrapper ở `ENTRYPOINT` |
| k8s / Helm (app + worker) | ghi đè `command`/`args`, tức thay luôn entrypoint | `ENV NODE_OPTIONS` |

Wrapper `/usr/local/bin/bat-source-map` **nối thêm** cờ vào `NODE_OPTIONS` đang có thay vì thay
thế, nên trần heap mà compose đã tính vẫn còn nguyên. `command:` của compose chỉ ghi đè `CMD` nên
vẫn đi qua entrypoint; k8s/Helm thay cả entrypoint nhưng lại KHÔNG khai `NODE_OPTIONS`, nên biến
môi trường của image tới nơi. Hai cơ chế bù đúng chỗ hở của nhau.

**Giá phải trả, đã đo** (node 22.22, bài đo tổng hợp: 20.000 lần ném lồng 5 tầng trên `dist` do
`tsc` sinh kèm `.map` — KHÔNG phải đo trên chính ứng dụng này):

| Tình huống | Không cờ | Có cờ |
|---|---|---|
| ném rồi **đọc** `.stack` | 19,1 µs | 44,4 µs (+25 µs) |
| ném mà **không** đọc `.stack` | 5,66 µs | 5,98 µs (trong nhiễu đo) |

Giải mã map là **lười** — chỉ chạy khi stack thật sự được định dạng. Trong ứng dụng này lỗi nằm ở
đường ngoại lệ (500 / log / Sentry), không phải đường nóng, nên +25 µs mỗi lỗi được ghi log là giá
rẻ để đổi lấy đúng tệp `.ts` và đúng số dòng khi có sự cố.

Đã kiểm: map vẫn ánh xạ đúng **dù image không chứa `src/`** — Node chỉ cần `mappings` trong file
`.map` để viết lại `tệp:dòng:cột`. Cái image thiếu `src/` làm mất là **đoạn mã ngữ cảnh** quanh
dòng lỗi, không phải vị trí.

**`SENTRY_RELEASE` thì CHƯA xong.** Dockerfile đã nhận `--build-arg SENTRY_RELEASE`, và
`@sentry/node` tự đọc biến đó khi `Sentry.init` không truyền `release` — nghĩa là chỉ cần truyền
tham số, không phải sửa `src/observability.ts`. Nhưng `deploy.sh` **không** truyền:
`tests/b7-deploy-image-digest.test.js` chốt lệnh build khớp đúng mẫu `compose -f <file> build app`,
chèn cờ vào giữa là làm đỏ cổng đó. Nên hiện tại **production chạy với `SENTRY_RELEASE` rỗng** →
stack trace đã đúng tệp `.ts`, nhưng Sentry **không** gom được lỗi theo bản phát hành.
Muốn bật: nới mẫu trong test đó rồi thêm cờ vào `deploy.sh` — hai việc phải đi cùng nhau.
Dựng tay thì đã dùng được ngay: `docker build --build-arg SENTRY_RELEASE=$(git rev-parse HEAD) .`

## Ba mức triển khai

| Mức | Hình thái | Trạng thái |
|---|---|---|
| 1 | Cloudflare Tunnel → Docker Compose trên MỘT VM | **đang chạy production** |
| 2 | nhiều instance app/worker + PG/Redis quản lý ngoài | có sẵn đường, chưa dùng |
| 3 | Kubernetes qua Helm | chart chạy được, chưa dùng production |

Mức 1 là hợp lệ cho quy mô này. Phải nói thẳng: **VM đó là điểm hỏng đơn**. Mất
VM là mất dịch vụ cho tới khi khôi phục xong — xem
[DISASTER_RECOVERY.md](DISASTER_RECOVERY.md).

## Deploy (mức 1) — `deploy.sh`

```bash
npm run verify              # đủ 13 bước, cây SẠCH → ghi DẤU XANH cho commit HEAD
bash deploy.sh staging      # → VM staging (không có dấu xanh: chỉ cảnh báo)
bash deploy.sh prod         # → VM production, CHỈ sau khi staging đã duyệt (không có dấu xanh: DỪNG)
```

Mỗi lượt (số bước khớp comment `[n/6]` in ra khi chạy):

- **[0/6]** Cổng trước khi ship (audit 2026-09-22, INFRA-04). `scripts/verify-local.sh` chạy ĐỦ trên
  cây SẠCH thì ghi dấu `ok-<sha>` vào `$(git rev-parse --git-common-dir)/quanly-verify/`. `prod`:
  commit không có dấu, hoặc cây làm việc bẩn → **dừng trước khi đụng máy chủ**. `staging`: chỉ cảnh
  báo. Commit chưa có trên origin: chỉ cảnh báo (chủ repo làm việc local). Khẩn cấp:
  `DEPLOY_KHAN_CAP="<lý do>" bash deploy.sh prod` — lý do được ghi vào `RELEASES.log` (trường `khan_cap`).
- **[1/6]** Backup CSDL (`pg_dump --no-owner --clean --if-exists`, cùng cờ với dump hằng đêm) + gắn
  tag `:rollback` cho ảnh của **container đang chạy** (không phải ảnh mà tag đang trỏ — có thể là ảnh
  chưa từng chạy nếu lượt trước hỏng giữa chừng)
- **[2/6]** Ship file đã tracked (`git archive`)
- **[2b/6]** Dọn file mồ côi trong `src/`, `shared/`, `web/src/`, `prisma/`, `templates/`, `public/`
  (trừ `public/app2/` do build sinh) — `tar` không tự xoá, nên file đã bị xoá/đổi tên/di chuyển trong
  git vẫn nằm lại trên VM: có thể làm build biên dịch nhầm mã đã gỡ, và một thư mục migration đã gỡ
  khỏi git sẽ bị `prisma migrate deploy` CHẠY trên CSDL
- **[2c/6]** So bộ sao lưu trên host (`/opt/quanly/*.sh`) với `scripts/backup/` — **chỉ cảnh báo**,
  không tự cài (cần sudo). Xem [BACKUP_RESTORE.md](BACKUP_RESTORE.md)
- **[3/6]** `docker compose build app` trên VM, hoặc `docker pull` theo digest nếu đặt `IMAGE_REF`
- **[3b/6]** Gắn tag bất biến `<tên>:<git-sha>` cho ảnh vừa lấy
- **[3c/6]** Soát migration HUỶ đang chờ (DROP TABLE/COLUMN, RENAME, đổi kiểu cột) — `prod` dừng trừ
  khi `CHO_PHEP_MIGRATION_HUY=1`; xem mục "Lùi schema"
- **[3d/6]** Kéo ảnh phụ thuộc còn thiếu (`compose pull --policy missing postgres redis minio`) — hỏng
  thì dừng với thông báo riêng (migration CHƯA chạy). Lượt deploy đầu tiên sau DEP-01 (minio đổi sang
  `quay.io/minio/minio@sha256:…`) cần VM kéo được từ quay.io, và `quanly-minio` sẽ bị dừng rồi dựng lại
  ngay ở bước 4 (vài giây app cũ không đọc/ghi được chứng từ)
- **[4/6]** **`prisma migrate deploy`** (`docker compose run --rm app …`) — hỏng ở đây thì
  `set -e` dừng deploy, app cũ vẫn chạy
- **[5/6]** Recreate `app` + `worker` bằng `--force-recreate`, ghi `DEPLOYED_SHA`
- **[5c/6]** Đối chiếu ảnh container đang chạy khớp đúng ảnh vừa gắn tag ở [3b/6]
- **[5b/6]** Ghi sổ phát hành vào `RELEASES.log` (SHA, migration đã áp, digest ảnh, `image_tag`, `khan_cap`)
- **[5d/6]** Nạp lại quy tắc Prometheus (`SIGHUP`) và khởi động lại Alertmanager khi bản mẫu đổi —
  nếu ngăn quan sát đang chạy
- **[6/6]** Verify: `/livez` · **`/readyz`** (app chạm được CSDL) · **worker** đang chạy, không khởi
  động lại, log có `worker registered` · **đường public** `$URL/livez` từ máy gõ lệnh (prod: hỏng là
  đỏ; staging: cảnh báo; `DEPLOY_BO_QUA_KIEM_PUBLIC=1` để bỏ riêng lớp này)

Bước 4 đặt **trước** bước 5 là có chủ ý: schema phải có cột mới trước khi mã mới
dùng tới.

Bước **[5c/6]** tồn tại vì một lỗi đã đo được ngày 2026-09-01: `docker compose up -d` trên một
service có khối `build:` không so ảnh mà tag đang trỏ tới với ảnh container đang chạy — nếu cấu
hình service không đổi, nó kết luận "không có gì để làm" và thoát 0 dù container vẫn chạy ảnh CŨ.
`--force-recreate` ở bước [5/6] và đối chiếu ở [5c/6] cùng vá lỗi này; bước [6/6] verify `/livez`
KHÔNG bắt được ca đó vì app cũ vẫn trả 200.

## Diễn tập thay đổi postgres/redis

Bước 5 **chỉ** `docker compose up -d --force-recreate app worker` — nó không bao giờ dựng lại
`postgres`/`redis`. Nên câu "cứ deploy staging trước là mọi thay đổi đều được thử"
là **sai một nửa**: hai service dữ liệu được chạm ở **bước 4**, gián tiếp.
`docker compose run --rm app …` khởi động các service trong `depends_on`, và compose
recreate một service phụ thuộc khi *config hash* của nó lệch — `cap_add`, `cap_drop`,
`deploy.resources` đều nằm trong hash đó.

Đo được ngày 2026-08-27 (docker 29.3.1, compose v5.1.1, máy sandbox):

| Tình huống | Kết quả thật |
|---|---|
| đổi `cap_add` của service phụ thuộc rồi `compose run` | dep bị **recreate** (container id đổi) |
| không đổi gì rồi `compose run` | **không** recreate |
| dep không lên nổi | `compose run` thoát **mã 1** → `set -e` dừng deploy |
| `cpus` lớn hơn số vCPU của máy | `Error response from daemon: range of CPUs is from 0.01 to 4.00, as there are only 4 CPUs available` |

Phiên bản compose **trên VM thật chưa được đối chiếu**, và hành vi recreate-khi-lệch-hash
là mặc định của compose chứ không phải hợp đồng được ghim ở đâu. Nên khi sửa
`cap_add` / `cap_drop` / `security_opt` / `deploy.resources` của `postgres` hoặc
`redis`, **diễn tập tay trên staging trước**, đừng trông vào lượt deploy:

```bash
# BƯỚC 0 — BẮT BUỘC: đẩy file compose MỚI lên VM trước đã.
# Bỏ bước này là diễn tập đúng file compose CŨ đang nằm sẵn trên máy chủ: lệnh xanh, thay đổi
# của bạn chưa hề được thử. Đây chính là cách `deploy.sh` ship file (dòng `git archive`), nên
# chạy tay như dưới cho ra đúng thứ mà lượt deploy sẽ ghi vào:
# ⚠️ `git archive` đọc một COMMIT, KHÔNG đọc thư mục làm việc. Sửa compose xong mà chưa commit
#    thì lệnh dưới đẩy lên bản CŨ — đúng cái bẫy mà cả mục này sinh ra để chống. Commit trước
#    (hoặc `git stash` rồi bỏ ý định diễn tập bản nháp).
git status --porcelain docker-compose.staging.yml   # phải TRỐNG trước khi chạy dòng dưới
git archive --format=tar.gz HEAD | ssh staging-ts 'tar xzf - -C /opt/stacks/quanly/quanly'

ssh staging-ts
cd /opt/stacks/quanly/quanly
grep -A2 cap_add docker-compose.staging.yml      # xác nhận đúng là bản vừa đẩy lên
docker compose -f docker-compose.staging.yml up -d postgres redis
docker compose -f docker-compose.staging.yml ps          # cả hai phải (healthy)
docker logs quanly-postgres --tail 30 | grep 'ready to accept connections'
docker logs quanly-redis    --tail 30 | grep 'Ready to accept connections'
```

> `docker-compose.*.yml` được git theo dõi, nên `git archive` **ghi đè** chúng trên máy chủ mỗi
> lượt deploy. Hệ quả hai chiều: (a) không đẩy trước thì diễn tập sai file; (b) sửa tay compose
> trên máy chủ sẽ mất ở lượt deploy kế — giá trị riêng theo máy phải nằm trong `.env`.

Thiếu capability thì hỏng **ngay lúc khởi động**, thấy liền trong log, ví dụ thật đã đo:

- postgres, `cap_drop: ALL` không `cap_add`:
  `error: failed switching to 'postgres': operation not permitted` (gosu)
- postgres, có `FOWNER` nhưng thiếu `DAC_OVERRIDE`:
  `find: /var/lib/postgresql/data: Permission denied`
- redis, thiếu `SETGID`: `setpriv: setresgid failed: Operation not permitted`

Lưu ý: **volume rỗng và volume đã có dữ liệu không đi qua cùng một nhánh quyền.**
Entrypoint postgres chạy `chmod 00700 "$PGDATA"` (nuốt lỗi) *rồi mới* `find "$PGDATA"
\! -user postgres …`. Ba phép đo:

| Volume | Capability | Kết quả |
|---|---|---|
| rỗng | chỉ `SETGID,SETUID` | **lên được** — chmod hỏng lặng lẽ nên thư mục còn 1777, `find` vẫn đọc được |
| đã có dữ liệu (0700) | chỉ `SETGID,SETUID` | **chết** — `find: … Permission denied` |
| rỗng | `CHOWN,FOWNER,SETGID,SETUID` (thiếu `DAC_OVERRIDE`) | **chết ngay lượt đầu** — chmod thành công rồi chính root không đọc lại được |

Nên diễn tập trên staging (volume đã có dữ liệu) sát prod hơn là dựng volume mới.

## Helm

```bash
helm upgrade --install quanly infra/helm/quanly \
  --set secrets.SESSION_SECRET=... \
  --set secrets.JWT_SECRET=... \
  --set image.digest=sha256:...
```

**Chart TỪ CHỐI `image.tag=latest`.** Deploy từ tag di động nghĩa là hai pod cùng
một ReplicaSet có thể kéo về hai bản mã khác nhau, và rollback thì không có gì để
quay về. Ưu tiên `image.digest`; nếu dùng tag thì đặt git SHA tường minh. Thử
nghiệm cần thì `--set image.allowMutableTag=true`.

Chart tạo: Deployment app + worker, Service, Ingress, HPA, **PodDisruptionBudget**,
NetworkPolicy, và tuỳ chọn Postgres/Redis nhúng (chỉ dùng cho môi trường không
phải production).

## Migration CSDL

- Production: **`prisma migrate deploy`** — chỉ tiến, có advisory lock (an toàn
  với nhiều replica), no-op khi không còn migration nào.
- **KHÔNG dùng `prisma db push`** ở production — nó có thể **xoá cột và dữ liệu**.
- Migration đụng dữ liệu: diễn tập trước bằng `scripts/db/migration-rehearsal.sh`
  (dựng CSDL ở đúng schema production, nạp dữ liệu, rồi mới nâng cấp).

### Diễn tập phải nạp ĐÚNG hình dạng dữ liệu mà migration sẽ đụng

`migration-rehearsal-seed.mjs` nạp dữ liệu ở schema **cũ**, và
`migration-rehearsal-check.mjs` đối chiếu **sau** khi nâng cấp. Tới 2026-09-16 bộ
seed chỉ có `User` + `PersonnelRecord`, nghĩa là mọi buổi diễn tập cho một
migration đụng **báo giá** đều chạy trên CSDL **không có báo giá nào** rồi báo
ĐẠT. Nó chứng minh đúng một điều — lệnh DDL chạy không lỗi — chứ không chứng minh
dữ liệu chuyển sang chỗ mới **đúng và đủ**, mà đó mới là thứ người ta sợ.

Quy tắc: **thêm migration đụng dữ liệu thì thêm cả seed lẫn check.** Check phải
đối chiếu **số tiền**, không phải số hàng — chép sót một hàng giá 0 đồng vẫn qua
được phép đếm. Mẫu: bộ hiện tại nạp một báo giá có bảng `hanoi` trong
`QuoteSheet.extraTables` cùng một hàng `_QuoteMembers`, rồi khẳng định sau nâng
cấp: `Quote.hnTables` đúng 1 bảng, **tiền khớp tới từng đồng**, `category` đã bị
cắt, bảng `hcm` không bị đụng, bản cũ **còn nguyên** (expand-only), `QuoteMember`
được **đủ 4 phạm vi**, và `_QuoteMembers` đã biến mất.

Tự kiểm bộ check: sửa hỏng một con số trong CSDL diễn tập rồi chạy lại — phải ra
`✖` và **thoát mã 1**. Một bộ check không bao giờ đỏ là một bộ check không tồn tại.

### Khi bước [4/6] migrate hỏng

Nhiều migration đặt `SET lock_timeout = '10s'` để không treo cả CSDL khi có ai
đang giữ khoá bảng. Hết giờ thì Postgres huỷ lệnh (SQLSTATE **55P03**) và Prisma
ghi migration đó là **FAILED**.

**Chạy lại `deploy.sh` KHÔNG tự khỏi.** Prisma từ chối đi tiếp khi còn một
migration FAILED, nên mọi lượt sau hỏng y hệt cho tới khi có người gỡ tay. App cũ
vẫn chạy suốt thời gian đó — không ai bị ảnh hưởng, nhưng cũng không có gì được
deploy. `deploy.sh` nay in nguyên quy trình dưới đây ngay tại chỗ hỏng:

```bash
# 1) Xem migration nào hỏng
docker compose -f docker-compose.prod.yml run --rm app npx prisma migrate status

# 2) Hỏng vì lock_timeout → mọi lệnh nằm trong một transaction nên đã rollback
#    sạch, không ghi được gì. Đánh dấu đã-lùi rồi deploy lại:
docker compose -f docker-compose.prod.yml run --rm app \
  npx prisma migrate resolve --rolled-back <ten_migration>

# 3) Tìm ai đang giữ khoá, nếu không sẽ hết giờ lần nữa
psql -c "SELECT pid, state, left(query,80) FROM pg_stat_activity
         WHERE datname='quanly' AND state<>'idle';"
```

> **ĐỪNG dùng `migrate resolve --applied`.** Nó nói dối rằng migration đã chạy;
> lượt sau sẽ bỏ qua nó và để lại schema thiếu cột trong khi mã mới tưởng đã có.

## Rollback

```bash
bash deploy.sh rollback prod              # về :rollback — bản chạy TRƯỚC lượt deploy gần nhất
bash deploy.sh rollback prod <git-sha>    # về BẤT KỲ bản đã phát hành (image_tag trong RELEASES.log)
```

Lệnh con này làm đúng những gì bước [5/6]–[6/6] làm: gắn tag, `up -d --no-deps --force-recreate app
worker`, **đối chiếu** ảnh container đang chạy, rồi kiểm `/livez` · `/readyz` · worker · đường public.

> **Vì sao không còn in lệnh `docker tag … && docker compose up -d app worker` trần** (audit
> 2026-09-22, DOC-02): chính deploy.sh đã ĐO (staging 2026-09-01) rằng `up -d` trên service có khối
> `build:` KHÔNG thay container khi chỉ tag đổi — lệnh thoát 0, container vẫn chạy ảnh lỗi, và
> `/livez` của bản cũ lẫn bản mới đều trả 200. Lệnh lùi dùng đúng lúc sự cố mà báo thành công giả là
> tệ hơn không có. Phải gõ tay thì BẮT BUỘC kèm `--force-recreate` rồi đối chiếu:
>
> ```bash
> ssh <host> "cd /opt/stacks/quanly/quanly && docker tag quanly-app:<sha> quanly-app:prod && docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate app worker"
> ssh <host> "docker images quanly-app:prod --format '{{.ID}}'; for c in quanly-app quanly-worker; do docker inspect \$c --format '{{.Image}}'; done"
> ```

### Lùi schema

**Migration không tự rollback** — lùi ẢNH không lùi schema (`prisma migrate deploy` chỉ đi tiến). Với
migration chỉ THÊM (đa số) thì bản cũ chạy được trên schema mới và lùi ảnh là đủ. Với migration
HUỶ/ĐỔI DẠNG thì bản cũ gọi vào thứ đã mất → 500 (ví dụ thật: `20260915090000_quote_member_scopes`
`DROP TABLE "_QuoteMembers"` mà code trước `f84a4ff` còn dùng). Lúc đó phải khôi phục bản dump trước
deploy (bước [1/6], `~/quanly-backups/predeploy-*.sql.gz`) — **mất mọi ghi mới từ lúc deploy**:

```bash
cd /opt/stacks/quanly/quanly
docker compose -f docker-compose.prod.yml stop app worker
gunzip -c ~/quanly-backups/predeploy-<ts>.sql.gz | docker exec -i quanly-postgres psql -U quanly -d quanly -v ON_ERROR_STOP=1
bash deploy.sh rollback prod <git-sha-bản-trước>     # (chạy từ máy dev)
```

(Dump trước-deploy tạo **trước 2026-09-23** không có `--clean` — xem DISASTER_RECOVERY.md, mục
"Khôi phục DB", nhánh 3b.)

Vì thế migration phải theo **expand/contract** (prisma/migrations/README.md): thêm cột trước, đổi mã
sau, bỏ cột cũ ở một bản phát hành SAU lượt đã ngừng dùng nó. Bước [3c/6] chặn migration huỷ trên prod
cho tới khi người deploy xác nhận điều đó bằng `CHO_PHEP_MIGRATION_HUY=1`.

## Biến môi trường BẮT BUỘC ở production

Thiếu là tiến trình **thoát ngay** (`src/config.ts`):

| Biến | Ràng buộc |
|---|---|
| `DATABASE_URL` | |
| `SESSION_SECRET` | ≥ 32 ký tự |
| `JWT_SECRET` | ≥ 32 ký tự, **khác** SESSION_SECRET |
| `APP_BASE_URL` | URL đầy đủ, không có đường dẫn phía sau |
| `MFA_ENC_KEY` | ≥ 16 ký tự |

Thiếu là **cảnh báo to nhưng vẫn chạy**: `PII_ENC_KEY` (PII ghi thô), `S3_*`
(chứng từ trả 503), `SMTP_HOST` (email bị bỏ im lặng), `METRICS_TOKEN`
(`/metrics` trả 404 ở production).

`PII_ENC_KEY` **khi đã đặt** thì bị siết ngang SESSION_SECRET/JWT_SECRET: phải ≥ 32 ký tự và
**khác** cả ba khoá kia (SESSION_SECRET, JWT_SECRET, MFA_ENC_KEY), không chỉ ≥ 16 ký tự như schema
chung — thiếu vẫn chỉ cảnh báo, nhưng **có mà yếu/trùng** thì tiến trình thoát ngay (`src/config.ts`).

Danh sách đầy đủ có chú thích: `.env.example`, được `tests/env-example.test.js`
giữ cho khớp với schema.

## Danh sách kiểm trước khi phát hành

- [ ] `npm run verify` **xanh trên đúng commit sẽ deploy** — 13 bước, gõ tay, cây sạch.
      `deploy.sh prod` nay KIỂM điều này (dấu xanh `ok-<sha>`, bước [0/6]) và dừng nếu thiếu.
      Mục này trước đây ghi "CI xanh", tức trỏ vào một cổng **không bao giờ chạy**: GitHub
      Actions không dùng ở repo này. CI là `verify-local.sh`.
      `npm run verify:nhanh` **không** ghi dấu xanh — nó bỏ smoke image + smoke giao diện +
      cổng bảo mật.
- [ ] Có migration đụng dữ liệu → đã diễn tập
- [ ] Backup gần nhất < 24h (`/opt/quanly/backup-watchdog.sh`)
- [ ] Đã deploy staging và duyệt bằng tay
- [ ] Có sửa `cap_*` / `security_opt` / `deploy.resources` của `postgres` hoặc `redis`
      → đã diễn tập tay (mục "Diễn tập thay đổi postgres/redis"), vì bước 5 của
      `deploy.sh` không dựng lại hai service đó
- [ ] Biết trước lệnh rollback (`bash deploy.sh rollback prod [<git-sha>]`) **và biết lùi về bản
      nào**: `tail $DIR/RELEASES.log` trên máy chủ cho `image_tag` = `quanly-app:<git-sha>` — tag bất
      biến `deploy.sh` gắn ở bước [3b/6].
      `:rollback` chỉ lùi được đúng một bước và bị ghi đè mỗi lượt deploy; tag theo SHA thì không.
- [ ] Không deploy chiều thứ Sáu, trừ khi đang chữa sự cố
