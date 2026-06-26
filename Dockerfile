# syntax=docker/dockerfile:1.7
# NOTE: pin the base image by digest in production for reproducible builds, e.g.
#   FROM node:22-alpine@sha256:<digest> AS deps
# (kept as a tag here so local builds don't break on an unknown digest).

##### deps stage — PRODUCTION-ONLY deps + generated Prisma client #####
# `prisma` (the migrate CLI) is a runtime dependency in this project because
# k8s/helm/windows run `prisma migrate deploy` on startup, so --omit=dev keeps it
# while dropping eslint/vitest/supertest/coverage from the image.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN apk add --no-cache openssl libc6-compat \
 && npm ci --omit=dev \
 # Prisma 7: prisma.config.ts dùng env("DATABASE_URL") (throw nếu thiếu). `generate` KHÔNG kết nối DB
 # nên cấp URL GIẢ cho qua; runtime + migrate dùng DATABASE_URL THẬT (compose env).
 && DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate

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

RUN apk add --no-cache openssl libc6-compat tini postgresql16-client \
 && addgroup -S app && adduser -S app -G app

# Copy production-only node_modules + generated Prisma client
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY package.json package-lock.json prisma.config.ts ./

# App sources
COPY src ./src
COPY public ./public
COPY --from=webbuild /app/public/app2 ./public/app2
COPY templates ./templates

USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3000/livez || exit 1
# Chạy qua tsx: hỗ trợ .ts (backend đang chuyển dần sang TypeScript) lẫn .js cũ. tsx nằm
# trong dependencies nên có trong image production (npm ci --omit=dev).
CMD ["node", "--import", "tsx", "src/server.js"]
