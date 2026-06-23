# syntax=docker/dockerfile:1
# Panel WhatsApp multi-cuenta — imagen única: API Express sirve también el SPA.
# Multi-stage: build del cliente (Vite) + build del server (tsc) -> runtime slim.

# ---- 1. Build del cliente (Vite -> client/dist) ----
FROM node:20-bookworm-slim AS client
WORKDIR /app/client
# Vite hornea las VITE_* en build-time. Sin ellas el front entra en DEV MODE
# (login mock, sin Supabase). EasyPanel debe pasarlas como build args:
#   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (anon, no service), VITE_API_URL
#   VITE_API_URL = dominio público del panel (mismo origen) -> URL correcta del
#   webhook de Meta en la UI y llamadas absolutas al API.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_API_URL=$VITE_API_URL
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- 2. Build del server (tsc -> server/dist) ----
FROM node:20-bookworm-slim AS server-build
# Toolchain por si alguna dep nativa (bufferutil/utf-8-validate) necesita gyp.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# ---- 3. Runtime ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
# Sesiones de WhatsApp (baileys) en /data/auth -> montar volumen en /data
# para que sobrevivan a redeploys y no haya que re-escanear el QR.
ENV AUTH_BASE_PATH=/data/auth
WORKDIR /app

# Solo deps de producción.
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Artefactos compilados.
COPY --from=server-build /app/server/dist ./dist
COPY --from=client /app/client/dist ./public

# Carpeta de datos persistente (volumen) y permisos para el usuario node.
RUN mkdir -p /data/auth && chown -R node:node /data /app
USER node

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3001)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
