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
4. **`prisma migrate deploy`** — hỏng ở đây thì `set -e` dừng deploy, app cũ vẫn chạy
5. Recreate `app` + `worker`, ghi `DEPLOYED_SHA`
6. Verify `/livez`

Bước 4 đặt **trước** bước 5 là có chủ ý: schema phải có cột mới trước khi mã mới
dùng tới.

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
- [ ] Biết trước lệnh rollback
- [ ] Không deploy chiều thứ Sáu, trừ khi đang chữa sự cố
