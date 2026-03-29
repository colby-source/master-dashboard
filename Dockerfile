# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install server dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Install client dependencies
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm ci

# Copy source
COPY . .

# Build client (Vite) then server (TypeScript)
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy built server
COPY --from=builder /app/dist ./dist

# Copy built client into dist/ so __dirname-relative paths work
# (compiled server at dist/server/ uses ../client/dist which resolves to dist/client/dist)
COPY --from=builder /app/client/dist ./dist/client/dist

# Copy database schema and migrations into dist/ so __dirname-relative paths work
# (compiled server at dist/server/ uses ../database/ which resolves to dist/database/)
COPY database ./dist/database

# Create data directory for SQLite (Railway volume mounts here)
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Health check for Railway
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "dist/server/index.js"]
