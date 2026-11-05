#!/bin/sh
# Chạy khi container web khởi động (/docker-entrypoint.d): sinh /etc/nginx/realip.conf từ TRUSTED_PROXY_IPS.
# Chỉ tin X-Forwarded-For khi request đến từ proxy tin cậy → lấy đúng IP người dùng, không giả mạo được.
#   TRUSTED_PROXY_IPS="203.0.113.10, 10.0.0.0/8"   (IP VPS chạy nginx proxy vào đây)
set -eu
out=/etc/nginx/realip.conf
{
  echo "real_ip_header X-Forwarded-For;"
  echo "real_ip_recursive on;"
  # Nginx trên chính máy này (qua cổng Docker)
  echo "set_real_ip_from 127.0.0.1;"
  echo "set_real_ip_from 172.16.0.0/12;"
  for ip in $(echo "${TRUSTED_PROXY_IPS:-}" | tr ',' ' '); do echo "set_real_ip_from $ip;"; done
} > "$out"
echo "realip: tin proxy ${TRUSTED_PROXY_IPS:-<chỉ local>}"
