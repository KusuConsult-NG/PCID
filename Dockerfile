# Plateau Citizen Identity & Data Exchange Platform - API service
#
# Multi-stage: the runtime image carries compiled JavaScript, production
# dependencies and the migration files, and nothing else. No source, no test
# fixtures, no build toolchain.

FROM node:22-bookworm-slim AS build
WORKDIR /build

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/policy/package.json packages/policy/
COPY services/api/package.json services/api/
RUN npm ci --ignore-scripts

COPY packages/ packages/
COPY services/ services/
RUN npm run build --workspaces --if-present

# Reduce to production dependencies only, after the build has used the dev ones.
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
# tini reaps zombies and forwards signals, so a rolling restart drains cleanly.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini postgresql-client \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app

COPY --from=build /build/node_modules node_modules
COPY --from=build /build/package.json package.json
COPY --from=build /build/packages/contracts/package.json packages/contracts/package.json
COPY --from=build /build/packages/contracts/dist packages/contracts/dist
COPY --from=build /build/packages/policy/package.json packages/policy/package.json
COPY --from=build /build/packages/policy/dist packages/policy/dist
COPY --from=build /build/services/api/package.json services/api/package.json
COPY --from=build /build/services/api/dist services/api/dist
COPY db/migrations db/migrations

# Never run as root. The image is read-only apart from /tmp in deployment.
USER node
EXPOSE 3000

# The platform declares its own readiness; the orchestrator should use the
# /api/v1/health/ready endpoint rather than this fallback.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "services/api/dist/main.js"]
