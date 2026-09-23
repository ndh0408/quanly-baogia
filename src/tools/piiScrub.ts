// XOÁ CỘT PII THÔ ĐÃ CÓ BẢN MÃ KHỚP — chạy được TỪ TRONG image production (FILE-04).
//
// ── VÌ SAO FILE NÀY TỒN TẠI ─────────────────────────────────────────────────
// Cutover PII (`PII_PLAINTEXT_CUTOVER`, src/piiFields.ts) chỉ đổi đường GHI: hồ sơ ghi SAU cutover
// có cột thô null, nhưng hàng tạo TRƯỚC đó — và mọi hàng mà `pii-backfill` đã điền bản mã — vẫn giữ
// nguyên `idCard`/`bankAccount`/`salary` thô ngay cạnh bản mã. Mối đe doạ mà mã hoá nêu tên là
// "bản dump CSDL bị lộ"; chừng nào cột thô còn giá trị thì dump vẫn lộ CCCD/STK/lương, và trước file
// này không công cụ nào xoá được chúng (grep cả repo: không script/migration nào SET cột thô = NULL).
//
//   node dist/tools/piiScrub.js              # xoá thật
//   node dist/tools/piiScrub.js --dry-run    # chỉ đếm, không ghi
//
// ── AN TOÀN ─────────────────────────────────────────────────────────────────
// · CHỈ null cột thô khi bản mã của CHÍNH hàng đó giải ra ĐÚNG giá trị thô. Bản mã thiếu, hỏng hay
//   lệch → GIỮ NGUYÊN cột thô, đếm, và thoát 1. Không bao giờ xoá thứ chưa có bản sao đọc được.
// · Ghi bằng compare-and-set (`updateMany` kèm giá trị thô + bản mã vừa đọc): ứng dụng sửa hàng
//   giữa lúc đọc và ghi thì lượt ghi không khớp và hàng được bỏ qua, không xoá nhầm giá trị mới.
// · `includeDeleted: true` — hồ sơ xoá mềm vẫn nằm trong dump như hàng sống.
// · Xong thì DỮ LIỆU CHỈ CÒN TRONG BẢN MÃ: mất PII_ENC_KEY là mất vĩnh viễn. Chỉ chạy khi khoá đã
//   được lưu ngoài máy chủ (xem chú thích `piiCutoverBat` ở src/piiFields.ts).
//
// Thoát 0 = không còn cột thô nào có bản mã khớp mà chưa xoá. Thoát 1 = còn hàng không xoá được.
// KHÔNG in ra giá trị PII nào — chỉ đếm.
import { pathToFileURL } from "node:url";
import { prisma } from "../db.js";
import { PII_FIELDS, piiCutoverBat } from "../piiFields.js";
import { moTheoKhoa, isPiiEncrypted, isPiiEncryptionEnabled } from "../piiBox.js";

const aadFor = (model: string, field: string) => `${model}:${field}`;
const modelClient = (m: string) => (prisma as any)[m.charAt(0).toLowerCase() + m.slice(1)];

export type KetQuaXoaTho = { model: string; truong: string; daXoa: number; khongBanMa: number; lech: number; daDoi: number };

/** `chiTrongIds` chỉ dành cho bài test: giới hạn vào đúng các hàng bài test tạo (CSDL test dùng chung). */
type PhamVi = { chiTrongIds?: Record<string, number[]> };
const locId = (model: string, pv: PhamVi) => (pv.chiTrongIds ? { id: { in: pv.chiTrongIds[model] ?? [] } } : {});

/** Đếm số ô PII THÔ còn trong CSDL (mọi model/trường, kể cả hàng xoá mềm). verifyIntegrity dùng. */
export async function demCotThoConLai(pv: PhamVi = {}): Promise<number> {
  let n = 0;
  for (const [model, fields] of Object.entries(PII_FIELDS)) {
    const client = modelClient(model);
    if (!client) continue;
    for (const f of fields) n += await client.count({ where: { ...locId(model, pv), [f.plain]: { not: null } }, includeDeleted: true } as never);
  }
  return n;
}

/** Xoá cột thô ở mọi hàng có bản mã giải ra đúng giá trị đó. Trả bảng đếm theo (model, trường). */
export async function xoaCotThoDaMaHoa({ chayThu = false, ...pv }: { chayThu?: boolean } & PhamVi = {}): Promise<KetQuaXoaTho[]> {
  if (!isPiiEncryptionEnabled()) throw new Error("Chưa đặt PII_ENC_KEY — không có bản mã nào để đối chiếu, KHÔNG xoá gì.");
  const ra: KetQuaXoaTho[] = [];
  for (const [model, fields] of Object.entries(PII_FIELDS)) {
    const client = modelClient(model);
    if (!client) continue;
    for (const f of fields) {
      const kq: KetQuaXoaTho = { model, truong: f.plain, daXoa: 0, khongBanMa: 0, lech: 0, daDoi: 0 };
      const rows = await client.findMany({
        where: { ...locId(model, pv), [f.plain]: { not: null } },
        select: { id: true, [f.plain]: true, [f.enc]: true },
        orderBy: { id: "asc" },
        includeDeleted: true,
      } as never);
      for (const r of rows as any[]) {
        const tho = String(r[f.plain]);
        const enc = r[f.enc];
        if (!isPiiEncrypted(enc)) { kq.khongBanMa++; continue; }
        const { giaTri } = moTheoKhoa(String(enc), aadFor(model, f.plain));
        // So trong bộ nhớ, không in. Lệch hay không giải được → cột thô là bản đọc được DUY NHẤT.
        if (giaTri == null || giaTri !== tho) { kq.lech++; continue; }
        if (chayThu) { kq.daXoa++; continue; }
        const w = await client.updateMany({
          where: { id: r.id, [f.plain]: r[f.plain], [f.enc]: enc },
          data: { [f.plain]: null },
          includeDeleted: true,
        } as never);
        if (w.count === 1) kq.daXoa++; else kq.daDoi++;
      }
      ra.push(kq);
    }
  }
  return ra;
}

const laLenhChinh = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (laLenhChinh) {
  const chayThu = process.argv.includes("--dry-run");
  let thoat = 0;
  try {
    if (!piiCutoverBat()) {
      console.warn("⚠ PII_PLAINTEXT_CUTOVER chưa bật: ứng dụng vẫn GHI cột thô cho mọi lượt sửa sau đây — bật cờ đó trước, nếu không cột thô sẽ đầy lại.");
    }
    const kq = await xoaCotThoDaMaHoa({ chayThu });
    for (const k of kq) {
      console.log(`${k.model}.${k.truong}: ${chayThu ? "sẽ xoá" : "đã xoá"} ${k.daXoa} · KHÔNG có bản mã ${k.khongBanMa} · bản mã lệch/không giải được ${k.lech} · bị sửa giữa chừng ${k.daDoi}`);
      if (k.khongBanMa || k.lech) thoat = 1;
    }
    if (thoat) console.error("✖ Còn cột thô KHÔNG có bản mã khớp — chạy scripts/migration/pii-backfill.mjs rồi chạy lại. Đã GIỮ NGUYÊN các hàng đó.");
  } catch (e) {
    console.error("✖", e instanceof Error ? e.message : String(e));
    thoat = 1;
  }
  await prisma.$disconnect().catch(() => {});
  process.exit(thoat);
}
