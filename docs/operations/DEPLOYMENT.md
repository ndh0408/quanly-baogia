# Triển khai và phát hành

## Artifact: một lệnh cho mọi nơi

Production chạy **JavaScript đã biên dịch**, không chạy TypeScript qua loader:

```
npm run build          →  dist/
node dist/server.js       API
node dist/worker.js       worker nền
```

Docker, docker-compose, Helm và manifest k8s **đều gọi đúng lệnh đó**.
`scripts/ci/check-runtime-command.sh` làm đỏ CI nếu chúng lệch nhau.

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
bash deploy.sh staging      # → VM staging
bash deploy.sh prod         # → VM production, CHỈ sau khi staging đã duyệt
```

Mỗi lượt:

1. **Backup CSDL** + gắn tag `:rollback` cho image hiện tại
2. Ship file đã tracked (`git archive`), dọn `.js` cũ còn sót có `.ts` cùng tên
3. `docker compose build app`
4. **`prisma migrate deploy`** (`docker compose run --rm app …`) — hỏng ở đây thì
   `set -e` dừng deploy, app cũ vẫn chạy
5. Recreate `app` + `worker`, ghi `DEPLOYED_SHA`
6. Verify `/livez`

Bước 4 đặt **trước** bước 5 là có chủ ý: schema phải có cột mới trước khi mã mới
dùng tới.

## Diễn tập thay đổi postgres/redis

Bước 5 **chỉ** `docker compose up -d app worker` — nó không bao giờ dựng lại
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

## Rollback

```bash
# App (deploy.sh in ra lệnh này ở cuối mỗi lượt)
ssh <host> "cd /opt/stacks/quanly/quanly && \
  docker tag quanly-app:rollback quanly-app:prod && \
  docker compose -f docker-compose.prod.yml up -d app worker"

# Helm
helm rollback quanly
```

**Migration không tự rollback.** Nếu bản phát hành có migration phá tương thích
ngược thì rollback mã thôi là chưa đủ — phải khôi phục từ bản backup trước deploy
(deploy.sh đã tạo ở bước 1). Vì thế migration phải theo hướng expand/contract:
thêm cột trước, đổi mã sau, bỏ cột cũ ở một bản phát hành sau nữa.

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

Danh sách đầy đủ có chú thích: `.env.example`, được `tests/env-example.test.js`
giữ cho khớp với schema.

## Danh sách kiểm trước khi phát hành

- [ ] CI xanh trên commit sẽ deploy
- [ ] Có migration đụng dữ liệu → đã diễn tập
- [ ] Backup gần nhất < 24h (`/opt/quanly/backup-watchdog.sh`)
- [ ] Đã deploy staging và duyệt bằng tay
- [ ] Có sửa `cap_*` / `security_opt` / `deploy.resources` của `postgres` hoặc `redis`
      → đã diễn tập tay (mục "Diễn tập thay đổi postgres/redis"), vì bước 5 của
      `deploy.sh` không dựng lại hai service đó
- [ ] Biết trước lệnh rollback
- [ ] Không deploy chiều thứ Sáu, trừ khi đang chữa sự cố
