#!/bin/bash
# 로컬 플릿 노드 셋업 — 원격 맥 한 대를 «Pod 풀 ⊕ 시험 샤딩» 노드로 (MANUAL-local-fleet-node-setup).
#   bash scripts/fleet/node-setup.sh <호스트> [--check]
#   <호스트>  ssh 로 닿는 이름(예: node-b · node-c) — 이 맥에서 `ssh -o BatchMode=yes <호스트> true` 가 돼야 한다.
#   --check  아무것도 바꾸지 않고 상태만 본다(단계마다 ✓ · ✗ · → 할 일).
# ⭐ 단계마다 «이미 돼 있으면 건너뛴다» — 몇 번 돌려도 같은 결과(재현 가능한 셋업).
# ⛔ 원격의 다른 컨테이너·앱은 건드리지 않는다. 이 맥의 ~/.kube/config 는 바꾸기 전에 백업한다.
set -u
HOST="${1:?usage: node-setup.sh <host> [--check]}"; CHECK=0; [ "${2:-}" = "--check" ] && CHECK=1
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
K3S_IMAGE="${MONAD_FLEET_K3S_IMAGE:-rancher/k3s:v1.36.4-k3s1}"   # 풀의 모든 노드가 «같은 판» — 판이 갈리면 같은 Job 이 노드마다 다르게 돈다
API_PORT="${MONAD_FLEET_API_PORT:-6550}"
CLUSTER=monad-pool; CTX="pool-$HOST"
BUN_VER="$(bun --version 2>/dev/null)"                              # 이 맥과 같은 bun
unset HTTPS_PROXY https_proxy HTTP_PROXY http_proxy ALL_PROXY all_proxy
R() { ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "export PATH=\$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:\$HOME/.orbstack/bin:\$PATH HOMEBREW_NO_AUTO_UPDATE=1; unset HTTPS_PROXY https_proxy HTTP_PROXY http_proxy ALL_PROXY all_proxy; $1"; }
ok() { printf '  ✓ %s\n' "$1"; }; bad() { printf '  ✗ %s\n' "$1"; FAIL=1; }; todo() { printf '  → %s\n' "$1"; TODO=$((TODO+1)); }
FAIL=0; TODO=0
echo "▶ 노드 $HOST$([ $CHECK = 1 ] && echo ' (점검만)')"

# 1. ssh
R true >/dev/null 2>&1 && ok "ssh" || { bad "ssh 불통 — 이 맥에서 ssh 키·Tailscale 확인"; exit 1; }
# 2. brew · docker(OrbStack)
R 'command -v brew' >/dev/null && ok "brew" || bad "brew 없음 — https://brew.sh 로 먼저 설치(사람이)"
if R 'docker info --format "{{.ServerVersion}}"' >/dev/null 2>&1; then ok "docker $(R 'docker info --format "{{.ServerVersion}} cpu={{.NCPU}} mem={{.MemTotal}}"')"; else bad "docker 없음·꺼짐 — OrbStack 을 설치·실행(사람이 · ⛔ OrbStack 내장 k8s 는 NetworkPolicy 를 집행 안 한다 · k3d 를 쓴다)"; fi
# 3. bun — 이 맥과 «같은 판»(시험 샤딩은 판이 같아야 비교된다).
#    ⛔ 원격에 «다른 판» bun 이 이미 있으면 덮어쓰지 않는다(그 기계의 다른 일이 쓴다) — ~/.bun-<판> 에 나란히 둔다.
#    ⛔ 나란히 설치할 땐 설치기가 셸 설정에 PATH 를 덧붙여 기본 bun 을 가로채지 않게, 셸 설정 파일을 전후로 되돌린다.
FLEET_BUN="\$HOME/.bun-$BUN_VER/bin/bun"
have="$(R 'bun --version' 2>/dev/null)"; side="$(R "$FLEET_BUN --version" 2>/dev/null)"
if [ "$have" = "$BUN_VER" ]; then ok "bun $have (~/.bun)"
elif [ "$side" = "$BUN_VER" ]; then ok "bun $side (~/.bun-$BUN_VER · 기본 bun 은 ${have:-없음} 그대로)"
elif [ $CHECK = 1 ]; then todo "bun $BUN_VER 설치(기본 bun ${have:-없음} — $([ -n "$have" ] && echo '건드리지 않고 ~/.bun-'"$BUN_VER"' 에 나란히' || echo '~/.bun'))"
elif [ -z "$have" ]; then R "curl -fsSL https://bun.sh/install | bash -s bun-v$BUN_VER >/dev/null 2>&1"; [ "$(R 'bun --version')" = "$BUN_VER" ] && ok "bun $BUN_VER (설치 · ~/.bun)" || bad "bun 설치 실패"
else R "for f in .zshrc .bashrc .bash_profile .zprofile .profile .config/fish/config.fish; do [ -f \$HOME/\$f ] && cp -p \$HOME/\$f \$HOME/\$f.fleet-bak; done; curl -fsSL https://bun.sh/install | BUN_INSTALL=\$HOME/.bun-$BUN_VER bash -s bun-v$BUN_VER >/dev/null 2>&1; for f in .zshrc .bashrc .bash_profile .zprofile .profile .config/fish/config.fish; do [ -f \$HOME/\$f.fleet-bak ] && mv \$HOME/\$f.fleet-bak \$HOME/\$f; done"; [ "$(R "$FLEET_BUN --version")" = "$BUN_VER" ] && ok "bun $BUN_VER (설치 · ~/.bun-$BUN_VER · 기본 bun $have 그대로)" || bad "bun 나란히 설치 실패"; fi
# 4. Chrome (CDP 시험 레인 · 이 맥과 같은 조건)
if R 'test -d "/Applications/Google Chrome.app"'; then ok "Chrome"
elif [ $CHECK = 1 ]; then todo "Chrome 설치"
else R 'brew install --cask google-chrome >/tmp/fleet-chrome.log 2>&1' && ok "Chrome (설치)" || bad "Chrome 설치 실패 — 원격 /tmp/fleet-chrome.log"; fi
# 5. k3d
if R 'command -v k3d' >/dev/null; then ok "k3d $(R 'k3d version | head -1 | cut -d" " -f3')"
elif [ $CHECK = 1 ]; then todo "k3d 설치"
else R 'brew install k3d >/tmp/fleet-k3d.log 2>&1' && ok "k3d (설치)" || bad "k3d 설치 실패"; fi
# 6. 클러스터 monad-pool — API 를 0.0.0.0:<포트> 로 · 인증서 SAN = 호스트 이름 ⊕ tailnet 이름
TSNAME="$(R '(tailscale status --self --json 2>/dev/null || /Applications/Tailscale.app/Contents/MacOS/Tailscale status --self --json 2>/dev/null) | python3 -c "import json,sys;print(json.load(sys.stdin)[\"Self\"][\"DNSName\"].rstrip(\".\"))"' 2>/dev/null)"
if R "k3d cluster list $CLUSTER" >/dev/null 2>&1; then ok "클러스터 $CLUSTER"
elif [ $CHECK = 1 ]; then todo "클러스터 $CLUSTER 생성($K3S_IMAGE · API :$API_PORT · SAN $HOST ${TSNAME:-})"
else
  SAN="--k3s-arg --tls-san=$HOST@server:0"; [ -n "$TSNAME" ] && SAN="$SAN --k3s-arg --tls-san=$TSNAME@server:0"
  R "k3d cluster create $CLUSTER --image $K3S_IMAGE --no-lb --api-port 0.0.0.0:$API_PORT $SAN --wait --timeout 300s >/tmp/fleet-k3d-create.log 2>&1" && ok "클러스터 $CLUSTER (생성)" || { bad "클러스터 생성 실패 — 원격 /tmp/fleet-k3d-create.log"; exit 1; }
fi
# 7. 이 맥 kubeconfig 에 컨텍스트 pool-<호스트>
if kubectl config get-contexts -o name 2>/dev/null | grep -qx "$CTX"; then ok "kubeconfig 컨텍스트 $CTX"
elif [ $CHECK = 1 ]; then todo "kubeconfig 에 $CTX 추가"
else
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  R "k3d kubeconfig get $CLUSTER" > "$TMP/kc.yaml" || { bad "kubeconfig 못 받음"; exit 1; }
  python3 - "$TMP/kc.yaml" "$HOST" "$API_PORT" <<'PY'
import re, sys
p, host, port = sys.argv[1:]
s = open(p).read()
s = re.sub(r'server: https://[^\n]+', f'server: https://{host}:{port}', s)
s = s.replace('k3d-monad-pool', f'pool-{host}')
open(p, 'w').write(s)
PY
  cp ~/.kube/config ~/.kube/config.bak-fleet-"$HOST"-"$(date +%Y%m%d%H%M%S)"
  KUBECONFIG=~/.kube/config:"$TMP/kc.yaml" kubectl config view --flatten > "$TMP/merged.yaml" && chmod 600 "$TMP/merged.yaml" && mv "$TMP/merged.yaml" ~/.kube/config && ok "kubeconfig 컨텍스트 $CTX (추가 · 현재 컨텍스트는 그대로)" || bad "kubeconfig 병합 실패"
fi
# 8. 네임스페이스 ⊕ 격리 정책
if kubectl --context "$CTX" --request-timeout=10s get ns monad-test >/dev/null 2>&1; then ok "monad-test 네임스페이스"
elif [ $CHECK = 1 ]; then todo "base.yaml ⊕ policy-internet.yaml 적용"
else kubectl --context "$CTX" apply -f "$ROOT/docker/h1/base.yaml" -f "$ROOT/docker/h1/policy-internet.yaml" >/dev/null && ok "monad-test 네임스페이스 ⊕ 정책 (적용)" || bad "적용 실패"; fi
# 9. 판 대조 — k3s · 노드 준비
v="$(kubectl --context "$CTX" --request-timeout=10s get nodes -o jsonpath='{.items[0].status.nodeInfo.kubeletVersion}' 2>/dev/null)"
want="${K3S_IMAGE##*:}"; want="${want/-k3s/+k3s}"
[ "$v" = "$want" ] && ok "k3s $v" || bad "k3s ${v:-응답 없음} ≠ 기대 $want"
echo
if [ $FAIL = 0 ] && [ $TODO -gt 0 ]; then echo "→ $HOST 할 일 $TODO — --check 없이 다시 돌리면 채운다"; exit 2
elif [ $FAIL = 0 ]; then echo "✓ $HOST 준비됨 — 풀에 넣기: MONAD_POD_POOL='…,$CTX@$HOST:<상한>'"; else echo "✗ $HOST 미완 — 위 ✗ 를 먼저"; fi
exit $FAIL
