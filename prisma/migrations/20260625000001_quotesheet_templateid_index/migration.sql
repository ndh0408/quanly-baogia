-- Perf (additive, KHÔNG đụng data): index FK QuoteSheet.templateId để truy vấn "template còn sheet nào
-- tham chiếu?" (khi xoá/ngừng template) không phải seq-scan toàn bảng QuoteSheet.
CREATE INDEX "QuoteSheet_templateId_idx" ON "QuoteSheet"("templateId");
