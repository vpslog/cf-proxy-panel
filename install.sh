#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="cf-proxy-panel Reality Installer"
PROJECT_REPO_URL="https://github.com/vpslog/cf-proxy-panel"
LOG_FILE="/var/log/subconvert-reality-install.log"
XRAY_CONFIG="/usr/local/etc/xray/config.json"
CLIENT_JSON="/usr/local/etc/xray/reality-client.json"
CLIENT_LINK="/usr/local/etc/xray/reality-client.txt"
XRAY_INSTALL_SCRIPT="/tmp/xray-install.sh"
XRAY_BIN="${XRAY_BIN:-}"

SERVER_IP="${SERVER_IP:-}"
REALITY_PORT="${REALITY_PORT:-443}"
REALITY_SNI="${REALITY_SNI:-www.amazon.com}"
REALITY_SHORT_ID="${REALITY_SHORT_ID:-88}"
REALITY_FINGERPRINT="${REALITY_FINGERPRINT:-chrome}"
SUBCONVERT_WEB_URL="${SUBCONVERT_WEB_URL:-}"
SUBCONVERT_TOKEN="${SUBCONVERT_TOKEN:-}"
SUBCONVERT_ALIAS="${SUBCONVERT_ALIAS:-}"
SUBCONVERT_SKIP_REGISTER="${SUBCONVERT_SKIP_REGISTER:-0}"
SUBCONVERT_NON_INTERACTIVE="${SUBCONVERT_NON_INTERACTIVE:-0}"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
info() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"; }
die() { red "错误: $*"; exit 1; }
command_exists() { command -v "$1" >/dev/null 2>&1; }

find_xray_bin() {
  if [[ -n "$XRAY_BIN" && -x "$XRAY_BIN" ]]; then
    printf '%s' "$XRAY_BIN"
    return
  fi

  if command_exists xray; then
    command -v xray
    return
  fi

  if [[ -x /usr/local/bin/xray ]]; then
    printf '%s' /usr/local/bin/xray
    return
  fi

  return 1
}

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    die "请使用 root 用户运行此脚本。"
  fi
}

detect_package_manager() {
  if command_exists apt-get; then
    PKG_UPDATE=(apt-get update -y)
    PKG_INSTALL=(apt-get install -y)
  elif command_exists dnf; then
    PKG_UPDATE=(dnf makecache)
    PKG_INSTALL=(dnf install -y)
  elif command_exists yum; then
    PKG_UPDATE=(yum makecache)
    PKG_INSTALL=(yum install -y)
  else
    die "未找到支持的包管理器，目前支持 apt、dnf、yum。"
  fi
}

install_dependencies() {
  info "安装基础依赖..."
  "${PKG_UPDATE[@]}"
  "${PKG_INSTALL[@]}" curl wget ca-certificates unzip uuid-runtime || "${PKG_INSTALL[@]}" curl wget ca-certificates unzip
}

install_xray() {
  if XRAY_BIN="$(find_xray_bin)" && "$XRAY_BIN" version >/dev/null 2>&1; then
    info "检测到已安装 Xray，跳过安装。"
    return
  fi

  info "安装 Xray..."
  curl -L --retry 3 --connect-timeout 20 --max-time 300 \
    "https://github.com/XTLS/Xray-install/raw/main/install-release.sh" \
    -o "$XRAY_INSTALL_SCRIPT"
  chmod +x "$XRAY_INSTALL_SCRIPT"
  bash "$XRAY_INSTALL_SCRIPT" install
  rm -f "$XRAY_INSTALL_SCRIPT"

  XRAY_BIN="$(find_xray_bin)" || die "Xray 安装失败。"
}

generate_uuid() {
  if [[ -r /proc/sys/kernel/random/uuid ]]; then
    cat /proc/sys/kernel/random/uuid
  elif command_exists uuidgen; then
    uuidgen
  else
    die "无法生成 UUID，请安装 uuid-runtime。"
  fi
}

generate_short_id() {
  if [[ -n "$REALITY_SHORT_ID" ]]; then
    printf '%s' "$REALITY_SHORT_ID"
    return
  fi

  openssl rand -hex 4 2>/dev/null || printf '88'
}

default_alias() {
  if [[ -n "$SUBCONVERT_ALIAS" ]]; then
    printf '%s' "$SUBCONVERT_ALIAS"
    return
  fi

  hostname 2>/dev/null || printf 'Reality-%s' "${SERVER_IP:-server}"
}

generate_reality_keys() {
  info "生成 Reality X25519 密钥..."
  local raw
  XRAY_BIN="$(find_xray_bin)" || die "未找到 Xray 可执行文件。"
  raw="$("$XRAY_BIN" x25519 2>&1)" || die "Reality 密钥生成命令执行失败: $raw"
  REALITY_PRIVATE_KEY="$(printf '%s\n' "$raw" | sed -nE 's/.*[Pp]rivate[[:space:]_-]*[Kk]ey[[:space:]]*:[[:space:]]*([^[:space:]]+).*/\1/p; s/.*[Pp]rivate[Kk]ey[[:space:]]*:[[:space:]]*([^[:space:]]+).*/\1/p' | head -n 1)"
  REALITY_PUBLIC_KEY="$(printf '%s\n' "$raw" | sed -nE 's/.*[Pp]ublic[[:space:]_-]*[Kk]ey[[:space:]]*:[[:space:]]*([^[:space:]]+).*/\1/p; s/.*Password([[:space:]]*\([^)]*\))?[[:space:]]*:[[:space:]]*([^[:space:]]+).*/\2/p' | tail -n 1)"

  [[ -n "$REALITY_PRIVATE_KEY" && -n "$REALITY_PUBLIC_KEY" ]] || die "Reality 密钥生成失败，原始输出: $raw"
}

detect_server_ip() {
  if [[ -n "$SERVER_IP" ]]; then
    return
  fi

  info "获取服务器公网 IP..."
  SERVER_IP="$(curl -fsS4 --connect-timeout 10 https://api.ipify.org || true)"
  if [[ -z "$SERVER_IP" ]]; then
    SERVER_IP="$(curl -fsS --connect-timeout 10 https://ifconfig.me || true)"
  fi

  [[ -n "$SERVER_IP" ]] || die "无法获取服务器公网 IP，可通过 SERVER_IP 环境变量指定。"
}

validate_port() {
  [[ "$REALITY_PORT" =~ ^[0-9]+$ ]] || die "端口必须是数字。"
  (( REALITY_PORT >= 1 && REALITY_PORT <= 65535 )) || die "端口必须在 1-65535 之间。"
}

ask_inputs() {
  local input
  local alias_default

  if [[ "$SUBCONVERT_NON_INTERACTIVE" == "1" ]]; then
    validate_port
    SUBCONVERT_ALIAS="$(default_alias)"
    if [[ "$SUBCONVERT_SKIP_REGISTER" != "1" && -z "$SUBCONVERT_WEB_URL" ]]; then
      die "无人值守安装需要提供 SUBCONVERT_WEB_URL，或设置 SUBCONVERT_SKIP_REGISTER=1。"
    fi
    if [[ "$SUBCONVERT_SKIP_REGISTER" != "1" && -z "$SUBCONVERT_TOKEN" ]]; then
      die "无人值守安装需要提供 SUBCONVERT_TOKEN，或设置 SUBCONVERT_SKIP_REGISTER=1。"
    fi
    info "无人值守模式：端口 ${REALITY_PORT}，SNI ${REALITY_SNI}，节点名称 ${SUBCONVERT_ALIAS}"
    return
  fi

  read -r -p "Reality 监听端口 [${REALITY_PORT}]: " input
  REALITY_PORT="${input:-$REALITY_PORT}"
  validate_port

  read -r -p "Reality SNI / dest 域名 [${REALITY_SNI}]: " input
  REALITY_SNI="${input:-$REALITY_SNI}"

  alias_default="$(default_alias)"
  read -r -p "节点名称 [${alias_default}]: " input
  SUBCONVERT_ALIAS="${input:-$alias_default}"

  if [[ "$SUBCONVERT_SKIP_REGISTER" != "1" ]]; then
    read -r -p "SubConvert Web 地址（留空则不自动提交）[${SUBCONVERT_WEB_URL}]: " input
    SUBCONVERT_WEB_URL="${input:-$SUBCONVERT_WEB_URL}"

    if [[ -n "$SUBCONVERT_WEB_URL" ]]; then
      read -r -s -p "SubConvert AUTH_TOKEN: " input
      printf '\n'
      SUBCONVERT_TOKEN="${input:-$SUBCONVERT_TOKEN}"
    fi
  fi
}

write_xray_config() {
  info "写入 Xray Reality 配置..."
  local uuid="$1"
  local short_id="$2"

  mkdir -p /usr/local/etc/xray
  if [[ -f "$XRAY_CONFIG" ]]; then
    cp "$XRAY_CONFIG" "${XRAY_CONFIG}.bak.$(date +%s)"
  fi

  cat > "$XRAY_CONFIG" <<EOF
{
  "log": {
    "loglevel": "warning"
  },
  "inbounds": [
    {
      "port": $REALITY_PORT,
      "protocol": "vless",
      "settings": {
        "clients": [
          {
            "id": "$uuid",
            "flow": "xtls-rprx-vision"
          }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "$REALITY_SNI:443",
          "xver": 0,
          "serverNames": [
            "$REALITY_SNI"
          ],
          "privateKey": "$REALITY_PRIVATE_KEY",
          "shortIds": [
            "$short_id"
          ]
        }
      }
    }
  ],
  "outbounds": [
    {
      "protocol": "freedom",
      "tag": "direct"
    },
    {
      "protocol": "blackhole",
      "tag": "blocked"
    }
  ]
}
EOF

  "$XRAY_BIN" run -test -config "$XRAY_CONFIG" >/dev/null
}

restart_xray() {
  info "启动 Xray 服务..."
  if command_exists systemctl; then
    systemctl enable xray >/dev/null 2>&1 || true
    systemctl restart xray
    systemctl is-active --quiet xray || die "Xray 服务启动失败。"
  else
    service xray restart
  fi
}

save_client_config() {
  local uuid="$1"
  local short_id="$2"
  REALITY_LINK="vless://${uuid}@${SERVER_IP}:${REALITY_PORT}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${REALITY_SNI}&fp=${REALITY_FINGERPRINT}&pbk=${REALITY_PUBLIC_KEY}&sid=${short_id}&type=tcp&headerType=none#${SUBCONVERT_ALIAS}"

  cat > "$CLIENT_JSON" <<EOF
{
  "alias": "$SUBCONVERT_ALIAS",
  "server": "$SERVER_IP",
  "port": $REALITY_PORT,
  "uuid": "$uuid",
  "flow": "xtls-rprx-vision",
  "network": "tcp",
  "security": "reality",
  "sni": "$REALITY_SNI",
  "fingerprint": "$REALITY_FINGERPRINT",
  "publicKey": "$REALITY_PUBLIC_KEY",
  "shortId": "$short_id",
  "link": "$REALITY_LINK"
}
EOF
  printf '%s\n' "$REALITY_LINK" > "$CLIENT_LINK"
}

register_to_subconvert() {
  if [[ "$SUBCONVERT_SKIP_REGISTER" == "1" || -z "$SUBCONVERT_WEB_URL" ]]; then
    yellow "已跳过自动提交到 SubConvert Web。"
    return
  fi

  [[ -n "$SUBCONVERT_TOKEN" ]] || die "已填写 SubConvert Web 地址，但缺少 AUTH_TOKEN。"

  local base_url="${SUBCONVERT_WEB_URL%/}"
  local payload
  payload="$(printf '{"alias":"%s","url":"%s","enabled":true}' \
    "$(printf '%s' "$SUBCONVERT_ALIAS" | sed 's/"/\\"/g')" \
    "$(printf '%s' "$REALITY_LINK" | sed 's/"/\\"/g')")"

  info "提交节点到 SubConvert Web..."
  local response_code
  response_code="$(curl -sS -o /tmp/subconvert-register-response.json -w '%{http_code}' \
    -X POST "${base_url}/store" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${SUBCONVERT_TOKEN}" \
    --data "$payload")"

  if [[ "$response_code" =~ ^2 ]]; then
    green "节点已自动添加到 SubConvert Web。"
  else
    yellow "自动提交失败，HTTP ${response_code}。Reality 已安装完成，可手动复制链接添加。"
    cat /tmp/subconvert-register-response.json 2>/dev/null || true
    printf '\n'
  fi
}

print_result() {
  green "Reality 安装完成"
  printf '\n'
  printf '节点名称: %s\n' "$SUBCONVERT_ALIAS"
  printf '服务器: %s\n' "$SERVER_IP"
  printf '端口: %s\n' "$REALITY_PORT"
  printf 'SNI: %s\n' "$REALITY_SNI"
  printf '客户端链接: %s\n' "$REALITY_LINK"
  printf '\n配置文件: %s\n链接文件: %s\n安装日志: %s\n' "$CLIENT_JSON" "$CLIENT_LINK" "$LOG_FILE"
}

main() {
  require_root
  mkdir -p "$(dirname "$LOG_FILE")"
  touch "$LOG_FILE"

  green "$APP_NAME"
  info "cf-proxy-panel by vpslog - ${PROJECT_REPO_URL}"
  detect_package_manager
  install_dependencies
  detect_server_ip
  ask_inputs
  install_xray
  generate_reality_keys

  local uuid short_id
  uuid="$(generate_uuid)"
  short_id="$(generate_short_id)"

  write_xray_config "$uuid" "$short_id"
  restart_xray
  save_client_config "$uuid" "$short_id"
  register_to_subconvert
  print_result
}

main "$@"
