# Xử lý sự cố

> **Trước khi restart bất cứ thứ gì**, thu thập: `docker logs quanly-app --tail 500`,
> `docker logs quanly-worker --tail 200`, `docker ps -a`, `df -h`. Restart làm mất
> bằng chứng, và một sự cố hiểu sai sẽ quay lại.

Số tham chiếu: `/livez` (tiến trình sống), `/readyz` (chạm được CSDL).

---

## API trả 5xx hàng loạt

```bash
# Probe TỪ TRONG container: docker-compose.prod.yml KHÔNG publish cổng app ra host, và image không
# có curl. `curl localhost:3000` gõ trên host LUÔN "connection refused" — theo cây quyết định ngay
# dưới bạn sẽ tưởng tiến trình chết và đi restart, tức xoá mất bằng chứng (audit 2026-09-22, DOC-05).
docker exec quanly-app wget -qO- http://127.0.0.1:3000/livez; echo
docker exec quanly-app wget -qO- http://127.0.0.1:3000/readyz; echo
docker logs quanly-app --tail 200 | grep -i error
```

- `/livez` hỏng → tiến trình chết hoặc treo. Xem log tìm `uncaughtException`.
- `/livez` OK nhưng `/readyz` hỏng → xuống mục CSDL.
- Cả hai OK mà vẫn 5xx → lỗi ở tầng route. Lấy `reqId` từ response của người
  dùng rồi tìm đúng dòng log.

**Deploy vừa xong?** Rollback trước, điều tra sau: `bash deploy.sh rollback prod` (từ máy dev) —
lệnh con này `--force-recreate` và đối chiếu ảnh đang chạy; lệnh `docker tag … && up -d` trần KHÔNG
thay container. Chi tiết và cảnh báo về migration: [DEPLOYMENT.md](DEPLOYMENT.md#rollback).

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

**Điều gì đổi:** rate-limit **KHÔNG bị bỏ qua** — mỗi limiter rơi về bộ đếm **trong bộ
nhớ của từng tiến trình** (`src/rateLimit.ts`, `duPhong`). Production chỉ có một container
app nên gần như không mất độ chính xác; bộ đếm reset khi app khởi động lại. (Hai lựa
chọn đã loại: để mọi lệnh Redis treo — đo được gây 524 toàn API; và tắt hẳn limiter —
biến /auth/forgot-password thành máy bơm email.)

**Điều gì hỏng:** job nền không chạy. SSE không lan giữa các instance.

```bash
docker ps | grep redis && docker exec quanly-redis redis-cli -a "$REDIS_PASSWORD" ping
docker compose -f docker-compose.prod.yml restart redis
```

Chấp nhận được trong thời gian ngắn. Nếu kéo dài, lưu ý hàng rào theo-IP chỉ còn
tính trong bộ nhớ (mất khi app khởi động lại).

---

## Xuất file trả 503

Hàng đợi xuất file đã đầy (`src/exportQueue.ts`). Đây là **backpressure có chủ
ý**, không phải lỗi — nhưng nghĩa là người dùng đang bị từ chối.

```bash
# Từ TRONG container (app không publish cổng ra host; image không có curl). $METRICS_TOKEN nằm
# trong môi trường của container nên để shell BÊN TRONG nó tự nội suy.
docker exec quanly-app sh -c 'wget -qO- --header "Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:3000/metrics' \
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
có bí mật, nên request ghi đầu tiên trả `csrf_token_missing`. SPA React **tự lấy
mã mới và thử lại một lần**, nên người dùng không thấy gì.

Nếu 403 vẫn kéo dài:

```bash
docker logs quanly-app | grep -c csrf_origin      # sai cấu hình origin
```

`csrf_origin` nhiều → `APP_BASE_URL` không khớp origin trình duyệt thật đang
dùng. Phải là scheme+host+port, **không có đường dẫn phía sau**.

Người dùng đang mở tab cũ với bản JS đã cache có thể vẫn hỏng — bảo họ tải lại
cứng. Frontend React né được chuyện đó vì Vite băm tên file asset — đổi nội dung là
đổi tên file, cache cũ không còn khớp. `index.html` vẫn phục vụ `no-cache`.

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
  `JWT_SECRET` (làm mọi người phải đăng nhập lại). Cần xoay cả `PII_ENC_KEY` thì
  **đừng đổi biến rồi khởi động lại tay** — làm vậy là hoá đá toàn bộ dữ liệu đã
  mã hoá. Theo đúng quy trình bốn bước ở
  [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md#xoay-pii_enc_key) (`piiRotate.js`
  rồi `verifyIntegrity.js --pii`).
- **Quá 30 phút chưa hiểu nguyên nhân** → rollback về bản đã biết là tốt
  (`bash deploy.sh rollback prod <git-sha>`, sha lấy trong `RELEASES.log`), rồi
  điều tra ngoài giờ cao điểm.
