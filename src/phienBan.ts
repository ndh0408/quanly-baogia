// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ src/phienBan.ts — "máy chủ đang phát BẢN GIAO DIỆN nào" (GET /api/phien-ban). │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// Web dùng để biết có bản mới sau mỗi lần deploy (chủ repo 2026-09-24: người dùng không biết
// Ctrl+Shift+R). Service worker (vite-plugin-pwa autoUpdate) cất sẵn bản giao diện trong máy, nên tab
// để mở từ trước lúc deploy vẫn chạy bản CŨ tới khi tự tải lại — kể cả khi bản mới sửa lỗi tính tiền.
//
// HAI THỨ, HAI NGUỒN:
// · `banGiaoDien` — tên tệp JS chính trong public/app2/index.html ("index-BVwnOoE_"). Vite băm nội dung
//   vào tên, nên đổi tên = đổi bản; và đây ĐÚNG là thứ trình duyệt sẽ tải khi tải lại trang. Web so tên
//   này với tệp mình đang chạy — không cần mã commit, không đụng đường build của deploy.sh.
// · `sha` / `capNhatLuc` — chỉ để HIỆN cho người đọc ("Phiên bản 9dd30dc · 24/09 14:00"). Lấy từ
//   public/.phien-ban, tệp mang thuộc tính `export-subst` (.gitattributes): `git archive` — chính
//   thứ deploy.sh dùng để ship mã — tự điền mã commit + giờ commit vào đó. Chạy từ cây làm việc (dev
//   cục bộ, verify) thì tệp còn nguyên `$Format:…$` → hai trường này null, web hiện "bản đang phát triển".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type PhienBan = {
  banGiaoDien: string | null;
  sha: string | null;
  capNhatLuc: string | null;
};

const GOC_MAC_DINH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Đọc thẳng từ đĩa (không cache) — cho test truyền thư mục gốc giả. */
export function docPhienBan(goc: string = GOC_MAC_DINH): PhienBan {
  let banGiaoDien: string | null = null;
  try {
    const html = fs.readFileSync(path.join(goc, "public", "app2", "index.html"), "utf8");
    banGiaoDien = /\/assets\/(index-[A-Za-z0-9_-]+)\.js/.exec(html)?.[1] ?? null;
  } catch { /* chưa build web (dev cục bộ chạy vite riêng) → không có gì để so */ }

  let sha: string | null = null;
  let capNhatLuc: string | null = null;
  try {
    // TỆP CHẤM (.phien-ban): express.static mặc định bỏ qua dotfile → không bị phục vụ công khai ở
    // /phien-ban.txt kèm mã commit ĐẦY ĐỦ và cache `immutable` 1 năm (soát 2026-09-24). Web chỉ cần
    // mã rút gọn qua /api/phien-ban.
    const t = fs.readFileSync(path.join(goc, "public", ".phien-ban"), "utf8").trim();
    const m = /^([0-9a-f]{7,40})\s+(\S+)/.exec(t);
    if (m && !Number.isNaN(Date.parse(m[2]))) { sha = m[1].slice(0, 7); capNhatLuc = m[2]; }
  } catch { /* thiếu tệp → không có số để hiện */ }

  return { banGiaoDien, sha, capNhatLuc };
}

// Mỗi tab hỏi 5 phút một lần; đọc đĩa mỗi lượt là thừa, nhưng cũng không giữ mãi — dev cục bộ build lại
// web mà không khởi động lại máy chủ thì vẫn thấy bản mới sau tối đa 30 giây.
let daDoc: { luc: number; gt: PhienBan } | null = null;
export function phienBanHienTai(): PhienBan {
  const bayGio = Date.now();
  if (!daDoc || bayGio - daDoc.luc > 30_000) daDoc = { luc: bayGio, gt: docPhienBan() };
  return daDoc.gt;
}
