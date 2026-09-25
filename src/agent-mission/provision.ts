// ── 역량 프로비저닝 (P4 행동양식 · 2026-07-25) ────────────────────────────────────────
//
// 감독(monad)이 자율 미션 중 **자식(codex/claude)의 역량을 스스로 늘리는** 행동. 자식이 없는
// 패키지/도구에 막히면(command not found·module not found), 감독이 격리 worktree 안에 설치하고
// "다시 시도하라"고 알린다. 자기치유(힐링)의 실행능력 확대판 = "bare→강한 에이전트" 스택 climb.
//
// ── 계층화된 역량 스택 (대표 co-design) ────────────────────────────────────────────────
//   L4 지식(context/memory) · L3 하니스(skill/MCP/subagent·⭐monad 고유) · L2 앱/런타임 · L1 셸/pkg
//   이 첫 슬라이스 = **L1(pkg)** 반응형 수복(안전·보편). L2+/L3 는 후속(정책이 지금은 pkg 만 자율).
//
// ── 안전 (자율 설치 = 실행권 확대) ──────────────────────────────────────────────────────
//   ① 정책 게이트: layer=pkg 만 자율·매니저 allowlist(node 전용)·**패키지명 셸메타/플래그/URL 금지**(주입 차단).
//   ② worktree-local + no-scripts: node 매니저는 `<cwd>/node_modules` 에 설치(worktree-local) + `--ignore-scripts`
//      로 **설치시 lifecycle 임의코드(RCE) 차단**. ⚠️ 정직: `cwd` 지정만으론 완전 sandbox 가 아니다 — monad
//      Write/Edit 경계(#4)는 **서브프로세스 write 를 못 막고**, 설치된 패키지 코드는 미션이 import 할 때 실행된다
//      (단 미션은 이미 자식이 임의 코드를 쓰고 돌리는 신뢰 봉투 안). 이번 슬라이스가 닫는 신규 벡터=설치시 RCE.
//      완전 sandbox(컨테이너·no-net)는 후속. argv spawn(셸 미경유).
//   ③ 관측 3박자: monad logs --category autopilot.provision (denied/installed/install-fail/install-noop).
//   미배선(브레인에 provision dep 미주입)이면 이 행동 자체가 no-op → 무회귀.
//
// ── 지원 범위(현재·정직) ────────────────────────────────────────────────────────────────
//   · 설치 위치 = **worktree 루트(wt.path)**. 루트에 package.json/lockfile 이 있는 프로젝트만 매니저 감지 →
//     **중첩 Node 프로젝트**(패키지가 하위 디렉토리)는 루트 매니페스트가 없으면 정책이 "매니저 불명" 거부.
//     관측된 자식 실제 cwd 로 설치 위치를 전달하는 것은 후속(지금은 루트 고정).
//   · 검증 = exit 0 + node_modules/<pkg> **존재**. 손상 설치·실 import 가능성까지는 안 봄(require.resolve 상당
//     검증은 후속·현재는 존재로 no-op/부분성공을 1차 차단). 실행은 hard 타임아웃(INSTALL_TIMEOUT_MS) 바운드.
//   · 실 패키지 매니저 e2e(argv 호환·실설치)는 smoke 후속(unit 은 주입 run/resolved 로 배선·정책·안전구성 커버).
//     npm/bun/pnpm 만(yarn 세대차·pip 격리 후속).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { debug } from '../debug/log.js';
import { LOCAL_SKILLS_DIR, LOCAL_AGENTS_DIR } from '../config.js';
import { reloadSkillIndex } from '../skills/index.js';
import { invalidateLayeredCache } from '../agent/definition-registry.js';

const execFileAsync = promisify(execFile);

// 프로비저닝 계층 로드맵(문서) — 이번 슬라이스는 **pkg(L1·Node) 만 자율**. layer 는 **자유 문자열**로 받고
// 정책이 유일한 검증점이다(`!== 'pkg'` → 전부 deferred). 이렇게 하면 알려진 non-pkg('skill')·오타·완전 무효
// ('garbage') 를 **모두 안전 defer** — 타입 union 을 두면 파서가 무효값을 drop→undefined→pkg 로 오분류하는
// 우회가 생긴다(리뷰 must-fix). 로드맵: L1 pkg(now) · L2 app · L3 하니스(skill/mcp/subagent) · L4 context.

export interface ProvisionRequest {
  /** 프로비저닝 계층. 현재 'pkg'(Node 패키지)만 정책 허용 — 그 외 문자열은 정책이 defer. */
  readonly layer: string;
  /** 설치 대상(**Node 패키지명**·스코프@org/pkg·버전@1.2.3 허용). pip/시스템 패키지는 미지원(후속). */
  readonly spec: string;
  /** 감독이 왜 설치하려는지(관측에 기록). */
  readonly reason?: string;
}

export interface ProvisionResult {
  readonly ok: boolean;
  readonly layer: string;
  readonly spec: string;
  readonly action: 'installed' | 'denied' | 'error';
  /** 자식/관측에 전달할 사람이 읽는 결과(다음 지시 포함). */
  readonly detail: string;
}

/** 정책 결정 — 허용(pkg=argv 설치 / registry=self 레지스트리 설치) 또는 거부(사유). `kind` 판별자로 실행기
 *  분기(pkg=매니저 argv·registry=skill/subagent 레지스트리 install+reload). L3(#7-5)에서 registry 추가. */
export type ProvisionDecision =
  | { readonly allow: true; readonly kind: 'pkg'; readonly manager: string; readonly cmd: string; readonly args: readonly string[] }
  | { readonly allow: true; readonly kind: 'registry'; readonly regLayer: 'skill' | 'subagent'; readonly name: string; readonly sourcePath: string }
  | { readonly allow: false; readonly reason: string };

/** (요청, worktree) → 허용/거부. 주입 가능(운영자가 더 엄격/느슨하게 교체). */
export type ProvisionPolicy = (req: ProvisionRequest, cwd: string) => ProvisionDecision;

export interface ProvisionDeps {
  /** 격리 worktree(설치가 일어날 곳). */
  readonly cwd: string;
  /** 정책 게이트(기본 defaultProvisionPolicy). */
  readonly policy?: ProvisionPolicy;
  /** 설치 실행 seam(테스트 주입). 기본 execFile async(이벤트루프 비블로킹). */
  readonly run?: (cmd: string, args: readonly string[], cwd: string) => Promise<{ status: number | null; out: string }>;
  /** ★ 설치 검증 seam(테스트 주입) — exit 0 후 실제로 모듈이 해석되는지 확인(no-op/부분성공 오판 방지·리뷰).
   *  기본=`<cwd>/node_modules/<pkg>` 존재 확인. 테스트는 () => true 주입. */
  readonly resolved?: (cwd: string, spec: string) => boolean;
  /** ★ 레지스트리 설치 seam(테스트 주입·self skill/subagent·L3). 기본=cpSync + reloadSkillIndex/invalidateLayeredCache. */
  readonly installRegistry?: (regLayer: 'skill' | 'subagent', name: string, sourcePath: string) => Promise<{ ok: boolean; detail: string }>;
}

/** 패키지 spec → node_modules 안 디렉토리명(버전 제거·스코프 보존). 'react@18'→'react'·'@types/node@1'→'@types/node'. */
export function pkgDirName(spec: string): string {
  if (spec.startsWith('@')) {
    const slash = spec.indexOf('/');
    if (slash < 0) return spec.split('@').slice(0, 2).join('@'); // 비정상('@x') 방어
    return `${spec.slice(0, slash)}/${spec.slice(slash + 1).split('@')[0]}`;
  }
  return spec.split('@')[0]!;
}

/** 허용 매니저 allowlist — cmd + 설치 인자 빌더(argv·셸 미경유).
 *  ⚠️ **node 매니저만**(설치가 `<cwd>/node_modules` = worktree-local). pip 는 cwd 아니라 활성 env/시스템
 *     site-packages 를 바꿔 격리 위반 → 제외(venv/`--target` 격리는 후속 슬라이스).
 *  ⚠️ `--ignore-scripts`(npm/pnpm/yarn) — 설치 시 **lifecycle script(postinstall) 임의코드 실행**을 차단한다.
 *     cwd 만으론 격리가 아니다(스크립트가 홈·정본에 쓸 수 있음). bun 은 신뢰목록 밖 deps 스크립트를 기본 미실행. */
// ⚠️ yarn 제외(리뷰) — `--ignore-scripts` 는 Yarn Classic(v1) 만 지원하고 Berry(v2+)는 미지원(설정 enableScripts)
//   이라 세대별로 안전 플래그가 갈린다. 감지되면 정책이 **명시 거부**(오작동보다 안전). 버전별 처리는 후속.
const MANAGERS: Record<string, { cmd: string; installArgs: (spec: string) => string[] }> = {
  npm: { cmd: 'npm', installArgs: (s) => ['install', s, '--ignore-scripts'] },
  // bun 도 명시 --ignore-scripts — bun 은 기본적으로 untrusted deps 스크립트를 안 돌리나, 프로젝트의
  //   trustedDependencies 설정이 매치하면 실행될 수 있어(리뷰 must-fix) RCE 차단 불변식을 명시 플래그로 못박는다.
  bun: { cmd: 'bun', installArgs: (s) => ['add', s, '--ignore-scripts'] },
  pnpm: { cmd: 'pnpm', installArgs: (s) => ['add', s, '--ignore-scripts'] },
};

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g;

/** ★ PTY input 재주입 안전화(리뷰 should-fix) — detail 은 자식 PTY 에 input 으로 들어가므로, 매니저 출력·거부된
 *  원본 spec 등 **신뢰 못 할 문자열**의 제어문자(개행 포함)·ANSI 를 제거해 프롬프트/터미널 인젝션을 막는다.
 *  export — 호출부(driver)가 **PTY 주입 직전 경계**에서도 적용(주입 가능한 provision 구현의 detail 방어·심층방어). */
export function sanitizeForPtyInput(s: string, max = 200): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(ANSI_RE, '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** ★ 안전 패키지명 판정(순수) — 셸 메타·공백·플래그(선행 `-`)·URL(임의 tarball) 금지로 주입/오용 차단.
 *  스코프(@org/pkg)·버전(pkg@1.2.3·^~*x) 허용. argv spawn 이라 셸해석은 없지만(방어심화) 플래그/URL 주입은
 *  실질 위협이라 차단. 128자 상한. */
export function isSafeSpec(spec: string): boolean {
  if (!spec || spec.length > 128) return false;
  if (/[\s;|&$`(){}<>!\\'"]/.test(spec)) return false;   // 셸 메타/공백
  if (spec.startsWith('-')) return false;                 // 플래그 주입(npm install --foo)
  if (spec.includes('://')) return false;                 // URL(임의 원격 tarball)
  return /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~*x-]+)?$/i.test(spec);
}

/** worktree 매니페스트로 기본 매니저 감지. **packageManager 필드 우선**(corepack `pnpm@8.x` — lockfile 없어도
 *  프로젝트 의도 존중·잘못된 npm 강제 방지) → lockfile(bun/pnpm/yarn) → package.json(npm 폴백). node 전용. */
export function detectManager(cwd: string): string | null {
  const pj = join(cwd, 'package.json');
  const hasPj = existsSync(pj);
  // ★ 정직한 **감지**(무엇을 쓰는 프로젝트인가) — 지원 여부는 정책이 판단(MANAGERS 검증). 명시 선언(corepack)이
  //   있으면 그 이름만 존중(lockfile 폴백 안 함) → deno@·yarn@ 등도 정직히 감지되고, 정책이 미지원이면 명시 거부.
  if (hasPj) {
    try {
      const pm = String((JSON.parse(readFileSync(pj, 'utf8')) as { packageManager?: unknown }).packageManager ?? '').trim();
      if (pm) return pm.split('@')[0] || null;
    } catch { /* 파싱 실패 → lockfile 폴백 */ }
  }
  if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) return 'bun';
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn'; // 감지는 하되 정책이 미지원 거부
  if (hasPj) return 'npm'; // 매니페스트만 있고 lockfile/선언 없음 → npm 폴백
  return null;
}

/** ★ 기본 정책(순수·테스트가능) — L1 pkg 만 자율 허용. 안전 spec + allowlist 매니저(명시 시 검증·아니면 감지).
 *  layer≠pkg 는 후속 슬라이스로 deferred(거부). */
export function defaultProvisionPolicy(req: ProvisionRequest, cwd: string): ProvisionDecision {
  if (req.layer !== 'pkg') return { allow: false, reason: `'${sanitizeForPtyInput(req.layer, 40)}' 계층 자율 프로비저닝은 후속 슬라이스 — 현재는 pkg(L1)만 자율` };
  if (!isSafeSpec(req.spec)) return { allow: false, reason: `안전하지 않은 패키지명(셸메타/플래그/URL 금지): ${sanitizeForPtyInput(req.spec, 60)}` };
  // worktree 매니페스트로 매니저 감지. 지원 여부는 **여기서** 검증(MANAGERS) — yarn/deno 등 미지원은 명시 거부(리뷰).
  const mgrKey = detectManager(cwd);
  if (!mgrKey) return { allow: false, reason: 'worktree 에 패키지 매니페스트 미감지 — 매니저 불명' };
  const m = MANAGERS[mgrKey];
  if (!m) return { allow: false, reason: `매니저 '${sanitizeForPtyInput(mgrKey, 40)}' 미지원 — 현재 npm/bun/pnpm(yarn 은 버전별 안전플래그 차이로 제외)` };
  return { allow: true, kind: 'pkg', manager: mgrKey, cmd: m.cmd, args: m.installArgs(req.spec) };
}

// ── L3 self 역량 프로비저닝 — skill/subagent 레지스트리 설치 (P4 · #7-5 · 2026-07-26) ─────────────────
//
// ⚠️ **대상 분리**: defaultProvisionPolicy(위)는 **외부 자식**(agent-mission·codex worktree) 전용 — pkg 만 자율.
//    아래 self 정책/설치는 **monad 자신**(goal-loop)이 대상 — reload 훅이 in-process 라 재시작 없이 픽업 가능.
//    codex/claude 하니스 설치(자식 재시작 필요)는 L3b(후속). 두 정책을 물리적으로 분리 → 외부 경로 무회귀.

/** 안전 역량명 판정(순수) — path traversal·셸메타 차단. 스킬/에이전트 이름은 단순 슬러그만 허용. */
export function isSafeCapabilityName(name: string): boolean {
  if (!name || name.length > 64) return false;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return false;
  return /^[a-z0-9][a-z0-9._-]*$/i.test(name);
}

/** (layer, name) → 설치할 소스 아티팩트 경로 or null(=미allowlist·거부). 발굴→resolver 채우기는 후속. */
export type ArtifactResolver = (layer: 'skill' | 'subagent', name: string) => string | null;

/** allowlist 기반 resolver 빌더 — 명시 등록된 능력만 자율 설치 허용(나머지 전부 거부). */
export function makeAllowlistResolver(
  allow: ReadonlyArray<{ readonly layer: 'skill' | 'subagent'; readonly name: string; readonly sourcePath: string }>,
): ArtifactResolver {
  const idx = new Map(allow.map((a) => [`${a.layer}:${a.name}`, a.sourcePath]));
  return (layer, name) => idx.get(`${layer}:${name}`) ?? null;
}

/** ★ 기본 self resolver = **전부 거부**(deny-all). L3 는 실행권 확대 → 명시 allowlist 없이는 자율 설치 불가
 *  (정책/HITL 강화·PLAN §7-5). buildSelfProvision 호출부가 allowlist resolver 를 주입해야 설치가 열린다. */
export const denyAllArtifactResolver: ArtifactResolver = () => null;

/** ★ self 정책(순수·테스트가능) — pkg(→monad repo argv·defaultProvisionPolicy 재사용) + skill/subagent(레지스트리
 *  설치·allowlist resolver). resolver 가 소스 못 주면 거부. mcp 등 나머지 계층은 후속(defer). */
export function makeSelfProvisionPolicy(resolve: ArtifactResolver): ProvisionPolicy {
  return (req, cwd) => {
    if (req.layer === 'pkg') return defaultProvisionPolicy(req, cwd); // pkg = 외부와 동일 argv 설치(cwd=monad repo)
    if (req.layer === 'skill' || req.layer === 'subagent') {
      if (!isSafeCapabilityName(req.spec)) return { allow: false, reason: `안전하지 않은 역량명(슬러그만): ${sanitizeForPtyInput(req.spec, 60)}` };
      const sourcePath = resolve(req.layer, req.spec);
      if (!sourcePath) return { allow: false, reason: `'${sanitizeForPtyInput(req.spec, 60)}' 는 allowlist 밖 — 자율 설치 불가(발굴→명시 승인 필요)` };
      return { allow: true, kind: 'registry', regLayer: req.layer, name: req.spec, sourcePath };
    }
    return { allow: false, reason: `'${sanitizeForPtyInput(req.layer, 40)}' 계층 self 프로비저닝 미지원 — 현재 pkg/skill/subagent(mcp 등 후속)` };
  };
}

/** ★ 기본 레지스트리 설치 — skill=활성 skill dir 로 복사 후 reloadSkillIndex / subagent=agents dir 로 .md 복사 후
 *  invalidateLayeredCache. monad-self 는 in-process 훅이라 재시작 0. 소스 미존재/오류는 graceful({ok:false}). */
async function defaultInstallRegistry(regLayer: 'skill' | 'subagent', name: string, sourcePath: string): Promise<{ ok: boolean; detail: string }> {
  try {
    if (!existsSync(sourcePath)) return { ok: false, detail: `설치 소스 미존재: ${sanitizeForPtyInput(sourcePath, 120)}` };
    if (regLayer === 'skill') {
      mkdirSync(LOCAL_SKILLS_DIR, { recursive: true });
      cpSync(sourcePath, join(LOCAL_SKILLS_DIR, name), { recursive: true });
      const n = reloadSkillIndex();
      return { ok: true, detail: `skill '${name}' 를 활성 레지스트리에 설치·리로드(총 ${n}개). 다시 시도하라.` };
    }
    mkdirSync(LOCAL_AGENTS_DIR, { recursive: true });
    cpSync(sourcePath, join(LOCAL_AGENTS_DIR, `${name}.md`));
    invalidateLayeredCache();
    return { ok: true, detail: `subagent '${name}' 정의를 설치·캐시 무효화. 다시 시도하라.` };
  } catch (e) {
    return { ok: false, detail: `레지스트리 설치 오류: ${(e as Error).message}` };
  }
}

/** ★ 설치 실행 hard 타임아웃(ms·리뷰) — 네트워크 정지 시 감독 decide/미션이 **무기한** 멈추지 않게 바운드.
 *  초과하면 execFile 이 자식을 kill(→ status≠0 → error 결과) → 미션은 "설치 없이 계속"으로 진행. */
const INSTALL_TIMEOUT_MS = 180_000;

/** 기본 실행 — execFile async(이벤트루프 양보). 격리 cwd·hard 타임아웃(INSTALL_TIMEOUT_MS)·maxBuffer 바운드. */
async function defaultRun(cmd: string, args: readonly string[], cwd: string): Promise<{ status: number | null; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args as string[], { cwd, encoding: 'utf8', timeout: INSTALL_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    return { status: 0, out: `${stdout ?? ''}${stderr ?? ''}` };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { status: typeof err.code === 'number' ? err.code : 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/**
 * ★ 역량 프로비저닝 실행 — 정책 게이트 통과 시 격리 worktree 에 설치하고, 자식에 전달할 사람이 읽는 결과를
 *  반환한다. 거부/실패도 detail 로 "다른 방법으로 진행하라" 안내(자식이 계속 진행). 관측 3박자.
 */
export async function provisionCapability(req: ProvisionRequest, deps: ProvisionDeps): Promise<ProvisionResult> {
  const policy = deps.policy ?? defaultProvisionPolicy;
  const decision = policy(req, deps.cwd);
  if (!decision.allow) {
    // req.reason(why=감독이 왜 설치하려 했나) 을 관측에 연결(리뷰 must-fix·DEAD 필드 제거). decision.reason=거부 사유.
    debug.log('autopilot.provision', 'denied', { layer: req.layer, spec: req.spec, deniedReason: decision.reason, why: req.reason }, { level: 'warn' });
    // ★ decision.reason 은 **커스텀 정책**이 임의 문자열을 넣을 수 있어 PTY 재주입 前 sanitize(리뷰).
    return { ok: false, layer: req.layer, spec: req.spec, action: 'denied', detail: `설치 거부(${sanitizeForPtyInput(decision.reason, 140)}). 설치 없이 다른 방법으로 진행하라.` };
  }
  // ── L3 registry 분기(self skill/subagent) — argv 실행이 아니라 레지스트리 install + in-process reload. ──
  if (decision.kind === 'registry') {
    debug.log('autopilot.provision', 'install-start', { layer: req.layer, spec: req.spec, regLayer: decision.regLayer, source: decision.sourcePath, why: req.reason });
    const install = deps.installRegistry ?? defaultInstallRegistry;
    const res = await install(decision.regLayer, decision.name, decision.sourcePath);
    debug.log('autopilot.provision', res.ok ? 'installed' : 'install-fail', { spec: req.spec, regLayer: decision.regLayer, ok: res.ok }, { level: res.ok ? 'info' : 'warn' });
    // detail 은 자식 PTY 재주입 가능 → sanitize(설치 소스·이름·오류 문자열 신뢰 못 함).
    const safe = sanitizeForPtyInput(res.detail, 200);
    return { ok: res.ok, layer: req.layer, spec: req.spec, action: res.ok ? 'installed' : 'error', detail: res.ok ? safe : `${safe}. 설치 없이 다른 방법으로 진행하라.` };
  }
  // ── pkg 분기(외부/self 공통·argv 매니저 설치) — decision 은 여기서 kind:'pkg' 로 좁혀짐. ──
  const run = deps.run ?? defaultRun;
  debug.log('autopilot.provision', 'install-start', { layer: req.layer, spec: req.spec, manager: decision.manager, cwd: deps.cwd, why: req.reason });
  const r = await run(decision.cmd, decision.args, deps.cwd);
  const exitOk = r.status === 0;
  // ★ 설치 검증(리뷰) — exit 0 만으론 no-op(이미 설치)·부분성공도 "설치했다"로 오판한다. 실제 모듈 해석
  //   (node_modules/<pkg> 존재)까지 확인해야 진짜 성공. exit≠0 이면 검증 불필요(이미 실패).
  const resolved = exitOk ? (deps.resolved ?? ((c, s) => existsSync(join(c, 'node_modules', pkgDirName(s)))))(deps.cwd, req.spec) : false;
  const ok = exitOk && resolved;
  debug.log('autopilot.provision', ok ? 'installed' : (exitOk ? 'install-noop' : 'install-fail'), { spec: req.spec, manager: decision.manager, exit: r.status, resolved }, { level: ok ? 'info' : 'warn' });
  // ★ detail 은 자식 PTY 로 재주입되므로 신뢰 못 할 부분(spec·매니저명·매니저 출력)을 모두 sanitize(인젝션 차단).
  const safeSpec = sanitizeForPtyInput(req.spec, 80);
  const safeMgr = sanitizeForPtyInput(decision.manager, 20);
  if (ok) return { ok: true, layer: req.layer, spec: req.spec, action: 'installed', detail: `${safeMgr} 로 '${safeSpec}' 를 worktree 에 설치했다. 다시 시도하라.` };
  if (exitOk) return { ok: false, layer: req.layer, spec: req.spec, action: 'error', detail: `'${safeSpec}' 설치 명령은 성공했으나 모듈이 확인되지 않았다(no-op/부분). 설치 없이 다른 방법으로 진행하라.` };
  return { ok: false, layer: req.layer, spec: req.spec, action: 'error', detail: `'${safeSpec}' 설치 실패(exit ${r.status}). ${sanitizeForPtyInput(r.out, 200)}. 설치 없이 다른 방법으로 진행하라.` };
}

/**
 * ★ 미션 provision 배선 팩토리(리뷰 must-fix — DI 테스트가능) — worktree 경로를 provisionCapability 의 cwd 로
 *  못박는 provision 콜백을 만든다. runAgentMission 이 `buildMissionProvision(wt.path)` 로 배선하면, 이 팩토리를
 *  DI(주입 provisioner)로 단위검증해 "wt.path → cwd" 배선을 **행동으로** 확인할 수 있다(소스 문자열 tripwire 불요).
 *  provisioner 는 테스트 주입점(기본 provisionCapability).
 */
export function buildMissionProvision(
  worktreePath: string,
  provisioner: (req: ProvisionRequest, deps: ProvisionDeps) => Promise<ProvisionResult> = provisionCapability,
): (req: ProvisionRequest) => Promise<ProvisionResult> {
  return (req) => provisioner(req, { cwd: worktreePath });
}

/**
 * ★ self 프로비저닝 배선 팩토리(L3 · #7-5) — **monad 자신**(goal-loop)을 대상으로 provision 콜백을 만든다.
 *  buildMissionProvision(외부 자식·pkg-only)과 **물리적으로 분리** → 외부 경로 무회귀. 차이:
 *   ① 정책 = makeSelfProvisionPolicy(pkg + skill/subagent·allowlist) — pkg 뿐 아니라 레지스트리 계층 개방.
 *   ② cwd = monad repoRoot(pkg 는 monad 자신의 node_modules 에 설치).
 *   ③ 레지스트리 설치는 in-process reload(reloadSkillIndex/invalidateLayeredCache) — 재시작 0.
 *  ⚠️ resolve 미주입 시 **deny-all**(skill/subagent 자율 설치 전면 차단) — L3 실행권 확대의 안전 기본값.
 *  DI: provisioner/installRegistry 는 테스트 주입점.
 */
export function buildSelfProvision(opts: {
  readonly repoRoot: string;
  readonly resolve?: ArtifactResolver;
  readonly provisioner?: (req: ProvisionRequest, deps: ProvisionDeps) => Promise<ProvisionResult>;
  readonly installRegistry?: ProvisionDeps['installRegistry'];
}): (req: ProvisionRequest) => Promise<ProvisionResult> {
  const policy = makeSelfProvisionPolicy(opts.resolve ?? denyAllArtifactResolver);
  const provisioner = opts.provisioner ?? provisionCapability;
  return (req) => provisioner(req, { cwd: opts.repoRoot, policy, installRegistry: opts.installRegistry });
}

/**
 * ★ self provision CLI 계획(순수·테스트가능·리뷰) — (layer, spec, source, repoRoot) → dry-run 판정 + resolve +
 *  종료코드. CLI 는 이 헬퍼로 dry-run 을 출력하고 exitCode(허용=0·거부=1)를 그대로 쓴다(자동화가 거부를 성공으로
 *  오인 않도록·must-fix). resolve 는 skill/subagent + source 있을 때만 allowlist 개방(없으면 deny-all=안전 기본).
 */
export function planSelfProvision(
  layer: string,
  spec: string,
  source: string | undefined,
  repoRoot: string,
): { readonly decision: ProvisionDecision; readonly resolve: ArtifactResolver; readonly exitCode: 0 | 1 } {
  const resolve: ArtifactResolver = (layer === 'skill' || layer === 'subagent') && source
    ? makeAllowlistResolver([{ layer, name: spec, sourcePath: source }])
    : denyAllArtifactResolver;
  const decision = makeSelfProvisionPolicy(resolve)({ layer, spec }, repoRoot);
  return { decision, resolve, exitCode: decision.allow ? 0 : 1 };
}
