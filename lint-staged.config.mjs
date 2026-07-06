// Pre-commit (husky → lint-staged). Triết lý khớp eslint.config.js: ERROR = bug thật → chặn commit;
// warning không chặn. KHÔNG chạy prettier lên .ts/.tsx/.js — house style dùng one-liner đặc chủ đích,
// prettier sẽ bung dòng ồ ạt + gây conflict với nhánh song song; format code đã có eslint --fix lo phần an toàn.
export default {
  "*.{js,mjs,cjs}": "eslint --fix",
  "*.{ts,tsx}": "eslint --fix",
  "*.{json,css,yml,yaml}": "prettier --write",
  // Đổi TS/JS backend (hoặc gói dùng chung) → typecheck TOÀN backend trước khi commit (tsc --noEmit, vài giây).
  "{src,shared,prisma,tests}/**/*.{ts,js}": () => "npm run typecheck",
  // Đổi frontend React → typecheck app web.
  "web/src/**/*.{ts,tsx}": () => "npm --prefix web run typecheck",
};
