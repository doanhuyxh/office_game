#!/bin/sh
# Deploy / cập nhật OfficeHub trên VPS:  cd /opt/officehub && sh scripts/deploy.sh
# Kéo code mới → build image → chạy lại container đã đổi → dọn cache build + image cũ (tiết kiệm ổ cứng).
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Thiếu /opt/officehub/.env (copy từ .env.pro)"; exit 1; }
C="docker compose --env-file .env -f infra/docker-compose.yml"

git pull --ff-only
# Phiên bản hiện ở trang Hệ thống → Vận hành (image backend + web)
GIT_SHA=$(git rev-parse --short HEAD)
BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
export GIT_SHA BUILD_TIME
$C build
$C up -d --remove-orphans
# SDK .NET / bun chỉ cần lúc build: xoá cache build + image không còn dùng (giữ image đang chạy)
docker builder prune -af >/dev/null
docker image prune -af >/dev/null
$C ps
docker system df
