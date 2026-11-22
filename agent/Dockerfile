# syntax=docker/dockerfile:1
# qe-agent container image.
#   build:  docker build -t qe-agent:0.1.0 .            (from agent/)
#   run:    docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
#             -v "$PWD/qe-agent.yaml:/etc/qe-agent/qe-agent.yaml:ro" -v qe-agent-state:/var/lib/qe-agent \
#             -e QE_API_KEY -e JIRA_TOKEN -e JIRA_EMAIL qe-agent:0.1.0 check
#
# Runtime: distroless Node 20 (no shell, no package manager), user 65532 (nonroot), only the single
# bundled file /app/qe-agent.mjs (no node_modules). The base images are pinned by digest; update the
# digests deliberately (see SECURITY.md, "Verifying the image").

# --- build: compile and test the bundle --------------------------------------------------------------
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build
WORKDIR /src
COPY package.json package-lock.json ./
# Dev dependencies only (esbuild, typescript, tsx, @types/node); no install scripts are run. Behind a
# TLS-inspecting proxy, pass its CA as a build secret: docker build --secret id=ca,src=/path/ca.pem .
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json config.example.yaml ./
COPY scripts ./scripts
COPY src ./src
COPY test ./test
RUN npx tsc --noEmit -p tsconfig.json \
 && node scripts/build.mjs \
 && node --import tsx --test --test-timeout=60000 test/*.test.ts \
 && mkdir -p /out/app /out/state && cp dist/qe-agent.mjs dist/SHA256SUMS /out/app/ \
 && chmod 0444 /out/app/* && chmod 0555 /out/app

# --- runtime ---------------------------------------------------------------------------------------------
FROM gcr.io/distroless/nodejs20-debian12:nonroot@sha256:2cd820156cf039c8b54ae2d2a97e424b6729070714de8707a6b79f20d56f6a9a
LABEL org.opencontainers.image.title="qe-agent" \
      org.opencontainers.image.description="QE Navigator on-premises agent: reads Jira, Linear, PagerDuty and Opsgenie inside your network and sends minimised records over outbound HTTPS" \
      org.opencontainers.image.version="0.1.0"
# Owned by root and read-only: the agent cannot modify itself.
COPY --from=build --chown=0:0 /out/app /app
# The only writable path (mount a volume): the state file with the cursors.
COPY --from=build --chown=65532:65532 /out/state /var/lib/qe-agent
USER 65532:65532
ENV NODE_ENV=production QE_AGENT_CONFIG=/etc/qe-agent/qe-agent.yaml
WORKDIR /var/lib/qe-agent
VOLUME ["/var/lib/qe-agent"]
ENTRYPOINT ["/nodejs/bin/node", "/app/qe-agent.mjs"]
CMD ["sync"]
