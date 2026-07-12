#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 root@host weave.example.com" >&2
  exit 64
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="$1"
DOMAIN="$2"
if [[ ! "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]; then
  echo "invalid DNS name: $DOMAIN" >&2
  exit 64
fi
SSH_ARGS=(-F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=yes)
BINARY="$ROOT/target/release/tessaryn-weave-node"

cargo build --release --locked -p tessaryn-weave-node --manifest-path "$ROOT/Cargo.toml"

ssh "${SSH_ARGS[@]}" "$HOST" \
  'id tessaryn-weave >/dev/null 2>&1 || useradd --system --home /var/lib/tessaryn --shell /usr/sbin/nologin tessaryn-weave; install -d -m 0700 -o tessaryn-weave -g tessaryn-weave /var/lib/tessaryn/weave; install -d -m 0755 /etc/tessaryn /etc/nginx/sites-available /etc/nginx/sites-enabled'

scp "${SSH_ARGS[@]}" "$BINARY" "$HOST:/usr/local/bin/tessaryn-weave-node.new"
scp "${SSH_ARGS[@]}" "$ROOT/infra/systemd/tessaryn-weave-node.service" \
  "$HOST:/etc/systemd/system/tessaryn-weave-node.service"
scp "${SSH_ARGS[@]}" "$ROOT/infra/nginx/tessaryn-weave-rate-limit.conf" \
  "$HOST:/etc/nginx/conf.d/tessaryn-weave-rate-limit.conf"
scp "${SSH_ARGS[@]}" "$ROOT/infra/nginx/tessaryn-weave.conf" \
  "$HOST:/etc/nginx/sites-available/tessaryn-weave.http.new"
scp "${SSH_ARGS[@]}" "$ROOT/infra/nginx/tessaryn-weave-tls.conf" \
  "$HOST:/etc/nginx/sites-available/tessaryn-weave.tls.new"
scp "${SSH_ARGS[@]}" "$ROOT/infra/systemd/weave.env.example" "$HOST:/etc/tessaryn/weave.env.new"

ssh "${SSH_ARGS[@]}" "$HOST" bash -s -- "$DOMAIN" <<'REMOTE'
set -euo pipefail
DOMAIN="$1"
install -m 0755 /usr/local/bin/tessaryn-weave-node.new /usr/local/bin/tessaryn-weave-node
rm -f /usr/local/bin/tessaryn-weave-node.new
if [[ -f /etc/tessaryn/weave.env ]]; then
  rm -f /etc/tessaryn/weave.env.new
else
  install -m 0600 -o root -g root /etc/tessaryn/weave.env.new /etc/tessaryn/weave.env
  rm -f /etc/tessaryn/weave.env.new
fi
sed -i "s#^TESSARYN_WEAVE_PUBLIC_URL=.*#TESSARYN_WEAVE_PUBLIC_URL=https://$DOMAIN#" /etc/tessaryn/weave.env
sed -i "s/__TESSARYN_WEAVE_DOMAIN__/$DOMAIN/g" \
  /etc/nginx/sites-available/tessaryn-weave.http.new \
  /etc/nginx/sites-available/tessaryn-weave.tls.new
if [[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  install -m 0644 /etc/nginx/sites-available/tessaryn-weave.tls.new \
    /etc/nginx/sites-available/tessaryn-weave
else
  install -m 0644 /etc/nginx/sites-available/tessaryn-weave.http.new \
    /etc/nginx/sites-available/tessaryn-weave
fi
rm -f /etc/nginx/sites-available/tessaryn-weave.http.new \
  /etc/nginx/sites-available/tessaryn-weave.tls.new
ln -sfn /etc/nginx/sites-available/tessaryn-weave /etc/nginx/sites-enabled/tessaryn-weave
systemd-analyze verify /etc/systemd/system/tessaryn-weave-node.service
nginx -t
systemctl daemon-reload
systemctl enable --now tessaryn-weave-node.service nginx
systemctl restart tessaryn-weave-node.service
for attempt in {1..30}; do
  if curl -fs http://127.0.0.1:8790/healthz >/dev/null; then
    exit 0
  fi
  sleep 0.2
done
systemctl status tessaryn-weave-node.service --no-pager -l >&2
exit 1
REMOTE

if ssh "${SSH_ARGS[@]}" "$HOST" test -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem"; then
  echo "Weave node installed; existing TLS certificate preserved for $DOMAIN."
else
  echo "Weave node installed. Issue TLS after $DOMAIN resolves to this host:"
  echo "  certbot --nginx -d $DOMAIN"
fi
