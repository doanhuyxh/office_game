# Build FE (React + Vite) thành image nginx.  Chạy từ gốc repo:
#   docker build -f frontend/Dockerfile -t officehub-web .
# Image pin theo digest (TEST-22): đổi phiên bản = cập nhật cả tag lẫn digest (docker buildx imagetools inspect <image:tag>)
FROM oven/bun:1@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS build
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

# nginx nhánh stable (1.28), không dùng mainline
FROM nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY frontend/nginx-security-headers-sameorigin.conf /etc/nginx/snippets/security-headers-sameorigin.conf
COPY --chmod=755 frontend/nginx-realip.sh /docker-entrypoint.d/40-realip.sh
COPY --from=build /src/frontend/dist /usr/share/nginx/html
