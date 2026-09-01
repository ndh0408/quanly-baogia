# QuanLY — hướng dẫn riêng cho Claude Code

> ## Đọc [AGENTS.md](AGENTS.md) TRƯỚC.
>
> Toàn bộ quy ước kỹ thuật, chốt chặn của CI và danh sách "tuyệt đối không phá"
> nằm ở đó, và áp dụng cho mọi công cụ. File này CHỈ chứa phần riêng của Claude
> Code — nội dung không lặp lại AGENTS.md.

**Trả lời bằng tiếng Việt.**

---

## BMAD (đã cài — 89 skill)

BMAD v6 cài trong repo này ngày 2026-07-28. Skill nằm ở `.claude/skills/bmad-*` và `wds-*`,
config ở `_bmad/`, sản phẩm sinh ra ghi vào `_bmad-output/`.

Module đã cài: `core` · `bmm` · `cis` · `tea` · `wds` · `bmb` · `bmad-loop` (**không** cài `gds`).

Không biết bắt đầu từ đâu → gọi skill `bmad-help`, nó tự dò trạng thái rồi gợi bước kế.

### ⛔ Ba thứ TUYỆT ĐỐI không chạy

1. **`bmad-bmb-setup`** — nó gọi `cleanup-legacy.py --also-remove _config`, mà
   `cleanup-legacy.py:183` là `shutil.rmtree(target)`. SKILL.md dòng 70 ghi rõ thư mục
   không chứa skill (như `_config/`) bị **xoá thẳng, bỏ qua lớp kiểm tra an toàn**.
   `_bmad/_config/` đang giữ toàn bộ manifest của bản cài 89 skill
   (`files-manifest.csv`, `skill-manifest.csv`, `bmad-help.csv`, `manifest.yaml`).
   Mất thư mục này là `bmad-help` mù. Các skill bmb khác (`bmad-workflow-builder`,
   `bmad-eval-runner`) thì vô hại.

2. **`bmad-loop-*`** (3 skill) — cần `tmux`, máy Windows không có; backend `psmux` được
   chính README ghi là *experimental, native Windows is not yet shipped*. Còn cần
   `sprint-status.yaml` mà repo không có. `bmad-loop-setup` sẽ đăng ký hook
   `Stop`/`SessionStart`/`SessionEnd`/`PreCompact` vào `.claude/settings.json` — đừng chạy.

3. **Agent WDS** (`wds-agent-saga-analyst`, `wds-agent-freya-ux`, `wds-agent-mimir-builder`)
   — có tool `sync` tự động ghi 6 slash command (`/saga` `/freya` `/mimir` `/start`
   `/wrap` `/handoff`) vào `~/.claude/commands/`, tức **ra ngoài repo, ảnh hưởng mọi
   project khác trên máy**. Tính đến 2026-07-28 thư mục đó chưa tồn tại. Hỏi trước khi kích hoạt.

### Bẫy cấu hình đã vá — đừng vá lại

- `output_folder` ban đầu **không được định nghĩa** ở đâu cả → installer tạo thư mục tên
  literal `{output_folder}` ở gốc repo. Đã vá bằng `--output-folder _bmad-output`.
- TEA và WDS mặc định đẻ thư mục ra **gốc repo** (`skills/`, `design-artifacts/`).
  Đã trỏ hết vào `_bmad-output/`. TEA có **4 key** phải set: `test_artifacts` cộng 3 key con
  `test_design_output` / `test_review_output` / `trace_output` — sửa key cha không đủ.
- `python3` trên máy này vốn là **stub Microsoft Store** (exit 9009). Đã tạo shim
  `C:\Users\Admin\AppData\Local\Programs\Python\Python313\python3.exe` (thư mục này đứng
  trước `WindowsApps` trong PATH). Mọi script BMAD gọi `python3` nay chạy thật.

Muốn đổi cấu hình BMAD thì **chạy lại installer** với `--set`, đừng sửa tay
`_bmad/config.toml` (file ghi rõ installer-managed, bị ghi đè mỗi lần cài).

### Skill BMAD nào đáng dùng cho repo này

**Nên dùng** — vá đúng chỗ đang thiếu:
- `bmad-generate-project-context` — sinh `project-context.md`, là `persistent_facts` mặc định
  của gần như mọi skill BMAD khác. Không có nó thì cả bộ chạy mù.
- `bmad-document-project` — repo `docs/` gần như trống.
- `bmad-testarch-test-review` — chấm determinism/isolation/maintainability trên test **sẵn có**.
- `bmad-review-edge-case-hunter` — trực giao với coderabbit, hợp cho code tiền + phân quyền
  (`quoteFormula`, `excel`, `permissions`, `hnWorkflow`).
- `bmad-spec` — hợp cách làm từng nhánh nhỏ ở đây hơn là bộ PRD→epic→story.

**Đừng dùng** — trùng thứ repo đã có:
- `bmad-code-review`, `bmad-review-adversarial-general` → đã có `coderabbit:code-review`,
  `/code-review`, `/security-review`, `AUDIT_REPORT.md`, `.scan/`.
- `bmad-qa-generate-e2e-tests`, `bmad-testarch-ci` → đã có 30 vitest + 39 script
  `e2e-*.mjs` + `.github/workflows/ci.yml`. Sinh thêm test bám selector khác chỉ làm phình.
- `bmad-agent-*` (persona) → chỉ là menu router, gọi thẳng skill nhanh hơn.
- Nhóm `bmad-cis-*` và `wds-*` → dựng cho sản phẩm bán ra thị trường có khách ngoài;
  QuanLY là công cụ nội bộ, không có thị trường/khách hàng/nhà đầu tư để phục vụ.

### Skill BMAD cần PRD/epics mới chạy

`bmad-sprint-planning`, `bmad-create-story`, `bmad-dev-story`, `bmad-correct-course`,
`bmad-check-implementation-readiness`, `bmad-testarch-trace` đều HALT nếu thiếu
PRD/epics/`sprint-status.yaml`. Repo hiện **không có** — muốn dùng phải chạy
`bmad-prd` → `bmad-create-epics-and-stories` → `bmad-sprint-planning` trước.

---

---

## Vì sao file này ngắn

Trước đây `CLAUDE.md` và `AGENTS.md` là hai bản gần như y hệt nhau — `AGENTS.md`
được tạo bằng cách tìm-thay `Claude` → `Codex` trên `CLAUDE.md`. Phép thay đó
biến đường dẫn thật `.claude/skills/` thành `.Codex/skills/` (không tồn tại) và
`.claude/settings.json` thành `.Codex/settings.json`, tức là tài liệu chỉ người
đọc tới chỗ không có gì.

Nhân đôi tài liệu thì hai bản sẽ trôi khỏi nhau — câu hỏi chỉ là bao lâu. Nay quy
ước chung nằm ở **một chỗ** (`AGENTS.md`), còn đây giữ đúng phần thật sự riêng
của Claude Code: bộ skill BMAD cài cục bộ (`.claude/` và `_bmad/` đều nằm trong
`.gitignore` — chúng KHÔNG có trong bản clone).
