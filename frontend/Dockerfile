# Build FE (React + Vite) thành image nginx.  Chạy từ gốc repo:
#   docker build -f frontend/Dockerfile -t officehub-web .
FROM oven/bun:1 AS build
WORKDIR /src
COPY shared/ ./shared/
COPY frontend/package.json frontend/bun.lock ./frontend/
WORKDIR /src/frontend
RUN bun install --frozen-lockfile
COPY frontend/ ./
# Phiên bản giao diện (trang Hệ thống → Vận hành) — scripts/deploy.sh truyền vào; Vite đọc VITE_* từ biến môi trường lúc build
ARG GIT_SHA=unknown
ARG BUILD_TIME=
ENV VITE_APP_COMMIT=$GIT_SHA \
    VITE_APP_BUILD_TIME=$BUILD_TIME
RUN bun run build

FROM nginx:1.29-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY frontend/nginx-security-headers-sameorigin.conf /etc/nginx/snippets/security-headers-sameorigin.conf
COPY --chmod=755 frontend/nginx-realip.sh /docker-entrypoint.d/40-realip.sh
COPY --from=build /src/frontend/dist /usr/share/nginx/html
