// ============================================================================
// NẠP BÍ MẬT TỪ FILE — quy ước `<TÊN>_FILE`.
//
// `SESSION_SECRET_FILE=/run/secrets/session` → đọc file đó, dùng nội dung làm SESSION_SECRET.
//
// (Ví dụ cố ý dùng một khoá CÓ THẬT trong schema. Viết `process.env.<TÊN-BỊA>` trong chú thích sẽ
//  bị tests/b8-env-drift.test.js quét trúng và báo là "biến đọc thẳng mà chưa khai ở đâu".)
//
// ── VÌ SAO CẦN ─────────────────────────────────────────────────────────────
// src/config.ts đọc DUY NHẤT `process.env`. Nghĩa là mọi bí mật (SESSION_SECRET, JWT_SECRET,
// PII_ENC_KEY, MFA_ENC_KEY, S3_SECRET_KEY, SMTP_PASS, chuỗi kết nối CSDL…) phải nằm trong BIẾN
// MÔI TRƯỜNG. Biến môi trường là nơi tệ nhất để cất bí mật:
//   · `docker inspect <container>` in ra nguyên vẹn cho bất kỳ ai chạm được docker socket;
//   · `/proc/<pid>/environ` đọc được bởi mọi tiến trình cùng UID;
//   · chúng được KẾ THỪA sang mọi tiến trình con — kể cả `npx prisma`, kể cả một postinstall;
//   · chúng hay lọt vào log lỗi và báo cáo sự cố của thư viện bên thứ ba.
//
// Quy ước `_FILE` là cách chuẩn để tránh chuyện đó, và là quy ước mà HẠ TẦNG đã sẵn sàng phục vụ:
//   · Docker/Swarm secrets  → gắn sẵn ở /run/secrets/<tên>
//   · Kubernetes Secret     → gắn thành volume (một file cho mỗi khoá)
//   · Vault Agent / CSI     → ghi ra file rồi làm mới tại chỗ khi xoay khoá
// Ảnh chính thức của postgres/mysql/redis đều dùng đúng quy ước này, nên người vận hành đã quen.
//
// ── BỐN QUYẾT ĐỊNH, MỖI CÁI ĐỀU LÀ "ĐÓNG CHỨ KHÔNG MỞ" ─────────────────────
// 1. Đặt CẢ HAI (`FOO` và `FOO_FILE`) là LỖI, không phải "chọn một cái".
//    Im lặng chọn một bên nghĩa là hôm xoay khoá, người ta cập nhật file mà tiến trình vẫn chạy
//    giá trị cũ trong env — hoặc ngược lại. Không có cách nào nhìn ra từ bên ngoài. Thà chết ngay
//    lúc khởi động với một câu nói rõ.
// 2. File không đọc được là LỖI, không phải bỏ qua. Bí mật "tắt êm" là đúng cái bẫy mà repo này
//    đã gặp ở PII_ENC_KEY (thiếu khoá → ghi THÔ, chỉ một dòng console.warn).
// 3. File RỖNG là LỖI. Một secret rỗng gần như luôn là volume gắn hụt hoặc Vault chưa ghi xong.
// 4. KHÔNG BAO GIỜ in nội dung. Thông điệp lỗi chỉ nêu TÊN BIẾN và ĐƯỜNG DẪN.
//
// ── XUỐNG DÒNG CUỐI FILE ───────────────────────────────────────────────────
// `echo "bi-mat" > f` để lại một "\n" ở cuối. Cắt ĐÚNG MỘT dấu xuống dòng cuối (và "\r\n" của
// Windows), KHÔNG dùng `.trim()`: `.trim()` cắt cả khoảng trắng đầu/cuối, mà một khoá base64 hay
// mật khẩu HOÀN TOÀN có thể kết thúc bằng dấu cách — cắt nhầm là hỏng xác thực với một lỗi không
// ai lần ra được.
import { readFileSync } from "node:fs";

/** Cắt đúng một dấu xuống dòng ở cuối. Xem khối chú thích trên về lý do không dùng trim(). */
function boXuongDongCuoi(s: string): string {
  if (s.endsWith("\r\n")) return s.slice(0, -2);
  if (s.endsWith("\n")) return s.slice(0, -1);
  return s;
}

export type KetQuaNap = { ten: string; duongDan: string }[];

/**
 * Duyệt `env`, với mỗi `X_FILE` mà `X` NẰM TRONG `tenHopLe` thì đọc file và đặt `env.X`.
 *
 * ── VÌ SAO PHẢI CÓ `tenHopLe`, KHÔNG NHẬN MỌI `*_FILE` ────────────────────
 * Hậu tố `_FILE` KHÔNG thuộc về ứng dụng này. Cả một hệ sinh thái công cụ đã dùng nó với nghĩa
 * KHÁC HẲN — nó chỉ là "đường dẫn tới một file", không phải "hãy đọc file này thành biến kia".
 * Đo trên đúng máy đang chạy repo này, `env | grep _FILE=` ra NĂM biến như vậy:
 *     SSL_CERT_FILE · NIX_SSL_CERT_FILE · CLOUDSDK_CORE_CUSTOM_CA_CERTS_FILE
 *     CLAUDE_CODE_DIAGNOSTICS_FILE · CLAUDE_SESSION_INGRESS_TOKEN_FILE
 * `SSL_CERT_FILE` là biến CHUẨN của OpenSSL, có mặt trên mọi máy sau proxy doanh nghiệp, mọi hệ
 * Nix, mọi máy cài gcloud SDK. Bản đầu của hàm này nhận MỌI `*_FILE` nên nó cố nạp `SSL_CERT` từ
 * bó CA — và khi có bất kỳ va chạm nào thì ứng dụng TỪ CHỐI KHỞI ĐỘNG.
 * ĐO ĐƯỢC: `npm run verify` đỏ 25 bài với "process.exit unexpectedly called with 1".
 *
 * Nên phạm vi phải là DANH SÁCH KHOÁ CỦA CHÍNH ỨNG DỤNG (lấy từ schema zod trong src/config.ts).
 * `SSL_CERT` không có trong schema ⇒ `SSL_CERT_FILE` bị bỏ qua, đúng như nó phải thế.
 *
 * ── GÕ SAI TÊN THÌ SAO ────────────────────────────────────────────────────
 * `SESSION_SECRETT_FILE` (thừa chữ T) sẽ bị BỎ QUA ở đây — nhưng KHÔNG im lặng: `SESSION_SECRET`
 * vẫn thiếu, và zod ở src/config.ts từ chối khởi động kèm đúng tên biến. Lỗi vẫn to, chỉ đến từ
 * lớp khác.
 *
 * Trả về danh sách biến đã nạp (TÊN và ĐƯỜNG DẪN — không có giá trị) để nơi gọi ghi log.
 * Ném `Error` với thông điệp gộp nếu có bất kỳ vấn đề nào; không bao giờ ném kèm giá trị bí mật.
 *
 * @param tenHopLe BẮT BUỘC. Không để mặc định "mọi tên" — mặc định đó chính là lỗi vừa mô tả.
 */
export function napBiMatTuFile(env: NodeJS.ProcessEnv, tenHopLe: Iterable<string>): KetQuaNap {
  const daNap: KetQuaNap = [];
  const loi: string[] = [];
  const hopLe = tenHopLe instanceof Set ? tenHopLe : new Set(tenHopLe);

  // Sắp xếp để thứ tự xử lý (và thứ tự thông báo lỗi) tất định giữa các lần chạy.
  for (const khoa of Object.keys(env).sort()) {
    if (!khoa.endsWith("_FILE")) continue;
    const ten = khoa.slice(0, -"_FILE".length);
    if (!ten) continue;                       // biến tên đúng "_FILE" — không phải quy ước này
    if (!hopLe.has(ten)) continue;            // không phải khoá cấu hình của ứng dụng này — xem chú thích trên

    const duongDan = env[khoa];
    if (!duongDan || duongDan.trim() === "") {
      loi.push(`${khoa} được đặt nhưng RỖNG — bỏ hẳn biến đó, hoặc trỏ nó vào một file có thật.`);
      continue;
    }

    // Quyết định 1: đặt cả hai là lỗi. `!== undefined` chứ không phải truthy — `FOO=""` cũng là
    // "đã đặt", và chính ca đó (biến rỗng lẫn với file) là ca mơ hồ nhất.
    if (env[ten] !== undefined) {
      loi.push(
        `Đặt CẢ ${ten} lẫn ${khoa}. Không đoán được cái nào là bí mật đang hiệu lực — ` +
          `lúc xoay khoá sẽ có một bên cũ chạy tiếp mà không ai thấy. Bỏ một trong hai.`,
      );
      continue;
    }

    let noiDung: string;
    try {
      noiDung = readFileSync(duongDan, "utf8");
    } catch (e) {
      const ma = (e as NodeJS.ErrnoException).code;
      const vi =
        ma === "ENOENT" ? "không tồn tại"
        : ma === "EACCES" ? "không có quyền đọc"
        : ma === "EISDIR" ? "là một THƯ MỤC (Secret của k8s gắn cả thư mục? trỏ vào đúng file khoá)"
        : `không đọc được (${ma})`;
      loi.push(`${khoa} trỏ tới "${duongDan}" — ${vi}.`);
      continue;
    }

    const gt = boXuongDongCuoi(noiDung);
    if (gt === "") {
      loi.push(
        `${khoa} trỏ tới "${duongDan}" nhưng file RỖNG. Gần như luôn là volume gắn hụt ` +
          `hoặc bí mật chưa được ghi xong. Từ chối khởi động thay vì chạy với ${ten} rỗng.`,
      );
      continue;
    }

    env[ten] = gt;
    daNap.push({ ten, duongDan });
  }

  if (loi.length) {
    throw new Error(`Cấu hình bí mật theo file (quy ước *_FILE) sai:\n  - ${loi.join("\n  - ")}`);
  }
  return daNap;
}
