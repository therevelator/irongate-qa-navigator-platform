# syntax=docker/dockerfile:1
# Fake vendors for trying the QE Navigator Exporter (TEST ONLY: made-up data, any non-empty token accepted).
# No RUN step in the runtime stage, so an arm64 image builds without emulation (docker buildx build --platform linux/arm64).
FROM --platform=$BUILDPLATFORM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS prep
RUN mkdir -p /out/shared && node -e "require('node:fs')"

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293
LABEL org.opencontainers.image.title="qe-fake-vendors" \
      org.opencontainers.image.description="TEST ONLY: made-up GitHub, GitLab, Bitbucket, Jira, PagerDuty and SonarQube APIs for trying the QE Navigator Exporter"
WORKDIR /app
COPY server.mjs ./
COPY --from=prep --chown=1000:1000 /out/shared /shared
USER node
ENV PORT=8080 HISTORY_DAYS=180 KPI_FILE=/shared/kpis.json
EXPOSE 8080
CMD ["node", "/app/server.mjs"]
