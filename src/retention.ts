// Retention/prune cho các bảng APPEND-ONLY phình vô hạn (AuditEvent/LoginAttempt/WebhookDelivery)
// + giới hạn số QuoteVersion/báo giá. Chạy qua repeatable BullMQ job (worker) hằng ngày.
// Mặc định RỘNG TAY (không xoá gì trong thời gian dài) + cấu hình được qua env → an toàn bật mặc định.
// LƯU Ý: các bảng này KHÔNG soft-delete (không nằm trong SOFT_DELETE_MODELS của db.ts) → deleteMany là
// HARD delete đúng ý. AuditEvent được GIỮ 2 năm theo nghĩa vụ truy vết.
import { prisma } from "./db.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { deleteObject, listObjects, isStorageEnabled } from "./storage.js";

const days = (n: number) => new Date(Date.now() - n * 86_400_000);

// ĐỌC QUA `config`, KHÔNG đọc thẳng `process.env`.
//
// Bản trước dùng `Number(process.env.RETAIN_AUDIT_DAYS) || 730`, và dạng đó nuốt hai loại sai cấu
// hình theo hai kiểu khác nhau:
//   · `RETAIN_AUDIT_DAYS=abc` → NaN → falsy → rơi về 730. Sai thành im lặng.
//   · `RETAIN_AUDIT_DAYS=-5`  → -5 là TRUTHY nên đi thẳng vào `days(-5)`, cho ra mốc trong TƯƠNG
//     LAI, và `deleteMany({ createdAt: { lt: mốc } })` khi ấy xoá SẠCH nhật ký kiểm toán. Job này
//     chạy tự động hằng ngày, không ai bấm nút, không có bước xác nhận.
// `config` (src/config.ts) đã khai cả bốn khoá với `.int().positive()`, nên gõ sai là CHẾT NGAY
// LÚC KHỞI ĐỘNG kèm tên biến — đúng thứ cần cho một nút xoá dữ liệu không hoàn tác được.
const AUDIT_DAYS = config.RETAIN_AUDIT_DAYS;       // 2 năm — nghĩa vụ truy vết
const LOGIN_DAYS = config.RETAIN_LOGIN_DAYS;       // 1 năm
const WEBHOOK_DAYS = config.RETAIN_WEBHOOK_DAYS;   // 90 ngày
const VERSION_KEEP = config.RETAIN_VERSION_KEEP;   // giữ N bản mới nhất / báo giá
// Dọn file xuất trong kho object: TẮT MẶC ĐỊNH (0 = tắt). Xem khối chú thích ở chỗ dùng bên dưới —
// đây là thao tác XOÁ VĨNH VIỄN dữ liệu production và nó còn làm hỏng một cổng kiểm sao lưu.
const EXPORT_DAYS = config.RETAIN_EXPORT_DAYS;

// Trần MỖI LƯỢT cho nhánh dọn object. Vì sao phải có: prune chạy trong tiến trình worker, nạp cả
// bảng vào mảng rồi bắn từng lệnh S3 tuần tự là tự tay làm cạn RAM + giữ khoá job quá hạn.
// Phần dư để lượt sau (hằng ngày) dọn tiếp — với UploadObject thì hợp lệ, vì hàng đã dọn bị XOÁ
// khỏi bảng nên lượt sau chắc chắn gặp hàng khác (khác hẳn việc liệt kê object theo tự vựng).
const UPLOAD_BATCH = 5_000;
// Kích thước MỘT TRANG khi rà exports/; rà hết dải bằng StartAfter chứ không cắt cụt.
const EXPORT_PAGE = 1_000;
// Trần tổng số khoá rà trong MỘT lượt — để job maintenance không chạy vô tận.
const EXPORT_SCAN_MAX = 200_000;

/**
 * Xoá object nhưng KHÔNG cho một khoá hỏng làm gãy cả lượt prune (job này còn nhiều việc khác).
 *
 * BA kết quả, KHÔNG PHẢI HAI. Bản trước trả boolean và chỗ gọi chỉ dùng nó để ĐẾM; hệ quả là
 * "xoá hụt" và "không có gì để xoá" gộp làm một, nên không cách nào biết có được phép xoá hàng
 * CSDL đi kèm hay không:
 *   · "da-xoa"  — object đã đi thật (đếm vào staleObjects).
 *   · "bo-qua"  — không có khoá, hoặc chưa cấu hình kho: KHÔNG có object nào để mất. `deleteObject`
 *                 thoát êm khi không có client, nên đếm nó là "đã xoá" sẽ là con số bịa trong log.
 *   · "loi"     — kho từ chối (S3 503, MinIO đang restart…): object CÒN NGUYÊN ở đó.
 */
type KetQuaXoa = "da-xoa" | "bo-qua" | "loi";
async function dropObject(key: string): Promise<KetQuaXoa> {
  if (!key || !isStorageEnabled()) return "bo-qua";
  try {
    await deleteObject(key);
    return "da-xoa";
  } catch (e) {
    logger.warn({ key, err: e instanceof Error ? e.message : String(e) }, "retention: không xoá được object");
    return "loi";
  }
}

/**
 * Trần SỐ HÀNG cho MỘT câu lệnh DELETE khi dọn bảng append-only.
 *
 * `deleteMany` không chia lô là MỘT câu lệnh xoá sạch phần quá hạn. Trên bảng đã tích tụ (AuditEvent
 * giữ 2 năm) lượt prune ĐẦU TIÊN sau khi bật retention là hàng triệu hàng trong một transaction:
 * khoá giữ suốt câu lệnh, WAL phình bằng đúng lượng xoá, và replica/backup phải nuốt trọn khối đó.
 * Chia lô cho phép mỗi lệnh commit riêng — dừng giữa chừng cũng không phải làm lại từ đầu.
 */
const PRUNE_BATCH = 5_000;

/**
 * Xoá theo lô cho tới khi hết hàng quá hạn. `bang` CHỈ nhận hằng chuỗi trong chính file này
 * (không có đầu vào người dùng) nên nội suy vào SQL là an toàn; mốc thời gian vẫn đi qua tham số.
 * Lọc trong truy vấn con rồi xoá theo id: bám đúng index dẫn đầu `createdAt DESC` của ba bảng này.
 */
async function xoaTheoLo(bang: "AuditEvent" | "LoginAttempt" | "WebhookDelivery", cutoff: Date) {
  let tong = 0;
  for (;;) {
    const n = await prisma.$executeRawUnsafe(
      `DELETE FROM "${bang}" WHERE id IN (SELECT id FROM "${bang}" WHERE "createdAt" < $1 LIMIT ${PRUNE_BATCH})`,
      cutoff,
    );
    tong += n;
    if (n < PRUNE_BATCH) return tong;
  }
}

export async function pruneOldRecords() {
  const audit = { count: await xoaTheoLo("AuditEvent", days(AUDIT_DAYS)) };
  const login = { count: await xoaTheoLo("LoginAttempt", days(LOGIN_DAYS)) };
  const webhook = { count: await xoaTheoLo("WebhookDelivery", days(WEBHOOK_DAYS)) };
  // QuoteVersion: giữ VERSION_KEEP bản MỚI NHẤT mỗi quote, xoá bản cũ hơn (raw — keep-top-N theo partition).
  const ver = await prisma.$executeRawUnsafe(
    `DELETE FROM "QuoteVersion" WHERE id IN (
       SELECT id FROM (
         SELECT id, row_number() OVER (PARTITION BY "quoteId" ORDER BY "createdAt" DESC, id DESC) AS rn
         FROM "QuoteVersion"
       ) t WHERE rn > $1)`,
    VERSION_KEEP
  );
  // ─── File XUẤT RA (exports/) — TẮT MẶC ĐỊNH, phải bật bằng RETAIN_EXPORT_DAYS ─────────────
  //
  // Vấn đề có thật: src/worker.ts đặt khoá kèm Date.now() nên mỗi lượt xuất đẻ một object MỚI,
  // không ghi đè — bucket phình vô hạn trong khi link tải đã hết hạn sau 24h.
  //
  // VÌ SAO KHÔNG BẬT SẴN (đọc kỹ trước khi đặt biến này):
  //   1) Lý do từng được viện dẫn — "rác đẩy tarball vượt trần nên bản sao off-host của CHỨNG TỪ
  //      THANH TOÁN bị bỏ lại" — là SAI. scripts/backup/backup-objects.sh dùng `mc mirror` CỘNG DỒN,
  //      CỐ Ý không `--remove`, và bước [5/5] không bao giờ xoá bản gương. Bản gương chỉ có lớn lên;
  //      xoá trong bucket KHÔNG hạ được một MB nào ở MIRROR_MB, nên cổng OBJ_TARBALL_MAX_MB y nguyên.
  //   2) Tệ hơn: bước [2/5] của script đó kiểm tính đầy đủ của bản gương bằng ĐẾM SỐ LƯỢNG
  //      (`LOCAL_N -lt REMOTE_N`). Khi retention xoá dần khỏi bucket, LOCAL_N vĩnh viễn LỚN HƠN
  //      REMOTE_N → điều kiện không bao giờ đúng nữa → `mc mirror` bỏ sót chứng từ mới vẫn báo "✓ OK".
  //      Bật dọn TRƯỚC khi cổng đó chuyển sang đối chiếu THEO TỪNG KHOÁ là tự bịt mắt bản sao lưu.
  //   3) Bucket production tới nay là APPEND-ONLY với tiền tố này. Lượt prune đầu tiên sau khi bật
  //      sẽ xoá VĨNH VIỄN gần như toàn bộ lịch sử xuất file trong một lần — không hoàn tác được.
  //
  // Quy trình bật an toàn: sửa cổng [2/5] của backup-objects.sh trước → đặt RETAIN_EXPORT_DAYS rất
  // lớn (vd 3650) và đọc `exports` trong log `retention prune done` để biết sẽ mất bao nhiêu →
  // hạ dần. Chỉ đụng đúng tiền tố exports/ — logos/, uploads/, chứng từ đều KHÔNG nằm trong diện dọn.
  let exportsPruned = 0;
  if (EXPORT_DAYS > 0 && isStorageEnabled()) {
    const cutoff = days(EXPORT_DAYS);
    // Phân trang bằng StartAfter, KHÔNG cắt cụt ở một cửa sổ cố định. ListObjectsV2 trả khoá theo
    // thứ tự TỰ VỰNG (khoá bắt đầu bằng tiền tố công ty), nên "chạm trần thì lượt sau dọn tiếp" là
    // lời hứa suông: lượt sau lại bắt đầu từ đúng đầu dải, phần đuôi KHÔNG BAO GIỜ tới lượt.
    // Bộ nhớ vẫn O(một trang) vì mỗi trang được dọn xong rồi mới xin trang kế.
    let startAfter: string | undefined;
    let scanned = 0;
    for (;;) {
      const page = await listObjects("exports/", { maxKeys: EXPORT_PAGE, startAfter });
      if (!page.length) break;
      for (const o of page) {
        if (o.lastModified && o.lastModified < cutoff && (await dropObject(o.key)) === "da-xoa") exportsPruned++;
      }
      scanned += page.length;
      startAfter = page[page.length - 1].key;
      if (page.length < EXPORT_PAGE) break; // hết dải
      if (scanned >= EXPORT_SCAN_MAX) {
        // Có trần thời gian cho một lượt job, nhưng lần này việc "hẹn lượt sau" là THẬT: lượt sau
        // vẫn bắt đầu từ đầu dải và những khoá quá hạn ở đầu đã bị xoá, nên dải co lại dần.
        logger.warn({ scanned, startAfter }, "retention: chạm trần rà exports/ trong một lượt");
        break;
      }
    }
  }
  // Phiên tải lên treo: ký URL rồi không bao giờ /finalize. Hàng `pending` quá hạn là rác thuần —
  // object tương ứng (nếu client có PUT lên) chưa qua xác minh nên KHÔNG dùng được, và cũng không
  // ai tải được. Xoá hàng để bảng không phình và để hạn mức MAX_PENDING_UPLOADS không kẹt oan.
  // Bản ghi `rejected` giữ lâu hơn (30 ngày) vì đó là dấu vết ai đó đẩy nội dung không hợp lệ.
  //
  // XOÁ OBJECT TRƯỚC, XOÁ HÀNG SAU. Hàng UploadObject là MANH MỐI DUY NHẤT dẫn tới `stagingKey`;
  // xoá hàng trước thì object tạm nằm lại vĩnh viễn, không còn cách nào tìm ra để dọn.
  // CHỈ xoá `stagingKey`, KHÔNG đụng `key`: /finalize copy từ staging sang `key` rồi mới đổi trạng
  // thái, nên giữa lúc ta liệt kê và lúc ta xoá, `key` có thể vừa nhận file THẬT — xoá nhầm là mất
  // dữ liệu người dùng vừa tải lên. Object ở `stagingKey` thì xoá thừa cũng vô hại (/finalize tự xoá).
  //
  // TRẦN MỖI LƯỢT + XOÁ ĐÚNG TẬP VỪA DỌN. Nạp không trần là cách chắc chắn làm cạn RAM worker khi
  // bảng tích tụ (MAX_PENDING_UPLOADS chỉ đếm hàng CHƯA hết hạn, nên một tài khoản đẻ được hàng
  // nghìn hàng `pending` quá hạn mỗi ngày). Và deleteMany phải giới hạn ĐÚNG những id vừa dọn
  // object: nếu xoá rộng hơn, hàng thứ UPLOAD_BATCH+1 trở đi mất manh mối `stagingKey` vĩnh viễn —
  // đúng cái lỗi mà thứ tự "object trước, hàng sau" ở trên sinh ra để chống.
  // Điều kiện trạng thái vẫn giữ trong deleteMany: giữa findMany và deleteMany một hàng `pending`
  // có thể vừa được /finalize chuyển trạng thái, xoá theo mỗi id là xoá nhầm hàng đã dùng được.
  const pendingWhere = { status: "pending", expiresAt: { lt: days(1) } } as const;
  const rejectedWhere = { status: "rejected", createdAt: { lt: days(30) } } as const;
  let staleObjects = 0;
  const removed: Record<string, number> = { pending: 0, rejected: 0 };
  for (const where of [pendingWhere, rejectedWhere] as const) {
    if (isStorageEnabled()) {
      const rows = await prisma.uploadObject.findMany({
        where,
        select: { id: true, stagingKey: true },
        take: UPLOAD_BATCH,
      });
      // XOÁ HÀNG CHỈ KHI OBJECT THẬT SỰ ĐÃ ĐI.
      //
      // Bản trước xoá cả lô `rows` bất kể `dropObject` trả gì. Mà dropObject NUỐT lỗi S3 — nên một
      // lần MinIO chập chờn là mất VĨNH VIỄN manh mối `stagingKey` của mọi hàng trong lô đó: đúng
      // thứ mà thứ tự "object trước, hàng sau" ở trên sinh ra để chống. Giữ hàng lại thì lượt prune
      // hôm sau gặp lại nó (điều kiện quá hạn vẫn đúng) và dọn nốt.
      //
      // "bo-qua" (stagingKey rỗng) VẪN được xoá hàng: không có object nào để mất, giữ lại chỉ tạo
      // ra một loại rác mới không bao giờ dọn được.
      const choXoa: number[] = [];
      for (const u of rows) {
        const kq = await dropObject(u.stagingKey);
        if (kq === "da-xoa") staleObjects++;
        if (kq !== "loi") choXoa.push(u.id);
      }
      // Vẫn gọi kể cả khi `choXoa` rỗng: Prisma dịch `in: []` thành điều kiện không khớp hàng nào
      // (count = 0), và giữ đúng MỘT đường chạy cho mọi trường hợp thì ít chỗ sai hơn.
      const del = await prisma.uploadObject.deleteMany({ where: { ...where, id: { in: choXoa } } });
      removed[where.status] = del.count;
    } else {
      // Không có kho object thì không có object tạm nào để dọn — bỏ hẳn phần nạp hàng (đỡ một lượt
      // quét bảng vô ích) và xoá thẳng phía máy chủ như trước, RAM O(1).
      const del = await prisma.uploadObject.deleteMany({ where });
      removed[where.status] = del.count;
    }
  }
  const result = { audit: audit.count, login: login.count, webhook: webhook.count, quoteVersion: ver, staleUploads: removed.pending, rejectedUploads: removed.rejected, exports: exportsPruned, staleObjects };
  logger.info(result, "retention prune done");
  return result;
}
