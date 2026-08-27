# syntax=docker/dockerfile:1.7
# ── ẢNH NỀN LÀ MỘT THAM SỐ ──────────────────────────────────────────────────
# Mặc định là TAG để bản clone nào cũng build được ngay. Production nên GHIM THEO DIGEST cho
# build tái lập được — nay ghim bằng tham số, không phải sửa file:
#
#   docker build --build-arg NODE_IMAGE=node:22-alpine@sha256:<digest> .
#
# Tham số này còn là đường để `scripts/ci/docker-smoke.sh` chèn một ảnh nền có sẵn CA của proxy
# MITM khi máy build nằm sau proxy đó (xem chú thích trong script). CA KHÔNG được nướng vào
# Dockerfile: nó là chuyện của MỘT môi trường build, không phải của image.
ARG NODE_IMAGE=node:22-alpine

##### deps stage — PRODUCTION-ONLY deps + generated Prisma client #####
# `prisma` (the migrate CLI) is a runtime dependency in this project because
# k8s/helm/compose run `prisma migrate deploy` on startup, so --omit=dev keeps it
# while dropping eslint/vitest/supertest/coverage from the image.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# KHÔNG còn hook cài đặt nào cần `scripts/`. Chú thích cũ ở đây viện dẫn khoá `postinstall`
# (gọi scripts/patch-codex-security-9router.mjs) như lý do bắt buộc phải COPY — khoá đó ĐÃ BỊ GỠ
# khỏi package.json, và tests/qs-postinstall-hook.test.js giữ cho nó không quay lại. Lifecycle
# script duy nhất còn lại là `prepare` = "husky || true", không đụng tới thư mục này.
# Dòng COPY vẫn giữ vì chưa dựng được image thật để xác nhận bỏ đi là an toàn; nó KHÔNG miễn phí:
# mọi thay đổi trong scripts/ đều làm hỏng cache lớp `npm ci` ngay dưới.
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
FROM ${NODE_IMAGE} AS build
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
FROM ${NODE_IMAGE} AS webbuild
WORKDIR /app
COPY web ./web
COPY shared ./shared
# web/ import NGOÀI root → phải có mặt khi build (nếu không Vite/tsc fail):
#   ../../shared (gói dùng chung) + ../../public/style.css (design-system import vào bundle để Vite tự hash).
COPY public/style.css ./public/style.css
RUN cd web && npm ci && npm run build
# vite outDir = ../public/app2 → ghi ra /app/public/app2

##### runtime stage — slim production image #####
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

# --enable-source-maps: tsconfig.build.json đặt `sourceMap: true` và dist/*.js.map ĐÃ nằm trong
# image, nhưng KHÔNG có gì tiêu thụ chúng lúc chạy — mọi stack trace (log lẫn Sentry) trỏ vào
# dist/*.js đã biên dịch, tức số dòng vô nghĩa với người đọc và với `git blame`.
#
# GIÁ PHẢI TRẢ, ĐÃ ĐO (node 22.22, 20.000 lần ném lồng 5 tầng, dist do tsc sinh kèm .map):
#   • ném rồi ĐỌC `.stack`      : 19,1 µs → 44,4 µs mỗi lỗi  (+25 µs, ~2,3×)
#   • ném mà KHÔNG đọc `.stack` : 5,66 µs → 5,98 µs           (chênh trong nhiễu đo)
# Giải mã map là LƯỜI — chỉ chạy khi stack thật sự được định dạng. Trong ứng dụng này lỗi là
# đường NGOẠI LỆ (500/log/Sentry), không phải đường nóng: +25 µs cho mỗi lỗi được ghi log là giá
# không đáng kể so với việc đọc được đúng tệp .ts và số dòng khi có sự cố. → BẬT.
#
# Đặt ở ENV (không phải ở CMD) vì hai lý do:
#   1. scripts/ci/check-runtime-command.sh:18 đòi CMD KHỚP TỪNG KÝ TỰ `["node", "dist/server.js"]`;
#   2. bốn đường triển khai đều GHI ĐÈ lệnh khởi động (compose worker `command:`, k8s/helm
#      `command:`/`args:`), nên cờ nhét vào CMD chỉ với tới đúng một đường.
# k8s/helm KHÔNG khai NODE_OPTIONS nên biến này tới nơi. compose thì CÓ khai
# (--max-old-space-size) và ghi đè SẠCH biến của image — đó là lý do có wrapper ở ENTRYPOINT.
ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS=--enable-source-maps

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

# CHỐT CUỐI CHO SOURCE MAP. docker-compose.{prod,staging}.yml đặt NODE_OPTIONS=--max-old-space-size=…
# cho cả app lẫn worker; biến của compose THAY THẾ hoàn toàn biến ENV của image, nên nếu chỉ dựa vào
# ENV ở trên thì ĐÚNG con đường đang chạy production (deploy.sh → compose) lại là con đường MẤT cờ.
# Wrapper này NỐI THÊM cờ vào bất kỳ NODE_OPTIONS nào nó nhận được, thay vì thay thế — giữ nguyên
# trần heap mà compose đã tính. Nó nằm ở ENTRYPOINT nên `command:` của compose (chỉ ghi đè CMD)
# vẫn đi qua đây; k8s/helm ghi đè cả entrypoint thì đã có ENV NODE_OPTIONS ở trên đỡ.
# Không nhân đôi cờ nếu đã có sẵn. `exec "$@"` giữ nguyên PID để tini nhận đúng tín hiệu.
#
# HAI LƯỢT TỰ KIỂM, VÌ MỘT LƯỢT KHÔNG ĐỦ. `ENV NODE_OPTIONS=--enable-source-maps` ở trên ĐÃ có
# hiệu lực ngay trong RUN này, nên một lượt kiểm chạy trần luôn rơi vào nhánh "đã có sẵn, không
# nối thêm". Đúng cái nhánh mà compose phụ thuộc — nhánh NỐI THÊM — sẽ KHÔNG BAO GIỜ được chạy
# lúc build, tức phép tự kiểm không bảo vệ thứ nó tưởng nó bảo vệ. Lượt thứ hai ép NODE_OPTIONS
# sang ĐÚNG giá trị mà docker-compose.prod.yml:202 gửi cho app (--max-old-space-size=1024) để
# buộc đi vào nhánh
# đó, rồi đòi kết quả chứa CẢ hai cờ. Gán biến ngay trước lệnh (không gọi `env`) để lượt kiểm
# không phụ thuộc một applet busybox nào — sandbox không có Docker daemon nên `env` của alpine là
# thứ KHÔNG kiểm chứng được ở đây, còn dạng gán-tiền-tố thì /bin/sh nào cũng phải hiểu.
# Đã đo bằng sh thật (dash), trên đúng khối script bên dưới:
#   • wrapper THAY THẾ thay vì nối thêm  → lượt 1 XANH (không phát hiện), lượt 2 ĐỎ;
#   • wrapper nối cờ hai lần             → phép "có mặt không" XANH, phép "đúng một lần" ĐỎ.
# Nên cả hai lượt và cả phép đếm "đúng một lần" đều có sức phân biệt thật, không phải trang trí.
RUN printf '%s\n' \
      '#!/bin/sh' \
      'case " ${NODE_OPTIONS:-} " in' \
      '  *" --enable-source-maps "*) ;;' \
      '  *) NODE_OPTIONS="${NODE_OPTIONS:-} --enable-source-maps" ;;' \
      'esac' \
      'export NODE_OPTIONS' \
      'exec "$@"' \
    > /usr/local/bin/bat-source-map \
 && chmod 0755 /usr/local/bin/bat-source-map \
 && /usr/local/bin/bat-source-map node -e 'const c=(process.env.NODE_OPTIONS||"").split(" ").filter(Boolean),n=c.filter(f=>f==="--enable-source-maps").length;if(n!==1){console.error("bat-source-map: nhánh GIỮ NGUYÊN sai, NODE_OPTIONS="+process.env.NODE_OPTIONS);process.exit(1)}' \
 && NODE_OPTIONS=--max-old-space-size=1024 /usr/local/bin/bat-source-map node -e 'const c=(process.env.NODE_OPTIONS||"").split(" ").filter(Boolean),n=c.filter(f=>f==="--enable-source-maps").length;if(n!==1||!c.includes("--max-old-space-size=1024")){console.error("bat-source-map: nhánh NỐI THÊM sai, NODE_OPTIONS="+process.env.NODE_OPTIONS);process.exit(1)}'

# PHÁT HÀNH CHO SENTRY. @sentry/node tự đọc process.env.SENTRY_RELEASE khi `Sentry.init` không
# truyền `release` (hàm getRelease → getSentryRelease trong gói @sentry/node-core) — src/observability.ts
# đúng là không truyền, nên KHÔNG cần sửa mã để chỗ này có hiệu lực.
# Nhờ vậy stack trace đã ánh xạ về .ts (xem khối --enable-source-maps ở trên) còn gắn được vào ĐÚNG
# bản phát hành, tức Sentry gom nhóm và chỉ ra được "lỗi này mới có từ commit nào".
# Mặc định RỖNG → biến falsy → Sentry rơi về cơ chế tự dò cũ, KHÔNG đổi hành vi bản build nào không
# truyền tham số.
#
# CHƯA CÓ AI TRUYỀN: deploy.sh CỐ Ý không truyền, vì tests/b7-deploy-image-digest.test.js chốt lệnh
# build khớp đúng mẫu `compose -f <file> build app` và chèn cờ vào giữa sẽ làm đỏ cổng đó (lý do
# đầy đủ ghi ngay tại chỗ trong deploy.sh). Nên hôm nay đây là MỘT ĐIỂM MÓC dùng được bằng tay,
# chưa phải đường tự động:
#   docker build --build-arg SENTRY_RELEASE=$(git rev-parse HEAD) .
# ĐẶT SÁT CUỐI STAGE LÀ CỐ Ý: ARG này đổi theo TỪNG commit, nằm sớm hơn thì mọi lớp phía sau
# (apk add, COPY node_modules, phông chữ) mất cache và VM phải dựng lại từ đầu mỗi lượt deploy.
ARG SENTRY_RELEASE=""
ENV SENTRY_RELEASE=${SENTRY_RELEASE}

USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/bat-source-map"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3000/livez || exit 1
# MỘT artifact duy nhất cho Docker/Compose/Helm/k8s: `node dist/server.js`. Trước đây Dockerfile chạy
# `node --import tsx src/server.js` còn Helm/k8s chạy `node src/server.js` (file KHÔNG tồn tại) →
# pod chết vòng lặp. Nay cả bốn đường deploy gọi đúng một lệnh.
CMD ["node", "dist/server.js"]
