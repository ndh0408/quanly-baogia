-- Index dẫn đầu bằng createdAt cho ba bảng CHỈ-GHI-THÊM.
--
-- VÌ SAO: cả ba bảng chỉ có index GHÉP mà createdAt nằm ở cột 2/3
-- (AuditEvent[actorId,createdAt], LoginAttempt[username,createdAt], WebhookDelivery[webhookId,createdAt]).
-- Hai đường KHÔNG lọc theo cột dẫn đầu ấy nên không dùng được index nào:
--   · trang Nhật ký mở không bộ lọc → count(*) + ORDER BY "createdAt" DESC LIMIT n  (seq-scan + top-N sort)
--   · job dọn dữ liệu (src/retention.ts) → DELETE ... WHERE "createdAt" < $1        (seq-scan)
-- Ba bảng này chỉ lớn lên, nên chi phí tăng đều theo thời gian.
--
-- AN TOÀN: thuần THÊM index, không đụng dữ liệu, không đổi cột. ROLLBACK: DROP INDEX ba dòng dưới.
--
-- ⚠️ TRÊN PRODUCTION ĐANG TẢI: `CREATE INDEX` (không CONCURRENTLY) khoá ghi bảng suốt thời gian
-- dựng index. Với AuditEvent lớn, hãy chạy TAY bản CONCURRENTLY dưới đây TRƯỚC, rồi
-- `prisma migrate resolve --applied 20260826000001_append_only_createdat_indexes` — vì
-- CONCURRENTLY không chạy được trong transaction của migrate:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditEvent_createdAt_idx"      ON "AuditEvent"("createdAt" DESC);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "LoginAttempt_createdAt_idx"    ON "LoginAttempt"("createdAt" DESC);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "WebhookDelivery_createdAt_idx" ON "WebhookDelivery"("createdAt" DESC);

CREATE INDEX IF NOT EXISTS "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "LoginAttempt_createdAt_idx" ON "LoginAttempt"("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "WebhookDelivery_createdAt_idx" ON "WebhookDelivery"("createdAt" DESC);
