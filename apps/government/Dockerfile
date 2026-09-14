# Plateau Citizen Identity & Data Exchange Platform - government portal
#
# Multi-stage, like the other two images: the runtime carries the standalone
# server, the traced dependencies and the static assets, and nothing else. No
# source, no build toolchain, and no database credential - the portal never
# talks to the database. Its only secrets are the key it seals an officer's
# session cookie with and the address of the API.
#
# Built from the repository root:
#   docker build -f apps/government/Dockerfile -t pcid-government-portal .

FROM node:22-bookworm-slim AS build
WORKDIR /build

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/government/package.json apps/government/
COPY packages/portal-kit/package.json packages/portal-kit/
COPY packages/contracts/package.json packages/contracts/
COPY packages/policy/package.json packages/policy/
COPY services/api/package.json services/api/
RUN npm ci --ignore-scripts

COPY packages/ packages/
COPY apps/government/ apps/government/
# A build must not need the runtime secret; the portal reads its configuration
# at the point of use, so this produces the same artefact on any machine.
RUN npm run build --workspace @pcid/government-portal

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    PORT=3200 \
    HOSTNAME=0.0.0.0
WORKDIR /app

COPY --from=build /build/apps/government/.next/standalone/ ./
COPY --from=build /build/apps/government/.next/static apps/government/.next/static

USER node
EXPOSE 3200

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3200)+'/sign-in').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/government/server.js"]
