# BÀN GIAO PHIÊN LÀM VIỆC — cập nhật 2026-07-28

> Mở session mới thì đọc file này TRƯỚC (kèm `CLAUDE.md` nếu có) rồi làm tiếp.
> Câu lệnh gợi ý để dán vào session mới:
> **"Đọc HANDOFF.md rồi làm tiếp phần 'VIỆC ĐANG DANG DỞ / TIẾP THEO'."**

## 1. Hiện trạng hệ thống

| Môi trường | URL | Commit đang chạy |
|---|---|---|
| Production | https://gianguyen.cloud | `5ec5f5d` |
| Dev/Staging | https://dev.gianguyen.cloud (`quanly-staging.tail24aeab.ts.net`) | `5ec5f5d` |
| GitHub | github.com/ndh0408/quanly-baogia | `giai-doan-0` + `master` = `5ec5f5d` |

- Nhánh local hiện tại: **`feat/venue-suggest`** (⚠️ push phải dùng `git push origin HEAD:giai-doan-0` và `HEAD:master`, KHÔNG dùng `git push origin giai-doan-0` — sẽ đẩy ref cũ).
- Deploy: `bash deploy.sh staging` / `bash deploy.sh prod` (git archive → scp → docker build → migrate; tự backup DB trước).
- Production chạy **React ở gốc `/`**; `/app` là SPA cũ chỉ để dự phòng khẩn cấp.

## 2. Vừa hoàn thành (đợt này)

### 2.1 Bỏ cột "Chi Tiết" khỏi báo giá (web + Excel)
- `src/templateConfigs.ts`: thêm `items.hideDetail: true` + `hiddenColumns: ["D"]` + `columnWidths: { C: 46 }` cho `marico_decor` (GN không ngày), `clofull_decor` (CLF); `gn_banner` kế thừa.
- `src/excel.ts`: áp `hiddenColumns` (ẩn hẳn cột, không hiện/không in) + `columnWidths`; không ghi chữ detail khi `hideDetail`.
- `src/services/metaService.ts`: `hasDetail` (có hiện cột) tách khỏi **`reserveDetail`** (giữ chỗ trong sơ đồ địa chỉ ô A1).
- ⚠️ **QUAN TRỌNG — KHÔNG được xóa `detail` khỏi `columns`**: địa chỉ ô A1 của editor (A=STT, B=Hạng Mục, C=Chi Tiết, D=ĐVT…) suy từ danh sách cột; bỏ hẳn sẽ dịch trái mọi cột phía sau → **công thức đã lưu của báo giá cũ (`=F3*E3`, `=SUM(H3:H8)`) trỏ sai ô**. Web/SPA nhận `layout.reserveDetail` để giữ chỗ.

### 2.2 Lưới báo giá thao tác kiểu Excel (`web/src/components/GridTable.tsx`)
- **Bấm 1 lần = CHỌN + KHÓA ô** (`readOnly` + class `.cell-lock`) → bấm nhầm/đè bàn phím không sửa được gì; gõ phím hiện toast nhắc.
- **Nhấp đúp / F2 = mở ô để sửa**; Enter/Tab lúc đang sửa → ô kế **mở sẵn** (nhập dây chuyền).
- Esc lần 1 = hủy sửa (khóa lại, vẫn chọn ô) · Esc lần 2 = thoát ô.
- Phím tắt (nhận cả `Ctrl` lẫn `⌘`): Ctrl+mũi tên nhảy biên (+Shift kéo vùng) · Home/End (+Ctrl đầu/cuối bảng) · PgUp/PgDn · Ctrl+A (chọn cả bảng; khi ĐANG SỬA thì bôi đen chữ trong ô) · Shift+Space hàng · Ctrl+Space cột · Delete/Backspace xóa vùng · Ctrl+D chép xuống · Ctrl+R chép phải · Ctrl+Shift++ chèn hàng · Ctrl+- xóa hàng · Alt+Enter xuống dòng trong ô · Ctrl+Z/Y.
- Copy: đang chọn ô → copy **giá trị thô** cả ô/vùng (dán sang Excel đúng số); đang sửa → copy đoạn chữ bôi đen. Dán vào ô khóa = ghi đè cả ô.
- Point-mode (bấm ô khác để chèn tham chiếu) CHỈ bật khi **đang thực sự sửa công thức**.
- Bấm ra ngoài bảng → bỏ tô vùng chọn.
- Bảng **"⌨️ Phím tắt kiểu Excel"** thu gọn dưới lưới (nhãn ⌘/Ctrl tự đổi theo máy).

### 2.3 Kiểm thử
- Unit/integration: `npx vitest run` — 127/127 ở nhóm excel/snapshot/formula/clipboard/stitcher (snapshot golden đã cập nhật theo output mới).
- E2E thật trên staging (file `e2e-*.mjs` ở gốc repo, **gitignored**):
  - `node e2e-gridxl.mjs` → **30/30** (cột Chi Tiết + toàn bộ thao tác Excel).
  - `e2e-editor.mjs`, `e2e-editor2..5.mjs`, `e2e-banner.mjs`, `e2e-venue-suggest.mjs`, `e2e-accounthn.mjs` → tất cả PASS (đã sửa các test cũ sang `dblclick()` cho khớp luật khóa ô).
  - Tài khoản test: `admin` / `GiaNguyenDemo2026`.

## 3. VIỆC ĐANG DANG DỞ / TIẾP THEO

1. **Chưa dùng được BMAD trong phiên cũ**: BMAD mới cài (`.claude/skills/bmad-*`, `_bmad/`) nên registry của phiên cũ chưa có. Session mới sẽ gọi được `Skill(bmad-code-review)`, `bmad-dev-story`… → **nên chạy `bmad-code-review` cho 6 commit `03d4e52..5ec5f5d`** (rà soát đối kháng phần lưới + Excel).
2. **Cân nhắc theo dõi phản hồi người dùng** về luật "khóa ô": nếu thấy nhập liệu chậm, có thể bật lại "gõ 1 ký tự = sửa luôn" (Excel chuẩn) — chỗ sửa: `onGridKeyDown`, nhánh cuối `e.key.length === 1` trong `GridTable.tsx`.
3. **Dữ liệu `detail` cũ vẫn nằm trong DB** (không hiện, không xuất). Nếu muốn gộp nội dung đó vào cột Hạng Mục cho báo giá cũ → cần 1 migration riêng (chưa làm, vì đổi nội dung báo giá lịch sử).
4. **Rác cần dọn khi tiện**: `tmp-tpl-dump.mjs`, `gridxl.png` ở gốc repo (chưa gitignore).
5. `.claude/`, `_bmad/`, `CLAUDE.md` đang **chưa commit** (untracked) — quyết định commit hay ignore.

## 4. Quy ước bắt buộc khi làm tiếp

- Giao diện: xem `C:\Users\Admin\.claude\projects\c--Users-Admin-Desktop-QuanLY\memory\ui-conventions.md` (dùng `lib/format.tsx`, class chung, cấm màu hard-code, dark-mode).
- **Chỉ làm React** (`web/src`); `public/js` (SPA cũ) chỉ sửa khi bắt buộc để bản dự phòng không lỗi.
- `public/style.css` = design-system ĐÓNG BĂNG (chung với SPA); override viết ở `web/src/styles.css`.
- Sửa xong: `npx tsc --noEmit` (cả `web/`) → `npm --prefix web run build` → `npx vitest run` → deploy **staging** → chạy E2E → mới deploy **prod** → push cả `giai-doan-0` và `master`.
