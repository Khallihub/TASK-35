#!/bin/sh
# web-entrypoint.sh — Auto-generate self-signed TLS cert if none exists.
# This ensures the default deployment always starts with HTTPS enabled.

CERT_PATH="/etc/ssl/certs/harborstone.crt"
KEY_PATH="/etc/ssl/private/harborstone.key"

if [ ! -f "$CERT_PATH" ] || [ ! -f "$KEY_PATH" ]; then
  echo "[harborstone] No TLS certificate found — generating self-signed cert for local use..."
  mkdir -p /etc/ssl/certs /etc/ssl/private
  apk add --no-cache openssl >/dev/null 2>&1 || true
  openssl req -x509 -newkey rsa:2048 \
    -keyout "$KEY_PATH" \
    -out "$CERT_PATH" \
    -days 365 -nodes \
    -subj "/CN=localhost/O=HarborStone" \
    2>/dev/null
  echo "[harborstone] Self-signed certificate generated. Install $CERT_PATH in your browser/OS trust store to avoid warnings."
fi

# Start nginx
exec nginx -g 'daemon off;'
