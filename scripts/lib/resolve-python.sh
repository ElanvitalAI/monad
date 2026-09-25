#!/bin/sh
# 셸판 파이썬 해석기 — src/python/resolve-python.ts 와 «같은» 순서(RFC-doctor-fix-build-toolchain-and-python-by-distro A5).
#   ① $MONAD_PYTHON  ② monad venv  ③ pyenv 의 <저장소>/.python-version 판  ④ PATH 의 python3
# 사용: PY="${PY:-$(sh "$(dirname "$0")/lib/resolve-python.sh")}"   · 못 찾으면 빈 줄 ⊕ rc 1
# ⛔ bun 에 기대지 않는다 — 크론의 PATH(/usr/bin:/bin)에서도 돈다.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [ -n "${MONAD_PYTHON:-}" ] && [ -x "$MONAD_PYTHON" ]; then echo "$MONAD_PYTHON"; exit 0; fi
VENV="${XDG_DATA_HOME:-$HOME/.local/share}/monad/python/venv/bin/python"
if [ -x "$VENV" ]; then echo "$VENV"; exit 0; fi
if [ -f "$ROOT/.python-version" ]; then
  V="$(head -n 1 "$ROOT/.python-version" | tr -d '[:space:]')"
  P="${PYENV_ROOT:-$HOME/.pyenv}/versions/$V/bin/python3"
  if [ -n "$V" ] && [ -x "$P" ]; then echo "$P"; exit 0; fi
fi
if command -v python3 >/dev/null 2>&1; then command -v python3; exit 0; fi
echo ""; exit 1
