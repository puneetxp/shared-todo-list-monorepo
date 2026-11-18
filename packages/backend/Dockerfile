FROM node:20-alpine AS builder
WORKDIR /app

ENV NODE_OPTIONS="--max-old-space-size=256"

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/backend/tsconfig.json ./packages/backend/

RUN npm install --workspace=@shared-todo/backend

COPY packages/backend/src ./packages/backend/src
COPY packages/backend/sql ./packages/backend/sql

RUN npm run build --workspace=@shared-todo/backend && \
    npm prune --omit=dev --workspace=@shared-todo/backend

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=96"

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/backend/package.json ./packages/backend/
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/backend/sql ./packages/backend/sql

WORKDIR /app/packages/backend
EXPOSE 3001

CMD ["node", "dist/server.js"]
