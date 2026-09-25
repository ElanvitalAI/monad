#!/usr/bin/env bash
# Install monadagent from this checkout, a local tarball, or a tarball URL.
#
# 🆕 2026-09-24 (결정 「sh 를 실행하면 알아서 설치되는 구조」) — claude·grok 의 네이티브 설치기와 같은 모양:
#   $PREFIX/versions/<version>[-<커밋12>]/ 판별 본체(각자 node_modules) ← 옛 판은 남는다(롤백 · 체크아웃 설치는 커밋이 이름)
#   $PREFIX/current  → versions/<version>                                ← 전환은 심링크 하나
#   $PREFIX/bin/monad → ../current/node_modules/.bin/monad               ← PATH 에 넣는 «고정» 경로
#   ⛔ 기본 PREFIX 는 상태 폴더(~/.monad)가 «아니다» — 설치물과 상태(auth·logs·worktrees)를 가른다.
#   bun 이 없으면 공식 설치기로 먼저 깐다(--no-bootstrap-bun 으로 끈다).
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/install.sh [--prefix PATH] [--source PATH.tgz|URL] [--no-modify-path] [--no-bootstrap-bun] [--help]
       curl -fsSL https://github.com/ElanvitalAI/monad/releases/latest/download/install.sh | bash

Install monadagent without contacting a package registry.
  --prefix PATH       installation root (default: $MONAD_INSTALL_PREFIX or ${XDG_DATA_HOME:-$HOME/.local/share}/monad)
                      layout: versions/<version>[-<commit12>]/ · current -> versions/… · bin/monad
                      (a checkout install names its folder by commit, so reinstalling keeps the previous one)
  --source PATH.tgz   install an existing local package tarball
  --source URL        download the package tarball (https://…/*.tgz) and install it
                      (or set $MONAD_INSTALL_SOURCE; without either, fetch the verified latest release)
  --no-modify-path    do not append the monad PATH block to a shell startup file
  --no-bootstrap-bun  fail instead of installing bun with its official installer when bun is missing
  --help, -h          show this help
EOF
}

shell_quote() {
  printf "'%s'" "${1//\'/\'\"\'\"\'}"
}

PREFIX="${MONAD_INSTALL_PREFIX:-${XDG_DATA_HOME:-${HOME:?HOME is required}/.local/share}/monad}"
SOURCE="${MONAD_INSTALL_SOURCE:-}"
MODIFY_PATH=1
BOOTSTRAP_BUN=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --prefix)
      [ "$#" -ge 2 ] || { echo "⛔ --prefix needs a path" >&2; exit 2; }
      PREFIX="$2"; shift 2 ;;
    --source)
      [ "$#" -ge 2 ] || { echo "⛔ --source needs a .tgz path" >&2; exit 2; }
      SOURCE="$2"; shift 2 ;;
    --no-modify-path) MODIFY_PATH=0; shift ;;
    --no-bootstrap-bun) BOOTSTRAP_BUN=0; shift ;;
    *) echo "⛔ unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# bun 이 없으면 공식 설치기로 먼저 깐다 — «sh 한 번이면 알아서» (claude·grok 설치기와 같은 기대).
# ⛔ 끄면(--no-bootstrap-bun) 공식 설치 명령을 안내하고 rc 127 로 멈춘다.
# 🩸 2026-09-24 빈 VM 실측: 비대화 셸(ssh 명령·크론)은 ~/.bun/bin 이 PATH 에 없어 «이미 깐» bun 을 못 보고 또 설치했다.
#    ⇒ 표준 위치에 있으면 그것을 쓴다.
if ! command -v bun >/dev/null 2>&1 && [ -x "${BUN_INSTALL:-$HOME/.bun}/bin/bun" ]; then
  export PATH="${BUN_INSTALL:-$HOME/.bun}/bin:$PATH"
fi
if ! command -v bun >/dev/null 2>&1 && [ "$BOOTSTRAP_BUN" -eq 1 ]; then
  # 🩸 2026-09-24 빈 GCP Ubuntu 24.04 실측: unzip 이 없어 bun 공식 설치기가 곧바로 죽고, 이 스크립트는 「bun 이 없다」만
  #    말했다. ⇒ 미리 보고 «칠 한 줄»을 댄다(패키지 매니저 권한은 사람 몫이라 대신 깔지 않는다).
  if ! command -v unzip >/dev/null 2>&1; then
    echo "⛔ bun's installer needs unzip, which is missing. Install it, then rerun this script:" >&2
    if command -v apt-get >/dev/null 2>&1; then echo "   sudo apt-get install -y unzip" >&2
    elif command -v dnf >/dev/null 2>&1; then echo "   sudo dnf install -y unzip" >&2
    elif command -v brew >/dev/null 2>&1; then echo "   brew install unzip" >&2
    else echo "   (install the 'unzip' package with your package manager)" >&2; fi
    exit 127
  fi
  if command -v curl >/dev/null 2>&1; then
    echo "bun not found — installing bun with its official installer (https://bun.sh/install)" >&2
    if curl -fsSL https://bun.sh/install | bash >&2; then
      export PATH="${BUN_INSTALL:-$HOME/.bun}/bin:$PATH"
    else
      echo "⚠️ bun bootstrap failed" >&2
    fi
  else
    echo "⚠️ bun bootstrap needs curl" >&2
  fi
fi

# Match doctor-distro.ts families when a required command is absent; do not source os-release as shell code.
required_command_hint() {
  local package="$1" id='' id_like='' version='' key value family='unknown' like
  if [ "$(uname -s)" = 'Darwin' ]; then
    family='darwin'
  elif [ "$(uname -s)" = 'Linux' ] && [ -r "${MONAD_INSTALL_OS_RELEASE_FILE:-/etc/os-release}" ]; then
    while IFS='=' read -r key value; do
      value="${value#\"}"; value="${value%\"}"
      value="${value#\'}"; value="${value%\'}"
      case "$key" in
        ID) id="$value" ;;
        ID_LIKE) id_like="$value" ;;
        VERSION_ID) version="$value" ;;
      esac
    done < "${MONAD_INSTALL_OS_RELEASE_FILE:-/etc/os-release}"
    if [ "$id" = 'amzn' ] && [ "$version" = '2' ]; then
      family='amzn2'
    elif [ "$id" = 'debian' ] || [ "$id" = 'ubuntu' ]; then
      family='debian'
    else
      for like in $id_like; do
        case "$like" in debian|ubuntu) family='debian'; break ;; esac
      done
      if [ "$family" = 'unknown' ]; then
        case "$id" in fedora|rhel|amzn) family='fedora' ;; esac
        for like in $id_like; do
          case "$like" in fedora|rhel) family='fedora' ;; esac
        done
      fi
    fi
  fi
  if [ "$package" = 'bun' ] && [ "$family" != 'unknown' ]; then
    echo '   curl -fsSL https://bun.sh/install | bash' >&2
    return
  fi
  case "$family" in
    debian) echo "   sudo apt-get install -y $package" >&2 ;;
    fedora) echo "   sudo dnf install -y $package" >&2 ;;
    amzn2) echo "   sudo yum install -y $package" >&2 ;;
    darwin) echo "   brew install $package" >&2 ;;
    *) echo "   (install the '$package' package with your package manager)" >&2 ;;
  esac
}

# Keep this explicit set aligned with catalog/external-commands.yaml required entries.
REQUIRED_COMMANDS=(git bun)
HARNESS_COMMANDS=(gh rg codex)
for command in "${REQUIRED_COMMANDS[@]}"; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "⛔ required command missing: $command. Install it, then rerun this script:" >&2
    required_command_hint "$command"
    exit 127
  fi
done
for command in "${HARNESS_COMMANDS[@]}"; do
  command -v "$command" >/dev/null 2>&1 || echo "⚠️ harness command missing: $command" >&2
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
TMP=""
cleanup() { [ -z "$TMP" ] || rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$PREFIX"
PREFIX="$(cd "$PREFIX" && pwd -P)"
if [ "$MODIFY_PATH" -eq 1 ]; then
  STARTUP="${MONAD_SHELL_STARTUP:-}"
  if [ -z "$STARTUP" ]; then
    case "${SHELL:-}" in
      */zsh) STARTUP="$HOME/.zshrc" ;;
      *) STARTUP="$HOME/.bashrc" ;;
    esac
  fi
  mkdir -p "$(dirname "$STARTUP")"
  touch "$STARTUP"
  MARKER_START='# >>> monad installer PATH >>>'
  MARKER_END='# <<< monad installer PATH <<<'
  PATH_LINE="export PATH=$(shell_quote "$PREFIX/bin"):\"\$PATH\""
  if grep -Fqx "$MARKER_START" "$STARTUP" && ! grep -Fqx "$PATH_LINE" "$STARTUP"; then
    echo "⛔ PATH block already points to a different installation prefix" >&2
    exit 1
  fi
  # bash 는 로그인 셸이 ~/.profile 을 읽고, ~/.bashrc 는 «비대화형이면 맨 앞에서 return» 한다(Debian 기본).
  # 🩸 2026-09-25 빈 debian:12 컨테이너: `bash -lc monad`(= ssh 원격 명령·스크립트) → command not found. 그래서 ~/.profile 에도 쓴다.
  LOGIN_STARTUP=""
  if [ -z "${MONAD_SHELL_STARTUP:-}" ] && [ "$STARTUP" = "$HOME/.bashrc" ]; then
    LOGIN_STARTUP="$HOME/.profile"
    touch "$LOGIN_STARTUP"
    if grep -Fqx "$MARKER_START" "$LOGIN_STARTUP" && ! grep -Fqx "$PATH_LINE" "$LOGIN_STARTUP"; then
      echo "⛔ PATH block in $LOGIN_STARTUP already points to a different installation prefix" >&2
      exit 1
    fi
  fi
fi

# A standalone installer fetches a verified release; explicit sources and checkouts keep their existing paths.
IS_CHECKOUT=0
if [ -f "$SCRIPT_DIR/install.sh" ] && [ -f "$REPO_ROOT/package.json" ] && grep -q '"name": *"monadagent"' "$REPO_ROOT/package.json" 2>/dev/null; then
  IS_CHECKOUT=1
fi
if [ -z "$SOURCE" ] && [ "$IS_CHECKOUT" -eq 0 ]; then
  RELEASE_BASE="${MONAD_RELEASE_BASE:-https://github.com/ElanvitalAI/monad/releases}"
  if [ -n "${MONAD_VERSION:-}" ]; then
    RELEASE_DIR="${RELEASE_BASE%/}/download/v${MONAD_VERSION}/"
  else
    RELEASE_DIR="${RELEASE_BASE%/}/latest/download/"
  fi
  PACKAGE_URL="${RELEASE_DIR}monadagent.tgz"
  CHECKSUM_URL="${RELEASE_DIR}SHA256SUMS"
  command -v curl >/dev/null 2>&1 || { echo "⛔ download failed: $PACKAGE_URL (curl missing)" >&2; exit 1; }
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/monad-install.XXXXXX")" || { echo "⛔ mktemp failed" >&2; exit 1; }
  curl -fsSL -o "$TMP/package.tgz" "$PACKAGE_URL" || { echo "⛔ download failed: $PACKAGE_URL" >&2; exit 1; }
  curl -fsSL -o "$TMP/SHA256SUMS" "$CHECKSUM_URL" || { echo "⛔ download failed: $CHECKSUM_URL" >&2; exit 1; }
  EXPECTED="$(awk '$2 == "monadagent.tgz" && $1 ~ /^[[:xdigit:]]+$/ && length($1) == 64 { print $1; exit }' "$TMP/SHA256SUMS")"
  [ -n "$EXPECTED" ] || { echo "⛔ checksum missing for monadagent.tgz: $CHECKSUM_URL" >&2; exit 1; }
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL="$(sha256sum "$TMP/package.tgz" | cut -d ' ' -f 1)"
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL="$(shasum -a 256 "$TMP/package.tgz" | cut -d ' ' -f 1)"
  else
    echo "⛔ SHA-256 verification needs sha256sum or shasum" >&2; exit 1
  fi
  [ "$(printf '%s' "$EXPECTED" | tr 'A-F' 'a-f')" = "$(printf '%s' "$ACTUAL" | tr 'A-F' 'a-f')" ] || { echo "⛔ checksum mismatch for $PACKAGE_URL: expected $EXPECTED actual $ACTUAL" >&2; exit 1; }
  METADATA_SOURCE="$PACKAGE_URL"
  INSTALL_TARBALL="$TMP/package.tgz"
  DOWNLOADED=1
fi

case "$SOURCE" in
  http://*|https://*)
    command -v curl >/dev/null 2>&1 || { echo "⛔ --source URL needs curl" >&2; exit 127; }
    TMP="$(mktemp -d "${TMPDIR:-/tmp}/monad-install.XXXXXX")" || { echo "⛔ mktemp failed" >&2; exit 1; }
    curl -fsSL -o "$TMP/package.tgz" "$SOURCE" || { echo "⛔ download failed: $SOURCE" >&2; exit 1; }
    METADATA_SOURCE="$SOURCE"
    INSTALL_TARBALL="$TMP/package.tgz"
    SOURCE=""
    DOWNLOADED=1
    ;;
esac

if [ "${DOWNLOADED:-0}" -eq 1 ]; then
  :
elif [ -n "$SOURCE" ]; then
  [ -f "$SOURCE" ] || { echo "⛔ source tarball missing: $SOURCE" >&2; exit 2; }
  TARBALL="$(cd "$(dirname "$SOURCE")" && pwd -P)/$(basename "$SOURCE")"
  METADATA_SOURCE="$TARBALL"
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/monad-install.XXXXXX")" || { echo "⛔ mktemp failed" >&2; exit 1; }
  INSTALL_TARBALL="$TMP/package.tgz"
  cp "$TARBALL" "$INSTALL_TARBALL"
else
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/monad-install.XXXXXX")" || { echo "⛔ mktemp failed" >&2; exit 1; }
  # 🆕 2026-09-24: 패키지가 PWA 빌드(apps/pwa/out/)를 싣는다 — 체크아웃에 빌드가 없으면 설치본에 웹 화면이 없다. 막지 않고 말한다.
  if [ ! -f "$REPO_ROOT/apps/pwa/out/index.html" ]; then
    echo "⚠ PWA build not found (apps/pwa/out/index.html) — the installed copy will have no web UI. Build it first: bun bin/monad.mjs nexus build" >&2
  fi
  (cd "$REPO_ROOT" && bun pm pack --destination "$TMP" >/dev/null)
  TARBALL="$(find "$TMP" -maxdepth 1 -type f -name '*.tgz' -print -quit)"
  [ -n "$TARBALL" ] || { echo "⛔ package tarball was not created" >&2; exit 1; }
  INSTALL_TARBALL="$TARBALL"
  METADATA_SOURCE="$REPO_ROOT"
  # Only a checkout install is this repo. A missing git or a failed
  # rev-parse stays an empty value, same as before — the install does not die.
  METADATA_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || true)"
  # 체크아웃 설치는 package.json 버전이 늘 같다 — 폴더를 «버전 ⊕ 짧은 커밋»으로 지어야 재설치가
  # 앞 판을 덮지 않는다(롤백 = current 심링크 하나). 추적 파일이 커밋과 다르면 `-dirty` 를 붙인다.
  if [ -n "$METADATA_COMMIT" ]; then
    VERSION_SUFFIX="-$(printf '%s' "$METADATA_COMMIT" | cut -c1-12)"
    if [ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no 2>/dev/null || true)" ]; then
      VERSION_SUFFIX="$VERSION_SUFFIX-dirty"
    fi
  fi
fi

# 버전을 «설치 전에» tarball 에서 읽는다 — 그래야 versions/<version>[-<커밋 12자>] 으로 곧장 깔고, 같은 판 재설치는
# 예전처럼 같은 폴더에 덮어쓴다(옛 판 폴더는 건드리지 않는다 = 롤백 가능).
PACKAGE_VERSION="$(tar -xzOf "$INSTALL_TARBALL" package/package.json 2>/dev/null | bun -e 'const t=await Bun.stdin.text(); try { process.stdout.write(String(JSON.parse(t).version ?? "")) } catch {}' || true)"
[ -n "$PACKAGE_VERSION" ] || { echo "⛔ package version missing in tarball: $INSTALL_TARBALL" >&2; exit 1; }
case "$PACKAGE_VERSION" in */*|*..*) echo "⛔ unsafe package version: $PACKAGE_VERSION" >&2; exit 1 ;; esac
VERSION_NAME="$PACKAGE_VERSION${VERSION_SUFFIX:-}"
VERSION_DIR="$PREFIX/versions/$VERSION_NAME"
mkdir -p "$VERSION_DIR"
if [ ! -f "$VERSION_DIR/package.json" ]; then
  printf '{"private":true}\n' > "$VERSION_DIR/package.json"
fi
# 🩸 2026-09-24 빈 GCP VM 실측: `--offline` 만 쓰면 bun 캐시가 빈 새 기계에서 의존성이 «전부» failed to resolve — 어떤
#    새 기계에서도 설치가 안 됐다(이 맥은 캐시가 차 있어 가려졌다). ⇒ 캐시로 먼저(빠르고 네트워크 없음) ⊕ 실패하면 레지스트리.
# 🩸 2026-09-24 빈 VM 실측: apt `nodejs npm` 이 있으면 PATH 의 node(v18)·node-gyp(9.3.0)가 node-pty 를 빌드해
#    bun 이 불러오는 순간 panic(uv_version_string)으로 죽었다. ⇒ 빌드 동안만 node=bun · node-gyp=최신 심을 PATH 앞에
#    (src/native/native-build-env.ts 와 같은 심).
NATIVE_SHIM="$(mktemp -d "${TMPDIR:-/tmp}/monad-native-build.XXXXXX")"
ln -s "$(command -v bun)" "$NATIVE_SHIM/node"
printf '#!/bin/sh\nexec "%s" x node-gyp@latest "$@"\n' "$(command -v bun)" > "$NATIVE_SHIM/node-gyp"
chmod +x "$NATIVE_SHIM/node-gyp"
if ! (cd "$VERSION_DIR" && PATH="$NATIVE_SHIM:$PATH" bun add --no-save --offline "$INSTALL_TARBALL" >/dev/null 2>&1); then
  echo "dependencies not in the local bun cache — fetching them from the npm registry" >&2
  (cd "$VERSION_DIR" && PATH="$NATIVE_SHIM:$PATH" bun add --no-save "$INSTALL_TARBALL")
fi
rm -rf "$NATIVE_SHIM"
ln -sfn "versions/$VERSION_NAME" "$PREFIX/current"
mkdir -p "$PREFIX/bin"
ln -sfn ../current/node_modules/.bin/monad "$PREFIX/bin/monad"
chmod +x "$PREFIX/bin/monad"
# monad 엔트리는 `#!/usr/bin/env bun` 이다 — bun 도 같은 bin 에 둬서 PATH 한 줄로 둘 다 잡히게 한다.
# 🩸 2026-09-25 빈 debian:12 컨테이너: bun 설치기는 ~/.bun/bin 을 ~/.bashrc 에만 써서(비대화형이면 안 읽힌다)
#    로그인 셸에서 monad 는 찾았는데 `/usr/bin/env: 'bun': No such file or directory` 로 죽었다.
ln -sfn "$(command -v bun)" "$PREFIX/bin/bun"

INSTALLED_PACKAGE="$PREFIX/current/node_modules/monadagent/package.json"
VERSION="$(bun -e 'const p=JSON.parse(await Bun.file(process.argv.at(-1)).text()); process.stdout.write(p.version)' "$INSTALLED_PACKAGE")"
[ -n "$VERSION" ] || { echo "⛔ package version missing: $INSTALLED_PACKAGE" >&2; exit 1; }
INSTALLED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
bun -e 'const [version,versionDir,source,installedAt,commit]=process.argv.slice(-5); console.log(JSON.stringify({version,versionDir,source,installedAt,...(commit ? {commit} : {})}))' \
  "$VERSION" "versions/$VERSION_NAME" "$METADATA_SOURCE" "$INSTALLED_AT" "${METADATA_COMMIT:-}" > "$PREFIX/install.json"
# 판 폴더에도 같은 것을 둔다 — `monad --version` 은 «자기 판»의 것을 읽는다(롤백한 판이 마지막 설치의 커밋을 말하지 않게).
cp "$PREFIX/install.json" "$VERSION_DIR/install.json"

# Darwin only: bun blocks dependency lifecycle scripts in the install prefix,
# so the repo postinstall chmod never reaches this copy of spawn-helper.
# Missing file or chmod failure must not fail the install.
if [ "$(uname -s)" = "Darwin" ]; then
  if [ -n "${MONAD_INSTALL_SPAWN_HELPER_CHMOD:-}" ]; then
    "$MONAD_INSTALL_SPAWN_HELPER_CHMOD" "$PREFIX"/current/node_modules/node-pty/prebuilds/*/spawn-helper 2>/dev/null || true
  else
    chmod +x "$PREFIX"/current/node_modules/node-pty/prebuilds/*/spawn-helper 2>/dev/null || true
  fi
fi

if [ "$MODIFY_PATH" -eq 1 ] && ! grep -Fqx "$MARKER_START" "$STARTUP"; then
  printf '\n%s\n%s\n%s\n' "$MARKER_START" "$PATH_LINE" "$MARKER_END" >> "$STARTUP"
fi
if [ "$MODIFY_PATH" -eq 1 ] && [ -n "${LOGIN_STARTUP:-}" ] && ! grep -Fqx "$MARKER_START" "$LOGIN_STARTUP"; then
  printf '\n%s\n%s\n%s\n' "$MARKER_START" "$PATH_LINE" "$MARKER_END" >> "$LOGIN_STARTUP"
fi

echo "Installed monad $VERSION at $PREFIX/bin/monad"

# ── 다음 걸음 (2026-09-23 · Phase 3 「사람 손」) ─────────────────────────
# ⛔ 설치가 끝나도 «무엇을 더 쳐야 하나»를 안 말하면, 빠뜨린 손이 나중에 «다른 원인의 얼굴»로 나타난다
#   (예: 로그인 누락이 quota-exhausted 로 분류됐다 — 09-21 실측). 그래서 «지금 상태»로 계산해 말한다.
#   provider 설정은 «안» 적는다 — 빈 config(auto)는 로그인만 있으면 런타임이 codex 로 고른다(#19950).
echo ""
echo "Next:"
STEP=1
case ":$PATH:" in
  *":$PREFIX/bin:"*) ;;
  *) if [ "$MODIFY_PATH" -eq 1 ]; then echo "  $STEP) open a new shell (or: source $STARTUP)"; else echo "  $STEP) add $PREFIX/bin to PATH"; fi; STEP=$((STEP + 1)) ;;
esac
if ! grep -q '"openai-codex"' "$HOME/.monad/auth.json" 2>/dev/null; then
  echo "  $STEP) monad login openai-codex        # ChatGPT subscription (device code, no API key)"; STEP=$((STEP + 1))
fi
# 🆕 2026-09-24 빈 VM 실측: 하니스(codex 백엔드)는 Codex CLI 를 자식으로 띄우는데 빈 기계엔 codex·node 가 «둘 다» 없었다.
#    ⚠️ 아래 설치 줄은 빈 기계에서 아직 «안 쟀다» — `monad doctor` 의 codex 줄이 판정한다.
if ! command -v codex >/dev/null 2>&1; then
  if ! command -v node >/dev/null 2>&1; then
    echo "  $STEP) install Node.js 20+ (the Codex CLI runs on node)   # e.g. your package manager or https://nodejs.org"; STEP=$((STEP + 1))
  fi
  echo "  $STEP) npm install -g @openai/codex      # the harness drives the Codex CLI (not yet measured on a fresh machine)"; STEP=$((STEP + 1))
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "  $STEP) install gh, then: gh auth login   # the harness opens pull requests with it"; STEP=$((STEP + 1))
elif ! gh auth status >/dev/null 2>&1; then
  echo "  $STEP) gh auth login                     # the harness opens pull requests with it"; STEP=$((STEP + 1))
fi
echo "  $STEP) monad harness say \"<one line of what you want>\""
echo "  check anytime: monad setup --non-interactive"
