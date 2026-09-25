#!/bin/sh
# PX-4 P6 dogfood — mission evaluator.
#
# Reads the mission runtime's stdin JSON, extracts the `iteration`
# field with a simple grep (no jq dependency), and emits done=true
# once iteration >= 5.
#
# Contract:
#   stdin  : {"missionId": "...", "iteration": N, "lastResult": ..., ...}
#   stdout : {"done": true | false, "reason": "..."}

# Keep stdin so the next line can grep it.
INPUT=$(cat)

# Extract iteration value — look for the "iteration": number pattern.
# awk fallback avoids relying on GNU grep extensions.
ITER=$(echo "$INPUT" | awk 'match($0, /"iteration"[[:space:]]*:[[:space:]]*[0-9]+/) {
  s = substr($0, RSTART, RLENGTH);
  sub(/^.*:[[:space:]]*/, "", s);
  print s; exit
}')

# Default to 0 if the field could not be read.
if [ -z "$ITER" ]; then
  ITER=0
fi

if [ "$ITER" -ge 5 ]; then
  echo '{"done": true, "reason": "reached 5"}'
else
  printf '{"done": false, "reason": "iteration %s / 5"}\n' "$ITER"
fi
