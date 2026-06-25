# UX Audit toàn diện — Hệ thống QuanLY (Báo giá + Nhân sự) · Gia Nguyễn

> Người thực hiện: Senior UX Consultant (góc nhìn ERP/SAP Fiori/Salesforce/Ant Design Pro)
> Ngày: 2026-06-24 · Nhánh: `feat/hr-module`
> Phương pháp: audit đa-agent (13 màn hình + 14 chiều UX, đọc code thật, trích `file:line`). Lưu ý: pha **kiểm chứng đối kháng tự động bị dừng giữa chừng do chạm session limit**; các phát hiện HIGH quan trọng/bất ngờ đã được kiểm tra TAY (xem mục “Đính chính & độ tin cậy”). 209 phát hiện thô, 52 mức critical/high.

---

## 0. Kết luận nhanh (Executive Summary)

**Điểm UX tổng thể: ~5.5/10** — *“Nền móng kỹ thuật tốt, nhưng nợ UX hệ thống ở tầng bảng/dữ liệu, và một rủi ro chiến lược về kiến trúc.”*

Hệ thống KHÔNG hề là một sản phẩm cẩu thả: nhiều primitive a11y làm tốt hơn mặt bằng chung (toast `role=alert`/`aria-live`, `applyFieldErrors` highlight + focus đúng ô sai, modal `aria-modal`, chống account-enumeration, chặn double-submit ở danh sách, wizard có stepper bấm quay lại được). Vấn đề **không** nằm ở “không biết làm UX”, mà ở **ba chỗ**:

1. **Rủi ro chiến lược — 2 frontend song song + nhúng iframe.** App đang ở giữa cuộc di trú: React shell mới (chỉ 2 trang Nhân sự/Danh bạ là “thật”) **bọc SPA cũ trong `<iframe src="/app?embed=1">`** cho mọi trang còn lại. Hệ quả: hai sidebar/hai toast/hai empty-state/hai breakpoint mobile, **mất unsaved-guard khi đổi tab lúc editor đang sửa dở** (remount iframe = mất dữ liệu chưa lưu), URL không phản ánh trạng thái bên trong, ô “tìm nhanh” toàn cục thực chất chỉ lọc bảng HR.
2. **Nợ UX tầng bảng (table debt).** Hầu hết bảng **không sort được** (dù backend hỗ trợ), **filter/sort không lưu URL** (F5 mất hết), **nhiều bảng không phân trang** (Audit log, Khách hàng, Sản phẩm, Người dùng chỉ tải cứng 100 dòng → dữ liệu thứ 101 “biến mất im lặng”). Đây là tử huyệt của ERP nội bộ — nơi người dùng sống trong bảng cả ngày.
3. **Lỗi & loading không nhất quán.** `errorState()` + nút “Thử lại” có sẵn nhưng **chỉ dùng ở 2/12 trang**; phần lớn trang lỗi → “kẹt skeleton” hoặc toast biến mất. React **chưa có ErrorBoundary** → một lỗi render = trắng toàn app.

**Hướng đi đề xuất (xếp theo đòn bẩy):**
- **Tuần 1–2 (quick win, rủi ro thấp):** thêm sort cột cho list báo giá + HR; đưa filter vào URL; thay `confirm()/prompt()` native bằng `confirmModal/promptModal` có sẵn; khóa nút + “Đang đăng nhập…” ở login cũ; bỏ chữ “Ctrl+K” giả (hoặc wire thật); `errorState()` cho mọi trang còn “kẹt skeleton”.
- **Tháng 1:** phân trang thật cho Audit/Khách/SP/User; ErrorBoundary + toast a11y cho React; unsaved-guard cho form React; tách component `<DataTable>`/`<Pager>`/`<Toast>` dùng chung.
- **Chiến lược (quyết định lớn):** chốt lộ trình “khai tử iframe” — port nốt list/editor sang React HOẶC quay lại 1 shell duy nhất. **Đây là quyết định cần bạn chốt**, không nên để app sống lâu dài ở trạng thái nửa-vời.

---

## 1. Bảng điểm (Scorecard)

### 1a. Theo màn hình

| # | Màn hình | FE | Điểm | Nhức nhất |
|---|----------|----|------|-----------|
| 1 | Đăng nhập & Kích hoạt (Login/Onboard) | SPA cũ | **6.5** | Nút submit không có loading → double-submit |
| 2 | Shell & Điều hướng SPA cũ | SPA cũ | **7.0** | Không breadcrumb; search toàn cục chỉ tìm báo giá |
| 3 | Danh sách báo giá + Dashboard | SPA cũ | **6.5** | Không sort; filter không vào URL |
| 4 | Lưới nhập/sửa báo giá (Editor) | SPA cũ | **7.0** | `thead` không sticky; lỗi Lưu chỉ toast chung |
| 5 | Xem trước & Xuất (Preview/Export) | SPA cũ | **3.5** | Preview ngủ đông; export theo bản đã lưu, không cảnh báo |
| 6 | Admin · Khách hàng + Sản phẩm | SPA cũ | **4.0** | Không phân trang (size=100); chỉ phơi 2 trường |
| 7 | Admin · Quản lý dự án | SPA cũ | **5.0** | Sửa 1 ô → re-render cả trang; 23 cột, không sort |
| 8 | Admin · Nhân viên + Phân quyền + Tài khoản | SPA cũ | **6.0** | Bảng NV không tìm/lọc/sort/phân trang; modal tự dựng bỏ a11y |
| 9 | Admin · Nhật ký + Thông báo | SPA cũ | **5.0** | Audit cứng 100 dòng, không lọc theo ngày/người |
| 10 | Primitive UI dùng chung | SPA cũ | **7.0** | Toast chồng đè; tự ẩn 2.4s không đóng được |
| 11 | React Shell (Sidebar/Search/Theme) | React | **5.5** | Ctrl+K giả; search nhảy về #/personnel; iframe |
| 12 | React · Nhân sự (Personnel) | React | **6.5** | Sort 1 cột; không filter; form thiếu validate client |
| 13 | React · Danh bạ nhân viên (Employees) | React | **6.0** | Không sort; click backdrop mất dữ liệu; không validate MST/CCCD |

### 1b. Theo 14 chiều UX

| Chiều | Điểm | Một câu chốt |
|-------|------|--------------|
| Navigation | **5.0** | Hash router tốt, nhưng iframe phá deep-link & guard |
| Sidebar | **6.0** | Hai sidebar lệch nhau; React mất drawer mobile |
| Menu | **6.0** | Row-actions 3 phong cách; React tụt lùi so với cũ |
| **Breadcrumb** | **3.0** | Không tồn tại ở bất kỳ đâu |
| Search | **4.0** | “Global search” thực chất chỉ lọc bảng; Ctrl+K giả |
| Filter | **5.0** | Không lưu URL; React HR không có filter trạng thái |
| **Sort** | **3.0** | Hầu hết bảng không sort dù backend hỗ trợ |
| Pagination | **5.5** | Nhiều bảng tải cứng 100, không pager |
| Form | **6.0** | SPA tốt, React thiếu unsaved-guard & field-error |
| Modal | **6.0** | `openModal` tốt; còn modal tự dựng + confirm() native |
| Toast | **5.5** | Toast React câm với screen reader; SPA chồng đè |
| Empty State | **6.0** | Hai hệ; thiếu CTA thật (chỉ chữ) |
| Loading State | **6.0** | Mở báo giá không loading; iframe trắng màn |
| Error State | **6.0** | `errorState()` chỉ dùng 2/12 trang; React chưa ErrorBoundary |

---

## 2. 12 vấn đề hệ thống (cross-cutting) — đòn bẩy cao nhất

> Đây là các vấn đề lặp lại ở nhiều màn hình; sửa 1 lần lợi nhiều nơi.

| # | Vấn đề | Loại | Mức | Bằng chứng tiêu biểu |
|---|--------|------|-----|----------------------|
| S1 | **2 frontend + iframe**: hai sidebar/toast/empty-state; đổi tab khi editor dirty → mất dữ liệu (remount iframe, không gọi guard) | Anti-pattern / Pain | 🔴 | `web/src/Shell.tsx:112`; `public/js/ui.js:53-55` |
| S2 | **Sort vắng mặt** ở hầu hết bảng dù backend có `sort/order` | Debt / Friction | 🟠 | `quotes.js:97-104`; `quotes.routes.js:55,84` |
| S3 | **Filter/Sort không lưu URL** → F5/chia sẻ link mất trạng thái | Anti-pattern | 🟠 | `quotes.js:50-76`; `admin.js:862-867` |
| S4 | **Phân trang thiếu**: Audit/Khách/SP/User tải cứng 100 → dữ liệu thứ 101 ẩn im lặng | Anti-pattern / Pain | 🔴 | `admin.js:425,867`; `users.routes.js:68` |
| S5 | **“Global search” đánh lừa**: chỉ lọc bảng HR / chỉ tìm báo giá; bỏ phí customer+product backend đã hỗ trợ | Anti-pattern | 🟠 | `Shell.tsx:84`; `app.js:381`; `search.routes.js:54-92` |
| S6 | **“Ctrl+K” là lời hứa giả** — placeholder quảng cáo nhưng không có handler | Anti-pattern | 🟠 | `Shell.tsx:83`; `app.js:288` |
| S7 | **Không breadcrumb** ở bất kỳ tầng nào; drill-down Dự án→Báo giá mất ngữ cảnh | Pain | 🟡 | toàn repo 0 class breadcrumb |
| S8 | **`errorState()`+retry chỉ dùng 2/12 trang**; còn lại kẹt skeleton/toast biến mất | Debt | 🟠 | `quotes.js:60-63` (dùng) vs `admin.js:448,881` (không) |
| S9 | **React chưa có ErrorBoundary** → 1 lỗi render = trắng app | Anti-pattern | 🟠 | `web/src/App.tsx`, `main.tsx` (0 match) |
| S10 | **Form React thiếu unsaved-guard + không map lỗi server vào field** | Pain | 🟠 | `Personnel.tsx:289-300,305`; `Employees.tsx:150` |
| S11 | **`confirm()/prompt()` native** còn sót trong luồng duyệt HN (lệch hệ thống) | Anti-pattern | 🟡 | `quotes.js:568,598` |
| S12 | **Toast**: React câm với screen reader; SPA chồng đè cùng toạ độ; tự ẩn 2.4s không đóng được | Friction / a11y | 🟠 | `web/src/ui.ts:5-20`; `style.css:699-706`; `ui.js:25` |

---

## 3. Đánh giá CHI TIẾT từng màn hình
*(Cấu trúc: ① Hiện trạng · ② Vấn đề · ③ Ảnh hưởng · ④ Đề xuất · Điểm)*

### 3.1 — Đăng nhập & Kích hoạt tài khoản — **6.5/10** (SPA cũ)
**① Hiện trạng:** `renderLogin` (`app.js:193`) + `renderOnboard` (`app.js:149`). Có MFA progressive (ô MFA chỉ hiện khi server yêu cầu + auto-focus), “Quên mật khẩu” trả thông điệp trung lập chống enumeration, lỗi qua khối `role=alert aria-live=assertive`, autocomplete tokens đầy đủ (`current-password`/`new-password`/`one-time-code`).
**② Vấn đề:** (a) **Nút submit không có loading state** — không disable, không “Đang đăng nhập…”, không `aria-busy` → bấm nhiều lần, double-submit `accept-invite` (token dùng-một-lần) dễ race [`app.js:218-247`]. (b) Không autofocus ô username [`193-208`]. (c) Yêu cầu mật khẩu chỉ nằm ở placeholder, không `minlength`/checklist độ mạnh [`166`]. (d) Lỗi “mật khẩu nhập lại không khớp” không gắn `aria-invalid`/không focus ô sai [`175`]. (e) “Quên mật khẩu” render `textarea` cho ô nhập email (thiếu `type:'email'`) [`211`].
**③ Ảnh hưởng:** Trên mạng văn phòng chậm, nhân viên bấm 2–3 lần tưởng treo; onboarding (ấn tượng đầu) bị vòng lặp “đặt MK → bị từ chối → thử lại”.
**④ Đề xuất:** disable nút + đổi nhãn + `aria-busy` trong `try/finally`; autofocus username; thêm `minlength=8`+checklist live; lỗi client gọi chung đường `applyFieldErrors`; truyền `{type:'email'}` cho promptModal. Thêm nút hiện/ẩn mật khẩu + cảnh báo Caps Lock.

### 3.2 — Shell & Điều hướng SPA cũ — **7.0/10** (SPA cũ)
**① Hiện trạng:** `renderShell` (`app.js:251`) + hash router (`routeFromHash` `:86`), có drawer mobile (`openSidebar/closeSidebar`), nav lọc theo quyền, `#main` skip-link, deep-link `#/quotes/:id` hoạt động với Back/F5/bookmark.
**② Vấn đề:** Không breadcrumb/chỉ-báo-vị-trí ở cấp 2 (editor/wizard) [`478-492`]; **toàn bộ shell bị dựng lại mỗi lần điều hướng** (`app.innerHTML`) → chớp nháy, mất focus [`266`]; đổi route không chuyển focus về nội dung (`#main tabindex=-1` không bao giờ được focus) [`313`]; lỗi tải route chỉ toast, không error-state [`92-98`]; topbar mobile cứng tiêu đề “Báo Giá” [`271`].
**③ Ảnh hưởng:** Người dùng bàn phím/screen-reader mất ngữ cảnh sau mỗi lần chuyển trang; cảm giác “nháy lại từ đầu”.
**④ Đề xuất:** chỉ re-render `#main` cho điều hướng cùng-cấp (đã có `renderMain` cho SSE — tái dùng); sau chuyển route focus `#main`; thêm breadcrumb cấp 2; topbar mobile hiển thị tên trang hiện tại.

### 3.3 — Danh sách báo giá + Dashboard — **6.5/10** (SPA cũ)
**① Hiện trạng:** `renderList` (`quotes.js:32`) có **search debounce 300ms**, lọc trạng thái, **phân trang server thật** (page/size=20, hiển thị “x–y / tổng”), empty-state phân biệt “không khớp” vs “chưa có”, **error-state + Thử lại**, row-actions chặn double-click, xóa qua `confirmModal`, click dòng mở deep-link. *Đây là màn list làm tốt nhất hệ thống.*
**② Vấn đề:** **Không sort cột nào** [`97-104`]; **filter không vào URL** [`49-77`] → F5/chia-sẻ-link mất; thiếu lọc khoảng-ngày & theo công ty/khách (backend có hỗ trợ); Dashboard cứng “30 ngày”, và **Dashboard fail toàn cục chỉ toast → skeleton treo vĩnh viễn** [`admin.js:380-412`].
**③ Ảnh hưởng:** Account quản lý hàng trăm báo giá không thể “sắp theo Tổng/Ngày”, không bookmark được bộ lọc thường dùng.
**④ Đề xuất:** thêm sort header (backend đã sẵn), serialize `q/status/page/sort` vào hash; thêm date-range + company filter; Dashboard dùng `errorState()` thay vì để skeleton kẹt; cho chọn kỳ thời gian.

### 3.4 — Lưới nhập/sửa báo giá (Editor) — **7.0/10** (SPA cũ)
**① Hiện trạng:** Lưới Excel-like ~2035 dòng, có undo/redo (Ctrl+Z/Y), copy/paste lưới, công thức, auto-grow textarea, panel HN cho quản lý, version history.
**② Vấn đề:** **`thead` không sticky** — cuộn dài mất tên cột [`style.css:391-393`] (trong khi `.proj-table` lại có sticky); **lỗi validate khi Lưu chỉ toast chung, không highlight ô sai** vì `applyFieldErrors` chỉ match `#f-<top>` còn lỗi lưới là theo dòng/ô [`ui.js:81-84`, `editor.js:421-427`]; **không có Ctrl+S** cho màn nhập nặng [`1716-1718`]; thanh action (Lưu/Khách chốt) cuối form dài, **không sticky** [`209-222`]; xóa dòng bằng `✕` **không xác nhận, không undo nổi bật** [`1894-1903`]; min-width 860px ép cuộn ngang mobile, **không freeze cột**.
**③ Ảnh hưởng:** Đây là nơi người dùng ở lâu nhất — mất header khi cuộn + không Ctrl+S + nút Lưu trôi xuống đáy = ma sát lặp lại hàng trăm lần/ngày.
**④ Đề xuất:** `position: sticky` cho `thead` + freeze 1–2 cột đầu; Ctrl+S = Lưu; sticky action-bar; map lỗi-lưới về đúng ô (mở rộng `applyFieldErrors` theo `data-row/col`); xác nhận xóa dòng (hoặc toast “Hoàn tác”).

### 3.5 — Xem trước & Xuất (Preview/Export) — **3.5/10** (SPA cũ) ⚠️ *xem đính chính*
**① Hiện trạng:** Module `preview.js` (~157 dòng) dựng preview “giống xlsx”. `refreshPreview(q)` **được gọi 5 lần** trong editor (`editor.js:331,365,382,384,2034`). Export Excel/PDF qua menu kebab “⋯”.
**② Vấn đề:** **Preview thực tế ngủ đông**: `refreshPreview/renderPreview` luôn `return` sớm vì `getElementById("xlsx-preview")` luôn `null` — **không nơi nào tạo phần tử `id="xlsx-preview"`** (CSS chỉ có *class* `.xlsx-preview`). Người dùng **không bao giờ thấy WYSIWYG trước khi xuất**. Ngoài ra **export bám bản ĐÃ LƯU (`q.id`)** — sửa chưa lưu không vào file, **không cảnh báo** [`editor.js:429-436`]; export `window.open` không loading/error feedback; báo giá MỚI chưa lưu **không xuất được** (nút ẩn).
**③ Ảnh hưởng:** Rủi ro nghiệp vụ thật: gửi khách file thiếu phần vừa sửa mà không hề biết; ~157 dòng preview là nợ chết.
**④ Đề xuất:** hoặc **bật lại** preview (tạo `#xlsx-preview` + nút toggle) — vì code đã sẵn — hoặc **xóa hẳn** để hết nợ; cảnh báo/auto-save trước khi export; thêm loading + bắt lỗi export trong app thay vì mở tab JSON thô.

### 3.6 — Admin · Khách hàng + Sản phẩm/Vật tư — **4.0/10** (SPA cũ)
**① Hiện trạng:** `renderCustomers` (`admin.js:416`), `renderProducts` (`:515`). Có search debounce 300ms, thêm/sửa/xóa qua modal + `confirmModal`.
**② Vấn đề:** **Không phân trang — tải cứng `size=100`** [`425,525`], dữ liệu thứ 101 “biến mất im lặng” dù backend trả `meta.pageCount`; **chỉ phơi 2 trường (mã/tên)** trong khi backend có cả mô hình CRM [`486-491` vs `customers.routes.js:30-43`]; **không sort** dù API hỗ trợ; loading là chữ **“Đang tải…” thô** (có `skeleton()` mà không dùng) [`422,521`]; **lỗi tải chỉ toast → “Đang tải…” kẹt vĩnh viễn** (`errorState` đã import ở `:12` mà không dùng); modal lỗi chỉ toast.
**③ Ảnh hưởng:** Công ty >100 khách/SP là mù dữ liệu; màn này “có xương thiếu thịt” đúng nghĩa.
**④ Đề xuất:** dùng `meta` để phân trang (như list báo giá đã làm); thêm sort + lọc trạng thái/`active`; thay “Đang tải…” bằng `skeleton()`, thêm `errorState()`; validate field trong modal.

### 3.7 — Admin · Quản lý dự án — **5.0/10** (SPA cũ)
**① Hiện trạng:** `renderProjects` (`admin.js:638`), bảng ~23 cột dự án đã chốt, có ô đánh dấu đỏ “cần làm”.
**② Vấn đề:** **Sửa 1 ô → `renderProjects(el)` re-render TOÀN BỘ trang** (mất focus, mất vị trí cuộn, gọi lại API) [`799-822`]; **không sort** cột nào [`716`]; **không phân trang/ảo hoá** — render hết thành DOM khổng lồ; **2 cột luôn rỗng vĩnh viễn** (“Ngày Xuất Hoá Đơn”, “Check”); **23 cột nhồi 1 bảng** quá tải thị giác; ô đỏ “cần làm” **không có legend** giải nghĩa.
**③ Ảnh hưởng:** Sửa nhanh nhiều ô là cực hình (focus nhảy sau mỗi ký tự lưu); bảng càng nhiều dự án càng chậm.
**④ Đề xuất:** cập nhật **tại chỗ** (chỉ patch ô + toast nhỏ), không re-render cả trang; thêm sort + phân trang/virtualize; ẩn cột chết; thêm legend màu; cân nhắc cột tuỳ biến/ẩn-hiện.

### 3.8 — Admin · Nhân viên + Phân quyền + Tài khoản — **6.0/10** (SPA cũ)
**① Hiện trạng:** `renderUsers` (`:22`), `renderProfile` (`:274`) có MFA box, `renderPermissions` (`:893`).
**② Vấn đề:** **Bảng nhân viên không tìm/lọc/sort/phân trang** [`24-67`]; **Modal “Sửa NV” & “Đổi mật khẩu” tự dựng DOM** (`.modal-mask`), bỏ qua a11y của `openModal` (không focus-trap/Esc/aria) [`149-217`]; **lỗi validate chỉ toast biến mất** dù đã có `applyFieldErrors` [`120,191`]; **Khóa tài khoản không xác nhận, không undo** [`75-82`]; “+ Thêm nhân viên” thực ra mở luồng **MỜI qua email** — nhãn gây hiểu nhầm; đổi vai trò ở Phân quyền **lưu ngay khi chọn dropdown, không xác nhận** [`934-940`].
**③ Ảnh hưởng:** Thao tác quyền/khoá tài khoản là nhạy cảm mà thiếu xác nhận → dễ sai khó sửa.
**④ Đề xuất:** chuyển 2 modal sang `openModal`; map lỗi vào field; thêm `confirmModal` cho Khóa tài khoản & Đổi vai trò; đổi nhãn “+ Mời nhân viên”; thêm tìm/sort/phân trang cho bảng NV.

### 3.9 — Admin · Nhật ký hoạt động + Thông báo — **5.0/10** (SPA cũ)
**① Hiện trạng:** `renderAuditLog` (`:849`) bảng sự kiện, `renderNotifications` (`:602`) dạng card + deep-link.
**② Vấn đề:** **Audit cứng `size=100`, không phân trang** → mất lịch sử [`867`]; **không lọc theo ngày/người thực hiện** [`854-859`]; không sort, không click dòng xem chi tiết; **Thông báo chỉ hiện NGÀY, thiếu GIỜ** (meta mơ hồ) [`618`]; lỗi tải chỉ toast → skeleton kẹt; Thông báo không có tab “chưa đọc/tất cả”, không tìm.
**③ Ảnh hưởng:** Audit log mà chỉ xem 100 dòng mới nhất + không lọc = vô dụng cho điều tra sự cố/compliance.
**④ Đề xuất:** phân trang + lọc ngày/người/loại hành động cho Audit; thêm giờ; `errorState()`; tab chưa-đọc cho Thông báo.

### 3.10 — Primitive UI dùng chung — **7.0/10** (SPA cũ)
**① Hiện trạng:** `ui.js`: `toast` (aria-live/role), `skeleton`, `errorState`+retry, `applyFieldErrors` (highlight+focus+aria-invalid), `openModal/promptModal/confirmModal` (aria-modal, Esc, ×). *Bộ primitive này là điểm sáng.*
**② Vấn đề:** **Toast chồng đè cùng toạ độ** (không xếp dọc) [`style.css:699-706`]; toast **tự ẩn cứng 2400ms, không dừng khi hover, không nút đóng** [`ui.js:25`]; **không có hàm `emptyState()` chuẩn** → empty-state mỗi nơi một kiểu; modal **click backdrop không đóng**; `promptModal/confirmModal` **không submit bằng Enter**; skeleton **thiếu `aria-busy`** (screen reader im lặng).
**③ Ảnh hưởng:** Toast lỗi quan trọng biến mất sau 2.4s trước khi đọc xong là pain thực sự.
**④ Đề xuất:** stack toast theo cột + giới hạn width + nút đóng + pause-on-hover + tăng thời gian cho `type=error`; thêm `emptyState(icon,msg,cta)`; Enter để confirm; `aria-busy` cho skeleton.

### 3.11 — React Shell (Sidebar/Search/Theme) — **5.5/10** (React)
**① Hiện trạng:** `Shell.tsx` sidebar nhóm theo `group`, lọc theo permission, theme toggle, ô “Tìm nhanh (Ctrl+K)”. Trang chưa port → `<iframe src="/app?embed=1#/...">`.
**② Vấn đề:** **Ctrl+K không có handler** [`83`]; **gõ vào search ở trang bất kỳ tự nhảy về `#/personnel`** — mất ngữ cảnh [`84`]; **iframe nhúng**: nguy cơ double-sidebar, không đồng bộ active-state với redirect bên trong, **không loading state (trắng màn)**, mất unsaved-guard; **sidebar không thu gọn & không drawer mobile thực** (regression so app cũ); link nav **thiếu `aria-current`**; mục Thông báo **không badge số chưa đọc**.
**③ Ảnh hưởng:** Shell mới — bộ mặt tương lai — lại kém hơn shell cũ ở mobile/menu; ô search “toàn cục” đánh lừa kỳ vọng.
**④ Đề xuất:** wire Ctrl+K thật hoặc bỏ chữ; đổi placeholder thành “Tìm nhân sự…”; thêm loading cho iframe + cross-frame guard trước khi remount; drawer mobile; `aria-current`; badge thông báo realtime.

### 3.12 — React · Nhân sự (Personnel) — **6.5/10** (React)
**① Hiện trạng:** `Personnel.tsx` có **sort cột (▲▼)**, **phân trang**, **skeleton loading**, **empty-state**, **error + Thử lại**, footer tổng, modal form (focus đầu + Esc), required `fullName`+`projectCode`, ProjectPicker/EmployeePicker debounce. *Trang React “mẫu mực” nhất.*
**② Vấn đề:** **Sort chỉ chạy 1 cột (Họ tên)** — cột số/ngày không sort [`fields.ts:58-59`]; **không có filter nào** (chỉ search toàn văn) [`32-44`] — không lọc “Đã thanh toán/Đã ký” dù là cột nghiệp vụ; **form không validate client ngoài 2 trường**, lỗi server gộp 1 dòng [`289-300,359-367`]; **ô Lương `type=number` thô, không nhóm nghìn**; **bug timezone** `toISOString()` lệch -1 ngày giờ VN [`9`]; modal form rất dài cuộn trong khung, không index nhóm; phân trang chỉ Trước/Sau.
**③ Ảnh hưởng:** Kế toán không lọc nhanh “ai chưa thanh toán”; nhập Lương dễ sai số 0; ngày có thể lệch.
**④ Đề xuất:** mở sort cho mọi cột số/ngày + `aria-sort`; thêm filter chips (đã TT/đã ký/dự án); format tiền khi gõ; sửa timezone (dùng local date); map lỗi server vào field.

### 3.13 — React · Danh bạ nhân viên (Employees) — **6.0/10** (React)
**① Hiện trạng:** `Employees.tsx` bảng danh bạ + modal thêm/sửa, phân trang Trước/Sau.
**② Vấn đề:** **Không sort** dù backend + metadata hỗ trợ [`66`]; **không validate định dạng** MST/CCCD/STK/SĐT [`fields.ts:15-24`]; **click backdrop/Escape đóng modal = mất sạch dữ liệu đã gõ, không hỏi** [`129,150`]; lỗi server 1 banner chung; **modal không focus-trap** (Tab thoát ra sau lưng); bug timezone; xóa không Undo; bảng cuộn ngang ghim 2 cột nhưng **không dấu hiệu còn cột bị che**.
**③ Ảnh hưởng:** Nhập nhầm MST/CCCD lọt thẳng DB; lỡ tay click nền = gõ lại từ đầu.
**④ Đề xuất:** thêm sort; validate pattern các trường định danh; unsaved-guard trước khi đóng; focus-trap (tái dùng `confirmModal` pattern); chỉ báo cuộn ngang.

---

## 4. Đánh giá CHI TIẾT 14 chiều UX (điểm + điểm mạnh + lỗ hổng)

- **Navigation — 5/10.** Mạnh: hash router deep-link/Back/F5 tốt, leave-editor-guard ở SPA. Yếu: iframe phá deep-link & nuốt guard (`Shell.tsx:112`); đổi route không chuyển focus; bước wizard không vào URL (F5 mất tiến độ).
- **Sidebar — 6/10.** Mạnh: nhóm + lọc quyền, drawer mobile (SPA). Yếu: hai sidebar lệch (mục/breakpoint 920 vs 760, token màu `--accent` vs `--gold`), React mất drawer mobile + badge thông báo.
- **Menu — 6/10.** Yếu: row-actions 3 phong cách (`quotes.js` nút text, `admin.js` khác, React khác); React thiếu mobile menu; không kebab gom ở list.
- **Breadcrumb — 3/10.** Gần như không tồn tại toàn hệ thống; drill-down Dự án→Báo giá mất ngữ cảnh nguồn; người dùng không biết “đang ở đâu” ở cấp 2.
- **Search — 4/10.** Mạnh: server search có route riêng + debounce. Yếu: “global search” chỉ lọc HR/chỉ tìm báo giá; Ctrl+K giả; comment “unaccent normalization” SAI (thực chất ILIKE, không bỏ dấu); Personnel/Employee thiếu trgm index → seq scan.
- **Filter — 5/10.** Yếu: không lưu URL; React HR không có filter trạng thái; 3 mô hình lọc không nhất quán (server/client/global-injection); thiếu filter chips & “Xóa lọc”.
- **Sort — 3/10.** Yếu nhất nhì: toàn SPA cũ không sort cột nào dù backend báo giá đã hỗ trợ; React Employees không sort, Personnel sort 1 cột; thiếu `aria-sort`.
- **Pagination — 5.5/10.** Mạnh: list báo giá + Personnel phân trang server thật. Yếu: Audit/Khách/SP/User tải cứng 100/50, không pager; pager thiếu nhảy trang/đổi cỡ trang; 3 tầng UI lệch markup.
- **Form — 6/10.** Mạnh: SPA có `applyFieldErrors` + wizard + required. Yếu: React thiếu unsaved-guard & field-error mapping; tiền `type=number` không nhóm nghìn; bug timezone; modal admin tự dựng.
- **Modal — 6/10.** Mạnh: `openModal` aria-modal/Esc. Yếu: React bỏ focus-trap; 2 modal admin tự dựng; còn `confirm()/prompt()` native; click-backdrop không nhất quán.
- **Toast — 5.5/10.** Yếu: React câm với screen reader; 2 implementation trùng lặp lệch nhau; SPA chồng đè; tự ẩn 2.4s không đóng/không pause.
- **Empty State — 6/10.** Yếu: hai design system; **thiếu CTA-button thật** (chỉ chữ, kể cả “Bấm + Thêm” lại nằm trong `<div>`); nhiều empty-state cụt 1 dòng.
- **Loading State — 6/10.** Mạnh: SPA có boot splash + skeleton. Yếu: mở báo giá không loading (đóng băng rồi nhảy); iframe trắng màn; React thiếu boot splash; 3 “phương ngữ” loading.
- **Error State — 6/10.** Mạnh: `errorState()`+retry tốt, anti-enumeration, phân tách 401. Yếu: chỉ dùng 2/12 trang; React chưa ErrorBoundary; lỗi boot `/auth/me` bị nuốt đẩy ra login; export lỗi → tab JSON thô; nhiều `.catch` im lặng.

---

## 5. Roadmap đề xuất (Impact × Effort)

### Đợt 1 — Quick wins (1–2 tuần, rủi ro thấp, đòn bẩy cao)
1. **Sort cột** cho list báo giá + bảng HR (backend đã sẵn) — *S2*.
2. **Filter/sort/page vào URL hash** (serialize state) — *S3*.
3. **Khóa nút + “Đang xử lý…” + `aria-busy`** cho login cũ & các submit thiếu loading — *3.1, Loading*.
4. **Thay `confirm()/prompt()` native** bằng `confirmModal/promptModal` — *S11*.
5. **`errorState()` cho mọi trang còn “kẹt skeleton”** (Dashboard, Khách, SP, Audit, Users) — *S8*.
6. **Bỏ/wire “Ctrl+K”** + đổi placeholder search cho đúng phạm vi — *S6, S5*.
7. **`thead` sticky + Ctrl+S** cho editor; **sticky action-bar** — *3.4*.

### Đợt 2 — High-impact (3–4 tuần)
8. **Phân trang thật** cho Audit/Khách/SP/User (đã có `meta`) — *S4*.
9. **ErrorBoundary + Toast a11y (aria-live)** cho React — *S9, S12*.
10. **Unsaved-guard + map lỗi server→field** cho form React — *S10*.
11. **Sửa-tại-chỗ** trang Dự án (bỏ re-render toàn trang) + sort + ẩn cột chết — *3.7*.
12. **Tách component dùng chung**: `<DataTable sortable/filterable>`, `<Pager>`, `<Toast>`, `<EmptyState cta>` — diệt nợ trùng lặp 2 frontend.
13. **Quyết định preview**: bật lại (tạo `#xlsx-preview`+toggle) hoặc xóa; **cảnh báo unsaved trước export** — *3.5*.

### Đợt 3 — Chiến lược (cần bạn chốt)
14. **Lộ trình khai tử iframe**: port nốt list/editor sang React, hoặc hợp nhất về 1 shell. Đặt “điểm dừng” rõ ràng thay vì để app sống nửa-vời lâu dài — *S1*. Đây là quyết định scope/rủi ro thật → nên bàn trước khi làm.
15. **Hệ thống breadcrumb** + chuẩn hoá design tokens (màu active/breakpoint) giữa 2 FE — *S7, Sidebar*.

---

## 6. Đính chính & độ tin cậy (đọc kỹ)

- **Pha kiểm chứng đối kháng tự động bị dừng** giữa chừng (chạm session limit lúc ~14:10), nên 34 finding HIGH chưa qua “skeptic verify” tự động. Tôi đã kiểm tra TAY các claim quan trọng/bất ngờ nhất.
- **ĐÃ ĐÍNH CHÍNH 1 finding sai:** Preview KHÔNG phải “code chưa từng import”. Thực tế `refreshPreview` **được import + gọi 5 lần** trong editor; nó *no-op* vì phần tử `#xlsx-preview` không bao giờ được tạo → preview **ngủ đông**, không “chết hẳn về mặt import”. Kết luận UX (người dùng không có WYSIWYG trước export) vẫn đúng; cơ chế đã sửa lại cho chính xác.
- **ĐÃ XÁC NHẬN TAY:** không breadcrumb (0 match toàn repo); `confirm()/prompt()` ở `quotes.js:568,598`; Ctrl+K không handler (`Shell.tsx:83`, `app.js:288`); React không ErrorBoundary (0 match `web/src`); Khách hàng `size=100` hardcode không pager (`admin.js:425`).
- Các finding mức medium/low còn lại dựa trên đọc-code của agent có `file:line`; nên spot-check khi triển khai sửa.
