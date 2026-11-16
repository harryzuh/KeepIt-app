#!/bin/sh
# Aplica o CORS de produção ao bucket (R2 ou qualquer S3) com UMA única origem: o domínio do app.
# Uso:  ORIGEM_APP=https://app.keepit.com.br S3_ENDPOINT=https://<conta>.r2.cloudflarestorage.com \
#       S3_BUCKET=keepit-fotos AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... sh infra/s3/aplicar-cors-producao.sh
# Com DRY_RUN=1 só imprime o JSON gerado (usado pelo teste e2e).
set -eu
: "${ORIGEM_APP:?defina ORIGEM_APP (ex.: https://app.keepit.com.br)}"
case "$ORIGEM_APP" in
  https://*) ;;
  *) echo "ORIGEM_APP deve começar com https://" >&2; exit 1 ;;
esac
case "$ORIGEM_APP" in
  *localhost*|*frontend:*|*\**) echo "ORIGEM_APP de produção não pode ser localhost, frontend ou curinga" >&2; exit 1 ;;
esac
DIR=$(dirname "$0")
JSON=$(sed "s#__ORIGEM_DO_APP__#$ORIGEM_APP#" "$DIR/cors.prod.json")
if [ "${DRY_RUN:-0}" = "1" ]; then echo "$JSON"; exit 0; fi
: "${S3_ENDPOINT:?defina S3_ENDPOINT}"
BUCKET="${S3_BUCKET:-keepit-fotos}"
TMP=$(mktemp)
echo "$JSON" > "$TMP"
aws --endpoint-url "$S3_ENDPOINT" s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "file://$TMP"
rm -f "$TMP"
