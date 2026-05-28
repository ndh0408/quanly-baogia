# syntax=docker/dockerfile:1.7

##### deps stage — install full deps including dev for prisma + build #####
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN apk add --no-cache openssl libc6-compat \
 && npm ci --include=dev \
 && npx prisma generate

##### runtime stage — slim production image #####
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NPM_CONFIG_PRODUCTION=true \
    PORT=3000

RUN apk add --no-cache openssl libc6-compat tini postgresql16-client \
 && addgroup -S app && adduser -S app -G app

# Copy hoisted production deps + generated Prisma client
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY package.json package-lock.json ./

# App sources
COPY src ./src
COPY public ./public
COPY templates ./templates

USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3000/livez || exit 1
CMD ["node", "src/server.js"]
