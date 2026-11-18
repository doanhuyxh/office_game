#!/bin/sh
# Lệnh ép (forced command) cho khoá SSH của bot DevOps — bot KHÔNG có shell trên VPS, chỉ chạy được:
#   ssh officehub-deploy status   → commit đang chạy, trạng thái container, health
#   ssh officehub-deploy deploy   → khoá chống chạy song song → scripts/deploy.sh → commit trước / sau + health
# Dòng trong ~/.ssh/authorized_keys của user deploy trên VPS (đường dẫn repo clone, xem .agent/commands.md):
#   command="/opt/officehub/scripts/deploy-remote.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... officehub-devops-bot
# Mã thoát: 0 ok · 1 deploy / health lỗi · 2 lệnh không hợp lệ · 3 đang có deploy khác.
# Không in biến môi trường / nội dung .env (chỉ đọc đúng HTTP_PORT để gọi health).
set -u
umask 027

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
LOCK_FILE=/tmp/officehub-deploy.lock
LOG_FILE=${HOME:-/tmp}/officehub-deploy-remote.log
CMD=${SSH_ORIGINAL_COMMAND:-}

log() {
  # Mỗi lần gọi một dòng: thời gian UTC, nguồn SSH (IP), lệnh (cắt 200 ký tự, bỏ xuống dòng), exit code
  safe_cmd=$(printf '%s' "$CMD" | tr '\n\r\t' '   ' | cut -c1-200)
  from=${SSH_CLIENT:-local}
  printf '%s from=%s cmd="%s" exit=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${from%% *}" "$safe_cmd" "$1" >>"$LOG_FILE" 2>/dev/null || true
}

finish() {
  log "$1"
  exit "$1"
}

cd "$REPO_DIR" || { echo "Không vào được thư mục repo"; finish 1; }

compose() {
  docker compose --env-file .env -f infra/docker-compose.yml "$@"
}

commit_line() {
  git log -1 --format='%h %cd %s' --date=format:'%Y-%m-%d %H:%M' 2>/dev/null || echo "(không đọc được git)"
}

health() {
  port=$(sed -n 's/^HTTP_PORT=//p' .env 2>/dev/null | tail -n 1 | tr -d '"'"'"' \r')
  case "$port" in '' | *[!0-9]*) port=7080 ;; esac
  url="http://127.0.0.1:$port/health"
  if body=$(curl -fsS --max-time 10 "$url" 2>&1); then
    echo "Health: OK ($url) $body"
    return 0
  fi
  echo "Health: LỖI ($url) $body"
  return 1
}

do_status() {
  echo "Commit đang chạy: $(git rev-parse --short HEAD 2>/dev/null || echo '?')"
  echo "  $(commit_line)"
  echo "Container:"
  compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}' 2>&1 || echo "(docker compose ps lỗi)"
  health
}

do_deploy() {
  exec 9>"$LOCK_FILE" || { echo "Không mở được file khoá $LOCK_FILE"; return 1; }
  if ! flock -n 9; then
    echo "Đang có deploy khác chạy — thử lại sau."
    return 3
  fi
  echo "Trước: $(commit_line)"
  sh scripts/deploy.sh 9>&-
  rc=$?
  echo "Sau:   $(commit_line)"
  if [ "$rc" -ne 0 ]; then
    echo "scripts/deploy.sh lỗi (exit $rc)"
    return 1
  fi
  # Container vừa khởi động lại: chờ health tối đa ~60 giây
  i=0
  while [ "$i" -lt 12 ]; do
    if health >/dev/null; then break; fi
    i=$((i + 1))
    sleep 5
  done
  health
}

# Chỉ nhận đúng một từ, không tham số / ký tự nào khác
case "$CMD" in
  status)
    do_status
    finish $?
    ;;
  deploy)
    do_deploy
    finish $?
    ;;
  *)
    echo "Lệnh không được phép. Chỉ nhận: status | deploy" >&2
    finish 2
    ;;
esac
