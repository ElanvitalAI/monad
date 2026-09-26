import { encodeControlMemoFrame, type ControlMemoPayload } from './control-inbox.js';
import type { PodFragmentRecord } from './self-send-target.js';
import { defaultKubectl, type Kubectl } from '../task-orchestrator/surfaces/self-implement-pod.js';

const PUBLISH = `set -eu
inbox="$1"
kind="$2"
IFS= read -r line
mkdir -p "\${inbox}.ready"
if [ "$kind" = memo ]; then
  temp=$(mktemp "\${inbox}.ready/.write-XXXXXXXX")
  trap 'rm -f "$temp"' EXIT
  printf 'memo:%s\\n' "$line" > "$temp"
  mv "$temp" "\${inbox}.ready/record-$(printf '%016x' "$(date +%s%3N)")-$(cat /proc/sys/kernel/random/uuid)"
else
  temp=$(mktemp "\${inbox}.ready/.write-XXXXXXXX")
  trap 'rm -f "$temp"' EXIT
  printf 'stop\\n' > "$temp"
  ln "$temp" "\${inbox}.ready/stop" 2>/dev/null || test -f "\${inbox}.ready/stop"
  mkdir -p "$inbox"
  marker=$(mktemp "$inbox/.stop-requested-XXXXXXXX")
  trap 'rm -f "$temp" "$marker"' EXIT
  printf '{"version":1,"requestedAt":"%s"}\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$marker"
  ln "$marker" "$inbox/stop-requested.json" 2>/dev/null || test -f "$inbox/stop-requested.json"
fi`;

/** Publish a control-inbox record inside the child container, not on the host. */
export function sendPodControl(record: PodFragmentRecord, message: { stop: true } | { memo: ControlMemoPayload }, kubectl: Kubectl = defaultKubectl): void {
  const stop = 'stop' in message;
  const input = stop ? 'stop\n' : `${encodeControlMemoFrame(message.memo)}\n`;
  const result = kubectl([
    ...(record.context ? ['--context', record.context] : []), '-n', record.namespace,
    'exec', '-i', `job/${record.job}`, '-c', 'child', '--',
    'sh', '-c', PUBLISH, 'pod-control', record.inboxDir, stop ? 'stop' : 'memo',
  ], input);
  if (result.status !== 0) throw new Error(`Pod ${record.job} control send 실패: ${result.stderr.trim() || 'kubectl exec failed'}`);
}
