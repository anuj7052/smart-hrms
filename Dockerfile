# syntax=docker/dockerfile:1.7
# Multi-stage build: frontend (Vite) + backend (Express/Prisma) in one image.

# ─── Stage 1: frontend build ───────────────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --legacy-peer-deps
COPY frontend/ ./
# Vite reads VITE_* at build time; pass via --build-arg if needed
ARG VITE_AZURE_AD_CLIENT_ID
ARG VITE_AZURE_AD_TENANT_ID=common
ENV VITE_AZURE_AD_CLIENT_ID=$VITE_AZURE_AD_CLIENT_ID
ENV VITE_AZURE_AD_TENANT_ID=$VITE_AZURE_AD_TENANT_ID
RUN npm run build

# ─── Stage 2: backend build ────────────────────────────────────────────────
FROM node:20-alpine AS backend-build
WORKDIR /app/backend
COPY backend/package*.json ./
COPY backend/prisma ./prisma
RUN npm ci
COPY backend/ ./
RUN npx prisma generate && npm run build

# ─── Stage 3: runtime ──────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5000 \
    FRONTEND_DIST_PATH=/app/public

# Install production deps only
COPY backend/package*.json ./
COPY backend/prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force

# Copy compiled backend + built frontend
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=frontend-build /app/frontend/dist ./public

EXPOSE 5000
CMD ["node", "dist/src/server.js"]
