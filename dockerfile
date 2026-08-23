# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1-alpine AS base
WORKDIR /usr/src/app

# install dependencies into temp directory
# this will cache them and speed up future builds
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lockb /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# install with --production (exclude devDependencies)
RUN mkdir -p /temp/prod
COPY package.json bun.lockb /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# curl-impersonate replays Chrome's BoringSSL ClientHello and nghttp2 SETTINGS
# frames. Cloudflare binds cf_clearance to that fingerprint, so stock curl (or
# Bun's fetch) gets the cookie invalidated on first use — see javdbClient.ts.
FROM base AS curlimp
ARG CURL_IMPERSONATE_VERSION=v2.0.0
ARG TARGETARCH
RUN apk add --no-cache curl tar
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) arch=x86_64 ;; \
      arm64) arch=aarch64 ;; \
      *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    mkdir -p /opt/curl-impersonate; \
    curl -fsSL -o /tmp/ci.tar.gz \
      "https://github.com/lexiforest/curl-impersonate/releases/download/${CURL_IMPERSONATE_VERSION}/curl-impersonate-${CURL_IMPERSONATE_VERSION}.${arch}-linux-musl.tar.gz"; \
    tar -xzf /tmp/ci.tar.gz -C /opt/curl-impersonate; \
    chmod +x /opt/curl-impersonate/curl-impersonate; \
    /opt/curl-impersonate/curl-impersonate --version

# copy node_modules from temp directory
# then copy all (non-ignored) project files into the image
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

# # [optional] tests & build
# ENV NODE_ENV=production
# RUN bun test
# RUN bun run build

# copy production dependencies and source code into final image
FROM base AS release
RUN apk add --no-cache ca-certificates
COPY --from=curlimp /opt/curl-impersonate/curl-impersonate /usr/local/bin/curl-impersonate
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /usr/src/app/src ./src
COPY --from=prerelease /usr/src/app/package.json .

ENV PORT=5000

# Liveness only: /health never touches javdb, so a stale caller cookie does not
# mark the container unhealthy. curl-impersonate is a full curl, reused here.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl-impersonate -fsS "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

USER bun
EXPOSE 5000/tcp
ENTRYPOINT [ "bun", "run", "src/index.ts" ]
