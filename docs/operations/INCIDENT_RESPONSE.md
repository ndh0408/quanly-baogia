# Xử lý sự cố

> **Trước khi restart bất cứ thứ gì**, thu thập: `docker logs quanly-app --tail 500`,
> `docker logs quanly-worker --tail 200`, `docker ps -a`, `df -h`. Restart làm mất
> bằng chứng, và một sự cố hiểu sai sẽ quay lại.

Số tham chiếu: `/livez` (tiến trình sống), `/readyz` (chạm được CSDL).

---

## API trả 5xx hàng loạt

```bash
curl -s localhost:3000/livez; curl -s localhost:3000/readyz
docker logs quanly-app --tail 200 | grep -i error
```

- `/livez` hỏng → tiến trình chết hoặc treo. Xem log tìm `uncaughtException`.
- `/livez` OK nhưng `/readyz` hỏng → xuống mục CSDL.
- Cả hai OK mà vẫn 5xx → lỗi ở tầng route. Lấy `reqId` từ response của người
  dùng rồi tìm đúng dòng log.

**Deploy vừa xong?** Rollback trước, điều tra sau. Xem
[DEPLOYMENT.md](DEPLOYMENT.md#rollback).

---

## `/readyz` đỏ — không tới được Postgres

```bash
docker ps | grep postgres
docker exec quanly-postgres pg_isready -U quanly
docker logs quanly-postgres --tail 100
df -h                 # đĩa đầy là nguyên nhân rất hay gặp
```

Đĩa đầy → dọn backup cũ / log docker **trước**, đừng restart Postgres khi đĩa
đang đầy.

Postgres sống mà app vẫn không nối được → cạn pool. `DB_POOL_MAX` (mặc định 20)
là **cho mỗi tiến trình**; nhân với số app + worker phải còn dưới
`max_connections`.

---

## Redis chết

**Điều gì KHÔNG hỏng:** khoá tài khoản khi sai mật khẩu nhiều lần nằm ở **CSDL**
(`User.failedAttempts` / `lockedUntil`), không phụ thuộc Redis. Lớp chống dò mật
khẩu quan trọng nhất vẫn còn.

**Điều gì hỏng:** rate-limit theo IP **bị bỏ qua** (đánh đổi có chủ ý — xem
`src/rateLimit.ts`; lựa chọn còn lại là để mọi request treo, đã đo được là gây
524 trên toàn bộ API trong khi container vẫn báo "running"). Job nền không chạy.
SSE không lan giữa các instance.

```bash
docker ps | grep redis && docker exec quanly-redis redis-cli -a "$REDIS_PASSWORD" ping
docker compose -f docker-compose.prod.yml restart redis
```

Chấp nhận được trong thời gian ngắn. Nếu kéo dài, theo dõi log đăng nhập thất bại
sát hơn vì hàng rào theo-IP đang không có.

---

## Xuất file trả 503

Hàng đợi xuất file đã đầy (`src/exportQueue.ts`). Đây là **backpressure có chủ
ý**, không phải lỗi — nhưng nghĩa là người dùng đang bị từ chối.

```bash
curl -s -H "Authorization: Bearer $METRICS_TOKEN" localhost:3000/metrics \
  | grep -E 'export_(queue_depth|active_workers|rejected_total)'
```

Xử lý: tăng `EXPORT_MAX_ACTIVE` (chú ý CPU/RAM), hoặc `EXPORT_MAX_PENDING` nếu
chỉ là đợt dồn ngắn. Chạm thường xuyên → cần worker riêng, không phải chỉnh số.

---

## Chứng từ thanh toán không lưu được

**503 "Chưa cấu hình lưu trữ tệp"** → thiếu `S3_*`. Kiểm bảng tính năng trong log
khởi động (`msg="cấu hình tính năng"`).

**`NoSuchBucket`** → bucket không tồn tại. Server thử tạo lúc khởi động; nếu khoá
S3 không có quyền `CreateBucket` thì phải tạo tay.

```bash
docker logs quanly-app | grep -i "kho object"
```

---

## Người dùng bị 403 CSRF hàng loạt sau khi deploy

Mong đợi **trong thời gian rất ngắn**: phiên tạo trước khi có tính năng CSRF chưa
có bí mật, nên request ghi đầu tiên trả `csrf_token_missing`. Cả hai SPA **tự lấy
mã mới và thử lại một lần**, nên người dùng không thấy gì.

Nếu 403 vẫn kéo dài:

```bash
docker logs quanly-app | grep -c csrf_origin      # sai cấu hình origin
```

`csrf_origin` nhiều → `APP_BASE_URL` không khớp origin trình duyệt thật đang
dùng. Phải là scheme+host+port, **không có đường dẫn phía sau**.

Người dùng đang mở tab cũ với bản JS đã cache có thể vẫn hỏng — bảo họ tải lại
cứng. Đó là lý do mọi thay đổi trong `public/js` phải bump `?v=`.

---

## Container / pod chết vòng lặp

```bash
docker logs quanly-app --tail 100
kubectl logs -l app.kubernetes.io/component=api --previous
```

Nguyên nhân hay gặp, theo thứ tự:

1. **Biến môi trường thiếu/sai** → log có `❌ Invalid environment variables:` kèm
   đúng tên biến. Sửa biến rồi mới deploy lại.
2. **Migration hỏng lúc khởi động** (Helm chạy `prisma migrate deploy` trước khi
   phục vụ) → chạy tay để xem lỗi thật.
3. **Lệnh khởi động sai** — đáng lẽ không xảy ra nữa;
   `scripts/ci/check-runtime-command.sh` gác ở CI. Nếu vẫn gặp, kiểm
   `node dist/server.js` có tồn tại trong image không.

---

## Nghi ngờ lộ tài khoản

```bash
# 1) Khoá tài khoản NGAY — có hiệu lực ở request kế tiếp, không cần chờ token hết hạn
docker exec quanly-postgres psql -U quanly -d quanly \
  -c "UPDATE \"User\" SET active=false WHERE username='<user>';"

# 2) Xem họ đã làm gì
docker exec quanly-postgres psql -U quanly -d quanly \
  -c "SELECT \"createdAt\",action,resource,\"resourceId\",ip FROM \"AuditEvent\"
      WHERE \"actorId\"=<id> ORDER BY \"createdAt\" DESC LIMIT 100;"

# 3) Đăng nhập thất bại từ IP nào
docker exec quanly-postgres psql -U quanly -d quanly \
  -c "SELECT \"createdAt\",username,ip,success FROM \"LoginAttempt\"
      ORDER BY \"createdAt\" DESC LIMIT 100;"
```

Đổi mật khẩu sẽ thu hồi toàn bộ refresh token **và** vô hiệu hoá mọi phiên
cookie cùng access token phát hành trước thời điểm đổi.

---

## Backup quá hạn (watchdog báo)

```bash
/opt/quanly/backup-watchdog.sh          # nói rõ cái nào quá hạn
systemctl list-timers 'quanly-*'
journalctl -u quanly-backup --since '3 days ago'
/opt/quanly/backup-db.sh                # chạy tay ngay một lượt
```

Đừng gạt đi. Xem [BACKUP_RESTORE.md](BACKUP_RESTORE.md) — dump CSDL một mình
**không** khôi phục được hệ thống.

---

## Khi nào leo thang

- **Nghi mất dữ liệu** → dừng ghi, chụp bản backup hiện trạng **trước khi thử
  chữa**. Xem [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md).
- **Nghi bị xâm nhập** → khoá tài khoản, thu thập log, xoay `SESSION_SECRET` +
  `JWT_SECRET` (làm mọi người phải đăng nhập lại). **Đừng xoay `PII_ENC_KEY`** —
  xoay mà không backfill là hoá đá toàn bộ dữ liệu đã mã hoá.
- **Quá 30 phút chưa hiểu nguyên nhân** → rollback về bản đã biết là tốt, rồi
  điều tra ngoài giờ cao điểm.
