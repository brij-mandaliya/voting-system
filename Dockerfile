# Single-service image: builds the API + the web bundle and serves both from
# one origin (required for the SameSite=strict session/CSRF cookies).
# syntax=docker/dockerfile:1

# ------------------------------- build stage --------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Prisma needs openssl both to generate and to run.
RUN apk add --no-cache openssl libc6-compat

# Install workspace dependencies first (best layer caching). Skip downloading
# Playwright browsers in the image — they are only needed for e2e tests.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
COPY web/package.json web/
COPY server/prisma ./server/prisma
RUN npm ci --no-audit --no-fund
RUN npx prisma generate --schema server/prisma/schema.prisma

# Copy sources and build shared types, the API, and the web bundle.
COPY packages/shared ./packages/shared
COPY server ./server
COPY web ./web
RUN npm run build

# ------------------------------ runtime stage -------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl libc6-compat

# node_modules holds the workspace symlink + the generated Prisma client/engine.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# @voting/shared ships TS source, so the API is executed with tsx (no emit).
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/server/src ./server/src
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/tsconfig.json ./server/tsconfig.json

# The built SPA served by the API at the same origin.
COPY --from=build /app/web/dist ./web/dist

EXPOSE 4000

# Fail fast on boot: apply migrations, ensure the first admin exists, then start.
CMD ["sh", "-c", "npx prisma migrate deploy --schema server/prisma/schema.prisma && npx tsx server/prisma/bootstrap-admin.ts && npx tsx server/src/index.ts"]
