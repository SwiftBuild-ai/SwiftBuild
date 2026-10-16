FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@10.28.1
COPY . .
RUN --mount=type=cache,id=swiftbuild-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store
ENV NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
RUN pnpm build

FROM python:3.12.10-slim-bookworm AS backend-base
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl postgresql-common \
    && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
    && apt-get install -y --no-install-recommends postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/services/backend
COPY services/backend/requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock \
    && useradd --uid 10001 --create-home backend
COPY --chown=backend:backend services/backend/ ./

FROM backend-base AS operations
COPY --chown=backend:backend tooling/scripts/provision-server.sh /app/tooling/scripts/provision-server.sh
COPY --chown=backend:backend examples/ /app/examples/
USER backend
CMD ["python", "-m", "swiftbuild_backend.cli", "--help"]

FROM backend-base AS backend
USER backend
ENV SWIFTBUILD_BACKEND_HOST=0.0.0.0
EXPOSE 8001
HEALTHCHECK --interval=5s --timeout=5s --start-period=20s --retries=20 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/api/v1/ready', timeout=3)"
CMD ["python", "-m", "swiftbuild_backend"]

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
