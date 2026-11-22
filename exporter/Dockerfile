# syntax=docker/dockerfile:1
# qe-exporter container image (the QE Navigator Exporter).
#   build:  docker build -f exporter/Dockerfile -t qe-exporter:0.3.0 .     (from the repository root; the build context
#           is limited to exporter/ and the shared field allow-list by exporter/Dockerfile.dockerignore)
#   setup:  docker run --rm -it -p 127.0.0.1:8788:8788 -v qe-exporter:/var/lib/qe-exporter qe-exporter:0.3.0 setup
#           (the page listens on the container's interface; the port is published to 127.0.0.1 on your machine only)
#   run:    docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
#             -v qe-exporter:/var/lib/qe-exporter qe-exporter:0.3.0 preview        (then: sync)
#
# Runtime: distroless Node 20 (no shell, no package manager), user 65532 (nonroot), only the single
# bundled file /app/qe-exporter.mjs (no node_modules). The base images are pinned by digest; update the
# digests deliberately (see SECURITY.md, "Verifying the image").

# --- build: compile and test the bundle --------------------------------------------------------------
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build
WORKDIR /src/exporter
COPY exporter/package.json exporter/package-lock.json ./
# Dev dependencies only (esbuild, typescript, tsx, @types/node); no install scripts are run. Behind a
# TLS-inspecting proxy, pass its CA as a build secret: docker build --secret id=ca,src=/path/ca.pem .
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci --ignore-scripts --no-audit --no-fund
COPY exporter/tsconfig.json exporter/config.example.yaml ./
COPY exporter/scripts ./scripts
COPY exporter/src ./src
COPY exporter/test ./test
COPY server/lib/ingest/fieldAllowList.ts /src/server/lib/ingest/fieldAllowList.ts
RUN npx tsc --noEmit -p tsconfig.json \
 && node scripts/sync-allow-list.mjs --check \
 && node scripts/build.mjs \
 && node --import tsx --test --test-timeout=60000 test/*.test.ts \
 && mkdir -p /out/app /out/state && cp dist/qe-exporter.mjs dist/SHA256SUMS /out/app/ \
 && chmod 0444 /out/app/* && chmod 0555 /out/app

# --- runtime ---------------------------------------------------------------------------------------------
FROM gcr.io/distroless/nodejs20-debian12:nonroot@sha256:2cd820156cf039c8b54ae2d2a97e424b6729070714de8707a6b79f20d56f6a9a
LABEL org.opencontainers.image.title="qe-exporter" \
      org.opencontainers.image.description="QE Navigator Exporter: reads your CI, code quality, issue and incident tools inside your network and sends the raw data to QE Navigator as JSON over outbound HTTPS; QE Navigator calculates" \
      org.opencontainers.image.version="0.3.0"
# Owned by root and read-only: the Exporter cannot modify itself.
COPY --from=build --chown=0:0 /out/app /app
# The only writable path (mount a volume): the config the setup page writes, the credentials file (0600) and the state.
COPY --from=build --chown=65532:65532 /out/state /var/lib/qe-exporter
USER 65532:65532
ENV NODE_ENV=production QE_EXPORTER_CONFIG=/var/lib/qe-exporter/qe-exporter.json QE_EXPORTER_SETUP_IN_CONTAINER=1
WORKDIR /var/lib/qe-exporter
VOLUME ["/var/lib/qe-exporter"]
EXPOSE 8788
ENTRYPOINT ["/nodejs/bin/node", "/app/qe-exporter.mjs"]
CMD ["sync"]
