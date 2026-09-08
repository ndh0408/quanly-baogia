// Backup/restore-drill KHO OBJECT phải gắn container `mc` vào ĐÚNG network của MinIO, không
// `--network host` — chốt hồi quy (ultracode audit 2026-09-09, finding H5).
//
// ── LỖI ──────────────────────────────────────────────────────────────────────
// `docker-compose.prod.yml` publish MinIO CHỈ ở `127.0.0.1:9001` (console); cổng S3 API (9000)
// KHÔNG BAO GIỜ mở ra host — theo đúng ý đồ, app/worker gọi qua network `internal` bằng tên
// service `minio`. `--network host` đặt container `mc` vào network namespace của HOST, bỏ qua hẳn
// DNS nội bộ của compose (127.0.0.11) mà chỉ thành viên network bridge mới có — không có
// `S3_ENDPOINT` nào (kể cả `http://minio:9000` lẫn `http://127.0.0.1:9000`) mà nó tới được. Nghĩa
// là toàn bộ chuỗi backup/restore-drill kho object CHƯA BAO GIỜ hoạt động kể từ khi MinIO lên
// production (fc053c2) — không lỗi nào từng hiện ra vì `/etc/quanly-backup.env` cũng chưa điền S3_*.
//
// Bài dưới KHÔNG chạy docker thật (máy này không có Docker — xem AGENTS.md) — soi mã nguồn để bắt
// đúng lớp lỗi: script không còn dùng `--network host`, và có dò network thật của MinIO/Postgres
// (`docker inspect ... NetworkSettings.Networks`) trước khi gọi `mc`. Xác nhận END-TO-END (chạy
// thật, sinh manifest thật) đã làm tay trên production, ghi trong PR/commit — bài này chỉ khoá lại
// để không ai lỡ tay đưa `--network host` trở lại.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const doc = (f) => readFileSync(f, "utf8");
// Chú thích giải thích LỖI CŨ tự nhắc lại đúng chuỗi vừa bị cấm ("--network host") — lọc dòng #
// trước khi soi, cùng kỹ thuật readCode() của tests/ic-infra-compose.test.js.
const code = (f) => doc(f).replace(/^\s*#.*$/gm, "");

describe("backup-objects.sh / restore-drill.sh — mc() không còn dùng --network host", () => {
  for (const f of ["scripts/backup/backup-objects.sh", "scripts/backup/restore-drill.sh"]) {
    it(`${f}: không còn "--network host" trong mã THẬT (bỏ qua chú thích)`, () => {
      expect(code(f), `${f} vẫn còn --network host — mc không tới được MinIO (cổng 9000 không publish ra host)`)
        .not.toMatch(/--network\s+host/);
    });

    it(`${f}: mc() dùng biến network dò được (không hardcode tên)`, () => {
      const s = code(f);
      const mucMc = s.slice(s.indexOf("\nmc() {"));
      expect(mucMc, `${f}: mc() phải dùng --network "$NET" hoặc tương đương dò động, không hardcode`)
        .toMatch(/--network\s+"\$(NET|net)"/);
    });
  }

  it("backup-objects.sh: dò network bằng docker inspect trên quanly-minio, không hardcode tên network", () => {
    const s = code("scripts/backup/backup-objects.sh");
    expect(s).toMatch(/docker inspect[^\n]*NetworkSettings\.Networks[^\n]*quanly-minio/);
    // Không hardcode một cái tên cụ thể như "quanly_internal" — tên đó phụ thuộc project name của
    // docker-compose (đổi tên thư mục/-p là đổi theo), hardcode là sẽ trôi khỏi thực tế VM.
    expect(s).not.toMatch(/--network\s+"?quanly_internal"?/);
  });

  it("restore-drill.sh: dùng LẠI $NET đã dò từ PG_CONTAINER (postgres + minio cùng network 'internal')", () => {
    const s = code("scripts/backup/restore-drill.sh");
    expect(s).toMatch(/NET="\$\(docker inspect "\$PG_CONTAINER"/);
  });
});
