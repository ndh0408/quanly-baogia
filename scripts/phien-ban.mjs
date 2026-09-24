#!/usr/bin/env node
// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ SỐ PHIÊN BẢN cho người dùng: 1.2.3 (chủ repo 2026-09-25).                     │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// Chân menu từng hiện "Phiên bản 9dd30dc" — mã commit, người dùng không hiểu. Nay là số ba phần:
//
//   · SỐ CUỐI  1.2.3 → 1.2.4  lần phát hành chỉ SỬA LỖI / chỉnh nhỏ   (commit fix:, docs:, chore:…)
//   · SỐ GIỮA  1.2.x → 1.3.0  lần phát hành có TÍNH NĂNG MỚI          (có ít nhất một commit feat:)
//   · SỐ ĐẦU   1.x.x → 2.0.0  thay đổi LỚN làm đổi cách mọi người làm việc — CHỦ REPO QUYẾT, không tự
//                             tăng: `PHIEN_BAN_LON=1 bash deploy.sh prod`
//
// Số chỉ tăng MỖI LẦN PHÁT HÀNH LÊN PRODUCTION (không phải mỗi commit — một ngày có vài chục commit).
// Mốc là tag git `vX.Y.Z`: deploy.sh prod gắn tag cho commit sắp ship (số tính từ các commit kể từ tag
// trước), deploy xong thì đẩy tag lên GitHub, deploy hỏng thì gỡ tag. Dev (staging) hiện số SẼ phát hành
// kèm chữ "bản thử". Tag trước là bản thử (vd `v1.1.0-rc.1`) thì lần phát hành kế là chính số đó (1.1.0).
//
//   node scripts/phien-ban.mjs [ref]            → JSON: tag trước, số kế tiếp, đếm tính năng / sửa
//   node scripts/phien-ban.mjs --so [ref]       → chỉ in số (ref đã có tag phát hành → số của tag đó)
//   node scripts/phien-ban.mjs --da-gan [ref]   → "1" nếu ref đã có tag phát hành, "0" nếu chưa
//   node scripts/phien-ban.mjs --ghi-chu [ref]  → ghi chú phát hành (tính năng / sửa lỗi) cho tag
//
// CHỈ ĐỌC git — KHÔNG tự gắn tag. deploy.sh gắn tag bằng `git` của shell: bộ test deploy thay `git` bằng
// bản giả trên PATH, mà trên Windows Node `execFileSync("git")` bỏ qua bản giả (không phải .exe) và gọi
// git THẬT — để script tự gắn là chạy test deploy gắn tag thật vào repo.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MAU_SO = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** "v1.1.0-rc.1" → { chinh:1, phu:1, va:0, truoc:"rc.1" }; không phải số phiên bản → null. */
export function phanTichSo(tag) {
  const m = MAU_SO.exec(String(tag || "").trim());
  return m ? { chinh: +m[1], phu: +m[2], va: +m[3], truoc: m[4] ?? null } : null;
}

/** Tiêu đề commit (Conventional Commits) là tính năng mới? `feat:` / `feat(web):` / `feat!:`. */
export const laTinhNang = (tieuDe) => /^feat(\([^)]*\))?!?:/i.test(String(tieuDe || "").trim());

/**
 * Số phát hành kế tiếp từ tag trước + tiêu đề các commit kể từ tag đó.
 *   · lon=true            → (đầu+1).0.0   (chủ repo quyết)
 *   · tag trước là bản thử → chính số đó bỏ đuôi (1.1.0-rc.1 → 1.1.0)
 *   · không commit nào     → giữ nguyên (deploy lại cùng bản)
 *   · có tính năng         → giữa+1, cuối 0
 *   · còn lại (sửa, chỉnh) → cuối+1
 * Chưa có tag nào → coi như sau 1.0.0.
 */
export function soKeTiep(tagTruoc, tieuDeCommit, { lon = false } = {}) {
  const t = phanTichSo(tagTruoc) ?? { chinh: 1, phu: 0, va: 0, truoc: null };
  if (lon) return `${t.chinh + 1}.0.0`;
  if (t.truoc) return `${t.chinh}.${t.phu}.${t.va}`;
  if (!tieuDeCommit.length) return `${t.chinh}.${t.phu}.${t.va}`;
  if (tieuDeCommit.some(laTinhNang)) return `${t.chinh}.${t.phu + 1}.0`;
  return `${t.chinh}.${t.phu}.${t.va + 1}`;
}

/** Ghi chú kèm tag: ngày + danh sách tính năng / sửa lỗi (tối đa 40 dòng mỗi nhóm). */
export function ghiChuPhatHanh(so, tieuDeCommit, ngay = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const bo = (s) => s.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "");
  const tn = tieuDeCommit.filter(laTinhNang).map(bo);
  const sua = tieuDeCommit.filter((t) => !laTinhNang(t) && !/^merge\b/i.test(t)).map(bo);
  const nhom = (ten, ds) => ds.length ? [`${ten}:`, ...ds.slice(0, 40).map((d) => `- ${d}`), ...(ds.length > 40 ? [`- … và ${ds.length - 40} mục khác`] : []), ""] : [];
  return [`Phiên bản ${so} (${p(ngay.getDate())}/${p(ngay.getMonth() + 1)}/${ngay.getFullYear()})`, "", ...nhom("Tính năng mới", tn), ...nhom("Sửa lỗi / chỉnh sửa", sua)].join("\n").trim() + "\n";
}

// ── phần gọi git (không có git / git giả trả rỗng → trả rỗng, KHÔNG ném: deploy không được chết vì số) ──
const git = (...a) => { try { return execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };

/** Tag phát hành (không phải bản thử) đang gắn ĐÚNG ref, nếu có. */
function tagPhatHanhTaiRef(ref) {
  return git("tag", "--points-at", ref, "--list", "v[0-9]*").split(/\r?\n/).find((t) => { const s = phanTichSo(t); return s && !s.truoc; }) || "";
}

export function tinhTuGit(ref = "HEAD", { lon = false } = {}) {
  const daGan = tagPhatHanhTaiRef(ref);
  if (daGan && !lon) return { tagTruoc: daGan, so: daGan.replace(/^v/, ""), tinhNang: 0, sua: 0, daGan: true, tieuDe: [] };
  // Tag gần nhất TRƯỚC ref (bỏ chính tag ở ref nếu đang tính số đầu mới).
  const tagTruoc = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", daGan ? `${ref}^` : ref);
  const tieuDe = git("log", "--format=%s", tagTruoc ? `${tagTruoc}..${ref}` : ref).split(/\r?\n/).filter(Boolean);
  return { tagTruoc: tagTruoc || null, so: soKeTiep(tagTruoc, tieuDe, { lon }), tinhNang: tieuDe.filter(laTinhNang).length, sua: tieuDe.filter((t) => !laTinhNang(t)).length, daGan: false, tieuDe };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const co = process.argv.slice(2);
  const ref = co.find((a) => !a.startsWith("--")) || "HEAD";
  const lon = process.env.PHIEN_BAN_LON === "1";
  const kq = tinhTuGit(ref, { lon });
  if (co.includes("--da-gan")) {
    process.stdout.write((kq.daGan ? "1" : "0") + "\n");
  } else if (co.includes("--ghi-chu")) {
    process.stdout.write(ghiChuPhatHanh(kq.so, kq.tieuDe));
  } else if (co.includes("--so")) {
    process.stdout.write(kq.so + "\n");
  } else {
    process.stdout.write(JSON.stringify({ tagTruoc: kq.tagTruoc, soKeTiep: kq.so, daGan: kq.daGan, tinhNang: kq.tinhNang, sua: kq.sua }, null, 2) + "\n");
  }
}
