// Tầng SERVICE cho domain GDPR (xuất dữ liệu + quyền-được-quên). Bê NGUYÊN logic THUẦN từ
// gdpr.routes.ts: truy vấn tổng hợp dữ liệu cá nhân, sinh các prisma-op vô danh hoá + thu hồi token.
// LƯU Ý: thao tác res (setHeader/end/clearCookie) và session.destroy GIỮ trong route — đó là controller
// HTTP, không phải logic thuần. Service chỉ trả DỮ LIỆU / thực thi transaction + audit. Mẫu theo customerService.ts.
import type { Request } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { httpError, loiXacNhanSai } from "../httpError.js";
import { config } from "../config.js";
import { quoteScopeWhere, readScopeWhere } from "../permissions.js";
import { destroyAllSessions } from "../sessions.js";
// `thoatLike` dùng CHUNG với phía đọc (findLoginUser) và phía chống trùng tài khoản — ba nửa của
// cùng một quy tắc, và nửa nào tự chép lại phép thoát là nửa sẽ trôi khỏi hai nửa kia.
import { thoatLike } from "../authCore.js";
import { bangNoiBoTheoSheet, bangHnTheoBaoGia } from "./quoteService.js";

/**
 * Tuần tự hoá khối xuất — MỘT lần stringify duy nhất cho cả đường xuất, và là chỗ DUY NHẤT xử lý
 * BigInt (AuditEvent/Notification/RefreshToken đều có id BigInt, thứ JSON.stringify trần sẽ ném).
 *
 * Trước đây việc này làm hai lần: `bigIntToString` chạy JSON.stringify + JSON.parse trên TOÀN BỘ cây
 * (dựng thêm một chuỗi đầy đủ và một cây object đầy đủ trong heap), rồi route lại JSON.stringify lần
 * nữa để gửi đi. Ba bản sao cho một lần tải về. Bỏ vòng parse ấy không đổi một byte nào của JSON gửi
 * ra: Decimal của Prisma có toJSON trả chuỗi và Date có toJSON trả ISO, y hệt vòng cũ tạo ra.
 */
export function serializeExport(data: unknown): string {
  return JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

/**
 * ── XOÁ DANH TÍNH MỘT NGƯỜI (quyền-được-quên) ──────────────────────────────
 * Sinh các prisma-op xoá dữ liệu cá nhân CỦA CHÍNH người đó rồi khoá tài khoản. Trả về mảng để
 * `prisma.$transaction([...])` cam kết nguyên tử cùng lượt thu hồi token. Dùng chung cho đường
 * tự-xoá và đường admin-xoá-hộ.
 *
 * ── KHỐI `data` PHẢI PHỦ MỌI CỘT CÁ NHÂN, KHÔNG PHẢI "NHỮNG CỘT NHỚ RA" ────
 * Bản trước bỏ sót `senderName` — cột giữ TÊN THẬT của người đó và là nguồn ô "Người gửi" IN LÊN
 * BÁO GIÁ GỬI RA NGOÀI (web/src/pages/NewQuoteWizard.tsx đọc `me.senderName || me.displayName`).
 * Nên sau khi `deletedAt` đã đặt, tên người ấy vẫn nằm nguyên trong CSDL và vẫn đọc ra được. Cùng
 * lối bỏ sót đó còn ba nhóm nữa:
 *   · `projectCode` — prefix mã dự án RIÊNG của từng nhân viên (thường là viết tắt tên người), đóng
 *     vào mã mọi báo giá họ tạo. Định danh giả gắn chặt với một con người vẫn là dữ liệu cá nhân.
 *   · `lastLoginAt` / `lastLoginIp` — địa chỉ IP là dữ liệu cá nhân, và chính repo này đã công nhận
 *     thế: `exportUser` trả `lastLoginIp` về cho chủ thể, còn gdpr.routes.ts gọi bản xuất là "gói
 *     PII đầy đủ (… IP đăng nhập …)". Thứ đủ nhạy để chặn mọi tầng cache khi XUẤT thì cũng đủ nhạy
 *     để phải xoá khi người ta đòi XOÁ.
 *   · `inviteTokenHash` / `inviteExpiresAt` — chứng thư kích hoạt còn SỐNG. `updateUser` khi admin
 *     KHOÁ tài khoản đã bắt buộc đốt hai cột này (accept-invite đặt `active: true`, nên token còn
 *     sống là người bị khoá tự mở khoá lại được). Xoá là hành vi MẠNH HƠN khoá, không thể làm ít hơn.
 * Và `passwordChangedAt`: đổi `passwordHash` thành "DELETED" mà không đóng mốc thì chốt chặn phiên
 * ĐỘC LẬP với kho phiên (xem chú thích cột đó trong prisma/schema.prisma) không hề đóng — mọi access
 * token JWT phát hành trước lúc xoá vẫn qua được phép so thời gian, chỉ còn `active: false` gác.
 *
 * ── NGOÀI BẢNG User: BA BẢN SAO DỮ LIỆU CÁ NHÂN CỦA CHÍNH NGƯỜI ĐÓ ────────
 *   · RefreshToken.ip/userAgent — mỗi hàng một IP thật + một vân tay thiết bị, và `exportUser`
 *     chính thức coi hai cột này là dữ liệu cá nhân của chủ thể (nó trả cả hai về). Thu hồi token
 *     mà giữ nguyên dấu vết định vị của token là làm nửa việc.
 *   · user_sessions — `sess` là JSON chứa `displayName` + `username` THẬT. Kho phiên nằm NGOÀI
 *     Prisma nên không vào được transaction; `destroyAllSessions` chạy ngay sau đó (xem `xoaDanhTinh`).
 *   · LoginAttempt — hàng `success: true`. Xem khối riêng ngay dưới: quyết định ở đây đã ĐẢO CHIỀU
 *     ngày 2026-09-18, nên đừng đọc bản ghi lịch sử ở chỗ khác mà suy ra hành vi hôm nay.
 *
 * ── LoginAttempt: ĐÃ GỠ RỒI LÀM LẠI CHO ĐÚNG (2026-09-18) ──────────────────
 * Bản trước CỐ Ý không đụng bảng này, và lý lẽ hồi đó không sai: một phép `updateMany({ where: {
 * username } })` so BYTE-FOR-BYTE sẽ SÓT hàng, vì phía GHI lưu ĐÚNG chuỗi người dùng gõ (`authCore.ts`:
 * `username: loginId`) còn phía ĐỌC (`findLoginUser`) khớp KHÔNG PHÂN BIỆT HOA/THƯỜNG và khớp CẢ cột
 * `email`. Một phép xoá SÓT mà đọc vào tưởng đã xong thì tệ hơn không xoá.
 *
 * Chủ hệ thống nay YÊU CẦU xoá, nên lý lẽ đó không còn là cớ để không làm — nó thành BẢN ĐẶC TẢ của
 * phép lọc. Bốn điều kiện, cả bốn đều bắt buộc:
 *
 *   (a) KHỚP CẢ `username` CŨ LẪN `email` CŨ. Bảng không có khoá ngoại về User; chuỗi `username` là
 *       đường lần ra DUY NHẤT, và người ta đăng nhập được bằng cả hai. Hai giá trị ấy phải được đọc
 *       TRƯỚC transaction (xem `xoaDanhTinh`) vì chính transaction này ghi đè `username` và đặt
 *       `email = null` — đọc sau là khớp 0 hàng, và một bài kiểm chỉ đo văn bản nguồn vẫn xanh.
 *   (b) KHỚP KHÔNG PHÂN BIỆT HOA/THƯỜNG (`mode: "insensitive"`). Đo được trên Prisma 7.10.0 +
 *       adapter-pg: nó chạy trong `updateMany({ where })`.
 *   (c) PHẢI ĐI QUA `thoatLike`. Đây là cái bẫy NGƯỢC CHIỀU với bẫy ở trên, và nó nặng hơn: Prisma
 *       biên dịch `equals` + `mode: "insensitive"` thành ILIKE, KHÔNG phải `lower() = lower()`, nên
 *       `_` và `%` trong chuỗi trở thành KÝ TỰ ĐẠI DIỆN. Regex `username` CHO PHÉP `_`, và tài khoản
 *       mời qua email lấy thẳng email làm username. Đo thật: một tên chứa `_` quét trúng 2 hàng
 *       (xoá dấu vết đăng nhập của NGƯỜI KHÁC — đúng thứ bản vá này phải tránh) và về 1 hàng khi có
 *       `thoatLike`. Dùng CHUNG helper đã xuất khẩu ở authCore, đừng chép lại phép thoát.
 *   (d) CHỈ CHẠM HÀNG `success: true`. `ip`/`userAgent` của hàng `success: false` là dấu vết của
 *       NGƯỜI KHÁC gõ vào tài khoản này — `recordAttempt(false, "no_such_user")` ghi một hàng cho
 *       MỌI chuỗi người lạ gõ — tức bằng chứng an ninh, không phải dữ liệu cá nhân của người xin xoá.
 *       Hàng `success: true` thì người gõ đã chứng minh biết mật khẩu VÀ qua cổng MFA, nên đó chắc
 *       chắn là chính chủ thể. Retention vẫn tự dọn cả bảng sau 365 ngày (RETAIN_LOGIN_DAYS).
 *
 * ĐỔI TÊN, KHÔNG XOÁ HÀNG: `username` là `String` NOT NULL nên không null được → ghi `tenThayThe`;
 * `ip`/`userAgent` về `null`. Mirror đúng cách `RefreshToken` được xử lý ở dưới, và giữ SỐ HÀNG nên
 * dòng thời gian an ninh (bao nhiêu lần đăng nhập thành công, lúc nào) còn nguyên.
 *
 * ⚠ HẠN CHẾ ĐÃ BIẾT, khai ra để không thành khoảng lặng: phép khớp chỉ lần ra được `username`/`email`
 * HIỆN TẠI. Từ 2026-09-18 `UserUpdateSchema` nhận `email`, nên quản trị đổi được email của một người
 * — và mọi hàng `LoginAttempt` sinh ra từ lần đăng nhập bằng email CŨ trở nên không lần ra được. Bảng
 * không lưu `userId` nên không có đường nào khép kín chỗ này mà không đổi schema. Retention 365 ngày
 * là lớp chặn cuối.
 *
 * ── CỐ Ý GIỮ LẠI — NÓI THẲNG RA, ĐỪNG ĐỂ LÀ KHOẢNG LẶNG ───────────────────
 * Những chỗ dưới đây KHÔNG bị đụng tới, và đó là quyết định chứ không phải bỏ sót. Chú thích cũ chỉ
 * miễn trừ "quotes/customers" với lý lẽ "không phải dữ liệu cá nhân của người xoá" — lý lẽ đó KHÔNG
 * phủ được mấy mục đầu trong danh sách này, nên phải kể tên từng chỗ:
 *   · Quote.fromContact/fromPhone/fromTitle — bản sao ĐÔNG CỨNG tên/SĐT/chức danh người gửi tại thời
 *     điểm tạo báo giá. Đây LÀ dữ liệu cá nhân của chính người xin xoá, nhưng báo giá là chứng từ
 *     đã gửi ra ngoài cho khách: sửa nó là sửa một bản ghi kế toán đã phát hành.
 *   · QuoteSheet.signedByName — bản chụp tên người ký, giữ có chủ ý (prisma/schema.prisma ghi rõ
 *     "keep the snapshotted signedByName, just clear the link (audit-safe)").
 *   · QuoteVersion.payload — mỗi hàng phiên bản chép lại fromContact/fromPhone/fromTitle của hàng
 *     báo giá tương ứng; giữ hay bỏ phải đi CÙNG quyết định về Quote ở trên.
 *   · AuditEvent.before/after — nhật ký `user.update` lưu nguyên `USER_SELECT`, tức một bản chụp đầy
 *     đủ username/email/displayName/phone/title/senderName/projectCode. Giữ theo nghĩa vụ pháp lý,
 *     nhưng đây là bản sao ĐẦY ĐỦ của đúng những cột vừa bị xoá ở trên — người rà tuân thủ phải biết.
 *   · Customer — dữ liệu cá nhân của CHỦ THỂ KHÁC, không phải của người xin xoá.
 *   · LoginAttempt hàng `success: false` — ip/userAgent ở đó là dấu vết của NGƯỜI KHÁC gõ vào tài
 *     khoản này (bằng chứng an ninh), không phải dữ liệu cá nhân của người xin xoá. Lý lẽ đầy đủ ở
 *     điều kiện (d) của khối LoginAttempt bên trên. Retention tự dọn sau 365 ngày.
 *   · AuditEvent.ip/userAgent — cùng lý lẽ với `before/after` ngay trên: nhật ký giữ theo nghĩa vụ
 *     pháp lý. Nêu tên ở đây để người rà tuân thủ biết hai cột này CÒN, chứ không phải bị bỏ quên.
 *
 * Thêm một cột cá nhân mới vào `model User` mà quên khối `data` này là ĐỎ ở
 * tests/gx-gdpr-xoa-sot-cot-pii.test.js (bài đó khoá theo QUAN HỆ với schema, không ghim danh sách).
 */
function anonymizeUserOps(id: number, tenThayThe: string, danhTinhCu: { username: string; email: string | null }) {
  const luc = new Date();
  // Tập chuỗi đăng nhập của người này. `new Set` vì tài khoản mời qua email có `username === email`
  // — không lọc trùng thì OR có hai nhánh y hệt, vô hại nhưng đọc vào tưởng đang phủ hai thứ khác nhau.
  const dinhDanhCu = [...new Set([danhTinhCu.username, danhTinhCu.email].filter((v): v is string => !!v))];
  return [
    prisma.refreshToken.updateMany({ where: { userId: id }, data: { revokedAt: luc, ip: null, userAgent: null } }),
    // Bốn điều kiện (a)–(d) của khối LoginAttempt trong docblock trên, theo đúng thứ tự đó. Đặt op
    // này TRƯỚC `prisma.user.update` để đọc tự nhiên: giá trị trong `where` đã chốt lúc dựng promise
    // nên thứ tự không đổi kết quả, nhưng người đọc không phải tự trả lời "hàng đã bị đổi tên chưa".
    prisma.loginAttempt.updateMany({
      where: {
        success: true,
        OR: dinhDanhCu.map((v) => ({ username: { equals: thoatLike(v), mode: "insensitive" as const } })),
      },
      data: { username: tenThayThe, ip: null, userAgent: null },
    }),
    prisma.user.update({
      where: { id },
      data: {
        username: tenThayThe,
        passwordHash: "DELETED",
        displayName: "(deleted user)",
        email: null,
        phone: null,
        title: null,
        senderName: null,
        projectCode: null,
        lastLoginAt: null,
        lastLoginIp: null,
        inviteTokenHash: null,
        inviteExpiresAt: null,
        passwordChangedAt: luc,
        mfaSecret: null,
        mfaBackupCodes: [],
        mfaEnabled: false,
        mfaLastStep: null,
        active: false,
        deletedAt: luc,
      },
    }),
  ];
}

/**
 * Đọc mốc cần thiết → transaction vô danh hoá → huỷ MỌI phiên cookie. Dùng chung cho hai đường xoá.
 *
 * `destroyAllSessions` phải gọi ở đây chứ không để route lo: route của đường TỰ xoá chỉ
 * `req.session.destroy()` — tức đúng MỘT phiên, phiên của trình duyệt đang bấm nút — còn đường ADMIN
 * xoá hộ thì không huỷ phiên nào của nạn nhân cả. Người bị admin xoá vẫn dùng tiếp tab đang mở cho
 * tới khi request kế tiếp chạm `enforceActiveUser`, và hàng `user_sessions` (chứa `displayName` +
 * `username` thật) vẫn nằm đó tới lúc hết hạn. Ba service khác (auth/mfa/user) đã gọi hàm này mỗi
 * khi thông tin xác thực đổi; đường xoá là chỗ cần nó nhất mà lại là chỗ duy nhất quên.
 */
async function xoaDanhTinh(id: number) {
  // `username` + `email` PHẢI đọc Ở ĐÂY, TRƯỚC transaction. `LoginAttempt` không có khoá ngoại về
  // User nên hai chuỗi này là đường lần ra DUY NHẤT của nhật ký đăng nhập, mà chính transaction bên
  // dưới ghi đè `username` thành `tenThayThe` và đặt `email = null`. Đọc sau là khớp 0 hàng — và đó
  // là kiểu thất bại IM LẶNG: `updateMany` trả `count: 0` chứ không ném, nên đường xoá vẫn trả 200.
  const truoc = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true, email: true } });
  if (!truoc) throw httpError(404, "Không tìm thấy người dùng");
  const tenThayThe = `deleted-${id}-${Date.now()}`;
  await prisma.$transaction(anonymizeUserOps(id, tenThayThe, { username: truoc.username, email: truoc.email }));
  // Nằm NGOÀI Prisma (bảng của connect-pg-simple) nên không vào được transaction ở trên.
  await destroyAllSessions(id);
}

/**
 * Tổng hợp toàn bộ dữ liệu cá nhân của 1 user thành object xuất khẩu. Tuần tự hoá: `serializeExport`.
 *
 * `session` — PHIÊN CỦA NGƯỜI XIN BẢN XUẤT (đường tự-xuất /me/export). Có nó thì báo giá và khách hàng
 * bị KẸP THÊM phạm vi quyền hiện tại: một nhân viên bị gỡ sạch quyền báo giá/khách hàng (chuyển sang
 * tài khoản "chi phí"/kế toán) nhận 403 ở MỌI đường đọc bình thường (listQuotes/getQuote/listCustomers/
 * listProjects đều fail-closed), nhưng trước 2026-09-08 đường này chỉ có requireAuth và truy vấn
 * thẳng `createdById`/`ownerId` — một request tải về TOÀN BỘ báo giá họ từng tạo kèm giá từng hạng
 * mục, bảng chi phí nội bộ, và 5000 khách hàng đầy đủ liên hệ — dữ liệu của BÊN THỨ BA. Cùng lập luận
 * mà chú thích bên dưới đã dùng để loại customerLogo. Đường admin xuất hộ (/users/:id/export) không
 * truyền session → giữ nguyên hành vi (admin có read:all).
 */
/**
 * ── TRẦN SỐ BẢN GHI CHO TỪNG NHÓM ─────────────────────────────────────────
 * Bốn nhóm dưới đây vốn có `take` cứng và cắt HOÀN TOÀN IM LẶNG: người nhận tải về một tệp tự
 * khai là bản xuất đầy đủ, trong khi bản ghi thứ 1.001 (hoặc 5.001) đã bị bỏ mà không dòng nào
 * nói ra. Chính tệp này đã đặt ra luật ngược lại — "Cắt mà im lặng là tệ hơn không cắt: người
 * nhận tưởng mình đã có đủ dữ liệu" — nhưng luật đó mới chỉ áp cho phần DÒNG HẠNG MỤC.
 *
 * Tệ hơn, `huongDan` của khối `gioiHan` còn khẳng định thẳng "Danh sách báo giá vẫn ĐẦY ĐỦ".
 * Với người dùng có hơn 1.000 báo giá, câu đó SAI — và nó sai theo hướng trấn an.
 *
 * Với một bản xuất GDPR thì đây không phải chuyện thẩm mỹ: bản xuất thiếu mà không khai là thiếu
 * thì người nhận không có cách nào biết để đi đòi phần còn lại.
 */
export const TRAN_BAN_GHI = { baoGia: 1_000, khachHang: 5_000, nhatKy: 5_000, thongBao: 5_000 } as const;

/** Một nhóm bị chạm trần — mô tả để đưa vào `gioiHan.danhSachBiCat`. */
type NhomBiCat = { nhom: string; tran: number; huongDan: string };

/**
 * Lấy `tran + 1` bản ghi rồi cắt lại còn `tran`. Dư một bản ghi = ĐÃ chạm trần.
 *
 * Dùng cách này thay vì một câu `count()` riêng vì `count` trên bảng lớn tốn đúng một lượt quét
 * nữa, mà ta chỉ cần biết "có nhiều hơn trần không" chứ không cần biết nhiều hơn bao nhiêu.
 */
export function catVaBao<T>(rows: T[], tran: number, nhom: string, huongDan: string): { rows: T[]; biCat: NhomBiCat | null } {
  if (rows.length <= tran) return { rows, biCat: null };
  return { rows: rows.slice(0, tran), biCat: { nhom, tran, huongDan } };
}

/**
 * Nhóm nhật ký mang BẢN CHỤP dữ liệu của người khác trong before/after, và cách xác định phạm vi đọc
 * HIỆN TẠI của nhóm đó (quyền `<quyen>:read:*`, cột chủ sở hữu, bảng để tra chủ).
 *
 * Soát chéo files#4 (RBAC-04 × FILE-11): FILE-11 chỉ che nhật ký `customer` và chỉ khi phạm vi = null.
 * RBAC-04 sau đó cho `employee.update` ghi before/after (SĐT, địa chỉ, MST, năm sinh, nơi cấp CCCD…),
 * còn `personnel.*-note` vốn đã ghi từ trước — nên người bị gỡ quyền (hoặc hạ xuống "của mình") vẫn lấy
 * lại được qua bản xuất GDPR đúng thứ mọi đường đọc thường đã chặn. Một bảng duy nhất để lần sau thêm
 * before/after cho nhóm mới thì thêm MỘT dòng ở đây, không phải nhớ ra một nhánh `?:` nữa.
 */
const PHAM_VI_NHAT_KY: Record<string, { quyen: string; cotChu: string; bang: "customer" | "employee" | "personnelRecord" }> = {
  customer: { quyen: "customer", cotChu: "ownerId", bang: "customer" },
  employee: { quyen: "employee", cotChu: "createdById", bang: "employee" },
  personnel: { quyen: "personnel", cotChu: "createdById", bang: "personnelRecord" },
};

/**
 * Bỏ before/after của những sự kiện mà phiên HIỆN TẠI không còn được đọc bản ghi đích:
 *   · phạm vi null (không có quyền đọc nhóm) → bỏ mọi bản chụp của nhóm;
 *   · read:all → giữ nguyên;
 *   · read:own → chỉ giữ bản chụp của bản ghi mình sở hữu (tra một lần mỗi nhóm; gồm cả bản ghi đã xoá
 *     mềm — xoá không đổi chủ). Chỉ che "nhóm có trong bảng khi phạm vi null" là không đủ: hạ quyền
 *     xuống "Xem … của mình" là ca thực tế hơn gỡ hẳn.
 * Hành động, thời điểm, resourceId luôn giữ — đó là dữ liệu CỦA người yêu cầu.
 */
async function kepBanChupNhatKy(rows: any[], session: Parameters<typeof quoteScopeWhere>[0]): Promise<any[]> {
  const giu = new Map<string, Set<string> | "tatCa">();
  for (const [resource, cfg] of Object.entries(PHAM_VI_NHAT_KY)) {
    const scope = readScopeWhere(session, cfg.quyen, cfg.cotChu);
    if (scope && !Object.keys(scope).length) { giu.set(resource, "tatCa"); continue; }
    const ids = scope
      ? [...new Set(rows.filter((e) => e?.resource === resource && (e.before != null || e.after != null)).map((e) => Number(e.resourceId)).filter(Number.isSafeInteger))]
      : [];
    if (!ids.length) { giu.set(resource, new Set()); continue; }
    const args = { where: { AND: [{ id: { in: ids } }, scope] }, select: { id: true }, includeDeleted: true } as any;
    const cuaMinh: { id: number }[] = cfg.bang === "customer" ? await prisma.customer.findMany(args)
      : cfg.bang === "employee" ? await prisma.employee.findMany(args)
      : await prisma.personnelRecord.findMany(args);
    giu.set(resource, new Set(cuaMinh.map((r) => String(r.id))));
  }
  return rows.map((e) => {
    const g = e?.resource ? giu.get(e.resource) : undefined;
    if (!g || g === "tatCa" || g.has(String(Number(e.resourceId)))) return e;
    return { ...e, before: undefined, after: undefined };
  });
}

export async function exportUser(userId: number, session?: Parameters<typeof quoteScopeWhere>[0]) {
  // null = KHÔNG có quyền đọc nhóm đó → nhóm đó rỗng trong bản xuất (fail-closed như mọi đường đọc).
  const phamViBaoGia = session ? quoteScopeWhere(session) : {};
  const phamViKhach = session ? readScopeWhere(session, "customer") : {};
  const [user, quotes, customers, auditEvents, refreshTokens, notifications] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      // `senderName` + `projectCode` PHẢI có mặt: chúng là dữ liệu cá nhân (tên thật in lên báo giá,
      // và prefix mã dự án gắn với một con người). Thiếu chúng ở đây thì chủ thể không có đường nào
      // BIẾT hai cột đó tồn tại mà đi đòi — đúng cái luật mà chính tệp này đã đặt cho phần bị cắt:
      // "Cắt mà im lặng là tệ hơn không cắt: người nhận tưởng mình đã có đủ dữ liệu".
      // Danh sách này KHÔNG được liệt kê bằng tay nữa mà không ai gác: từ 2026-09-18 có cổng quan
      // hệ đối chiếu nó với `model User` trong schema.prisma — thêm một cột cá nhân mới mà quên
      // đưa vào đây là ĐỎ (tests/gx-gdpr-xoa-sot-cot-pii.test.js, describe "Đường XUẤT...").
      // Chính cổng đó vừa tìm ra `mfaEnabled` đang thiếu.
      select: {
        id: true, username: true, displayName: true, email: true, phone: true,
        title: true, senderName: true, projectCode: true, role: true, active: true,
        // CHỈ cờ bật/tắt, KHÔNG phải `mfaSecret`/`mfaBackupCodes` — trao hai cái đó ra là trao
        // luôn khả năng sinh mã của người ta (xem MIEN_TRU_XUAT trong bài kiểm).
        mfaEnabled: true,
        lastLoginAt: true, lastLoginIp: true, createdAt: true,
      },
    }),
    // Ba cột BLOB bị loại khỏi bản xuất — lý do KHÁC NHAU cho từng cột, không phải "cho nhẹ":
    //   · QuoteItem.images  — mảng data-URL base64, trần validator là 10 ảnh × 2.800.000 ký tự MỖI
    //     hạng mục (src/validators.ts:161-163). Một báo giá cỡ trung đã vượt xa bộ nhớ hợp lý, mà
    //     take ở đây là 1000 báo giá.
    //   · Quote.customerLogo — data-URL base64 logo của KHÁCH HÀNG, không phải dữ liệu cá nhân của
    //     người xin bản xuất: đưa vào một tệp tải-về là tự tạo đường rò.
    //
    // CÒN `QuoteSheet.extraTables` THÌ GIỮ — CHỈ CẮT RIÊNG ẢNH, VÀ CẮT NGAY TẠI SQL.
    //
    // Bản trước dùng `omit: { extraTables: true }` và chú thích đi kèm khẳng định "mọi trường
    // chữ/số của báo giá, sheet và hạng mục vẫn nguyên". Sai: `extraTables` là MỘT cột jsonb, cắt
    // nó là cắt cả nội dung — các bảng nội bộ Chi Phí HCM / Giá Hà Nội / Phí Khách Hàng, gồm
    // {name, detail, unit, quantity, unitPrice, days, notes} của từng dòng. Đó là dữ liệu do CHÍNH
    // người xin bản xuất nhập vào báo giá của họ; một bản xuất GDPR thiếu nó là thiếu thật.
    //
    // Nhưng cắt ở tầng JS cũng sai, và tests/b5-gdpr-export-anh.test.js đo được: ảnh `paidProof`
    // vẫn đi qua dây rồi mới bị bỏ (2,4 MB thay vì 0,36 MB cho cùng bộ dữ liệu). Nên dùng lại
    // `bangNoiBoTheoSheet` của quoteService — câu SQL DUY NHẤT trong repo cắt `paidProof` — thay vì
    // viết bản thứ hai. Hai bản chép của quy tắc cắt ấy chắc chắn sẽ trôi khỏi nhau.
    phamViBaoGia === null ? Promise.resolve({ danhSach: [] as any[], gioiHan: null, biCat: null as NhomBiCat | null }) : napBaoGiaCoTran(userId, phamViBaoGia),
    phamViKhach === null ? Promise.resolve([] as any[]) : prisma.customer.findMany({ where: { AND: [{ ownerId: userId }, phamViKhach] }, take: TRAN_BAN_GHI.khachHang + 1 }),
    prisma.auditEvent.findMany({
      where: { actorId: userId },
      orderBy: { createdAt: "desc" },
      take: TRAN_BAN_GHI.nhatKy + 1,
    }),
    prisma.refreshToken.findMany({
      where: { userId },
      select: { id: true, family: true, ip: true, userAgent: true, expiresAt: true, revokedAt: true, createdAt: true },
    }),
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: TRAN_BAN_GHI.thongBao + 1,
    }),
  ]);

  // ── GOM MỌI CHỖ BỊ CẮT LẠI MỘT KHỐI ──────────────────────────────────────
  // Ba nhóm dưới lấy dư một bản ghi ở trên; cắt lại đúng trần TẠI ĐÂY và ghi nhận nhóm nào chạm.
  const cKhach = catVaBao(customers, TRAN_BAN_GHI.khachHang, "customers",
    `Chỉ ${TRAN_BAN_GHI.khachHang.toLocaleString("vi-VN")} khách hàng có trong bản xuất này. Lấy phần còn lại qua GET /api/customers?page=…`);
  const cNhatKy = catVaBao(auditEvents, TRAN_BAN_GHI.nhatKy, "auditEvents",
    `Chỉ ${TRAN_BAN_GHI.nhatKy.toLocaleString("vi-VN")} bản ghi nhật ký MỚI NHẤT có trong bản xuất này.`);
  const cThongBao = catVaBao(notifications, TRAN_BAN_GHI.thongBao, "notifications",
    `Chỉ ${TRAN_BAN_GHI.thongBao.toLocaleString("vi-VN")} thông báo MỚI NHẤT có trong bản xuất này.`);

  // Đường admin (không truyền session) giữ nguyên hành vi: không kẹp theo phạm vi.
  const nhatKy = session ? await kepBanChupNhatKy(cNhatKy.rows, session) : cNhatKy.rows;

  const danhSachBiCat = [quotes.biCat, cKhach.biCat, cNhatKy.biCat, cThongBao.biCat].filter(Boolean);
  // `gioiHan` phải xuất hiện khi CÓ BẤT KỲ kiểu cắt nào — trước đây nó chỉ xuất hiện cho phần dòng
  // hạng mục, nên bốn nhóm bị cắt theo SỐ BẢN GHI đi qua hoàn toàn im lặng.
  const gioiHan =
    quotes.gioiHan || danhSachBiCat.length
      ? { ...(quotes.gioiHan ?? {}), ...(danhSachBiCat.length ? { danhSachBiCat } : {}) }
      : null;

  return {
    exportedAt: new Date(),
    format: "qly-gdpr-export/1.0",
    user,
    // `gioiHan` chỉ xuất hiện khi bản xuất BỊ CẮT. Có mặt = bản xuất này KHÔNG đầy đủ, và khối đó
    // nói rõ cắt ở đâu và lấy nốt bằng cách nào. Cắt mà im lặng là tệ hơn không cắt: người nhận
    // tưởng mình đã có đủ dữ liệu.
    ...(gioiHan ? { gioiHan } : {}),
    quotes: quotes.danhSach,
    customers: cKhach.rows,
    // Chốt kẹp phạm vi phải phủ CẢ nhật ký (FILE-11, mở rộng ở soát chéo files#4): audit của khách hàng,
    // danh bạ, hồ sơ nhân sự lưu before/after là bản chụp dữ liệu của NGƯỜI KHÁC. Người đã bị gỡ/hạ quyền
    // vẫn nhận lại toàn bộ qua đây — đúng thứ mọi đường đọc thường đã chặn. Xem kepBanChupNhatKy.
    auditEvents: nhatKy,
    refreshTokens,
    notifications: cThongBao.rows,
  };
}

/**
 * Nạp báo giá cho bản xuất GDPR, CÓ TRẦN SỐ DÒNG, và nạp THEO LÔ.
 *
 * ── VÌ SAO ────────────────────────────────────────────────────────────────
 * Bản trước là một `findMany({ take: 1000, include: { sheets: { include: { items } } } })` —
 * trần 1000 BÁO GIÁ, không có trần nào trên số DÒNG. Sức chứa schema là 60 trang × 1000 dòng mỗi
 * báo giá, nên một lượt xuất có thể kéo về tới 60 TRIỆU dòng và dựng tất cả thành đối tượng JS
 * cùng lúc, rồi `serializeExport` còn `JSON.stringify(..., 2)` (in thụt lề) toàn bộ thành MỘT
 * chuỗi giữ trọn trong bộ nhớ. Đây là đường OOM cuối cùng còn lại sau đợt vá tháng 9 — cùng hình
 * dạng với đường lưu và đường nhập Excel đã vá.
 *
 * ── VÌ SAO PHẢI NẠP THEO LÔ, KHÔNG PHẢI CẮT SAU KHI NẠP ──────────────────
 * Cắt sau khi `findMany` trả về là vô nghĩa: đỉnh bộ nhớ nằm ở CHÍNH LÚC NẠP. Cùng bài học đã trả
 * giá ở `src/excelImport.ts` — bản vá đầu cắt sau vòng quét và ĐO ĐƯỢC là không đủ (RSS 1.887 MB,
 * vẫn bị nhân giết).
 *
 * ── VÀ VÌ SAO KHÔNG TỪ CHỐI THẲNG ─────────────────────────────────────────
 * Đây là quyền truy cập dữ liệu cá nhân. Trả lỗi "dữ liệu của bạn quá lớn" là từ chối một quyền
 * — không được phép. Nên: vẫn trả đủ DANH SÁCH báo giá (id, số, tiêu đề, ngày, tổng tiền…), chỉ
 * phần DÒNG CHI TIẾT của những báo giá vượt trần là bỏ, kèm khối `gioiHan` nói rõ báo giá nào
 * thiếu chi tiết và lấy nốt ở đâu (`GET /api/quotes/:id`).
 */
async function napBaoGiaCoTran(userId: number, phamViBaoGia: any) {
  const TRAN_DONG = config.GDPR_EXPORT_MAX_ROWS;
  const MOI_LO = 25;

  const ids = (await prisma.quote.findMany({
    where: { AND: [{ createdById: userId }, phamViBaoGia] },
    select: { id: true },
    orderBy: { id: "asc" },
    take: TRAN_BAN_GHI.baoGia + 1,
  })).map((q) => q.id);
  // Lấy dư MỘT id để biết có chạm trần không, rồi cắt lại. Trước bản vá này chỗ đó là `take: 1000`
  // trần trụi: người có 1.200 báo giá nhận về 1.000 và KHÔNG có dòng nào nói 200 cái kia đi đâu.
  const catDs = catVaBao(
    ids,
    TRAN_BAN_GHI.baoGia,
    "quotes",
    `Chỉ ${TRAN_BAN_GHI.baoGia.toLocaleString("vi-VN")} báo giá CŨ NHẤT (theo id tăng dần) có trong bản xuất này. Lấy phần còn lại qua GET /api/quotes?page=…`,
  );
  const ids2 = catDs.rows;
  if (!ids2.length) return { danhSach: [] as any[], gioiHan: null, biCat: catDs.biCat };

  // ── ĐẾM TRƯỚC, RỒI MỚI QUYẾT ĐỊNH NẠP GÌ ─────────────────────────────────
  // Bản đầu của hàm này chỉ xét ngân sách GIỮA CÁC LÔ, và bài kiểm bắt được ngay: 6 báo giá nằm
  // trọn trong lô đầu tiên nên không lô nào bị cắt, trần thành vô nghĩa. Tệ hơn, với lô 25 báo giá
  // × 60.000 dòng thì một lô có thể vượt trần 1,5 TRIỆU dòng trước khi ai đó kịp kiểm — đúng cái
  // trần này sinh ra để chặn.
  //
  // Một câu đếm rẻ (chỉ đụng chỉ mục `QuoteItem(sheetId, order)`) cho biết CHÍNH XÁC báo giá nào
  // vừa ngân sách, nên không có lượt nạp thừa nào, và không phải cắt-sau-khi-nạp.
  const dem = await prisma.$queryRaw<{ quoteId: number; soDong: bigint }[]>`
    SELECT s."quoteId" AS "quoteId", count(i.id) AS "soDong"
      FROM "QuoteSheet" s
      LEFT JOIN "QuoteItem" i ON i."sheetId" = s.id
     WHERE s."quoteId" = ANY(${ids2})
     GROUP BY s."quoteId"`;
  const soDongCua = new Map<number, number>();
  for (const r of dem) soDongCua.set(Number(r.quoteId), Number(r.soDong));

  const dayDu = new Set<number>();
  const thieuChiTiet: number[] = [];
  let tongDong = 0;
  for (const id of ids2) {
    const n = soDongCua.get(id) ?? 0;
    // `tongDong + n <= TRAN` chứ không phải `tongDong < TRAN`: vế sau cho một báo giá KHỔNG LỒ lọt
    // qua chỉ vì nó tình cờ là báo giá đầu tiên.
    if (tongDong + n <= TRAN_DONG) { dayDu.add(id); tongDong += n; }
    else thieuChiTiet.push(id);
  }

  const danhSach: any[] = [];
  for (let i = 0; i < ids2.length; i += MOI_LO) {
    const lo = ids2.slice(i, i + MOI_LO);
    const loDu = lo.filter((id) => dayDu.has(id));
    const loThieu = lo.filter((id) => !dayDu.has(id));

    if (loDu.length) {
      const qs = await prisma.quote.findMany({
        where: { id: { in: loDu } },
        orderBy: { id: "asc" },
        // `hnTables` (bảng Hà Nội cấp báo giá, từ 2026-09-15) cũng chứa `paidProof` → cắt cùng
        // cách: omit ở đây, rồi nạp lại bản đã cắt ảnh qua câu SQL dùng chung.
        omit: { customerLogo: true, hnTables: true },
        include: { sheets: { omit: { extraTables: true }, include: { items: { omit: { images: true } } } } },
      });
      const [bang, hn] = await Promise.all([bangNoiBoTheoSheet(loDu), bangHnTheoBaoGia(loDu)]);
      const theoSheet = new Map<number, any>();
      for (const r of bang) theoSheet.set(r.sheetId, r.tables);
      for (const q of qs) {
        danhSach.push({
          ...q,
          hnTables: hn.get(q.id) ?? [],
          sheets: (q.sheets || []).map((sh: any) => ({ ...sh, extraTables: theoSheet.get(sh.id) ?? [] })),
        });
      }
    }

    if (loThieu.length) {
      // Vẫn nạp METADATA đầy đủ (số, tiêu đề, ngày, tổng tiền…) — chỉ bỏ DÒNG chi tiết.
      const qs = await prisma.quote.findMany({
        where: { id: { in: loThieu } },
        orderBy: { id: "asc" },
        omit: { customerLogo: true, hnTables: true },
        include: { sheets: { omit: { extraTables: true } } },
      });
      for (const q of qs) {
        danhSach.push({
          ...q,
          hnTables: [],
          sheets: (q.sheets || []).map((sh: any) => ({ ...sh, items: [], extraTables: [] })),
        });
      }
    }
  }
  danhSach.sort((a, b) => a.id - b.id);

  const gioiHan = thieuChiTiet.length
    ? {
        lyDo: `Bản xuất đã chạm trần ${TRAN_DONG.toLocaleString("vi-VN")} dòng hạng mục (GDPR_EXPORT_MAX_ROWS).`,
        soDongDaXuat: tongDong,
        soBaoGiaThieuChiTiet: thieuChiTiet.length,
        baoGiaThieuChiTiet: thieuChiTiet,
        // Câu này TRƯỚC ĐÂY mở đầu bằng "Danh sách báo giá vẫn ĐẦY ĐỦ" — một lời trấn an SAI với
        // người có hơn 1.000 báo giá, vì chính danh sách đó cũng bị cắt. Nay nói đúng phạm vi của
        // nó, còn việc danh sách có bị cắt hay không thì `danhSachBiCat` khai riêng.
        huongDan: "Với các báo giá liệt kê ở trên, phần dòng hạng mục bị bỏ — lấy nốt từng báo giá tại GET /api/quotes/:id. Xem thêm `danhSachBiCat` (nếu có) để biết bản xuất còn thiếu gì nữa.",
      }
    : null;

  return { danhSach, gioiHan, biCat: catDs.biCat };
}

/**
 * Xoá tài khoản của CHÍNH user (right-to-erasure) — phần LOGIC THUẦN: transaction vô danh hoá + audit.
 * `req.session.destroy()` + `clearCookie` GIỮ ở route (controller HTTP) vì thao tác res/session của
 * CHÍNH request này. Còn việc xoá MỌI HÀNG phiên của người đó trong kho là một lệnh DELETE trên CSDL,
 * không phải thao tác HTTP — nó thuộc `xoaDanhTinh`, và phải ở đó để đường admin-xoá-hộ cũng có.
 */
export async function deleteSelf(req: Request) {
  const id = (req.session as any).userId;
  // XÁC THỰC LẠI + CHỐT QUẢN TRỊ VIÊN CUỐI (FILE-10). userService chặn khoá/hạ quyền admin cuối
  // ("ràng buộc DUY NHẤT") nhưng đường tự xoá này đi vòng qua: admin duy nhất tự xoá — hoặc một phiên
  // admin bị chiếm gọi hộ — là hệ thống không còn ai quản trị, phải sửa CSDL tay.
  const u = await prisma.user.findUnique({ where: { id }, select: { role: true, active: true, passwordHash: true } });
  if (!u) throw httpError(404, "Không tìm thấy tài khoản");
  if (!(await bcrypt.compare(String((req.body as any)?.password ?? ""), u.passwordHash || ""))) {
    throw loiXacNhanSai("Mật khẩu không đúng");
  }
  if (u.role === "admin" && u.active) {
    const adminKhac = await prisma.user.count({ where: { role: "admin", active: true, id: { not: id } } });
    if (adminKhac === 0) throw httpError(400, "Không thể xoá quản trị viên cuối cùng. Hãy chỉ định một quản trị viên khác trước.");
  }
  await xoaDanhTinh(id);
  await audit(req, "gdpr.delete.self", { resource: "user", resourceId: id, actorId: id });
}

/** Admin xoá tài khoản người dùng khác: chặn tự-xoá, 404 nếu không có, rồi transaction + audit. */
export async function deleteByAdmin(req: Request) {
  if ((req.params as any).id === req.session.userId) {
    throw httpError(400, "Không thể tự xóa chính mình ở đây. Vui lòng dùng chức năng \"Xóa tài khoản của tôi\".");
  }
  const target = await prisma.user.findUnique({ where: { id: (req.params as any).id }, select: { id: true } });
  if (!target) throw httpError(404, "Không tìm thấy người dùng");
  await xoaDanhTinh((req.params as any).id);
  await audit(req, "gdpr.delete.by_admin", { resource: "user", resourceId: (req.params as any).id });
  return { ok: true };
}
