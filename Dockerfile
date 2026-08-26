# syntax=docker/dockerfile:1.7
# NOTE: pin the base image by digest in production for reproducible builds, e.g.
#   FROM node:22-alpine@sha256:<digest> AS deps
# (kept as a tag here so local builds don't break on an unknown digest).

##### deps stage — PRODUCTION-ONLY deps + generated Prisma client #####
# `prisma` (the migrate CLI) is a runtime dependency in this project because
# k8s/helm/compose run `prisma migrate deploy` on startup, so --omit=dev keeps it
# while dropping eslint/vitest/supertest/coverage from the image.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# package.json khai `postinstall` gọi scripts/patch-codex-security-9router.mjs, mà npm CHẠY
# postinstall kể cả khi --omit=dev → thiếu file là `npm ci` gãy nguyên lượt build. Copy vào trước.
# (Bản thân script tự thoát 0 khi không thấy gói dev @openai/codex-security — đúng cảnh image này.)
COPY scripts ./scripts
RUN apk add --no-cache openssl libc6-compat \
 && npm ci --omit=dev \
 # Prisma 7: prisma.config.ts dùng env("DATABASE_URL") (throw nếu thiếu). `generate` KHÔNG kết nối DB
 # nên cấp URL GIẢ cho qua; runtime + migrate dùng DATABASE_URL THẬT (compose env).
 && DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate

##### build stage — TypeScript → dist/ (JavaScript thuần) #####
# Production KHÔNG còn chạy qua tsx. Xem tsconfig.build.json để biết vì sao rootDir phải là "src".
# Cần dev deps (typescript) nên `npm ci` ĐẦY ĐỦ ở đây; tầng runtime chỉ lấy dist/, không lấy
# node_modules của tầng này.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY scripts ./scripts
RUN apk add --no-cache openssl libc6-compat \
 && npm ci \
 && DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate
COPY src ./src
RUN npm run build \
 # Chốt an toàn: nếu tsc đổi cách bố trí đầu ra thì phải VỠ Ở ĐÂY, không phải lúc pod khởi động.
 && test -f dist/server.js && test -f dist/worker.js && test -f dist/exportWorker.js && test -f dist/importWorker.js

##### web build stage — frontend React + Vite + TypeScript → public/app2 #####
FROM node:22-alpine AS webbuild
WORKDIR /app
COPY web ./web
COPY shared ./shared
# web/ import NGOÀI root → phải có mặt khi build (nếu không Vite/tsc fail):
#   ../../shared (gói dùng chung) + ../../public/style.css (design-system import vào bundle để Vite tự hash).
COPY public/style.css ./public/style.css
RUN cd web && npm ci && npm run build
# vite outDir = ../public/app2 → ghi ra /app/public/app2

##### runtime stage — slim production image #####
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

RUN apk add --no-cache openssl libc6-compat tini postgresql16-client font-dejavu \
 && addgroup -S app && adduser -S app -G app

# Copy production-only node_modules + generated Prisma client
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY package.json package-lock.json prisma.config.ts ./

# Mã ứng dụng ĐÃ BIÊN DỊCH (không copy src/, không cần tsx lúc chạy).
COPY --from=build /app/dist ./dist
COPY public ./public
COPY --from=webbuild /app/public/app2 ./public/app2
COPY templates ./templates

# PHÔNG CHỮ CHO PDF. fonts/*.ttf bị .gitignore loại (bản quyền Times New Roman của Microsoft) nên
# image TRƯỚC ĐÂY không có phông nào → src/pdf.ts rơi về Times dựng sẵn của PDFKit, và PDF xuất ra
# MẤT DẤU tiếng Việt. DejaVu Serif phát hành tự do và phủ đủ Latin Extended Additional (dấu tiếng
# Việt). Đặt đúng tên mà pdf.ts tìm; nếu deploy có gắn volume phông riêng thì volume ghi đè chỗ này.
RUN mkdir -p fonts \
 && cp /usr/share/fonts/dejavu/DejaVuSerif.ttf            fonts/Times.ttf \
 && cp /usr/share/fonts/dejavu/DejaVuSerif-Bold.ttf       fonts/Times-Bold.ttf \
 && cp /usr/share/fonts/dejavu/DejaVuSerif-Italic.ttf     fonts/Times-Italic.ttf \
 && chown -R app:app fonts

USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3000/livez || exit 1
# MỘT artifact duy nhất cho Docker/Compose/Helm/k8s: `node dist/server.js`. Trước đây Dockerfile chạy
# `node --import tsx src/server.js` còn Helm/k8s chạy `node src/server.js` (file KHÔNG tồn tại) →
# pod chết vòng lặp. Nay cả bốn đường deploy gọi đúng một lệnh.
CMD ["node", "dist/server.js"]
