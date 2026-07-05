#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="cf-proxy-panel Installer"
PROJECT_REPO_URL="https://github.com/vpslog/cf-proxy-panel"
LOG_FILE="/var/log/cf-proxy-panel-install.log"
XRAY_CONFIG="/usr/local/etc/xray/config.json"
CLIENT_JSON="/usr/local/etc/xray/client.json"
CLIENT_LINK="/usr/local/etc/xray/client.txt"
XRAY_INSTALL_SCRIPT="/tmp/xray-install.sh"
XRAY_BIN="${XRAY_BIN:-}"

INSTALL_MODE="${INSTALL_MODE:-reality}"
SERVER_IP="${SERVER_IP:-}"
SUBCONVERT_WEB_URL="${SUBCONVERT_WEB_URL:-}"
SUBCONVERT_TOKEN="${SUBCONVERT_TOKEN:-}"
SUBCONVERT_ALIAS="${SUBCONVERT_ALIAS:-}"
SUBCONVERT_SKIP_REGISTER="${SUBCONVERT_SKIP_REGISTER:-0}"
SUBCONVERT_NON_INTERACTIVE="${SUBCONVERT_NON_INTERACTIVE:-1}"

REALITY_PORT="${REALITY_PORT:-443}"
REALITY_SNI="${REALITY_SNI:-www.amazon.com}"
REALITY_SHORT_ID="${REALITY_SHORT_ID:-88}"
REALITY_FINGERPRINT="${REALITY_FINGERPRINT:-chrome}"

WSS_DOMAIN="${WSS_DOMAIN:-}"
WSS_ROOT_DOMAIN="${WSS_ROOT_DOMAIN:-}"
WSS_PORT="${WSS_PORT:-443}"
WSS_LOCAL_PORT="${WSS_LOCAL_PORT:-8080}"
WSS_PATH="${WSS_PATH:-}"
CF_API_TOKEN="${CF_API_TOKEN:-}"
CF_ZONE_ID="${CF_ZONE_ID:-}"
CF_ACCOUNT_ID="${CF_ACCOUNT_ID:-}"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
info() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"; }
die() { red "错误: $*"; exit 1; }
command_exists() { command -v "$1" >/dev/null 2>&1; }

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

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
  "${PKG_INSTALL[@]}" curl wget ca-certificates unzip uuid-runtime openssl || "${PKG_INSTALL[@]}" curl wget ca-certificates unzip openssl

  if [[ "$INSTALL_MODE" == "wss" ]]; then
    "${PKG_INSTALL[@]}" nginx socat || die "Nginx 安装失败。"
  fi
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

random_path() {
  if [[ -n "$WSS_PATH" ]]; then
    printf '%s' "${WSS_PATH#/}"
    return
  fi

  openssl rand -hex 4 2>/dev/null || date +%s
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

  hostname 2>/dev/null || printf '%s-%s' "$INSTALL_MODE" "${SERVER_IP:-server}"
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
  local port="$1"
  [[ "$port" =~ ^[0-9]+$ ]] || die "端口必须是数字。"
  (( port >= 1 && port <= 65535 )) || die "端口必须在 1-65535 之间。"
}

require_registration_env() {
  if [[ "$SUBCONVERT_SKIP_REGISTER" != "1" && -z "$SUBCONVERT_WEB_URL" ]]; then
    die "无人值守安装需要提供 SUBCONVERT_WEB_URL，或设置 SUBCONVERT_SKIP_REGISTER=1。"
  fi
  if [[ "$SUBCONVERT_SKIP_REGISTER" != "1" && -z "$SUBCONVERT_TOKEN" ]]; then
    die "无人值守安装需要提供 SUBCONVERT_TOKEN，或设置 SUBCONVERT_SKIP_REGISTER=1。"
  fi
}

prepare_inputs() {
  INSTALL_MODE="$(printf '%s' "$INSTALL_MODE" | tr '[:upper:]' '[:lower:]')"
  [[ "$INSTALL_MODE" == "reality" || "$INSTALL_MODE" == "wss" ]] || die "INSTALL_MODE 仅支持 reality 或 wss。"

  validate_port "$REALITY_PORT"
  validate_port "$WSS_PORT"
  validate_port "$WSS_LOCAL_PORT"
  SUBCONVERT_ALIAS="$(default_alias)"
  require_registration_env

  if [[ "$INSTALL_MODE" == "wss" ]]; then
    [[ -n "$WSS_ROOT_DOMAIN" || -n "$WSS_DOMAIN" ]] || die "WSS 模式需要提供 WSS_ROOT_DOMAIN 或 WSS_DOMAIN。"
    [[ -n "$CF_API_TOKEN" ]] || die "WSS 模式需要提供 CF_API_TOKEN，用于自动创建 DNS 和申请证书。"
    WSS_DOMAIN="${WSS_DOMAIN:-${SERVER_IP}.${WSS_ROOT_DOMAIN}}"
    WSS_PATH="$(random_path)"
    info "无人值守模式：WSS 域名 ${WSS_DOMAIN}，端口 ${WSS_PORT}，路径 /${WSS_PATH}，节点名称 ${SUBCONVERT_ALIAS}"
    return
  fi

  info "无人值守模式：Reality 端口 ${REALITY_PORT}，SNI ${REALITY_SNI}，节点名称 ${SUBCONVERT_ALIAS}"
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

write_reality_config() {
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

cloudflare_api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  if [[ -n "$data" ]]; then
    curl -fsS -X "$method" "https://api.cloudflare.com/client/v4${path}" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$data"
  else
    curl -fsS -X "$method" "https://api.cloudflare.com/client/v4${path}" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json"
  fi
}

extract_json_value() {
  local key="$1"
  sed -nE "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*/\1/p" | head -n 1
}

ensure_cloudflare_dns() {
  info "配置 Cloudflare DNS：${WSS_DOMAIN} -> ${SERVER_IP}"
  local zone_name="${WSS_ROOT_DOMAIN:-$WSS_DOMAIN}"
  local zone_response zone_id record_response record_id payload

  if [[ -n "$CF_ZONE_ID" ]]; then
    zone_id="$CF_ZONE_ID"
    info "使用已提供的 Cloudflare Zone ID：${zone_id}"
  else
    zone_response="$(cloudflare_api GET "/zones?name=${zone_name}")" || die "Cloudflare Zone 查询失败。请在高级设置中填写 Zone ID，或给 Token 增加 Zone Read 权限。"
    zone_id="$(printf '%s' "$zone_response" | extract_json_value id)"
    [[ -n "$zone_id" ]] || die "未找到 Cloudflare Zone：${zone_name}"
  fi

  record_response="$(cloudflare_api GET "/zones/${zone_id}/dns_records?type=A&name=${WSS_DOMAIN}" || true)"
  record_id="$(printf '%s' "$record_response" | extract_json_value id || true)"
  payload="$(printf '{"type":"A","name":"%s","content":"%s","ttl":1,"proxied":true}' "$(json_escape "$WSS_DOMAIN")" "$(json_escape "$SERVER_IP")")"

  if [[ -n "$record_id" ]]; then
    cloudflare_api PUT "/zones/${zone_id}/dns_records/${record_id}" "$payload" >/dev/null || die "Cloudflare DNS 更新失败。"
  else
    if [[ -z "$record_response" ]]; then
      yellow "Cloudflare DNS 记录查询失败，尝试直接创建记录。若记录已存在，请给 Token 增加 DNS Read 权限或手动删除旧记录。"
    fi
    cloudflare_api POST "/zones/${zone_id}/dns_records" "$payload" >/dev/null || die "Cloudflare DNS 创建失败。"
  fi

  CF_ZONE_ID="$zone_id"
}

issue_wss_cert() {
  info "通过 Cloudflare DNS 申请 TLS 证书..."
  curl -fsSL https://get.acme.sh | sh -s email=admin@"${WSS_ROOT_DOMAIN:-$WSS_DOMAIN}" >/dev/null
  export CF_Token="$CF_API_TOKEN"
  export CF_Zone_ID="$CF_ZONE_ID"
  export CF_Account_ID="$CF_ACCOUNT_ID"
  mkdir -p "/etc/letsencrypt/live/${WSS_DOMAIN}"
  ~/.acme.sh/acme.sh --issue -d "$WSS_DOMAIN" --dns dns_cf --keylength ec-256 --force
  ~/.acme.sh/acme.sh --install-cert -d "$WSS_DOMAIN" --ecc \
    --fullchain-file "/etc/letsencrypt/live/${WSS_DOMAIN}/fullchain.pem" \
    --key-file "/etc/letsencrypt/live/${WSS_DOMAIN}/privkey.pem" \
    --reloadcmd "systemctl reload nginx >/dev/null 2>&1 || true"
}

write_wss_xray_config() {
  info "写入 Xray VMess WSS 配置..."
  local uuid="$1"

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
      "listen": "127.0.0.1",
      "port": $WSS_LOCAL_PORT,
      "protocol": "vmess",
      "settings": {
        "clients": [
          {
            "id": "$uuid",
            "alterId": 0
          }
        ]
      },
      "streamSettings": {
        "network": "ws",
        "wsSettings": {
          "path": "/$WSS_PATH"
        }
      }
    }
  ],
  "outbounds": [
    {
      "protocol": "freedom",
      "tag": "direct"
    }
  ]
}
EOF

  "$XRAY_BIN" run -test -config "$XRAY_CONFIG" >/dev/null
}

write_nginx_config() {
  info "写入 Nginx WSS 反代配置..."
  cat > /etc/nginx/conf.d/cf-proxy-panel-wss.conf <<EOF
server {
  listen 80;
  listen [::]:80;
  server_name ${WSS_DOMAIN};

  location / {
    return 301 https://\$host\$request_uri;
  }
}

server {
  listen ${WSS_PORT} ssl http2;
  listen [::]:${WSS_PORT} ssl http2;
  server_name ${WSS_DOMAIN};

  ssl_certificate /etc/letsencrypt/live/${WSS_DOMAIN}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${WSS_DOMAIN}/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_prefer_server_ciphers on;

  location / {
    default_type text/plain;
    return 200 "cf-proxy-panel by vpslog";
  }

  location /${WSS_PATH} {
    proxy_redirect off;
    proxy_pass http://127.0.0.1:${WSS_LOCAL_PORT};
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  }
}
EOF

  nginx -t
}

restart_services() {
  info "启动服务..."
  if command_exists systemctl; then
    systemctl enable xray >/dev/null 2>&1 || true
    systemctl restart xray
    systemctl is-active --quiet xray || die "Xray 服务启动失败。"

    if [[ "$INSTALL_MODE" == "wss" ]]; then
      systemctl enable nginx >/dev/null 2>&1 || true
      systemctl restart nginx
      systemctl is-active --quiet nginx || die "Nginx 服务启动失败。"
    fi
  else
    service xray restart
    [[ "$INSTALL_MODE" == "wss" ]] && service nginx restart
  fi
}

save_reality_client_config() {
  local uuid="$1"
  local short_id="$2"
  CLIENT_URL="vless://${uuid}@${SERVER_IP}:${REALITY_PORT}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${REALITY_SNI}&fp=${REALITY_FINGERPRINT}&pbk=${REALITY_PUBLIC_KEY}&sid=${short_id}&type=tcp&headerType=none#${SUBCONVERT_ALIAS}"

  cat > "$CLIENT_JSON" <<EOF
{
  "mode": "reality",
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
  "link": "$CLIENT_URL"
}
EOF
  printf '%s\n' "$CLIENT_URL" > "$CLIENT_LINK"
}

save_wss_client_config() {
  local uuid="$1"
  local vmess_json
  vmess_json="$(printf '{"v":"2","ps":"%s","add":"%s","port":"%s","id":"%s","aid":"0","scy":"auto","net":"ws","type":"none","host":"%s","path":"/%s","tls":"tls","sni":"%s"}' \
    "$(json_escape "$SUBCONVERT_ALIAS")" \
    "$(json_escape "$WSS_DOMAIN")" \
    "$(json_escape "$WSS_PORT")" \
    "$(json_escape "$uuid")" \
    "$(json_escape "$WSS_DOMAIN")" \
    "$(json_escape "$WSS_PATH")" \
    "$(json_escape "$WSS_DOMAIN")")"
  CLIENT_URL="vmess://$(printf '%s' "$vmess_json" | base64 | tr -d '\n')"

  cat > "$CLIENT_JSON" <<EOF
{
  "mode": "wss",
  "alias": "$SUBCONVERT_ALIAS",
  "server": "$WSS_DOMAIN",
  "port": $WSS_PORT,
  "uuid": "$uuid",
  "network": "ws",
  "security": "tls",
  "path": "/$WSS_PATH",
  "host": "$WSS_DOMAIN",
  "link": "$CLIENT_URL"
}
EOF
  printf '%s\n' "$CLIENT_URL" > "$CLIENT_LINK"
}

register_to_subconvert() {
  if [[ "$SUBCONVERT_SKIP_REGISTER" == "1" || -z "$SUBCONVERT_WEB_URL" ]]; then
    yellow "已跳过自动提交到 cf-proxy-panel。"
    return
  fi

  [[ -n "$SUBCONVERT_TOKEN" ]] || die "已填写 cf-proxy-panel 地址，但缺少 AUTH_TOKEN。"

  local base_url="${SUBCONVERT_WEB_URL%/}"
  local payload
  payload="$(printf '{"alias":"%s","url":"%s","enabled":true}' \
    "$(json_escape "$SUBCONVERT_ALIAS")" \
    "$(json_escape "$CLIENT_URL")")"

  info "提交节点到 cf-proxy-panel..."
  local response_code
  response_code="$(curl -sS -o /tmp/cf-proxy-panel-register-response.json -w '%{http_code}' \
    -X POST "${base_url}/store" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${SUBCONVERT_TOKEN}" \
    --data "$payload")"

  if [[ "$response_code" =~ ^2 ]]; then
    green "节点已自动添加到 cf-proxy-panel。"
  else
    yellow "自动提交失败，HTTP ${response_code}。安装已完成，可手动复制链接添加。"
    cat /tmp/cf-proxy-panel-register-response.json 2>/dev/null || true
    printf '\n'
  fi
}

print_result() {
  green "${INSTALL_MODE} 安装完成"
  printf '\n'
  printf '项目: cf-proxy-panel by vpslog\n'
  printf '仓库: %s\n' "$PROJECT_REPO_URL"
  printf '节点名称: %s\n' "$SUBCONVERT_ALIAS"
  printf '客户端链接: %s\n' "$CLIENT_URL"
  printf '\n配置文件: %s\n链接文件: %s\n安装日志: %s\n' "$CLIENT_JSON" "$CLIENT_LINK" "$LOG_FILE"
}

install_reality_mode() {
  generate_reality_keys
  local uuid short_id
  uuid="$(generate_uuid)"
  short_id="$(generate_short_id)"
  write_reality_config "$uuid" "$short_id"
  restart_services
  save_reality_client_config "$uuid" "$short_id"
}

install_wss_mode() {
  ensure_cloudflare_dns
  issue_wss_cert
  local uuid
  uuid="$(generate_uuid)"
  write_wss_xray_config "$uuid"
  write_nginx_config
  restart_services
  save_wss_client_config "$uuid"
}

main() {
  require_root
  mkdir -p "$(dirname "$LOG_FILE")"
  touch "$LOG_FILE"

  green "$APP_NAME"
  info "cf-proxy-panel by vpslog - ${PROJECT_REPO_URL}"
  detect_package_manager
  detect_server_ip
  prepare_inputs
  install_dependencies
  install_xray

  if [[ "$INSTALL_MODE" == "wss" ]]; then
    install_wss_mode
  else
    install_reality_mode
  fi

  register_to_subconvert
  print_result
}

main "$@"
