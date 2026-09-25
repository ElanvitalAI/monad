#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: upload_people_image_ref.sh <person-slug> <kind> <local-file> [--basename-name <name>] [--public-url] [--json]
example: upload_people_image_ref.sh kim-woohyeon business-card /path/to/card.jpg --public-url
EOF
}

if [ "$#" -lt 3 ]; then
  usage
  exit 1
fi

PERSON_SLUG="$1"
KIND="$2"
LOCAL_FILE="$3"
shift 3

BASENAME_OVERRIDE=""
PRINT_PUBLIC_URL=0
PRINT_JSON=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --basename-name)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --basename-name" >&2
        exit 1
      fi
      BASENAME_OVERRIDE="$2"
      shift 2
      ;;
    --public-url)
      PRINT_PUBLIC_URL=1
      shift
      ;;
    --json)
      PRINT_JSON=1
      shift
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [ ! -f "$LOCAL_FILE" ]; then
  echo "local file not found: $LOCAL_FILE" >&2
  exit 1
fi

BUCKET="${PEOPLE_IMAGE_BUCKET:-elanvital-public}"
PROFILE="${PEOPLE_IMAGE_AWS_PROFILE:-}"
REGION="${PEOPLE_IMAGE_AWS_REGION:-ap-northeast-2}"
BASENAME="${BASENAME_OVERRIDE:-$(basename "$LOCAL_FILE")}"
STAMP=$(date +%Y%m%d-%H%M%S)
KEY="people/${PERSON_SLUG}/${KIND}/${STAMP}-${BASENAME}"
S3_URI="s3://${BUCKET}/${KEY}"
PUBLIC_URL="https://${BUCKET}.s3.${REGION}.amazonaws.com/${KEY}"

if [ -n "$PROFILE" ]; then
  AWS_PROFILE="$PROFILE" AWS_REGION="$REGION" aws s3 cp "$LOCAL_FILE" "$S3_URI"
else
  AWS_REGION="$REGION" aws s3 cp "$LOCAL_FILE" "$S3_URI"
fi

if [ "$PRINT_JSON" -eq 1 ]; then
  python3 - "$BUCKET" "$REGION" "$KEY" "$S3_URI" "$PUBLIC_URL" "$KIND" "$PERSON_SLUG" "$LOCAL_FILE" <<'PY'
import json
import sys
bucket, region, key, s3_uri, public_url, kind, person_slug, local_file = sys.argv[1:9]
print(json.dumps({
  "bucket": bucket,
  "region": region,
  "key": key,
  "s3_uri": s3_uri,
  "public_url": public_url,
  "kind": kind,
  "person_slug": person_slug,
  "local_file": local_file,
}, ensure_ascii=False))
PY
elif [ "$PRINT_PUBLIC_URL" -eq 1 ]; then
  echo "$PUBLIC_URL"
else
  echo "$S3_URI"
fi
