FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@10.28.1
COPY . .
RUN --mount=type=cache,id=swiftbuild-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store
ENV NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
RUN pnpm build

FROM build AS operations
RUN apk add --no-cache postgresql-client
USER node
CMD ["pnpm", "computation:worker"]

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
