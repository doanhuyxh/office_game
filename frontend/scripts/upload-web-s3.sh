#!/bin/sh
# Đẩy bản build FE lên S3 bucket web (lưu trữ / rollback). Chạy sau `bun run build`.
#   S3__BucketWeb=... S3__AccessKey=... S3__SecretKey=... S3__Region=... ./scripts/upload-web-s3.sh <version>
set -eu
VERSION=${1:-$(date -u +%Y%m%dT%H%M%SZ)}
export AWS_ACCESS_KEY_ID="$S3__AccessKey" AWS_SECRET_ACCESS_KEY="$S3__SecretKey" AWS_DEFAULT_REGION="$S3__Region"
ENDPOINT=""; [ -n "${S3__ServiceUrl:-}" ] && ENDPOINT="--endpoint-url $S3__ServiceUrl"
PREFIX="${S3__KeyPrefix:-}"; [ -n "$PREFIX" ] && PREFIX="${PREFIX%/}/"
DEST="s3://$S3__BucketWeb/${PREFIX}web/releases/$VERSION/"
aws $ENDPOINT s3 sync dist "$DEST" --delete
echo "Đã upload dist → $DEST"
