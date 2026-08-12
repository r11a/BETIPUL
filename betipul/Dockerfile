ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.22
FROM node:22-alpine AS web-builder
WORKDIR /build
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.html vite.config.js ./
COPY src ./src
RUN pnpm run build

FROM node:22-alpine AS server-dependencies
WORKDIR /build
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM ${BUILD_FROM}
ARG BUILD_VERSION=0.1.7
RUN apk add --no-cache ca-certificates nginx nodejs postgresql17 postgresql17-client su-exec
COPY --from=web-builder /build/dist /var/www/betipul
COPY --from=server-dependencies /build/node_modules /opt/betipul/node_modules
COPY server /opt/betipul/server
COPY migrations /opt/betipul/migrations
COPY package.json /opt/betipul/package.json
COPY rootfs /
RUN chmod +x /etc/services.d/nginx/run /etc/services.d/postgresql/run /etc/services.d/api/run && rm -f /etc/nginx/http.d/default.conf
LABEL io.hass.version="${BUILD_VERSION}" io.hass.type="app"
EXPOSE 8099 8787
