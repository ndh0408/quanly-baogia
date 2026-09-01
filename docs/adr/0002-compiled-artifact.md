# ADR 0002 — Production chạy artifact đã biên dịch, không chạy TypeScript qua loader

**Trạng thái:** đã chấp nhận · **Ngày:** 2026-08

## Bối cảnh

Backend là TypeScript. Trước đây production chạy `node --import tsx src/server.js`:
tsx strip kiểu lúc chạy, mỗi lần khởi động lại biên dịch.

Việc này đã gây một sự cố **thật**: Dockerfile chạy qua tsx, còn chart Helm và
`infra/k8s/app.yaml` chạy `node src/server.js` — **file không tồn tại**. Mọi pod
chết vòng lặp ngay lần deploy k8s đầu tiên, và không bước CI nào phát hiện.

## Quyết định

`npm run build` (tsconfig.build.json) sinh `dist/`. Production chạy
`node dist/server.js` / `node dist/worker.js`. tsx **chỉ** dùng cho dev.

`rootDir: "src"` là **bắt buộc**: mã tính đường dẫn tài nguyên bằng
`__dirname/..`. Với `rootDir: "."` thì đầu ra thành `dist/src/app.js` và
`../public` trỏ vào `dist/public` — không tồn tại. Toàn bộ frontend 404 **âm
thầm**: typecheck xanh, server báo khoẻ.

## Lý do

- **Một artifact cho mọi đường triển khai.** Không còn khoảng hở giữa cái
  Dockerfile chạy và cái Helm chạy.
- **Khởi động tất định.** Không biên dịch lúc chạy nghĩa là không có lớp lỗi
  "biên dịch được trên máy tôi".
- **Bề mặt image nhỏ hơn.** Không cần trình biên dịch trong runtime.
- **Chốt được ở CI.** `check-runtime-command.sh` so lệnh khởi động giữa
  Dockerfile, compose, Helm, k8s và package.json.

## Hệ quả

- Thêm một bước build trước khi deploy. CI gác bằng `test -f dist/*.js`.
- `smoke-dist.sh` chạy **thật** artifact ở `NODE_ENV=production` và gọi
  `/style.css` — bắt được đúng lớp lỗi đường dẫn tài nguyên nói trên.
- `.js` cũ còn sót trong `src/` trên máy chủ có thể che `.ts` — `deploy.sh` dọn.

## Đường lùi

Quay lại chạy `tsx src/server.ts` ở production: sửa `CMD` trong Dockerfile (và `command:` trong
compose/Helm), dựng lại ảnh, deploy. Không có migration dữ liệu nào, không có trạng thái nào bị
kẹt — đây là quyết định **chỉ về artifact**, nên lùi là một lệnh build.

Trước khi lùi, đọc `scripts/ci/check-runtime-command.sh`: nó tồn tại vì bốn đường triển khai
(Dockerfile · compose · Helm · k8s) TỪNG lệch nhau và làm mọi pod chết vòng lặp. Lùi mà chỉ sửa một
chỗ là tái hiện đúng sự cố đó — cổng sẽ đỏ, và nó đang đỏ đúng chỗ.
