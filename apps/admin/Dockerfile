# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copier les fichiers de dépendances
COPY package.json package-lock.json ./
COPY apps/admin/package.json ./apps/admin/
COPY packages/ ./packages/

# Installer uniquement les dépendances admin
RUN npm ci --workspace=apps/admin --ignore-scripts

# Copier le code source
COPY apps/admin/ ./apps/admin/

WORKDIR /app/apps/admin

# Build Next.js
RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app/apps/admin

ENV NODE_ENV=production
ENV PORT=3000

# Copier les fichiers nécessaires depuis le builder
COPY --from=builder /app/apps/admin/.next/standalone ./
COPY --from=builder /app/apps/admin/.next/static ./.next/static
COPY --from=builder /app/apps/admin/public ./public
COPY --from=builder /app/apps/admin/src/data ./src/data

EXPOSE 3000

CMD ["node", "server.js"]
