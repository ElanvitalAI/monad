#!/bin/bash
if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <log-a> <log-b>" >&2
  exit 1
fi

LOG_A="$1"
LOG_B="$2"
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
LABEL_A="$(basename -- "$LOG_A" .log)"
LABEL_B="$(basename -- "$LOG_B" .log)"

echo "=== 1 base ==="
printf '%-14s ' "$LABEL_A"; command rg --no-config -o 'base=[^ ]*|NON-DEFAULT' -- "$LOG_A" 2>/dev/null | head -1; echo
printf '%-14s ' "$LABEL_B"; command rg --no-config -o 'base=[^ ]*|NON-DEFAULT' -- "$LOG_B" 2>/dev/null | head -1; echo

echo "=== 2 worktree ==="
printf '%-14s ' "$LABEL_A"; command rg --no-config -o 'self-impl-[a-z0-9-]*' -- "$LOG_A" 2>/dev/null | head -1; echo
printf '%-14s ' "$LABEL_B"; command rg --no-config -o 'self-impl-[a-z0-9-]*' -- "$LOG_B" 2>/dev/null | head -1; echo
echo "   위 둘이 같으면 그 실험은 이미 무효다"

echo "=== 3 child brain ==="
bun "$REPO_ROOT/bin/elanous.mjs" logs --event headless.spawn --since 10m --all --include-test --limit 6 --json --json-data 2>/dev/null \
  | jq -s -r '.[]|select(._meta==null)|"\(.data.runId[0:14])  childLlm=\(.data.childLlm|tojson)  tier=\(.data.escalateTier|tojson)"' | tail -3

echo "=== 4 orphan ==="
git -C "$REPO_ROOT" worktree list 2>/dev/null | command rg --no-config -c 'dev-pipeline-ts-src-self-de' || echo "0"
