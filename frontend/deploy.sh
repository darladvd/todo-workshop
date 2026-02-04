#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./deploy.sh <S3_BUCKET_NAME> [CLOUDFRONT_DISTRIBUTION_ID]
#
# Examples:
#   ./deploy.sh my-todo-workshop-frontend-bucket
#   ./deploy.sh my-todo-workshop-frontend-bucket E123ABC456DEF

BUCKET="${1:-}"
DIST_ID="${2:-}"

if [[ -z "$BUCKET" ]]; then
  echo "❌ Missing bucket name."
  echo "Usage: ./deploy.sh <S3_BUCKET_NAME> [CLOUDFRONT_DISTRIBUTION_ID]"
  exit 1
fi

echo "🚀 Deploying frontend to s3://$BUCKET ..."

# Cache strategy:
# - index.html: no-cache (so updates show immediately)
# - other assets: cached (you can tweak)
aws s3 sync . "s3://$BUCKET" \
  --exclude ".DS_Store" \
  --delete

# Ensure index.html is always fresh
aws s3 cp "s3://$BUCKET/index.html" "s3://$BUCKET/index.html" \
  --metadata-directive REPLACE \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html"

echo "✅ S3 sync done."

if [[ -n "$DIST_ID" ]]; then
  echo "🌐 Creating CloudFront invalidation for /* ..."
  aws cloudfront create-invalidation \
    --distribution-id "$DIST_ID" \
    --paths "/*" >/dev/null
  echo "✅ Invalidation created."
else
  echo "ℹ️ No CloudFront distribution ID provided — skipping invalidation."
fi

echo "🎉 Deploy complete."
