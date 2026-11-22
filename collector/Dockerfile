# syntax=docker/dockerfile:1
# qe-collector container image (the QE Navigator Collector).
#   build:  docker build -f collector/Dockerfile -t qe-collector:0.2.0 .     (from the repository root: the image
#           bundles collector/src and the shared calculation engine packages/engine/src; collector/Dockerfile.dockerignore
#           sends only those folders, the Collector's tests and the shared field allow-list to the build)
#   run:    docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
#             -v "$PWD/qe-collector.yaml:/etc/qe-collector/qe-collector.yaml:ro" -v qe-collector-state:/var/lib/qe-collector \
#             -e QE_API_KEY -e JIRA_TOKEN -e JIRA_EMAIL qe-collector:0.2.0 check
#
# Runtime: distroless Node 20 (no shell, no package manager), user 65532 (nonroot), only the single
# bundled file /app/qe-collector.mjs (no node_modules). The base images are pinned by digest; update the
# digests deliberately (see SECURITY.md, "Verifying the image").

# --- build: compile and test the bundle --------------------------------------------------------------
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build
WORKDIR /src/collector
COPY collector/package.json collector/package-lock.json ./
# Dev dependencies only (esbuild, typescript, tsx, @types/node); no install scripts are run. Behind a
# TLS-inspecting proxy, pass its CA as a build secret: docker build --secret id=ca,src=/path/ca.pem .
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci --ignore-scripts --no-audit --no-fund
COPY collector/tsconfig.json collector/config.example.yaml ./
COPY collector/scripts ./scripts
COPY collector/src ./src
COPY collector/test ./test
COPY packages/engine/package.json /src/packages/engine/package.json
COPY packages/engine/src /src/packages/engine/src
COPY packages/engine/test /src/packages/engine/test
COPY server/lib/ingest/fieldAllowList.ts /src/server/lib/ingest/fieldAllowList.ts
RUN npx tsc --noEmit -p tsconfig.json \
 && node scripts/sync-allow-list.mjs --check \
 && node --import tsx --test /src/packages/engine/test/*.test.ts \
 && node scripts/build.mjs \
 && node --import tsx --test --test-timeout=60000 test/*.test.ts \
 && mkdir -p /out/app /out/state && cp dist/qe-collector.mjs dist/SHA256SUMS /out/app/ \
 && chmod 0444 /out/app/* && chmod 0555 /out/app

# --- runtime ---------------------------------------------------------------------------------------------
FROM gcr.io/distroless/nodejs20-debian12:nonroot@sha256:2cd820156cf039c8b54ae2d2a97e424b6729070714de8707a6b79f20d56f6a9a
LABEL org.opencontainers.image.title="qe-collector" \
      org.opencontainers.image.description="QE Navigator Collector: reads your CI, SonarQube, Jira, Linear, PagerDuty and Opsgenie inside your network, calculates with QE Navigator's engine and sends results over outbound HTTPS" \
      org.opencontainers.image.version="0.2.0"
# Owned by root and read-only: the Collector cannot modify itself.
COPY --from=build --chown=0:0 /out/app /app
# The only writable path (mount a volume): the state file with the cursors and the local copy of the records.
COPY --from=build --chown=65532:65532 /out/state /var/lib/qe-collector
USER 65532:65532
ENV NODE_ENV=production QE_COLLECTOR_CONFIG=/etc/qe-collector/qe-collector.yaml
WORKDIR /var/lib/qe-collector
VOLUME ["/var/lib/qe-collector"]
ENTRYPOINT ["/nodejs/bin/node", "/app/qe-collector.mjs"]
CMD ["sync"]
