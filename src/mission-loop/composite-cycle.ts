import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { loadMissionBlueprint, type MissionBlueprintLoadResult } from '../mission-blueprints/loader.js';
import type { CapabilityRef, MissionBlueprint, RuntimeFileDeliveryOutcome } from '../mission-blueprints/types.js';
import { getMonadConfigDir } from '../monad-config-dir.js';
import { debug } from '../debug/log.js';
import { capabilityProviders, type CapabilityProbeResult, type CapabilityProvider } from '../mission-capabilities/registry.js';
import { judgeMissionRequests, type MissionRequestJudgeResult } from './judge.js';

export interface HarnessGoal {
  requestId: string;
  paths: readonly string[];
  situation: string;
  /**
   * ⭐ 하니스에 그대로 넘기는 골 본문.
   * ⛔ 이 저장소의 저작기는 «형태»로 문다 — 세 판정자가 각각 다른 줄을 본다:
   *    대상 경로   ***첫 비어 있지 않은 줄***이 `대상 경로:` 라벨이어야 한다
   *                📏 실측(2026-08-31): 첫 줄이 `Situation:` 이면 labelMissing:true · paths:[] — ***경로를 통째로 잃는다***
   *    불변식      `불변식: <보존 문장>`
   *    판정 신호   `판정 신호: 조건 = <조건>; 관측 = <명령>; 기대 = <결과>`
   * ⇒ 셋이 다 없으면 자식은 무엇을 지킬지도, 무엇으로 끝났다 할지도 모른다.
   */
  ask: string;
}

export interface CompositeCycleDependencies {
  judge?(authorityRoot: string): MissionRequestJudgeResult;
  loadBlueprint?(options: { authorityRoot: string; requestId: string; requestRequires: readonly CapabilityRef[]; catalog: readonly CapabilityProvider[] }): Promise<MissionBlueprintLoadResult>;
  catalog?: readonly CapabilityProvider[];
  createHarnessGoal?(goal: HarnessGoal): Promise<void> | void;
  isRequestInFlight?(requestId: string): boolean | Promise<boolean>;
  signal?: AbortSignal;
  resolveDeliveryRoot?(): string;
  persistBody?(path: string, body: string): void;
}

export type CompositeCycleAction =
  | { requestId: string; action: 'goal-created'; goal: HarnessGoal }
  | { requestId: string; action: 'deferred' }
  | { requestId: string; action: 'in-flight' }
  | { requestId: string; action: 'executed'; body: string; measured: Record<string, number | string>; deliver: readonly string[]; fileDelivery: RuntimeFileDeliveryOutcome }
  | { requestId: string; action: 'escalated'; reason: string }
  | { requestId: string; action: 'ignored'; reason: string };

export interface CompositeCycleResult {
  actions: readonly CompositeCycleAction[];
}

interface RequestAuthority {
  id: string;
  requires: readonly CapabilityRef[];
}

function requestAuthority(root: string, file: string): RequestAuthority | undefined {
  const source = readFileSync(join(root, 'docs', 'mission-requests', file), 'utf8');
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(source)?.[1];
  if (!frontmatter) return undefined;
  const get = (key: string): string | undefined => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(frontmatter)?.[1]?.trim();
  const id = get('id');
  const requires = get('requires');
  if (!id || !requires) return undefined;
  return { id, requires: requires.replace(/^\[|\]$/g, '').split(',').map(id => ({ id: id.trim() })).filter(capability => capability.id) };
}

/**
 * ⛔ 판정기는 «절대 경로»를 낸다. 골 ask 의 대상 경로는 «저장소 상대»여야 한다 —
 *   절대 경로에 './' 를 덧붙이면 `import('.//private/tmp/…')` 같은 깨진 지정자가 된다(리뷰 3R must-fix).
 */
function repoRelative(root: string, path: string): string {
  if (!isAbsolute(path)) return path.replace(/^\.\//, '');
  const rel = relative(root, path);
  return rel.startsWith('..') ? path : rel;
}

/** ⛔ 대상 경로 라벨이 «첫 줄»이어야 파서가 문다. 그 뒤에 불변식·판정 신호를 «형식대로» 붙인다. */
function buildAsk(root: string, requestId: string, paths: readonly string[], situation: string, signals: readonly string[], repair?: string): string {
  const target = paths.length > 0 ? paths.map(path => repoRelative(root, path)).join(' · ') : '(경로 미상 — 아래 Situation 을 읽어라)';
  return [
    `대상 경로: ${target}`,
    '',
    `# ${situation}`,
    '',
    '## Situation',
    '',
    situation,
    ...(repair ? ['', `고칠 곳: ${repair}`] : []),
    '',
    `요청 id: ${requestId}`,
    '',
    '## 불변식',
    '',
    '불변식: `src/mission-capabilities/registry.ts` 를 고치지 않는다 — 능력 조회는 경로 규칙이라 등록 절차가 «없다».',
    '불변식: `src/mission-capabilities/` 아래의 능력 파일을 하나도 지우지 않는다. `ls src/mission-capabilities/*/*.ts` 로 센 파일 수가 이 골 전후로 줄지 않는다.',
    '불변식: `docs/mission-requests/` 아래의 요청 문서를 고치지 않는다 — 그 프론트매터가 이 골의 «권위»다.',
    '',
    '## 판정 신호',
    '',
    ...signals,
    '',
  ].join('\n');
}

function capabilitySignals(root: string, paths: readonly string[]): readonly string[] {
  const first = paths.length > 0 ? repoRelative(root, paths[0]!) : 'src/mission-capabilities/<도메인>/<능력>.ts';
  // ⛔ 저장소 뿌리에서 치는 명령이다. 상대 경로에만 './' 를 붙인다 —
  //   repoRelative 는 «권위 트리 밖» 경로를 절대 그대로 돌려주므로, 거기에도 './' 를 붙이면
  //   다시 import('.//abs/path') 가 된다(리뷰 4R should-fix · 3R must-fix 의 «잔여»다).
  const specifier = isAbsolute(first) ? first : `./${first}`;
  const press = `bun -e "const m = await import('${specifier}'); console.log(JSON.stringify(await m.default.probe()))"`;
  return [
    `판정 신호: 조건 = 그 능력 파일을 세웠다; 관측 = ${press}; 기대 = ok 필드를 가진 값이 나온다`,
    `판정 신호: 조건 = 그 능력이 기대는 외부 상태를 비운다; 관측 = ${press}; 기대 = ok:false 와 reason 과 repairHint.paths 가 나온다`,
    `판정 신호: 조건 = 그 외부 상태를 채운다; 관측 = ${press}; 기대 = ok:true 가 나온다 — 즉 같은 코드가 «외부 상태»로 갈린다`,
    '판정 신호: 조건 = probe 의 판정 줄을 항상 ok:true 로 바꾼다; 관측 = bun test test/mission-capabilities/; 기대 = 그 시험이 빨강이 된다',
  ];
}

function blueprintSignals(): readonly string[] {
  return [
    '판정 신호: 조건 = 블루프린트를 세웠다; 관측 = bun scripts/mission-request-judge.ts --root .; 기대 = 그 요청이 missing-blueprint 로 나오지 않는다',
    '판정 신호: 조건 = 로더에 그 파일을 준다; 관측 = bun test test/mission-blueprints/; 기대 = 검증을 통과해 invalid 가 아니다',
    '판정 신호: 조건 = 요청 프론트매터의 requires 와 블루프린트의 requires 를 맞춰 본다; 관측 = bun test test/mission-blueprints/; 기대 = 블루프린트가 그 요구를 전부 덮는다',
  ];
}

function goal(root: string, requestId: string, paths: readonly string[], situation: string, signals: readonly string[], repair?: string): HarnessGoal {
  return { requestId, paths, situation, ask: buildAsk(root, requestId, paths, situation, signals, repair) };
}

type ProbeFailureResolution =
  | { action: 'goal'; goal: HarnessGoal; branch: 'missing-capability' }
  | { action: 'escalated'; reason: string; branch: 'external-state' | 'repository-outside' };

function capabilityFileExists(root: string, capabilityId: string): boolean {
  const [directory, ...rest] = capabilityId.split('.');
  const path = join(root, 'src', 'mission-capabilities', directory!, `${rest.join('.')}.ts`);
  try { return statSync(path).isFile(); } catch { return false; }
}

function isRepositoryPath(root: string, candidate: string): boolean {
  const candidatePath = isAbsolute(candidate) ? candidate : resolve(root, candidate);
  const pathFromRoot = relative(root, candidatePath);
  return pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(pathFromRoot);
}

/** ⛔ 전부 안일 때 situation 은 probe 의 reason 을 «그대로» 쓴다 — 시험이 그것을 계약으로 고정했다(verbatim). */
function probeFailureGoal(root: string, requestId: string, capabilityId: string, result: Extract<CapabilityProbeResult, { ok: false }>): ProbeFailureResolution {
  if (capabilityFileExists(root, capabilityId)) {
    return { action: 'escalated', branch: 'external-state', reason: result.repairHint.what };
  }
  const insidePaths = result.repairHint.paths.filter(path => isRepositoryPath(root, path));
  const outsidePaths = result.repairHint.paths.filter(path => !isRepositoryPath(root, path));
  if (insidePaths.length === 0 && outsidePaths.length > 0) {
    return { action: 'escalated', branch: 'repository-outside', reason: `${result.reason} Repository-outside repair paths: ${outsidePaths.join(', ')}` };
  }
  const situation = outsidePaths.length > 0
    ? `${result.reason}\n\nOmitted repository-outside repair paths: ${outsidePaths.join(', ')}`
    : result.reason;
  return {
    action: 'goal',
    branch: 'missing-capability',
    goal: goal(root, requestId, insidePaths, situation, capabilitySignals(root, insidePaths), result.repairHint.what),
  };
}

async function handleProbeFailure(root: string, requestId: string, capabilityId: string, result: Extract<CapabilityProbeResult, { ok: false }>, dependencies: CompositeCycleDependencies, actions: CompositeCycleAction[]): Promise<void> {
  const resolution = probeFailureGoal(root, requestId, capabilityId, result);
  logCompositeEvent('probe-failure-classified', { requestId, capabilityId, branch: resolution.branch, capabilityFileExists: capabilityFileExists(root, capabilityId) });
  if (resolution.action === 'escalated') actions.push({ requestId, action: 'escalated', reason: resolution.reason });
  else await createGoal(resolution.goal, dependencies, actions);
}

/**
 * ⛔ 생성기가 «없으면» goal-created 라고 말하지 않는다 — 아무 일도 안 일어났는데 성공으로 읽힌다(리뷰 지적).
 * ⛔ 던지면 회차 전체를 죽이지 않고 그 요청만 escalated 로 낸다.
 */
export function persistBlueprintBody(requestId: string, body: string, dependencies: Pick<CompositeCycleDependencies, 'resolveDeliveryRoot' | 'persistBody'> = {}): RuntimeFileDeliveryOutcome {
  try {
    if (body.length === 0) throw new Error('blueprint body is empty');
    const deliveryRoot = dependencies.resolveDeliveryRoot?.() ?? getMonadConfigDir();
    const path = join(deliveryRoot, 'mission-delivery', `${requestId.replace(/[^a-zA-Z0-9._-]/g, '_')}.md`);
    if (dependencies.persistBody) dependencies.persistBody(path, body);
    else {
      mkdirSync(join(deliveryRoot, 'mission-delivery'), { recursive: true });
      writeFileSync(path, body, 'utf8');
    }
    return { status: 'persisted', path, bytes: Buffer.byteLength(body) };
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

async function createGoal(
  action: HarnessGoal,
  deps: CompositeCycleDependencies,
  actions: CompositeCycleAction[],
): Promise<void> {
  const create = deps.createHarnessGoal;
  if (!create) {
    actions.push({ requestId: action.requestId, action: 'escalated', reason: 'harness-goal-creator-unavailable' });
    return;
  }
  // ⛔ 던지면 «전파»한다 — 이 회차는 한 발만 쏘므로 삼켜서 계속할 이유가 없고,
  //   CLI 가 그것을 비영 종료 코드로 드러낸다(escalated 로 접으면 exit 0 이 되어 조용해진다).
  await create(action);
  actions.push({ requestId: action.requestId, action: 'goal-created', goal: action });
}

function logCompositeEvent(event: string, data: Record<string, unknown>): void {
  try { debug.log('mission-loop.composite', event, data); } catch { /* observability is fail-soft */ }
}

function logDecision(action: CompositeCycleAction): void {
  const data: Record<string, unknown> = { requestId: action.requestId, action: action.action };
  if (action.action === 'escalated' || action.action === 'ignored') data.reason = action.reason;
  if (action.action === 'goal-created') data.paths = action.goal.paths;
  logCompositeEvent('request-decision', data);
  if (action.action === 'escalated') logCompositeEvent('escalated', { requestId: action.requestId, reason: action.reason });
}

export async function runCompositeCycle(authorityRoot: string, dependencies: CompositeCycleDependencies = {}): Promise<CompositeCycleResult> {
  const root = resolve(authorityRoot);
  const judge = dependencies.judge ?? judgeMissionRequests;
  const loadBlueprint = dependencies.loadBlueprint ?? loadMissionBlueprint;
  const catalog = dependencies.catalog ?? capabilityProviders;
  const providerById = new Map(catalog.map(provider => [provider.id, provider]));
  const actions: CompositeCycleAction[] = [];
  const record = (action: CompositeCycleAction): void => { actions.push(action); logDecision(action); };

  // The judge can fail before the request count is knowable; record the boundary first
  // without representing that unknown value as an empty cycle.
  logCompositeEvent('cycle-started', { requestCount: 'unknown' });
  try {
    const judged = judge(root);
    logCompositeEvent('requests-judged', { requestCount: judged.judgments.length });

    for (const judgment of judged.judgments) {
      if (judgment.status === 'invalid-request') {
        record({ requestId: judgment.file, action: 'ignored', reason: judgment.reasons.join('; ') });
        continue;
      }
      let authority: RequestAuthority | undefined;
      try {
        authority = requestAuthority(root, judgment.file);
      } catch (error) {
        record({ requestId: judgment.file, action: 'escalated', reason: error instanceof Error ? error.message : String(error) });
        continue;
      }
      if (!authority) {
        record({ requestId: judgment.file, action: 'escalated', reason: 'request-authority-unreadable' });
        continue;
      }
      if (await dependencies.isRequestInFlight?.(authority.id)) {
        record({ requestId: authority.id, action: 'in-flight' });
        continue;
      }
      if (judgment.status === 'missing-capability') {
        const missingPaths = judgment.missingCapabilities.map(item => item.path);
        await createGoal(goal(root, authority.id, missingPaths, `Capability provider unavailable: ${judgment.missingCapabilities.map(item => item.id).join(', ')}`, capabilitySignals(root, missingPaths)), dependencies, actions);
        logDecision(actions.at(-1)!);
        return { actions };
      }

      let failedProbe: { capabilityId: string; result: Extract<CapabilityProbeResult, { ok: false }> } | undefined;
      let probeError: { capabilityId: string; error: unknown } | undefined;
      for (const required of authority.requires) {
        const provider = providerById.get(required.id);
        if (!provider) {
          failedProbe = { capabilityId: required.id, result: { ok: false, reason: `Capability provider unavailable: ${required.id}`, repairHint: { paths: [], what: 'register provider' } } };
          break;
        }
        try {
          const result = await provider.probe();
          if (!result.ok) {
            failedProbe = { capabilityId: required.id, result };
            break;
          }
        } catch (error) {
          probeError = { capabilityId: required.id, error };
          break;
        }
      }
      if (probeError) {
        const reason = probeError.error instanceof Error ? probeError.error.message : String(probeError.error);
        logCompositeEvent('probe-failure-classified', { requestId: authority.id, capabilityId: probeError.capabilityId, branch: 'probe-error', capabilityFileExists: capabilityFileExists(root, probeError.capabilityId) });
        record({ requestId: authority.id, action: 'escalated', reason });
        continue;
      }
      if (failedProbe) {
        await handleProbeFailure(root, authority.id, failedProbe.capabilityId, failedProbe.result, dependencies, actions);
        logDecision(actions.at(-1)!);
        return { actions };
      }

      let loaded: MissionBlueprintLoadResult;
      try {
        loaded = await loadBlueprint({ authorityRoot: root, requestId: authority.id, requestRequires: authority.requires, catalog });
      } catch (error) {
        record({ requestId: authority.id, action: 'escalated', reason: error instanceof Error ? error.message : String(error) });
        continue;
      }
      if (loaded.status === 'unavailable') {
        await handleProbeFailure(root, authority.id, loaded.capabilityId, {
          ok: false,
          reason: loaded.reason,
          repairHint: loaded.repairHint,
        }, dependencies, actions);
        logDecision(actions.at(-1)!);
        return { actions };
      }
      if (loaded.status !== 'ready') {
        await createGoal(goal(root, authority.id, [loaded.path], loaded.status === 'missing' ? 'Mission blueprint is missing.' : `Mission blueprint is invalid: ${loaded.reason}`, blueprintSignals()), dependencies, actions);
        logDecision(actions.at(-1)!);
        return { actions };
      }
      try {
        const result = await loaded.blueprint.run({ authorityRoot: root, capabilities: providerById, signal: dependencies.signal ?? new AbortController().signal });
        const fileDelivery = persistBlueprintBody(authority.id, result.body, dependencies);
        record({ requestId: authority.id, action: 'executed', body: result.body, measured: result.measured, deliver: loaded.blueprint.produces.deliver, fileDelivery });
      } catch (error) {
        record({ requestId: authority.id, action: 'escalated', reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return { actions };
  } finally {
    logCompositeEvent('cycle-completed', {
      goalCreatedCount: actions.filter(action => action.action === 'goal-created').length,
      escalatedCount: actions.filter(action => action.action === 'escalated').length,
    });
  }
}
