#!/bin/sh
# Sao lưu Postgres + khoá DataProtection lên S3 mỗi ngày (TEST-16: mã hoá file trước khi đẩy lên).
#
# Mã hoá bằng age với KHOÁ CÔNG KHAI (BACKUP_AGE_RECIPIENT=age1…): VPS chỉ giữ khoá công khai → ai đọc được bucket (kể cả chiếm được VPS)
# cũng không mở được bản sao lưu; khoá bí mật cất offline (máy chủ dự án / két). Tạo cặp khoá trên máy cá nhân:  age-keygen -o officehub-backup.key
#   (dòng "# public key: age1…" → BACKUP_AGE_RECIPIENT trong .env; file officehub-backup.key giữ riêng, KHÔNG để trên VPS).
# Khôi phục:  age -d -i officehub-backup.key 20261112T000000Z.dump.age > x.dump && pg_restore -d $PGDATABASE --clean x.dump
#             age -d -i officehub-backup.key keys-….tgz.age | tar -xz -C <thư mục .keys>
# Chưa đặt BACKUP_AGE_RECIPIENT: vẫn sao lưu DB (không mã hoá, cảnh báo) nhưng KHÔNG đẩy khoá DataProtection lên S3 — khoá đó ký cookie đăng nhập,
# lộ ra là giả được phiên của bất kỳ ai (mất khoá chỉ làm mọi người đăng nhập lại, không mất dữ liệu).
#
# Quyền S3: nên dùng access key RIÊNG chỉ có quyền ghi prefix backup (BACKUP_S3_ACCESS_KEY / BACKUP_S3_SECRET_KEY); trống → dùng key của app.
set -eu
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE=/tmp/officehub-$STAMP.dump

export AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY:-$S3__AccessKey}"
export AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY:-$S3__SecretKey}"
export AWS_DEFAULT_REGION="$S3__Region"
ENDPOINT=""
SSE="--sse AES256"   # mã hoá phía S3 (AWS); S3 tương thích khác (MinIO…) có thể không hỗ trợ → bỏ khi có ServiceUrl
[ -n "${S3__ServiceUrl:-}" ] && ENDPOINT="--endpoint-url $S3__ServiceUrl" && SSE=""
# Bucket có thể dùng chung với dự án khác → mọi thứ nằm dưới {S3__KeyPrefix}backup/
PREFIX="${S3__KeyPrefix:-}"; [ -n "$PREFIX" ] && PREFIX="${PREFIX%/}/"
DEST="s3://$S3__BucketBackup/${PREFIX}backup"
RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"

cleanup() { rm -f "$FILE" "$FILE.age" /tmp/keys-$STAMP.tgz /tmp/keys-$STAMP.tgz.age; }
trap cleanup EXIT

pg_dump -Fc -f "$FILE"
if [ -n "$RECIPIENT" ]; then
  age -r "$RECIPIENT" -o "$FILE.age" "$FILE"
  aws $ENDPOINT s3 cp $SSE "$FILE.age" "$DEST/db/$STAMP.dump.age"
  tar -czf /tmp/keys-$STAMP.tgz -C /keys .
  age -r "$RECIPIENT" -o /tmp/keys-$STAMP.tgz.age /tmp/keys-$STAMP.tgz
  aws $ENDPOINT s3 cp $SSE /tmp/keys-$STAMP.tgz.age "$DEST/keys/$STAMP.tgz.age"
  echo "[backup] OK $STAMP (age)"
else
  echo "[backup] CẢNH BÁO: chưa đặt BACKUP_AGE_RECIPIENT → DB không mã hoá, KHÔNG sao lưu khoá DataProtection (xem đầu infra/backup/backup.sh)" >&2
  aws $ENDPOINT s3 cp $SSE "$FILE" "$DEST/db/$STAMP.dump"
  echo "[backup] OK $STAMP (chưa mã hoá)"
fi
# Thời gian giữ bản sao lưu: cấu hình Lifecycle Rule trên bucket (ví dụ 30 ngày); nên bật Object Lock cho prefix backup.
