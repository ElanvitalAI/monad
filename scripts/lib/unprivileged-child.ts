// ⭐⭐ 「특권 러너(root)에서도 «진짜» 권한 오류를 잰다」를 위한 공용 심.
//
// ⛔⭐ 왜 필요한가(2026-08-12 리뷰 지적): root 는 DAC 를 우회한다 — `chmod 000` 을 걸어도 그냥 읽힌다.
//   그래서 EACCES 를 무는 회귀가 컨테이너/CI(root) 에서 `skipIf` 로 «사라졌다». 「그 환경에서만 커버리지가
//   없다」는 ***가장 늦게 들키는 종류의 구멍***이다 — 검사 대상을 «비특권 자식 프로세스»에서 돌려 메운다.
//
// ⛔⛔ Bun 1.3.12 실측: `Bun.spawnSync` 와 `node:child_process` 의 `uid`/`gid` 옵션은 **조용히 무시된다**
//   (비특권에서 남의 uid 를 줘도 EPERM 없이 그대로 내 uid 로 돌았다 · 두 API 모두). ⇒ 그 옵션에 기대지 않고
//   «외부 도구»(sudo/setpriv/su)로 낮추고, ***낮춰졌는지를 자식이 스스로 보고한 uid 로 검증***한다.
//   「명령이 exit 0 이었다」는 증거가 아니다 — 이 저장소가 반복해 밟은 「0 을 읽기 전에 무엇을 쟀나」.
import { debug } from '../../src/debug/log.js';

/** 실행할 argv 를 「비특권으로 도는 argv」로 감싼다. */
export type UnprivilegedArgvWrapper = (argv: readonly string[]) => string[];

export type UnprivilegedDropVia = 'already-unprivileged' | 'sudo' | 'setpriv' | 'su';

export interface UnprivilegedLauncher {
  /** 어떤 경로로 비특권을 얻었나 — 관측·산출에 그대로 남긴다. */
  readonly via: UnprivilegedDropVia;
  /** ⭐ «검증된» 자식 uid. 0 이 아님이 이 값의 존재 이유다. */
  readonly uid: number;
  /** 대상 사용자(이미 비특권이면 null). */
  readonly user: string | null;
  readonly wrap: UnprivilegedArgvWrapper;
}

/**
 * 낮춘 사용자가 «실제로 그 일을 할 수 있어야» 한다는 전제.
 *
 * ⛔⭐ 실측(2026-08-12): `nobody` 로 낮추는 데는 성공해도 `~/.bun/bin/bun` 은 홈이 0700 이라 **실행조차
 *   못 했다**(`sudo: unable to execute ...: Permission denied`). uid 만 보고 전략을 고르면 그 뒤에 오는
 *   실패가 「권한 오류를 못 잰다」가 아니라 「자식이 안 떴다」로 나와, ***틀린 자리를 가리킨다.***
 *   ⇒ 후보를 고를 때 「낮췄나」와 「그 사용자로 이 경로들에 닿나」를 «같이» 묻는다.
 */
export interface UnprivilegedRequirements {
  readonly executable?: readonly string[];
  readonly readable?: readonly string[];
}

export interface UnprivilegedLauncherDeps {
  readonly getuid?: () => number;
  /** 감싼 argv 를 실제로 돌려 «자식이 보고한 uid» 를 돌려준다. 실패면 null. */
  readonly probeUid?: (argv: readonly string[]) => number | null;
  readonly env?: NodeJS.ProcessEnv;
  readonly requires?: UnprivilegedRequirements;
}

interface CandidateIdentity {
  readonly name: string;
  readonly uid: number | null;
  readonly gid: number | null;
}

/** `su -c` 는 «셸 문자열»을 받는다 — 경로에 공백·따옴표가 있어도 안 깨지게 통째로 인용한다. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function numericEnv(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const parsed = Number(raw.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * 낮출 대상 후보. ⭐ `sudo` 로 스위트를 돌린 사람이 있으면 «그 사람»이 1순위다 — 그래야 fixture 파일
 * 소유권이 자연스럽고, 없으면 표준 비특권 계정(`nobody`→`daemon`)으로 간다.
 */
export function unprivilegedCandidates(env: NodeJS.ProcessEnv): CandidateIdentity[] {
  const candidates: CandidateIdentity[] = [];
  const sudoUser = env.SUDO_USER?.trim();
  if (sudoUser && sudoUser !== 'root') {
    candidates.push({ name: sudoUser, uid: numericEnv(env.SUDO_UID), gid: numericEnv(env.SUDO_GID) });
  }
  candidates.push({ name: 'nobody', uid: null, gid: null });
  candidates.push({ name: 'daemon', uid: null, gid: null });
  return candidates;
}

/** 후보 하나에 대한 전략들 — 흔한 러너 이미지에서 «적어도 하나»는 있도록 셋을 둔다. */
function strategiesFor(identity: CandidateIdentity): { via: UnprivilegedDropVia; wrap: UnprivilegedArgvWrapper }[] {
  const strategies: { via: UnprivilegedDropVia; wrap: UnprivilegedArgvWrapper }[] = [
    // ⛔ `-n`: 비대화식(암호 프롬프트에서 «매달리지» 않는다). env 는 리셋되므로 호출자는 argv 로만 넘긴다.
    { via: 'sudo', wrap: (argv) => ['sudo', '-n', '-u', identity.name, '--', ...argv] },
  ];
  if (identity.uid !== null && identity.gid !== null) {
    strategies.push({ via: 'setpriv', wrap: (argv) => ['setpriv', `--reuid=${identity.uid}`, `--regid=${identity.gid}`, '--clear-groups', '--', ...argv] });
  }
  // ⚠️ `nobody` 의 로그인 셸은 보통 `/usr/bin/false` 다 ⇒ `-s /bin/sh` 를 «반드시» 준다.
  strategies.push({ via: 'su', wrap: (argv) => ['su', '-s', '/bin/sh', identity.name, '-c', argv.map(shellQuote).join(' ')] });
  return strategies;
}

function defaultProbeUid(argv: readonly string[]): number | null {
  try {
    const child = Bun.spawnSync(argv as string[], { stdout: 'pipe', stderr: 'pipe' });
    if (child.exitCode !== 0) return null;
    const parsed = Number(new TextDecoder().decode(child.stdout).trim());
    return Number.isInteger(parsed) ? parsed : null;
  } catch {
    return null; // 도구 자체가 없는 러너 — 다음 전략으로 간다.
  }
}

/**
 * 「낮췄나 ⊕ 그 사용자로 이 경로들에 닿나」를 한 자식 안에서 묻는 명령.
 * ⛔ 마지막이 `id -u` 다 — 앞의 `test` 가 하나라도 실패하면 `&&` 가 끊어 uid 가 «안 나온다»(= 그 전략 탈락).
 */
export function readinessProbeArgv(requires: UnprivilegedRequirements | undefined): string[] {
  const checks = [
    ...(requires?.executable ?? []).map((path) => `test -x ${shellQuote(path)}`),
    ...(requires?.readable ?? []).map((path) => `test -r ${shellQuote(path)}`),
  ];
  if (checks.length === 0) return ['id', '-u'];
  return ['/bin/sh', '-c', [...checks, 'id -u'].join(' && ')];
}

/** 사람이 고칠 수 있게 «무엇이 없어서 못 낮췄나»를 말한다(셀프힐링: 안 되는 건 명확히 표시). */
export const UNPRIVILEGED_DROP_HINT =
  'running as root but could not drop privileges to a user that can also reach the binary and repo: '
  + 'install one of sudo / setpriv(util-linux) / su and make the runtime + checkout readable by nobody, '
  + 'or run the suite as a non-root user (root bypasses DAC, so chmod-based permission regressions cannot be observed).';

const cache = new Map<string, UnprivilegedLauncher | null>();

/**
 * 비특권 실행기를 «검증하고» 돌려준다. 못 낮추면 `null`(호출자가 명시적으로 실패시킨다).
 *
 * ⛔⭐ 판정은 「명령이 성공했나」가 아니라 ***「uid 가 실제로 내려갔나」***다 — `uid` 옵션처럼 조용히
 *   무시하는 경로가 실재하므로, 0 이 돌아오면 그 전략을 «버린다»(성공으로 세면 회귀가 거짓 통과한다).
 */
export function resolveUnprivilegedLauncher(deps: UnprivilegedLauncherDeps = {}): UnprivilegedLauncher | null {
  const injected = deps.getuid !== undefined || deps.probeUid !== undefined || deps.env !== undefined;
  const cacheKey = JSON.stringify(deps.requires ?? null);
  if (!injected && cache.has(cacheKey)) return cache.get(cacheKey)!;
  const getuid = deps.getuid ?? (() => process.getuid?.() ?? 1);
  const probeUid = deps.probeUid ?? defaultProbeUid;
  const env = deps.env ?? process.env;
  const remember = (launcher: UnprivilegedLauncher | null): UnprivilegedLauncher | null => {
    if (!injected) cache.set(cacheKey, launcher);
    return launcher;
  };

  const current = getuid();
  if (current !== 0) {
    // 이미 비특권 — 감쌀 것이 없다(내가 만든 fixture 는 내가 닿으므로 readiness 도 자명하다).
    //   그래도 «자식 프로세스로 돌린다»는 축은 호출자가 두 환경에서 «같게» 유지한다.
    debug.log('harness.unprivileged-child', 'already-unprivileged', { uid: current });
    return remember({ via: 'already-unprivileged', uid: current, user: null, wrap: (argv) => [...argv] });
  }

  const probe = readinessProbeArgv(deps.requires);
  const attempted: string[] = [];
  for (const identity of unprivilegedCandidates(env)) {
    for (const strategy of strategiesFor(identity)) {
      attempted.push(`${strategy.via}:${identity.name}`);
      const uid = probeUid(strategy.wrap(probe));
      // ⛔ 안 낮춰졌거나(0) · 도구가 없거나 · 그 사용자가 경로에 못 닿는다(null) ⇒ 다음 전략.
      if (uid === null || uid === 0) continue;
      debug.log('harness.unprivileged-child', 'dropped', { via: strategy.via, user: identity.name, uid, attempted });
      return remember({ via: strategy.via, uid, user: identity.name, wrap: strategy.wrap });
    }
  }
  debug.log('harness.unprivileged-child', 'drop-unavailable', { attempted, hint: UNPRIVILEGED_DROP_HINT });
  return remember(null);
}
