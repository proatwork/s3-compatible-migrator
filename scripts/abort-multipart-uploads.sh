#!/bin/bash
set -euo pipefail

# Usage: S3_ENDPOINT=https://... AWS_PROFILE=my-profile ./scripts/abort-multipart-uploads.sh <bucket>
BUCKET="${1:?Usage: $0 <bucket>}"
ENDPOINT="${S3_ENDPOINT:?Set S3_ENDPOINT to the S3 endpoint URL of the bucket provider}"
AWS_PROFILE="${AWS_PROFILE:?Set AWS_PROFILE to the AWS CLI profile holding the bucket credentials}"

echo "Listing in-progress multipart uploads for bucket: $BUCKET"

UPLOADS=$(aws s3api list-multipart-uploads \
  --bucket "$BUCKET" \
  --endpoint-url "$ENDPOINT" \
  --profile "$AWS_PROFILE" \
  --output json)

COUNT=$(echo "$UPLOADS" | jq -r '.Uploads // [] | length')

if [ "$COUNT" -eq 0 ]; then
  echo "No in-progress multipart uploads found."
  exit 0
fi

echo "Found $COUNT in-progress multipart upload(s):"
echo "$UPLOADS" | jq -r '.Uploads[] | "  \(.Key) (UploadId: \(.UploadId), Initiated: \(.Initiated))"'
echo ""
read -p "Abort all $COUNT uploads? [y/N] " CONFIRM

if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

echo "$UPLOADS" | jq -r '.Uploads[] | "\(.Key)\t\(.UploadId)"' | \
while IFS=$'\t' read -r KEY UPLOAD_ID; do
  echo "Aborting: $KEY ($UPLOAD_ID)"
  aws s3api abort-multipart-upload \
    --bucket "$BUCKET" \
    --key "$KEY" \
    --upload-id "$UPLOAD_ID" \
    --endpoint-url "$ENDPOINT" \
    --profile "$AWS_PROFILE"
done

echo "Done. All multipart uploads aborted."
