# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl
RUN corepack enable

# ---- deps: install all dependencies (incl. dev) for building ----
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# ---- build: compile TypeScript and generate the Prisma client ----
FROM base AS build
COPY package.json pnpm-lock.yaml* ./
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
RUN pnpm prisma generate
COPY . .
RUN pnpm build
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# ---- runtime: minimal image with only what's needed to run ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl
RUN addgroup -S app && adduser -S app -G app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./

USER app
EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
