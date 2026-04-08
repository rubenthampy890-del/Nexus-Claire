# ─── Stage 1: Build Dashboard ───
FROM oven/bun:1 AS dashboard-builder
WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install
COPY dashboard/ .
RUN bun run build

# ─── Stage 2: Build Brain ───
FROM oven/bun:1 AS brain-builder
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install
COPY src/ src/
COPY roles/ roles/
COPY nexus.ts index.ts integrate.ts ./
COPY tsconfig.json ./

# ─── Stage 3: Production Image ───
FROM oven/bun:1-slim
WORKDIR /app

# Copy brain dependencies & source
COPY --from=brain-builder /app/node_modules ./node_modules
COPY --from=brain-builder /app/package.json ./
COPY --from=brain-builder /app/src ./src
COPY --from=brain-builder /app/roles ./roles
COPY --from=brain-builder /app/nexus.ts ./
COPY --from=brain-builder /app/index.ts ./
COPY --from=brain-builder /app/tsconfig.json ./

# Copy pre-built dashboard
COPY --from=dashboard-builder /app/dashboard/dist ./dashboard/dist

# Create persistent directories
RUN mkdir -p /app/vault /app/logs /app/tmp

# Expose ports
EXPOSE 18790 5173

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:18790').catch(() => process.exit(1))" || exit 1

# Environment
ENV NODE_ENV=production

# Start: Brain serves both WS and static dashboard
ENTRYPOINT ["bun", "run", "src/core/brain.ts"]
