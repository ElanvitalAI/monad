// ── 운영 리더 지정 (P1 · 2026-07-26) ───────────────────────────────────────
//
// 발단(대표): 동일 git repo 를 5군데에서 체크아웃해 쓰는데, 그중 **어디가 운영인지 기록하는
// 곳이 없다**. 전에는 다른 트리가 글로벌이었고 pilot 으로 옮길 때 손으로 여러 축을 맞춰야 했다.
//
// 지금 "누가 운영이냐"를 사실상 결정하는 마커가 **셋**이고 서로를 모른다:
//   1. `bun link` (`~/.bun/bin/elanous`) — 사람이 `elanous` 칠 때 어느 트리 코드가 도나
//   2. launchd `com.elanous.nexus` plist  — 부팅 시 어느 트리 코드가 데몬이 되나
//   3. 31415 LISTEN 실프로세스           — 지금 실제로 누가 잡고 있나
//
// ⭐ **권위는 파일 하나(`~/.elanous/leader.json`), 위 셋은 관측 축**이다. 이유:
//   - 리졸버가 모듈 초기화 시점(어떤 스토어보다 먼저) 읽어야 한다 → DB 는 부트스트랩 순서 위험
//   - **데몬이 죽었을 때도 답이 있어야 한다** — 리더를 제일 알고 싶은 순간이 그때다
//   - `cat` 으로 보이고 손으로 고칠 수 있어야 한다 · 쓰기는 승격 때 한 번뿐
//   - 운영은 트리의 속성이 아니라 **머신의 속성**(`~/.elanous` 하나·31415 하나·launchd 하나).
//     권위가 그 싱글턴과 같은 곳에 있으면 **두 리더가 구조적으로 불가능**하다. 레포 안에 두면
//     git 이 5개 체크아웃에 복제하거나(추적 시) 각자 따로 놀아(무시 시) 중재자가 없다.
//
// ⚠️ **bun link 를 권위로 쓰지 않는 이유**: ①기록이 없다(언제·누가·직전 리더) ②의도 없이
// 움직인다(`bun link` 한 줄로 조용히 승격) ③패키지 매니저 레이아웃에 부팅-크리티컬 경로가
// 묶인다(링크 부재 시 답이 정의되지 않음) ④자기가 그 축이라 **드리프트를 원리적으로 탐지 못한다**.
//
// 본 페이즈(P1)는 **관측·기록만** 한다 — 아무것도 거부하지 않는다(거부 게이트=P4).
// 설계 = 내부 문서 `DESIGN-instance-leader-and-default-test-2026-07-26` §5.

import { INSTALLED_PACKAGE_MARKERS, isInstalledPackagePath } from './installed-package.js';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { debug } from '../debug/log.js';

export interface LeaderRecord {
  /** 운영 리더 트리의 절대 경로(레포 루트). */
  tree: string;
  /** 승격 시각(ISO). */
  promotedAt: string;
  /** 승격 주체(사람 id / agent). */
  promotedBy?: string;
  /** 승격 사유(자유 텍스트). */
  reason?: string;
  /** 직전 리더(있으면) — "언제부터 여기가 운영이었나"에 답하기 위한 최소 이력. */
  previous?: { tree: string; until: string };
  /** 파일이 3축 추론으로 자동 물질화된 것인지(사람이 claim 한 게 아님). */
  bootstrapped?: boolean;
}

/** 권위 파일 경로 — 항상 prod 홈. 격리 state-dir 스코프가 **아니다**(머신 싱글턴이므로). */
export function leaderFilePath(): string {
  return join(homedir(), '.elanous', 'leader.json');
}

/** 경로 정규화 — 심볼릭 링크·후행 슬래시 차이로 트리가 달라 보이는 것을 막는다. */
export function normalizeTree(p: string): string {
  const abs = resolve(p.trim().replace(/\/+$/, ''));
  try { return realpathSync(abs); } catch { return abs; }
}

/** 권위 파일 읽기. 없거나 깨졌으면 null(부팅 불침몰). */
export function readLeader(): LeaderRecord | null {
  const p = leaderFilePath();
  try {
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as LeaderRecord;
    return typeof raw?.tree === 'string' && raw.tree.length > 0 ? raw : null;
  } catch { return null; }
}

/** 권위 파일 원자적 쓰기(tmp→rename). */
export function writeLeader(rec: LeaderRecord): void {
  const p = leaderFilePath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(rec, null, 2)}\n`);
  renameSync(tmp, p);
}

// ── 거부 기록 (P4 완화 ② · DESIGN §6) ────────────────────────────────────────
//
// ⚠️ launchd `com.elanous.nexus` 는 KeepAlive 로 재기동한다. plist 와 `leader.json` 이 어긋난 채
// 거부하면 **운영 데몬이 크래시 루프로 내려앉는데, 사람은 이유를 모른다.** 거부할 때마다 사유를
// 파일로 남겨 `elanous leader status` 가 즉시 답할 수 있게 한다("왜 안 뜨나"에 대한 유일한 단서).

/** 거부 기록의 형태 — 누가·어디서·왜 거부됐나. 진단에 필요한 최소치. */
export interface LeaderRefusalRecord {
  refusedAt: string;
  /** 거부당한 프로세스의 트리. */
  selfTree: string;
  /** 그 시점의 권위 트리. */
  leaderTree: string;
  /** 해석된 인스턴스 뿌리(운영 싱글턴이었으므로 보통 ~/.elanous). */
  root: string;
  depth: number;
  why: string;
}

/** 거부 기록 경로 — 권위와 같은 머신 싱글턴 자리(`~/.elanous`). */
export function leaderRefusalFilePath(): string {
  return join(homedir(), '.elanous', 'leader-refusal.json');
}

/** 최근 거부 읽기. 없거나 깨졌으면 null(진단용이라 절대 던지지 않는다).
 *  ⚠️ **전체 스키마를 검증한다**(리뷰 must-fix #5492) — 일부 필드만 보면 불완전 레코드가 유효로
 *  통과해 `leader status` 가 `undefined` 를 화면에 찍는다. 진단 도구가 진단을 흐리면 안 된다. */
export function readLeaderRefusal(path = leaderRefusalFilePath()): LeaderRefusalRecord | null {
  // ⚠️ 경로를 **인자로** 받는다(리뷰 must-fix #5492 2R) — 모듈 내부 lexical 호출은 `spyOn` 으로
  //    바뀌지 않아, 스파이에 의존한 테스트가 조용히 **실제 HOME 을 읽는다**. seam 주입이 정답.
  try {
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<LeaderRefusalRecord>;
    if (!raw || typeof raw !== 'object') return null;
    const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
    if (!str(raw.refusedAt) || !str(raw.why) || !str(raw.selfTree) || !str(raw.root)) return null;
    if (typeof raw.leaderTree !== 'string') return null;   // 빈 문자열 허용(권위 미지정 시)
    // depth 는 **0 이상 정수**(리뷰 should-fix) — 음수·소수는 스키마상 의미가 없다.
    if (typeof raw.depth !== 'number' || !Number.isInteger(raw.depth) || raw.depth < 0) return null;
    return raw as LeaderRefusalRecord;
  } catch { return null; }
}

/** 거부 기록 쓰기(원자적). ⚠️ **fail-soft** — 기록 실패가 거부 자체를 막으면 안 된다(설계 §6). */
export function writeLeaderRefusal(rec: LeaderRefusalRecord): void {
  try {
    const p = leaderRefusalFilePath();
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(rec, null, 2)}\n`);
    renameSync(tmp, p);
  } catch { /* 진단 보조일 뿐 — 실패해도 거부는 그대로 진행 */ }
}

/** 거부 기록 삭제 — 정상 기동에 성공하면 지운다(스테일 기록이 과거를 현재로 오인시키지 않게). */
export function clearLeaderRefusal(): void {
  try {
    const p = leaderRefusalFilePath();
    if (existsSync(p)) unlinkSync(p);
  } catch { /* fail-soft */ }
}

// ── 관측 3축 ───────────────────────────────────────────────────────────────

export interface LeaderAxes {
  /** 권위 — leader.json 의 tree(없으면 null). */
  authority: string | null;
  /** `bun link` 가 가리키는 트리(해석 실패 시 null). */
  bunLink: string | null;
  /** launchd plist 의 ProgramArguments 가 가리키는 트리(없으면 null). */
  launchd: string | null;
  /** 31415 를 잡은 실프로세스의 트리(미조회/미가동이면 null). */
  running: string | null;
  /** 이 프로세스의 코드가 있는 트리. */
  self: string;
  /** 이 프로세스의 코드가 «설치본»(`…/node_modules/elanous/…` · 위로 git 트리 없음)인가.
   *  설치본은 운영 코드다 — cwd 가 어느 워크트리든 리더와 같게 본다(아래 `isLeaderTree`). */
  selfInstalled?: boolean;
  /** 트리가 아니라 «설치본»으로 풀린 축(축 이름 → 설치본 뿌리). 이 축들은 `unresolved` 도 `drift` 도 아니다 — 운영 코드다. */
  installed?: Record<string, string>;
  /** **해석된** 축들이 권위와 일치하나. ⚠️ `unresolved` 를 포함하지 않는다 — 둘을 함께 봐야
   *  "정합"이라고 말할 수 있다(축이 없어서 조용한 것과 일치해서 조용한 것은 다르다). */
  coherent: boolean;
  /** 권위와 어긋난 축 이름. */
  drift: string[];
  /** 해석 자체가 안 된 축(링크 부재·plist 부재·데몬 미가동 등). 정합 판정의 사각지대. */
  unresolved: string[];
}

/** `bin/elanous.mjs` 같은 실행 경로 → 레포 루트. `<tree>/bin/elanous.mjs` 관례를 벗기고
 *  위로 걸어 `.git` 을 찾는다(worktree 의 `.git` 파일도 잡힘). */
export function treeFromScriptPath(scriptPath: string): string | null {
  let dir = dirname(normalizeTree(scriptPath));
  for (let i = 0; i < 30; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/** 설치본 사본의 뿌리(`…/node_modules/elanous`) — 경로가 설치본이고 위로 git 트리가 없을 때만. 아니면 null.
 *  T6(2026-09-24): 전역 링크·launchd·데몬이 설치본으로 옮긴 뒤 이 축들이 «해석 불가»로 경고했다 — 트리가 없는 게
 *  아니라 «설치본»이라는 값이다. */
export function installedCopyRoot(scriptPath: string): string | null {
  const normalized = normalizeTree(scriptPath).replace(/\\/g, '/');
  const marker = INSTALLED_PACKAGE_MARKERS.find((m) => normalized.includes(`${m}/`));
  if (!marker) return null;
  const at = normalized.indexOf(`${marker}/`);
  if (treeFromScriptPath(scriptPath) !== null) return null;
  return normalized.slice(0, at + marker.length);
}


/** `~/.bun/bin/elanous` 심볼릭 링크가 가리키는 실제 스크립트 경로. */
export function resolveBunLinkScript(binPath = join(homedir(), '.bun', 'bin', 'elanous')): string | null {
  try {
    if (!existsSync(binPath)) return null;
    return realpathSync(binPath);
  } catch { return null; }
}

/** `~/.bun/bin/elanous` 심볼릭 링크 → 트리. */
export function resolveBunLinkTree(binPath = join(homedir(), '.bun', 'bin', 'elanous')): string | null {
  const script = resolveBunLinkScript(binPath);
  return script ? treeFromScriptPath(script) : null;
}

/** launchd plist 의 ProgramArguments 에 있는 bin/elanous.mjs 경로. */
export function resolveLaunchdScript(
  plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.elanous.nexus.plist'),
): string | null {
  try {
    if (!existsSync(plistPath)) return null;
    const xml = readFileSync(plistPath, 'utf-8');
    const m = /<string>([^<]*\/bin\/elanous\.mjs)<\/string>/.exec(xml);
    return m?.[1] ?? null;
  } catch { return null; }
}

/** launchd plist 의 ProgramArguments 에서 bin/elanous.mjs 경로를 찾아 트리로 변환. */
export function resolveLaunchdTree(
  plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.elanous.nexus.plist'),
): string | null {
  const script = resolveLaunchdScript(plistPath);
  return script ? treeFromScriptPath(script) : null;
}

/** 31415 를 잡고 있는 **실프로세스**의 코드 트리 — 3번째 관측 축.
 *  `lsof` 서브프로세스라 **부팅 경로에서는 쓰지 않는다**(status/진단 전용·기본 미조회). */
export function resolveRunningTree(port = 31415): string | null {
  const script = resolveRunningScript(port);
  return script ? treeFromScriptPath(script) : null;
}

/** 31415 를 잡고 있는 실프로세스의 bin/elanous.mjs 경로(lsof · status 전용). */
export function resolveRunningScript(port = 31415): string | null {
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    const pids = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf-8', timeout: 3000 })
      .split('\n').map((l) => l.trim()).filter(Boolean);
    if (pids.length === 0) return null;
    const cmd = execFileSync('ps', ['-o', 'command=', '-p', pids[0]!], { encoding: 'utf-8', timeout: 3000 });
    const m = /(\S*\/bin\/elanous\.mjs)/.exec(cmd);
    return m?.[1] ?? null;
  } catch { return null; }
}

/** 실행 스크립트가 «설치본» 안에 있나 — `…/node_modules/elanous/…` 이고 위로 git 트리가 없다.
 *  🩸 2026-09-24 실측: 설치본 `elanous where` 를 비-리더 워크트리 안에서 부르면 `resolveSelfTree` 가
 *     (스크립트 위에 `.git` 이 없어) cwd 의 트리로 떨어져 «테스트 우주»로 풀렸다. pilot 링크는 같은 자리에서 운영.
 *     ⇒ 전역 `elanous` 를 설치본으로 바꾸면 워크트리에서 일하는 세션의 `elanous logs` 가 조용히 테스트를 읽는다. */
export function isInstalledCopyScript(argv1 = process.argv[1] ?? ''): boolean {
  if (!argv1) return false;
  try {
    const real = realpathSync(argv1).replace(/\\/g, '/');
    if (!isInstalledPackagePath(real)) return false;
    return treeFromScriptPath(real) === null;
  } catch { return false; }
}

/** 이 프로세스의 코드 트리(argv[1] 기준 · 실패 시 cwd 에서 위로). */
export function resolveSelfTree(argv1 = process.argv[1] ?? '', cwd = process.cwd()): string {
  return (argv1 ? treeFromScriptPath(argv1) : null) ?? treeFromScriptPath(join(cwd, 'x')) ?? normalizeTree(cwd);
}

/** 3축을 읽어 권위와 대조(순수 조회 — 아무것도 쓰지 않는다). */
export function observeLeaderAxes(deps: {
  authority?: string | null;
  bunLink?: string | null;
  launchd?: string | null;
  /** 기본 **미조회**(null) — lsof 서브프로세스라 부팅 경로에서 돌리지 않는다. status 가 명시 주입. */
  running?: string | null;
  self?: string;
  /** 기본: `self` 를 주입하지 않았을 때만 실제 argv[1] 로 판정(주입했으면 false). */
  selfInstalled?: boolean;
  /** 축별 설치본 뿌리(주입용). 주입 안 하면 bun-link·launchd 는 실제 스크립트 경로로 판정한다. running 은 명시 주입만. */
  installed?: Partial<Record<'bun-link' | 'launchd' | 'running', string | null>>;
} = {}): LeaderAxes {
  const authority = deps.authority !== undefined ? deps.authority : (readLeader()?.tree ?? null);
  const bunLink = deps.bunLink !== undefined ? deps.bunLink : resolveBunLinkTree();
  const launchd = deps.launchd !== undefined ? deps.launchd : resolveLaunchdTree();
  const running = deps.running !== undefined ? deps.running : null;   // 기본 미조회
  const self = deps.self ?? resolveSelfTree();
  const norm = (v: string | null) => (v ? normalizeTree(v) : null);
  const a = norm(authority);
  const drift: string[] = [];
  const unresolved: string[] = [];
  const installed: Record<string, string> = {};
  const installedOf = (name: 'bun-link' | 'launchd' | 'running'): string | null => {
    if (deps.installed && name in deps.installed) return deps.installed[name] ?? null;
    if (name === 'running') return null;
    if (name === 'bun-link' && deps.bunLink !== undefined) return null;
    if (name === 'launchd' && deps.launchd !== undefined) return null;
    const script = name === 'bun-link' ? resolveBunLinkScript() : resolveLaunchdScript();
    return script ? installedCopyRoot(script) : null;
  };
  const axis = (name: 'bun-link' | 'launchd' | 'running', v: string | null) => {
    const n = norm(v);
    if (n === null) {
      const root = installedOf(name);
      if (root) { installed[name] = root; return null; }
      unresolved.push(name);
      return null;
    }
    if (a && n !== a) drift.push(name);
    return n;
  };
  const bl = axis('bun-link', bunLink);
  const ld = axis('launchd', launchd);
  const rn = deps.running !== undefined ? axis('running', running) : null;
  return {
    authority: a, bunLink: bl, launchd: ld, running: rn, self: normalizeTree(self),
    selfInstalled: deps.selfInstalled ?? (deps.self === undefined ? isInstalledCopyScript() : false),
    installed,
    coherent: drift.length === 0, drift, unresolved,
  };
}

/** 이 프로세스가 운영 리더 트리에서 돌고 있나. 권위 파일이 없으면 **판정 보류(null)**. */
export function isLeaderTree(axes: LeaderAxes = observeLeaderAxes()): boolean | null {
  if (!axes.authority) return null;
  if (axes.selfInstalled) return true;   // 설치본 = 운영 코드 — cwd 트리로 판정하지 않는다
  return axes.authority === axes.self;
}

/** 권위 파일이 없으면 3축에서 추론해 **1회 물질화**하고 크게 남긴다.
 *  추론 우선순위 = launchd(부팅 시 실제로 운영을 접수하는 축) → bun link. 둘 다 없으면 포기(null).
 *
 *  ⚠️ **이미 파일이 있으면 절대 덮어쓰지 않는다** — 사람의 claim 이 항상 이긴다.
 *  ⚠️ **리더 트리 본인만 물질화한다** — `leader.json` 은 prod 홈(`~/.elanous`)에 산다. 비-리더 트리
 *     (axon 등 테스트 체크아웃)가 부팅마다 운영 스토어에 쓰는 것은 "운영 무접촉" 규율 위반이다.
 *     추론 결과가 자기 자신일 때만 쓰고, 아니면 **관측만** 남긴다(표시는 추론값으로 가능). */
export function bootstrapLeader(
  now: string,
  deps: { axes?: LeaderAxes; write?: (r: LeaderRecord) => void; read?: () => LeaderRecord | null } = {},
): LeaderRecord | null {
  // ⚠️ read 도 주입 가능해야 한다 — 안 그러면 유닛 테스트가 사용자 머신의 실제
  //    `~/.elanous/leader.json` 을 읽어 결과가 환경에 오염된다(테스트 격리 규율).
  const existing = (deps.read ?? readLeader)();
  if (existing) return existing;
  const axes = deps.axes ?? observeLeaderAxes();
  const inferred = axes.launchd ?? axes.bunLink;
  if (!inferred) {
    debug.log('instance.leader', 'bootstrap-skipped', { why: '3축 모두 해석 불가 — 권위 파일 없이 계속(관측만)' });
    return null;
  }
  if (normalizeTree(inferred) !== axes.self) {
    // 비-리더 트리 — 운영 스토어(~/.elanous)에 쓰지 않는다. 관측만.
    debug.log('instance.leader', 'bootstrap-deferred', {
      inferred: normalizeTree(inferred), self: axes.self,
      why: '비-리더 트리에서는 운영 스토어에 권위 파일을 쓰지 않는다(운영 무접촉) — 리더 트리 부팅 시 물질화',
    });
    return null;
  }
  const rec: LeaderRecord = {
    tree: inferred,
    promotedAt: now,
    promotedBy: 'bootstrap',
    reason: `3축 추론(${axes.launchd ? 'launchd' : 'bun-link'}) — 권위 파일 부재로 1회 물질화`,
    bootstrapped: true,
  };
  (deps.write ?? writeLeader)(rec);
  debug.log('instance.leader', 'bootstrapped', { tree: rec.tree, from: axes.launchd ? 'launchd' : 'bun-link', drift: axes.drift });
  return rec;
}

/** 부팅 관측 관문 — 드리프트를 시끄럽게. **거부하지 않는다**(P1 은 관측만·P4 가 거부).
 *  `emit`: 'both'(기본) · 'log'(관측만) · 'stderr'(경고만) — footgun 가드와 동일 스타일. */
export function observeLeaderAtBoot(opts: { emit?: 'both' | 'log' | 'stderr'; axes?: LeaderAxes } = {}): LeaderAxes {
  const axes = opts.axes ?? observeLeaderAxes();
  const emit = opts.emit ?? 'both';
  // 부팅마다 "이 프로세스가 리더 트리인가"를 남긴다 — P3 트리 파생의 입력이자, 지금은
  // 'axon 에서 돈 명령이 운영을 만졌나'를 사후 조회할 수 있게 하는 관측 축이다.
  // (`elanous logs --category instance.leader`)
  if (emit !== 'stderr') {
    try {
      debug.log('instance.leader', 'tree-role', {
        self: axes.self, authority: axes.authority,
        isLeader: isLeaderTree(axes),   // null = 권위 미지정 → 판정 보류
      });
    } catch { /* 관측 실패가 부팅을 막지 않는다 */ }
  }
  if (!axes.coherent) {
    if (emit !== 'stderr') {
      try {
        debug.log('instance.leader', 'axis-drift', {
          authority: axes.authority, bunLink: axes.bunLink, launchd: axes.launchd, drift: axes.drift,
          why: '운영 리더 권위(leader.json)와 실제 마커가 어긋남 — `elanous leader claim` 으로 세 축을 함께 옮기세요',
        });
      } catch { /* 관측 실패가 부팅을 막지 않는다 */ }
    }
    if (emit !== 'log') {
      try {
        process.stderr.write(
          `[leader] ⚠️ 운영 리더 드리프트(${axes.drift.join(', ')}) — 권위=${axes.authority}\n`
          + `  bun link: ${axes.bunLink ?? '(없음)'}\n  launchd : ${axes.launchd ?? '(없음)'}\n`
          + `  → 'elanous leader status' 로 확인, 'elanous leader claim' 으로 세 축을 함께 이동\n`,
        );
      } catch { /* */ }
    }
  }
  return axes;
}
