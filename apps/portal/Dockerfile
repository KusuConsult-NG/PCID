# Plateau Citizen Identity & Data Exchange Platform - citizen portal
#
# Multi-stage, like the API image: the runtime carries the standalone server,
# the traced dependencies and the static assets, and nothing else. No source, no
# build toolchain, and no database credential - the portal never talks to the
# database. Its only secrets are the key it seals a resident's session cookie
# with and the address of the API.
#
# Built from the repository root:
#   docker build -f apps/portal/Dockerfile -t pcid-portal .

FROM node:22-bookworm-slim AS build
WORKDIR /build

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/portal/package.json apps/portal/
COPY packages/contracts/package.json packages/contracts/
COPY packages/policy/package.json packages/policy/
COPY services/api/package.json services/api/
RUN npm ci --ignore-scripts

COPY packages/ packages/
COPY apps/portal/ apps/portal/
# A build must not need the runtime secret; the portal reads its configuration
# at the point of use, so this produces the same artefact on any machine.
RUN npm run build --workspace @pcid/portal

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    PORT=3100 \
    HOSTNAME=0.0.0.0
WORKDIR /app

COPY --from=build /build/apps/portal/.next/standalone/ ./
COPY --from=build /build/apps/portal/.next/static apps/portal/.next/static

USER node
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/sign-in').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/portal/server.js"]
