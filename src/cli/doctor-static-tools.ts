// 🧰 elanous 소유 정적 도구 — 패키지 관리자에 «줄이 없는» 배포판에서 rg·codex·uv(→ 관리형 파이썬)를 sudo 없이 받는다.
//
// 계기(2026-09-25 · 대표 「AL2023·AL2 의 파이썬과 rg 는 사람이 아니라 무인으로」):
//   📏 빈 amazonlinux:2(glibc 2.26)·amazonlinux:2023 컨테이너에서 실측 —
//     · ripgrep 15.2.0 · codex 0.156.1 의 GitHub 릴리스 «정적 musl» 바이너리가 둘 다 돈다(codex 는 node 불필요).
//     · uv 0.12.18(정적 musl) → `uv python install 3.12` (python-build-standalone) 가 glibc 2.26 에서도 돈다(ssl·sqlite·venv).
//     · 그 파이썬으로 requirements 9개가 `pip --prefer-binary` 로 설치·import 된다(없으면 AL2 에서 sdist 빌드로 실패).
//   🌐 codex Linux 바이너리 = 정적 musl(openai/codex#41312 · #36160) · ripgrep 15.x 부터 aarch64 musl 도 배포.
// ⛔ 버전·다이제스트를 «고정»한다 — 최신을 따라가지 않는다(공급망). codex 는 릴리스에 sha256 이 없어(sigstore 만)
//    2026-09-25 에 받아 계산한 값을 박았다 · rg·uv 는 공식 `.sha256` 과 대조해 일치(MATCH)를 확인했다.
// ⛔ 제3자 저장소(COPR·GetPageSpeed 등)를 붙이지 않는다 — 원 저자(GitHub 릴리스)의 산출만.
// 이 모듈은 부작용을 주입받는다(run·파일) — 시험은 가짜 run 으로 누른다.

import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { managedPythonRoot } from '../python/resolve-python.js';

export type LinuxArch = 'x86_64' | 'aarch64';
export type StaticToolName = 'rg' | 'codex' | 'codex-code-mode-host' | 'uv' | 'gh';

export interface StaticToolSpec {
  name: StaticToolName;
  version: string;
  url: (arch: LinuxArch) => string;
  /** 타르 안 실행 파일 경로. */
  member: (arch: LinuxArch) => string;
  sha256: Record<LinuxArch, string>;
  /** 받은 뒤 «도는지» 확인할 인자 — null = 실행 확인 없음(서버형 바이너리 · sha256 만). 기본 ['--version']. */
  checkArgs?: readonly string[] | null;
}

export const STATIC_TOOLS: Record<StaticToolName, StaticToolSpec> = {
  rg: {
    name: 'rg',
    version: '15.2.0',
    url: (arch) => `https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-${arch}-unknown-linux-musl.tar.gz`,
    member: (arch) => `ripgrep-15.2.0-${arch}-unknown-linux-musl/rg`,
    sha256: {
      x86_64: '33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c',
      aarch64: '800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915',
    },
  },
  codex: {
    name: 'codex',
    version: '0.156.1',
    url: (arch) => `https://github.com/openai/codex/releases/download/rust-v0.156.1/codex-${arch}-unknown-linux-musl.tar.gz`,
    member: (arch) => `codex-${arch}-unknown-linux-musl`,
    sha256: {
      x86_64: 'aff46539a83aff86e3c62c592bce2c50d95391f9df289afaf03a50c01d14533d',
      aarch64: '558e12aaa6dacb335ec47240bf9721db8a54746806d64f01185a403f44f79b72',
    },
  },
  // 🩸 2026-09-25 L2 실측: codex 0.156 은 셸 도구를 «짝 바이너리» `codex-code-mode-host`(codex 옆)로 돌린다.
  //   릴리스 tarball 엔 codex 본체만 있어 `--version` 은 통과하고 실제 작업은 「shell tool failed to start」로 실패했다.
  //   ⇒ codex 를 깔면 이것도 «같이» 깐다(doctor-fix static-tools). brew cask 판은 실제 경로 옆에 이미 있다.
  'codex-code-mode-host': {
    name: 'codex-code-mode-host',
    version: '0.156.1',
    url: (arch) => `https://github.com/openai/codex/releases/download/rust-v0.156.1/codex-code-mode-host-${arch}-unknown-linux-musl.tar.gz`,
    member: (arch) => `codex-code-mode-host-${arch}-unknown-linux-musl`,
    sha256: {
      x86_64: 'a929daa9f6a0bddc00c0c9e6402df117b125acd96f9d554f6c99c32c7e66c608',
      aarch64: '40198138b03798ffa8c0da4c827a8ca5896774ea104b7110c2a2c0c7560cbe94',
    },
    checkArgs: null,
  },
  // 🩸 2026-09-25: 배포판 gh 가 낡으면(Ubuntu 24.04 apt = 2.45.0) 하니스 PR 생성이 실패한다(doctor-readiness GH_MIN_VERSION).
  //   공식 릴리스 체크섬 파일(gh_2.101.0_checksums.txt)과 대조한 값을 고정했다. 릴리스 아키 이름은 amd64/arm64.
  gh: {
    name: 'gh',
    version: '2.101.0',
    url: (arch) => `https://github.com/cli/cli/releases/download/v2.101.0/gh_2.101.0_linux_${arch === 'x86_64' ? 'amd64' : 'arm64'}.tar.gz`,
    member: (arch) => `gh_2.101.0_linux_${arch === 'x86_64' ? 'amd64' : 'arm64'}/bin/gh`,
    sha256: {
      x86_64: '9bca2d1c16825f109907a23307628a2f0698fbf99662b73a5cf0b020293072b8',
      aarch64: 'b57e8063f18862647c9d22727c32e9da1b963f8bf9db648fe123a6975695640f',
    },
  },
  uv: {
    name: 'uv',
    version: '0.12.18',
    url: (arch) => `https://github.com/astral-sh/uv/releases/download/0.12.18/uv-${arch}-unknown-linux-musl.tar.gz`,
    member: (arch) => `uv-${arch}-unknown-linux-musl/uv`,
    sha256: {
      x86_64: 'e38d97460b98ebfd31b197de0fe9fa578add4bc8ba0179b203dd3f87b99f98e6',
      aarch64: '0796973fb3eea8095078c3d0659bd17a5f6789a71b8dd85caff2483178f78ac3',
    },
  },
};

/** node `process.arch` → 릴리스 아키 이름. 모르는 아키는 null(추측하지 않는다). */
export function linuxArch(arch: string = process.arch): LinuxArch | null {
  if (arch === 'x64') return 'x86_64';
  if (arch === 'arm64') return 'aarch64';
  return null;
}

/** elanous 데이터 뿌리(`~/.local/share/elanous` · 설치기 PREFIX 와 같은 규칙). */
export function elanousDataRoot(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const prefix = env.ELANOUS_INSTALL_PREFIX?.trim();
  if (prefix) return prefix;
  return join(env.XDG_DATA_HOME?.trim() || join(home, '.local', 'share'), 'elanous');
}

/** 설치기가 PATH 에 넣는 폴더 — rg·codex 를 여기 두면 하니스가 PATH 로 찾는다. */
export function staticToolBinDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return join(elanousDataRoot(env, home), 'bin');
}

/** uv 는 PATH 에 두지 않는다(elanous 내부 도구). */
export function uvPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return join(elanousDataRoot(env, home), 'tools', 'uv');
}


export interface StaticToolDeps {
  run?: (command: string, args: readonly string[], env?: NodeJS.ProcessEnv) => { status: number | null; stderr: string; stdout?: string };
  readFile?: (path: string) => Buffer;
  tempDir?: () => string;
}

function defaultRun(command: string, args: readonly string[], env?: NodeJS.ProcessEnv) {
  const r = spawnSync(command, [...args], { encoding: 'utf8', timeout: 600_000, ...(env ? { env } : {}) });
  return { status: r.status, stderr: (r.stderr ?? '') + (r.error ? String(r.error) : ''), stdout: r.stdout ?? '' };
}

export interface StaticToolResult { ok: boolean; path: string; detail: string }

/** 받기 → sha256 대조 → 풀기 → 목적지로(원자적 rename) → 실행 확인. 하나라도 틀리면 목적지를 건드리지 않는다. */
export function installStaticTool(name: StaticToolName, arch: LinuxArch, dest: string, deps: StaticToolDeps = {}): StaticToolResult {
  const spec = STATIC_TOOLS[name];
  const run = deps.run ?? defaultRun;
  const work = (deps.tempDir ?? (() => mkdtempSync(join(tmpdir(), 'elanous-static-tool-'))))();
  try {
    const tarball = join(work, 'pkg.tar.gz');
    const got = run('curl', ['-fsSL', '--retry', '2', '-o', tarball, spec.url(arch)]);
    if (got.status !== 0) return { ok: false, path: dest, detail: `download failed (${spec.url(arch)}): ${got.stderr.trim().split('\n').at(-1) ?? got.status}` };
    const digest = createHash('sha256').update((deps.readFile ?? readFileSync)(tarball)).digest('hex');
    if (digest !== spec.sha256[arch]) return { ok: false, path: dest, detail: `sha256 mismatch for ${name} ${spec.version} ${arch}: got ${digest}` };
    const untar = run('tar', ['-xzf', tarball, '-C', work, spec.member(arch)]);
    if (untar.status !== 0) return { ok: false, path: dest, detail: `tar failed: ${untar.stderr.trim().split('\n').at(-1) ?? untar.status}` };
    const extracted = join(work, spec.member(arch));
    mkdirSync(join(dest, '..'), { recursive: true });
    const staging = `${dest}.elanous-new`;
    copyFileSync(extracted, staging);
    chmodSync(staging, 0o755);
    const checkArgs = spec.checkArgs === undefined ? ['--version'] : spec.checkArgs;
    const check = checkArgs === null ? { status: 0, stderr: '' } : run(staging, checkArgs);
    if (check.status !== 0) { rmSync(staging, { force: true }); return { ok: false, path: dest, detail: `${name} --version failed after download: ${check.stderr.trim().split('\n').at(-1) ?? check.status}` }; }
    renameSync(staging, dest);
    return { ok: true, path: dest, detail: `${name} ${spec.version} (${arch}, sha256 verified) → ${dest}` };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** uv 로 관리형 파이썬(major.minor)을 받는다. 반환 = 그 파이썬 경로(못 받으면 null + 이유). */
export function installManagedPython(minor: string, deps: StaticToolDeps & { env?: NodeJS.ProcessEnv; home?: string; arch?: LinuxArch } = {}): { python: string | null; detail: string } {
  const env = deps.env ?? process.env;
  const home = deps.home ?? homedir();
  const arch = deps.arch ?? linuxArch();
  if (!arch) return { python: null, detail: `unsupported architecture ${process.arch}` };
  const uv = uvPath(env, home);
  if (!existsSync(uv)) {
    const got = installStaticTool('uv', arch, uv, deps);
    if (!got.ok) return { python: null, detail: got.detail };
  }
  const run = deps.run ?? defaultRun;
  const uvEnv = { ...env, UV_PYTHON_INSTALL_DIR: managedPythonRoot(env, home) };
  const installed = run(uv, ['python', 'install', minor], uvEnv);
  if (installed.status !== 0) return { python: null, detail: `uv python install ${minor} failed: ${installed.stderr.trim().split('\n').at(-1) ?? installed.status}` };
  const found = run(uv, ['python', 'find', '--managed-python', minor], uvEnv);
  const python = (found.stdout ?? '').trim().split('\n').at(-1) ?? '';
  if (found.status !== 0 || !python) return { python: null, detail: `uv python find ${minor} failed: ${found.stderr.trim().split('\n').at(-1) ?? found.status}` };
  return { python, detail: `managed python ${minor} via uv ${STATIC_TOOLS.uv.version} → ${python}` };
}
