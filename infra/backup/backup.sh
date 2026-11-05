#!/bin/sh
# Sao lưu Postgres + khoá DataProtection lên S3 mỗi ngày.
# Khôi phục: tải file .dump về rồi chạy  pg_restore -d $PGDATABASE --clean file.dump
set -eu
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE=/tmp/officehub-$STAMP.dump

export AWS_ACCESS_KEY_ID="$S3__AccessKey"
export AWS_SECRET_ACCESS_KEY="$S3__SecretKey"
export AWS_DEFAULT_REGION="$S3__Region"
ENDPOINT=""
[ -n "${S3__ServiceUrl:-}" ] && ENDPOINT="--endpoint-url $S3__ServiceUrl"
# Bucket có thể dùng chung với dự án khác → mọi thứ nằm dưới {S3__KeyPrefix}backup/
PREFIX="${S3__KeyPrefix:-}"; [ -n "$PREFIX" ] && PREFIX="${PREFIX%/}/"
DEST="s3://$S3__BucketBackup/${PREFIX}backup"

pg_dump -Fc -f "$FILE"
aws $ENDPOINT s3 cp "$FILE" "$DEST/db/$STAMP.dump"
tar -czf /tmp/keys-$STAMP.tgz -C /keys .
aws $ENDPOINT s3 cp /tmp/keys-$STAMP.tgz "$DEST/keys/$STAMP.tgz"
rm -f "$FILE" /tmp/keys-$STAMP.tgz
echo "[backup] OK $STAMP"
# Thời gian giữ bản sao lưu: cấu hình Lifecycle Rule trên bucket (ví dụ 30 ngày).
