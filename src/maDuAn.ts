// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ CẤP MÃ DỰ ÁN LÚC KHÁCH CHỐT — không còn cấp lúc tạo báo giá.                 │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// Chủ repo 2026-11-25: "tạo mới chưa duyệt thì không có mã nào, duyệt khách chốt thì mới tạo mã dự án nhé, để khỏi rác
// mã dự án". Trước đó `createQuote`/`duplicateQuote` gọi `nextProjectCode` NGAY LÚC TẠO: mọi báo giá nháp — kể cả bản
// khách không bao giờ chốt — tiêu một số trong dãy FP_A26_001, 002… của người tạo, nên dãy mã của những dự án THẬT
// (đã chốt) đầy lỗ.
//
// ── HỢP ĐỒNG ─────────────────────────────────────────────────────────────────────────────────────────
//   · Gọi TRONG transaction chốt (quoteService.markConverted), SAU khi đã đổi trạng thái + áp phép chia hóa đơn. Chốt
//     hỏng ở bất kỳ bước nào → rollback cuốn theo lần tăng bộ đếm: KHÔNG tiêu số (cùng tính chất "không đốt số" của
//     nextProjectCode). Đặt CUỐI để khoá hàng bộ đếm (prefix, năm) giữ ngắn nhất — y lý do ở createQuote.
//   · Báo giá ĐÃ có mã (dữ liệu trước 2026-11-25 chưa dọn, hoặc chạy lại) → giữ nguyên, không cấp lại.
//   · PHIÊN BẢN ("Bản mới" — duplicateQuote sameProject) KHÔNG tiêu số mới: lấy lại mã của dự án + số phiên bản kế
//     tiếp. "Cùng dự án" đọc qua `Quote.projectRootId` (bản nháp không có mã nên không suy được qua projectCode nữa).
//   · Mã mới theo tiền tố của NGƯỜI TẠO báo giá (`createdById`), KHÔNG phải người bấm chốt; năm = năm lúc CHỐT (giờ VN,
//     nextProjectCode). Người tạo không có tiền tố → để null như trước: báo giá đã chốt không mã hiển thị số báo giá.
//   · Mã cấp ra mà ĐÃ có báo giá mang (dữ liệu cũ, bộ đếm bị kéo lùi) → bỏ qua, lấy số kế — không bao giờ ra P2002 vì
//     dữ liệu cũ. Số bị bỏ qua đã có người dùng, nên không phải "lỗ".
import { nextProjectCode } from "./quoteNumber.js";
import { normalizeSearch } from "./searchText.js";
import type { TxClient } from "./db.js";

/** Trần bước đi ngược chuỗi projectRootId — chống vòng do dữ liệu sửa tay (A→B→A). */
const TRAN_BUOC_GOC = 20;
/** Trần số mã đã-có-người-dùng bỏ qua liền nhau. Quá trần = bộ đếm lệch nặng — dừng, để người vận hành xem. */
const TRAN_BO_QUA = 200;

/**
 * GỐC của dự án mà báo giá `id` thuộc về: đi ngược `projectRootId` tới bản không có gốc (null = chính nó là gốc).
 * Đi NGƯỢC CẢ CHUỖI chứ không tin một bước: bản nháp tạo TRƯỚC khi công cụ dọn mã (src/maDuAnDonDep.ts) điền liên kết
 * có thể trỏ vào một phiên bản (chứ không phải gốc) mà công cụ sau đó nối tiếp lên gốc thật.
 * Gốc đã bị xoá cứng → dừng ở số đó: các phiên bản còn lại vẫn nhóm được theo cùng số.
 */
export async function timGocDuAn(tx: TxClient, id: number, rootId: number | null | undefined): Promise<number> {
  let goc = id;
  let ke = rootId ?? null;
  const daQua = new Set<number>([id]);
  while (ke != null && !daQua.has(ke) && daQua.size <= TRAN_BUOC_GOC) {
    daQua.add(ke);
    goc = ke;
    const [r] = await tx.$queryRaw<{ projectRootId: number | null }[]>`SELECT "projectRootId" FROM "Quote" WHERE id = ${ke}`;
    if (!r) break;
    ke = r.projectRootId;
  }
  return goc;
}

export type MaCap = { projectCode: string; projectVersion: number; cach: "moi" | "phien-ban" | "so-bao-gia-goc" };

/**
 * Cấp mã dự án cho báo giá `quoteId` VỪA được đánh dấu chốt (cùng transaction). Trả `null` khi KHÔNG đổi gì: báo
 * giá đã có mã, hoặc người tạo không có tiền tố.
 */
export async function capMaDuAnKhiChot(tx: TxClient, quoteId: number): Promise<MaCap | null> {
  const [q] = await tx.$queryRaw<{
    id: number; quoteNumber: string; projectCode: string | null; projectRootId: number | null; createdById: number;
    title: string; toCompany: string; toContact: string | null;
  }[]>`SELECT id, "quoteNumber", "projectCode", "projectRootId", "createdById", title, "toCompany", "toContact" FROM "Quote" WHERE id = ${quoteId}`;
  if (!q || q.projectCode) return null;

  const goc = await timGocDuAn(tx, q.id, q.projectRootId);
  // HAI PHIÊN BẢN CÙNG DỰ ÁN CHỐT SONG SONG: cả hai cùng thấy "dự án chưa có mã" rồi mỗi bên cấp một mã mới → một dự
  // án hai mã; hoặc cùng tính "phiên bản lớn nhất + 1" → đụng @@unique([projectCode, projectVersion]). Khoá theo GỐC
  // dự án tuần tự hoá đúng cặp đó và không chặn ai khác. Cùng kiểu khoá venueService.ts đang dùng.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`du-an-goc:${goc}`})) IS NULL AS "khoa"`;

  // 1) Dự án ĐÃ có mã (một phiên bản khác đã chốt, hoặc dữ liệu cũ) → lấy lại đúng mã đó. Ưu tiên bản ĐÃ CHỐT (mã của
  //    nó đã ra chứng từ), rồi tới gốc, rồi phiên bản nhỏ. Bản đã xoá mềm không làm nguồn mã.
  const anhEm = await tx.$queryRaw<{ id: number; projectCode: string | null; quoteNumber: string; status: string }[]>`
    SELECT id, "projectCode", "quoteNumber", status::text AS status FROM "Quote"
    WHERE (id = ${goc} OR "projectRootId" = ${goc}) AND id <> ${q.id} AND "deletedAt" IS NULL
    ORDER BY (status = 'converted') DESC, (id = ${goc}) DESC, "projectVersion", id`;
  let ma = anhEm.find((x) => x.projectCode)?.projectCode ?? null;
  let cach: MaCap["cach"] = "phien-ban";
  let tuSoBaoGia = false;
  // 2) Dự án đã chốt mà KHÔNG có mã — người tạo không có tiền tố, mã hiển thị của nó CHÍNH LÀ số báo giá. "Bản mới"
  //    trước 2026-11-25 lấy đúng số đó làm mã chung cho các phiên bản (`src.projectCode || src.quoteNumber`) — giữ nguyên.
  if (!ma) {
    const daChotKhongMa = anhEm.find((x) => x.status === "converted" && !x.projectCode);
    if (daChotKhongMa) { ma = daChotKhongMa.quoteNumber; cach = "so-bao-gia-goc"; tuSoBaoGia = true; }
  }

  let phienBan = 1;
  if (ma) {
    // Khoá thêm theo MÃ: hai nhóm dữ liệu cũ (chưa có liên kết gốc) có thể dùng chung một mã.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`ma-du-an:${ma}`})) IS NULL AS "khoa"`;
    // Gồm cả bản xoá mềm — số phiên bản không tái dùng (cùng luật duplicateQuote trước đây).
    const [m] = await tx.$queryRaw<{ max: number | null }[]>`SELECT MAX("projectVersion")::int AS max FROM "Quote" WHERE "projectCode" = ${ma}`;
    // Mã lấy từ số báo giá của gốc: gốc (projectCode null) chính là v1 → bản này ít nhất v2.
    phienBan = Math.max(m?.max ?? 0, tuSoBaoGia ? 1 : 0) + 1;
  } else {
    // 3) Dự án mới: tiền tố của NGƯỜI TẠO báo giá.
    const [u] = await tx.$queryRaw<{ projectCode: string | null }[]>`SELECT "projectCode" FROM "User" WHERE id = ${q.createdById}`;
    const tienTo = (u?.projectCode ?? "").trim();
    if (!tienTo) return null;
    cach = "moi";
    for (let i = 0; ; i++) {
      if (i >= TRAN_BO_QUA) throw new Error(`Bộ đếm mã dự án "${tienTo}" lệch quá ${TRAN_BO_QUA} mã đã dùng — cần người vận hành xem lại`);
      const thu = await nextProjectCode(tienTo, tx as any);
      const [daCo] = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "Quote" WHERE "projectCode" = ${thu} LIMIT 1`;
      if (!daCo) { ma = thu; break; }
    }
  }

  const searchText = normalizeSearch(q.quoteNumber, ma, q.title, q.toCompany, q.toContact);
  // Câu RAW: lệnh đổi trạng thái ngay trước đó đã chạm `updatedAt` và đã bắn sự kiện realtime; ghi thêm qua client
  // Prisma là thêm một sự kiện SSE thừa cho cùng một lần chốt.
  await tx.$executeRaw`UPDATE "Quote" SET "projectCode" = ${ma}, "projectVersion" = ${phienBan}, "searchText" = ${searchText} WHERE id = ${q.id}`;
  return { projectCode: ma!, projectVersion: phienBan, cach };
}
