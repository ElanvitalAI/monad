// ☸️ self-implement 자식을 k8s Job(Pod)으로 — 슈퍼바이저(`self orchestrate`)의 세 번째 실행 칸.
//
// 계약은 로컬 spawn(`defaultSelfImplementSpawn`)과 «같다»: 입력 → { address, done }. 그래서 분해·동시 실행 상한·
// 감독 루프·원장이 수정 없이 따라온다(RFC-elanous-on-docker-and-kubernetes-isolation-ladder · ROADMAP C2).
// Pod 안에서는 같은 명령 `elanous self implement "<feature>" --json …` 을 치고, 마지막 줄 JSON 을 Job 로그로 읽는다.
//
// 📏 2026-09-25 실측 근거(docker/harness · docker/runner):
//   · 자격 = 호스트 계정의 «refresh 없는» 사본(1회용 refresh 보호) — Secret(읽기 전용) → 쓰기 가능한 홈으로 복사.
//   · 격리 관문(initContainer) 필수 — kube-router 는 새 Pod 에 정책을 늦게 건다(첫 ~0.5초 운영 31415 에 닿음 3/3).
//   · 이미지는 `docker/harness/Dockerfile`(elanous 설치 ⊕ 정적 codex·짝·rg·gh) — 이 모듈은 이미지를 «만들지» 않는다.
// ⛔ worktreePath 는 Pod 안 경로라 호스트에서 쓸 수 없다 → disposition 에서 지운다.
// 부작용(kubectl·파일)은 주입받는다 — 시험은 가짜 kubectl 로 누른다.

import { podSkillsDigest, readSkillEnvFiles, resolvePodSkills } from './pod-skills.js';
import { controlInboxEnv } from '../../harness/control-inbox.js';
import { finishPodFragment, writePodFragment } from '../../harness/self-send-target.js';

export const POD_CONTROL_INBOX_DIR = '/tmp/elanous-control.inbox';
import type { PodPoolMember, PodPoolScheduler } from './pod-pool.js';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { debug } from '../../debug/log.js';
import { authStorePath } from '../../oauth/store.js';
import { resolveHostId } from '../../platform/host-id.js';
import { LLM_TIER_MAP_BY_PROVIDER, lookupLlmTierSpec, type LlmTierProvider } from '../../model-tier/llm-tier-map.js';
import { parseSelfImplementJson, type SelfImplementJobDone, type SelfImplementJobSpawn } from './self-implement.js';

export type Kubectl = (args: readonly string[], input?: string) => { status: number | null; stdout: string; stderr: string };

export interface PodSpawnOptions {
  /** 이미지 판(라벨 elanous.commit) — 주입(시험·감독기가 이미 잰 값). 없으면 docker 로 잰다. */
  imageCommit?: string | null;
  /** codex 계정 이름(`~/.elanous/auth.json` 의 `openai-codex:<이름>`). 기본 team. */
  account?: string;
  /** Job 마다 계정을 고른다(pod-account-broker) — 있으면 `account` 보다 먼저. */
  accountBroker?: () => string;
  namespace?: string;
  /** 클러스터 안 이미지(`docker/harness/run.sh` 가 만드는 `elanous-harness:local`). */
  image?: string;
  repoUrl?: string;
  /** 호스트 환경에서 읽어 Pod env 로 넣을 키 이름(예: OPENROUTER_API_KEY · ANTHROPIC_API_KEY) — 벤치마크 과금 경로. */
  passEnv?: readonly string[];
  /** 자식 `self implement` 에 덧붙일 인자. */
  extraArgs?: readonly string[];
  /** Pod 에 그대로 넣을 «비밀 아닌» env — 벤치 팔의 `ELANOUS_LLM_PROVIDER`·`ELANOUS_LLM_MODEL`·`ELANOUS_ARM_ID`. */
  armEnv?: Readonly<Record<string, string>>;
  /** Job 수명 상한(초). */
  deadlineSeconds?: number;
  pollMs?: number;
  kubectl?: Kubectl;
  /** 🔑 Pod 필수 스킬의 키(.env)를 이 런의 Secret 으로 넘긴다 — 명시 opt-in(유료 크레딧을 쓴다). */
  skillEnv?: boolean;
  /** 스킬 키 읽기(시험 주입) — `{ <스킬>: <.env 내용> }`. */
  readSkillEnv?: () => Record<string, string>;
  /** ☸️ 여러 클러스터 풀(pod-pool.ts) — Job 마다 우선순위 순 첫 빈 자리로. 없으면 현재 컨텍스트 하나. */
  pool?: PodPoolScheduler;
  sleep?: (ms: number) => Promise<void>;
  credentials?: () => { elanousAuth: string; codexAuth: string; ghToken: string };
  /** 호스트 키 캐시(`~/.cache/<소문자 이름>`)에서 키를 읽는다(시험 주입) — env 에 없을 때. */
  readKeyCache?: (name: string) => string | undefined;
  env?: NodeJS.ProcessEnv;
}

export function defaultKubectl(args: readonly string[], input?: string): { status: number | null; stdout: string; stderr: string } {
  // 셸 프록시가 kubectl 의 로컬 API 요청을 가로챈다(2026-09-25 실측) — 자식 env 에서 뺀다.
  const env = { ...process.env };
  for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) delete env[k];
  const r = spawnSync('kubectl', [...args], { encoding: 'utf8', input, env, timeout: 120_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: (r.stderr ?? '') + (r.error ? String(r.error) : '') };
}

/** Job·Secret 이름 — 런마다 다르게(병렬) · k8s 이름 규칙(소문자·숫자·하이픈 · 63자 이하). */
export function podJobName(spaceId: string): string {
  const slug = spaceId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const hash = createHash('sha256').update(spaceId).digest('hex').slice(0, 8);
  return `si-${slug || 'job'}-${hash}`.replace(/-+/g, '-').slice(0, 58);
}

/** 호스트 계정 → refresh 없는 사본(elanous 저장소 ⊕ codex auth.json) ⊕ gh 토큰. */
export function hostCredentials(account: string, storePath: string = authStorePath(), ghToken: () => string = defaultGhToken): { elanousAuth: string; codexAuth: string; ghToken: string } {
  // 경로는 해석기로(격리 게이트 · 2026-09-25) — 손으로 `~/.elanous/auth.json` 을 조립하면 test↔prod 격리가 새는 자리가 된다.
  const store = JSON.parse(readFileSync(storePath, 'utf8')) as { version?: number; providers: Record<string, Record<string, unknown>> };
  const entry = store.providers[`openai-codex:${account}`] as { tokens: Record<string, unknown>; lastRefresh?: string; authMode?: string; codexHome?: string } | undefined;
  if (!entry?.codexHome) throw new Error(`openai-codex:${account} 계정이 없거나 codexHome 을 모른다`);
  const codex = JSON.parse(readFileSync(join(entry.codexHome, 'auth.json'), 'utf8')) as { tokens: Record<string, unknown> };
  const access = String(codex.tokens.access_token ?? '');
  const exp = Number(JSON.parse(Buffer.from(access.split('.')[1] ?? '', 'base64url').toString('utf8') || '{}').exp ?? 0);
  if (exp * 1000 - Date.now() < 3 * 3600_000) throw new Error(`openai-codex:${account} access token 이 3시간 안에 만료 — 호스트에서 먼저 갱신(컨테이너는 갱신 못 한다)`);
  const elanousAuth = JSON.stringify({
    version: store.version ?? 1,
    providers: { 'openai-codex': { tokens: { ...entry.tokens, refreshToken: '' }, lastRefresh: entry.lastRefresh, authMode: entry.authMode, chatGPT: { accountId: codex.tokens.account_id } } },
  });
  const codexAuth = JSON.stringify({ ...codex, tokens: { ...codex.tokens, refresh_token: '' } });
  return { elanousAuth, codexAuth, ghToken: ghToken() };
}

/** 키 캐시 관례: `~/.cache/<env 이름 소문자>`(예: OPENROUTER_API_KEY → ~/.cache/openrouter_api_key · src/config.ts 와 같다). */
function defaultReadKeyCache(name: string): string | undefined {
  try { const v = readFileSync(join(homedir(), '.cache', name.toLowerCase()), 'utf8').trim(); return v || undefined; } catch { return undefined; }
}

function defaultGhToken(): string {
  const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout.trim()) throw new Error('gh auth token 실패 — 호스트에서 gh auth login');
  return r.stdout.trim();
}

const GATE = `ok=0
for i in $(seq 1 60); do
  if curl -s -m 1 -o /dev/null http://host.orb.internal:31415/health || curl -s -m 1 -o /dev/null http://core.elanous-prod:8080/; then ok=0; else ok=$((ok+1)); fi
  [ "$ok" -ge 3 ] && { echo "[gate] isolation enforced after \${i} probes"; exit 0; }
  sleep 0.5
done
echo "[gate] ISOLATION NOT ENFORCED within 30s"; exit 1`;

/** Job 매니페스트(JSON) — docker/harness/job.yaml 과 같은 격리(관문 ⊕ 읽기 전용 Secret ⊕ 한도). */
export function podJobManifest(o: { name: string; namespace: string; image: string; repoUrl: string; args: readonly string[]; passEnv: readonly string[]; deadlineSeconds: number; runId?: string; armEnv?: Readonly<Record<string, string>>; hostId?: string; imageCommit?: string | null; skillEnvs?: readonly string[]; memoryLimit?: string }): Record<string, unknown> {
  const quoted = o.args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
  const script = [
    'set -u',
    'mkdir -p ~/.elanous ~/.codex && cp /creds/elanous-auth.json ~/.elanous/auth.json && cp /creds/codex-auth.json ~/.codex/auth.json && chmod 600 ~/.elanous/auth.json ~/.codex/auth.json',
    'export GH_TOKEN="$(cat /creds/gh-token)"',
    // 🔑 스킬 키(.env) — 이미지엔 없다. 이 런의 Secret 에서 각 스킬 폴더로 0600 복사(값은 로그에 안 나온다).
    ...(o.skillEnvs?.length ? [`for n in ${o.skillEnvs.join(' ')}; do [ -d ~/.claude/skills/$n ] && install -m 600 /creds/skillenv-$n ~/.claude/skills/$n/.env; done; echo "[pod] skill env: ${o.skillEnvs.join(',')}"`] : []),
    'git config --global user.name "elanous pod child" && git config --global user.email "noreply@anthropic.com" && gh auth setup-git',
    'curl -s -m 3 -o /dev/null http://host.orb.internal:31415/health && { echo "[pod] ISOLATION FAIL"; exit 3; }',
    `git clone -q --depth 50 '${o.repoUrl}' repo && cd repo || exit 5`,
    // self implement 의 마지막 줄 JSON 이 «맨 끝»이어야 한다(parseSelfImplementJson) — rollup 은 그 앞에.
    `elanous self implement "$(cat /creds/feature)" --json ${quoted} > /tmp/si.out 2>&1; rc=$?`,
    'cat /tmp/si.out',
    '[ -f scripts/usage-rollup.ts ] && bun scripts/usage-rollup.ts --since 12h || echo "ELANOUS_USAGE_ROLLUP {\"measured\":false,\"reason\":\"no rollup script\"}"',
    'tail -n 1 /tmp/si.out',
    'exit $rc',
  ].join('\n');
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name: o.name, namespace: o.namespace, labels: { 'elanous.substrate': 'pod', 'elanous.job': o.name } },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: 7200,
      activeDeadlineSeconds: o.deadlineSeconds,
      template: {
        // ⭐ Pod 라벨 — local 팔만 `elanous.egress/local-llm` 을 단다. docker/h1/policy-local-llm.yaml 이 그 라벨에만 호스트 LLM 포트 «하나»를 연다.
        metadata: { labels: { 'elanous.job': o.name, ...(o.armEnv?.ELANOUS_LLM_PROVIDER === 'local' ? { 'elanous.egress/local-llm': 'true' } : {}) } },
        spec: {
          restartPolicy: 'Never',
          securityContext: { runAsUser: 1000, fsGroup: 1000 },
          initContainers: [{ name: 'isolation-gate', image: o.image, imagePullPolicy: 'Never', command: ['bash', '-c'], args: [GATE] }],
          containers: [{
            name: 'child', image: o.image, imagePullPolicy: 'Never',
            // 📏 09-25: 6Gi 는 빠듯했다 — 자식이 6,127Mi 에 붙어 OOMKilled(137). 기본 12Gi · ELANOUS_POD_MEMORY 로 조정.
            resources: { limits: { memory: o.memoryLimit ?? '12Gi', cpu: '4' } },
            command: ['bash', '-c'], args: [script],
            env: [
              // 토큰 관측(`llm.usage`)이 부모 런에 묶이게 — debug.log 는 ELANOUS_RUN_ID 를 data.runId 로 붙인다.
              ...(o.runId ? [{ name: 'ELANOUS_RUN_ID', value: o.runId }] : []),
              { name: 'ELANOUS_SUBSTRATE', value: 'pod' },
              ...Object.entries(controlInboxEnv(POD_CONTROL_INBOX_DIR)).map(([name, value]) => ({ name, value })),
              // ⭐ 런 출처(🅣 RFC run-origin §A3 · #20457/#20468 칸 이름) — Pod 는 자기 elanous_id 를 쓰지 않고 «띄운 감독기»의 hostId 를 물려받는다.
              { name: 'ELANOUS_POD_NAME', valueFrom: { fieldRef: { fieldPath: 'metadata.name' } } },
              { name: 'ELANOUS_NODE_NAME', valueFrom: { fieldRef: { fieldPath: 'spec.nodeName' } } },
              { name: 'ELANOUS_POD_NAMESPACE', valueFrom: { fieldRef: { fieldPath: 'metadata.namespace' } } },
              ...(o.hostId ? [{ name: 'ELANOUS_HOST_ID', value: o.hostId }] : []),
              ...(o.imageCommit ? [{ name: 'ELANOUS_IMAGE_COMMIT', value: o.imageCommit }] : []),
              ...Object.entries(o.armEnv ?? {}).map(([name, value]) => ({ name, value })),
              ...o.passEnv.map((key) => ({ name: key, valueFrom: { secretKeyRef: { name: `${o.name}-creds`, key: `env-${key}` } } })),
            ],
            volumeMounts: [{ name: 'creds', mountPath: '/creds', readOnly: true }],
          }],
          volumes: [{ name: 'creds', secret: { secretName: `${o.name}-creds`, defaultMode: 0o400 } }],
        },
      },
    },
  };
}

export function podSelfImplementSpawn(options: PodSpawnOptions = {}): SelfImplementJobSpawn {
  const baseKubectl = options.kubectl ?? defaultKubectl;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const namespace = options.namespace ?? 'elanous-test';
  const image = options.image ?? 'elanous-harness:local';
  const repoUrl = options.repoUrl ?? 'https://github.com/ElanvitalAI/monad';
  const env = options.env ?? process.env;
  return (input) => {
    const name = podJobName(input.spaceId);
    const address = `self-impl:${input.spaceId}`;
    const args = [
      ...(input.base ? ['--base', input.base] : []),
      ...(input.autoMerge ? ['--auto-merge'] : []),
      ...(input.autoReview ? ['--auto-review'] : []),
      ...(input.openPr ? ['--open-pr'] : []),
      ...(input.draft === false ? ['--no-draft'] : []),
      ...(options.extraArgs ?? []),
    ];
    const done = (async (): Promise<SelfImplementJobDone> => {
      // ☸️ 풀이면 자리를 잡는다(우선순위 순 · 다 차면 기다린다) — 그 노드의 컨텍스트로 모든 호출을 묶는다.
      let member: PodPoolMember | null = null;
      if (options.pool) {
        for (;;) {
          if (input.signal?.aborted) return { exitCode: null, output: '', error: { code: 'aborted', message: 'aborted before a pool slot opened' } };
          member = options.pool.tryAcquire();
          if (member) break;
          await sleep(options.pollMs ?? 15_000);
        }
        debug.log('self-implement.pod', 'pool-slot', { spaceId: input.spaceId, context: member.context, inflight: options.pool.snapshot() });
      }
      const currentContext = member ? null : baseKubectl(['config', 'current-context']);
      const context = member?.context ?? (currentContext?.status === 0 ? currentContext.stdout.trim() : '');
      const kubectl: Kubectl = (args, stdin) => baseKubectl(['--context', context, ...args], stdin);
      let recorded = false;
      try {
      if (!context) return { exitCode: 1, output: '', error: { code: 'pod-context', message: 'Pod Job context를 확인할 수 없다' } };
      const cleanupSecret = () => { kubectl(['-n', namespace, 'delete', 'secret', `${name}-creds`, '--ignore-not-found']); };
      try {
        const account = options.accountBroker?.() ?? options.account ?? 'team';
        debug.log('self-implement.pod', 'account', { spaceId: input.spaceId, account, brokered: Boolean(options.accountBroker) });
        const creds = (options.credentials ?? (() => hostCredentials(account)))();
        const skillEnvs: Record<string, string> = options.skillEnv
          ? (options.readSkillEnv ?? (() => readSkillEnvFiles(resolvePodSkills(env).skills)))()
          : {};
        if (options.skillEnv) debug.log('self-implement.pod', 'skill-env', { job: name, skills: Object.keys(skillEnvs) });   // ⛔ 이름만 — 값은 안 싣는다
        const secret = {
          apiVersion: 'v1', kind: 'Secret', type: 'Opaque',
          metadata: { name: `${name}-creds`, namespace, labels: { 'elanous.job': name } },
          stringData: {
            'elanous-auth.json': creds.elanousAuth, 'codex-auth.json': creds.codexAuth, 'gh-token': creds.ghToken, feature: input.feature,
            ...Object.fromEntries(Object.entries(skillEnvs).map(([n, text]) => [`skillenv-${n}`, text])),
            ...Object.fromEntries((options.passEnv ?? []).map((k) => [k, env[k] ?? (options.readKeyCache ?? defaultReadKeyCache)(k)] as const).filter(([, v]) => v).map(([k, v]) => [`env-${k}`, v!])),
          },
        };
        const hostKey = (k: string): string | undefined => env[k] ?? (options.readKeyCache ?? defaultReadKeyCache)(k);
        const passEnv = (options.passEnv ?? []).filter((k) => hostKey(k));
        const missing = (options.passEnv ?? []).filter((k) => !hostKey(k));
        if (missing.length) debug.log('self-implement.pod', 'pass-env-missing', { job: name, missing }, { level: 'warn' });
        const s = kubectl(['apply', '-f', '-'], JSON.stringify(secret));
        if (s.status !== 0) return { exitCode: 1, output: s.stderr, error: { code: 'pod-secret', message: s.stderr.trim() } };
        kubectl(['-n', namespace, 'delete', 'job', name, '--ignore-not-found']);
        const job = podJobManifest({ name, namespace, image, repoUrl, args, passEnv, deadlineSeconds: options.deadlineSeconds ?? 5400, ...(env.ELANOUS_RUN_ID ? { runId: env.ELANOUS_RUN_ID } : {}), ...(options.armEnv ? { armEnv: options.armEnv } : {}), hostId: resolveHostId(env), skillEnvs: Object.keys(skillEnvs), ...(env.ELANOUS_POD_MEMORY?.trim() ? { memoryLimit: env.ELANOUS_POD_MEMORY.trim() } : {}), imageCommit: options.imageCommit !== undefined ? options.imageCommit : options.kubectl ? null : podImageFreshness({ image }).imageCommit });   // kubectl 주입(=시험)이면 docker 를 부르지 않는다
        const a = kubectl(['apply', '-f', '-'], JSON.stringify(job));
        if (a.status !== 0) { cleanupSecret(); return { exitCode: 1, output: a.stderr, error: { code: 'pod-apply', message: a.stderr.trim() } }; }
        writePodFragment({ spaceId: input.spaceId, context, namespace, job: name, inboxDir: POD_CONTROL_INBOX_DIR }, env);
        recorded = true;
        debug.log('self-implement.pod', 'job-applied', { job: name, namespace, ...(member ? { context: member.context } : {}), image, spaceId: input.spaceId, passEnv, extraArgs: options.extraArgs ?? [], ...(options.armEnv?.ELANOUS_ARM_ID ? { armId: options.armEnv.ELANOUS_ARM_ID } : {}) });
        let state: 'complete' | 'failed' | 'aborted' = 'failed';
        for (;;) {
          if (input.signal?.aborted) {
            kubectl(['-n', namespace, 'delete', 'job', name, '--ignore-not-found', '--wait=false']);
            state = 'aborted';
            break;
          }
          const g = kubectl(['-n', namespace, 'get', 'job', name, '-o', 'jsonpath={.status.conditions[*].type}']);
          const types = g.stdout;
          if (/Complete|SuccessCriteriaMet/.test(types)) { state = 'complete'; break; }
          if (/Failed|FailureTarget/.test(types)) { state = 'failed'; break; }
          await sleep(options.pollMs ?? 15_000);
        }
        const logs = kubectl(['-n', namespace, 'logs', `job/${name}`, '-c', 'child', '--tail=400']).stdout;
        cleanupSecret();
        // ⭐ 호스트 단가로 다시 매긴다(BACKLOG C1b) — Pod 엔 레지스트리 스냅숏이 없다.
        const { estimateLlmCost } = await import('../../budget/llm-cost.js');
        reemitPodUsage(logs, name, undefined, (u) => estimateLlmCost(u) as { kind: string; usd?: number });
        const parsed = parseSelfImplementJson(logs);
        // Pod 안 경로는 호스트에서 쓸 수 없다.
        const disposition = parsed ? { ...parsed, worktreePath: undefined } : undefined;
        debug.log('self-implement.pod', 'job-finished', { job: name, ...(member ? { context: member.context } : {}), state, stage: disposition?.stage ?? null, prUrl: disposition?.prUrl ?? null });
        const tail = logs.slice(-4000);
        if (state === 'aborted') return { exitCode: null, output: tail, error: { code: 'aborted', message: 'aborted — Job deleted' }, ...(disposition ? { disposition } : {}) };
        return {
          exitCode: state === 'complete' ? 0 : 1,
          output: tail,
          ...(state === 'failed' ? { error: { code: 'pod-job-failed', message: `Job ${name} failed` } } : {}),
          ...(disposition ? { disposition } : {}),
        };
      } catch (err) {
        cleanupSecret();
        const message = err instanceof Error ? err.message : String(err);
        debug.log('self-implement.pod', 'job-error', { job: name, message }, { level: 'error' });
        return { exitCode: 1, output: message, error: { code: 'pod-error', message } };
      }
      } finally {
        if (recorded) finishPodFragment(input.spaceId, env);
        if (member) options.pool!.release(member);
      }
    })();
    return { address, done };
  };
}

/** Pod 가 낸 `ELANOUS_USAGE_ROLLUP` 한 줄 → 호스트 logs.db 에 `llm-usage`(site=`pod-rollup:<site>`)로 재방출(RFC F2).
 *  Pod 의 logs.db 는 Pod 와 함께 사라지므로 이것이 그 칸의 토큰·비용이 남는 유일한 자리다. */
/** Pod 롤업 한 행의 비용 칸 (BACKLOG C5 · C1b).
 *  ⛔ «모름»을 0 으로 보이지 않는다 — 전부 모르면 `kind:'unknown', usd:null`.
 *  ⭐ Pod 엔 단가 스냅숏이 없어 «모름»이 나기 쉽다. 호스트는 레지스트리(OpenRouter `/models` 폴드)를 알므로
 *    «토큰 합계»로 다시 매긴다(단가는 선형이라 합계로 매겨도 같다) → `source:'host-reprice'`. */
export type PodRowReprice = (u: { model: string; inputTokens: number; outputTokens: number; cacheReadInputTokens: number }) => { kind: string; usd?: number } | null;
export function podRowCost(r: Record<string, unknown>, reprice?: PodRowReprice): Record<string, unknown> {
  const calls = Number(r.calls ?? 0);
  const unknown = Number(r.unknownCostCalls ?? 0);
  const usdKnown = typeof r.usdKnown === 'number' ? r.usdKnown : 0;
  const included = Number(r.includedCalls ?? 0);
  // ⭐ 전부 구독·local(C6) — 청구 0 · API 환산가는 따로.
  if (calls > 0 && included >= calls) return { kind: 'included', usd: 0, includedCalls: included, ...(typeof r.apiEquivalentUsd === 'number' ? { apiEquivalentUsd: r.apiEquivalentUsd } : {}) };
  if (unknown === 0) return { kind: 'known', usd: usdKnown, unknownCostCalls: 0, ...(included ? { includedCalls: included } : {}) };
  const host = reprice?.({ model: String(r.model ?? ''), inputTokens: Number(r.inputTokens ?? 0), outputTokens: Number(r.outputTokens ?? 0), cacheReadInputTokens: Number(r.cacheReadInputTokens ?? 0) });
  if (host && host.kind === 'known' && typeof host.usd === 'number') return { kind: 'known', usd: host.usd, source: 'host-reprice', podUnknownCostCalls: unknown };
  if (calls > 0 && unknown >= calls) return { kind: 'unknown', usd: null, unknownCostCalls: unknown };
  return { kind: 'partial', usd: usdKnown, unknownCostCalls: unknown };
}

export function reemitPodUsage(logs: string, job: string, log: (category: string, event: string, data: Record<string, unknown>) => void = (c, e, d) => debug.log(c, e, d), reprice?: PodRowReprice): number {
  const line = logs.split('\n').reverse().find((l) => l.startsWith('ELANOUS_USAGE_ROLLUP '));
  if (!line) { log('self-implement.pod', 'usage-rollup-missing', { job }); return 0; }
  let parsed: { measured?: boolean; truncated?: boolean; runId?: string | null; armId?: string | null; podName?: string | null; nodeName?: string | null; hostId?: string | null; rows?: Array<Record<string, unknown>> };
  try { parsed = JSON.parse(line.slice('ELANOUS_USAGE_ROLLUP '.length)); } catch { log('self-implement.pod', 'usage-rollup-unparsable', { job }); return 0; }
  const rows = parsed.rows ?? [];
  for (const r of rows) {
    const cost = podRowCost(r, reprice);
    log('llm.usage', 'llm-usage', {
      site: `pod-rollup:${String(r.site)}`, provider: r.provider, model: r.model, calls: r.calls,
      inputTokens: r.inputTokens, outputTokens: r.outputTokens, cacheReadInputTokens: r.cacheReadInputTokens,
      cost,
      substrate: 'pod', job, ...(parsed.runId ? { podRunId: parsed.runId } : {}), ...(parsed.armId ? { armId: parsed.armId } : {}),
      ...(parsed.podName ? { podName: parsed.podName } : {}), ...(parsed.nodeName ? { nodeName: parsed.nodeName } : {}), ...(parsed.hostId ? { podHostId: parsed.hostId } : {}),
    });
  }
  log('self-implement.pod', 'usage-rollup', { job, rows: rows.length, measured: parsed.measured ?? null, truncated: parsed.truncated ?? null });
  return rows.length;
}

/** 이 기계가 Pod 칸을 쓸 수 있나(클러스터 · 이미지) — 발사 전 한 번. */
export function podSubstrateReady(kubectl: Kubectl = defaultKubectl, image = 'elanous-harness:local'): { ok: boolean; reason: string } {
  const ctx = kubectl(['config', 'current-context']);
  if (ctx.status !== 0) return { ok: false, reason: 'kubectl context 없음 — k3d cluster create elanous-h1 --no-lb' };
  const ns = kubectl(['get', 'ns', 'elanous-test']);
  if (ns.status !== 0) return { ok: false, reason: 'elanous-test 네임스페이스 없음 — kubectl apply -f docker/h1/base.yaml -f docker/h1/policy-internet.yaml' };
  void image;
  return { ok: true, reason: `context ${ctx.stdout.trim()}` };
}


// ── 벤치 팔 (RFC fleet 슈퍼바이저 §A3·F4) ─────────────────────────────────────────────
export interface BenchArm {
  id: string; provider: string; model?: string; passEnv: string[];
  /** 모델을 누가 정했나 — `explicit`(스펙에 적었다) · `ladder`(그 provider 사다리 `better` 칸에서 채웠다). */
  modelSource?: 'explicit' | 'ladder';
}

/** ⛔ 벤치 팔의 모델은 «비워 두지 않는다» — 비우면 provider 마다 옛 상수로 떨어진다.
 *  🩸 09-25 실측: codex 팔이 `gpt-4o-mini`(400 · #20425) · claude 팔이 `claude-haiku-4-5` 로 돌았다.
 *  ⇒ 사다리가 있는 provider 는 `better` 칸으로 채우고 그 사실을 `modelSource` 로 남긴다. */
function ladderModelFor(provider: string): string | undefined {
  if (!(provider in LLM_TIER_MAP_BY_PROVIDER)) return undefined;
  return lookupLlmTierSpec(provider as LlmTierProvider, 'better').model;
}

/** `id=provider[:model][@KEY+KEY]` 를 `;` 로 잇는다 — 예 `codex=openai-codex; or-kimi=openrouter:openrouter/moonshotai/kimi-k3@OPENROUTER_API_KEY`. */
export function parseBenchArms(spec: string): BenchArm[] {
  const arms = spec.split(';').map((x) => x.trim()).filter(Boolean).map((part) => {
    const m = /^([a-z0-9][a-z0-9-]*)=([a-z0-9-]+)(?::([^@]+))?(?:@([A-Z0-9_+]+))?$/i.exec(part);
    if (!m) throw new Error(`--bench-arms: 못 읽는 팔 「${part}」 — 형식 id=provider[:model][@KEY+KEY]`);
    const provider = m[2]!;
    const explicit = m[3]?.trim();
    const model = explicit || ladderModelFor(provider);
    return {
      id: m[1]!.toLowerCase(), provider,
      ...(model ? { model, modelSource: explicit ? 'explicit' as const : 'ladder' as const } : {}),
      passEnv: m[4] ? m[4].split('+') : [],
    };
  });
  const ids = new Set(arms.map((a) => a.id));
  if (ids.size !== arms.length) throw new Error('--bench-arms: 팔 id 가 겹친다');
  if (arms.length < 2) throw new Error('--bench-arms: 팔은 둘 이상');
  return arms;
}

export const BENCH_ARM_LABEL = /\[bench-arm: ([a-z0-9-]+)\]/;

/** 골 하나 → 팔마다 «라벨 한 줄만» 다른 골(A/B 매뉴얼 규칙 ②). */
export function benchGoals(goal: string, arms: readonly BenchArm[]): string[] {
  return arms.map((a) => `${goal.trim()}\n[bench-arm: ${a.id}]`);
}

/** 라벨로 팔을 찾아 그 팔의 provider·model·과금 키로 Pod 를 띄운다. */
export function benchPodSpawn(arms: readonly BenchArm[], base: PodSpawnOptions = {}): SelfImplementJobSpawn {
  const byId = new Map(arms.map((a) => [a.id, a]));
  return (input) => {
    const id = BENCH_ARM_LABEL.exec(input.feature)?.[1];
    const arm = id ? byId.get(id) : undefined;
    if (!arm) return { address: `self-impl:${input.spaceId}`, done: Promise.resolve({ exitCode: 1, output: 'no bench arm label', error: { code: 'bench-arm-missing', message: `골에 [bench-arm: <id>] 라벨이 없다(팔: ${[...byId.keys()].join(', ')})` } }) };
    return podSelfImplementSpawn({ ...base, armEnv: benchArmEnv(arm), passEnv: [...(base.passEnv ?? []), ...arm.passEnv] })(input);
  };
}

/** 팔 하나의 Pod env. ⛔⭐ 재작업 «승급»도 팔 안에 가둔다.
 *  🩸 09-25 실측: anthropic 팔의 호출 40건 중 22건(입력 123만 토큰)이 codex `gpt-6-sol` 이었다 —
 *    gate/감독 재작업 라운드가 명시 자식 LLM 이 없으면 `resolveEscalateTarget`(codex sol · anthropic opus)으로
 *    승급하고, 그 env 가 `ELANOUS_LLM_PROVIDER` 를 이긴다(`user-config.ts` escalate → runtime → config).
 *  ⇒ 두 승급 칸(`sol`·`opus`)의 provider·model 을 팔의 값으로 덮는다. 팔 = «한 모델»이 벤치의 불변식이다. */
export function benchArmEnv(arm: BenchArm): Record<string, string> {
  const env: Record<string, string> = { ELANOUS_ARM_ID: `pod/${arm.id}`, ELANOUS_LLM_PROVIDER: arm.provider };
  if (arm.model) env.ELANOUS_LLM_MODEL = arm.model;
  // 🖥️ local 팔 — 호스트의 OpenAI 호환 서버(LM Studio 기본 1234). Pod 에서 호스트는 `host.orb.internal`(OrbStack).
  //   ⛔ 사설망 차단 정책이 기본이라 라벨(`elanous.egress/local-llm`) ⊕ policy-local-llm.yaml 이 그 포트 하나만 연다.
  if (arm.provider === 'local') env.LOCAL_LLM_URL = process.env.ELANOUS_BENCH_LOCAL_LLM_URL?.trim() || 'http://host.orb.internal:1234/v1';
  for (const tier of ['SOL', 'OPUS']) {
    env[`ELANOUS_SELFDEV_${tier}_PROVIDER`] = arm.provider;
    if (arm.model) env[`ELANOUS_SELFDEV_${tier}_MODEL`] = arm.model;
  }
  return env;
}

// ── 이미지 판 (BACKLOG E6) ────────────────────────────────────────────────────────────
/** Pod 안의 `elanous` 는 이미지에 구운 설치본이다 — clone 한 main 이 아니다.
 *  🩸 09-25: 11:08 이미지가 그 뒤 착지한 수리 넷(#20425·#20428·#20429·#20433)을 몰라, anthropic 팔이
 *    main 에서 고쳐진 400 으로 세 판 연속 죽었다. 벤치가 «main» 이 아니라 «이미지 판»을 쟀다.
 *  ⇒ 라벨 `elanous.commit`(docker/harness/build.sh)과 이 트리 HEAD 를 대조한다. */
export interface PodImageFreshness { imageCommit: string | null; headCommit: string | null; fresh: boolean; reason: string }

export function podImageFreshness(deps: {
  run?: (cmd: string, args: readonly string[]) => { status: number | null; stdout: string };
  image?: string;
  cwd?: string;
  /** 지금 설정의 Pod 스킬 세트 해시(pod-skills.ts). 생략 시 — run 을 주입한 시험이면 대조하지 않고, 아니면 실제로 잰다. */
  skillsDigest?: () => string;
} = {}): PodImageFreshness {
  const run = deps.run ?? ((cmd, args) => { const r = spawnSync(cmd, [...args], { encoding: 'utf8', timeout: 20_000, ...(deps.cwd ? { cwd: deps.cwd } : {}) }); return { status: r.status, stdout: r.stdout ?? '' }; });
  const image = deps.image ?? 'elanous-harness:local';
  const head = run('git', ['rev-parse', 'HEAD']);
  const headCommit = head.status === 0 ? head.stdout.trim() || null : null;
  const img = run('docker', ['image', 'inspect', image, '--format', '{{index .Config.Labels "elanous.commit"}}']);
  const label = img.status === 0 ? img.stdout.trim() : '';
  const imageCommit = label && label !== '<no value>' ? label : null;
  if (!headCommit) return { imageCommit, headCommit, fresh: false, reason: 'HEAD 를 못 읽었다 — 판정 불가(낡음으로 본다)' };
  if (img.status !== 0) return { imageCommit, headCommit, fresh: false, reason: `이미지 ${image} 없음` };
  if (!imageCommit) return { imageCommit, headCommit, fresh: false, reason: '이미지에 elanous.commit 라벨이 없다(build.sh 전 판)' };
  // ☸️ 스킬 세트가 바뀌었으면(설정 목록·스킬 내용) 코드가 같아도 낡았다.
  const digestOf = deps.skillsDigest ?? (deps.run ? undefined : () => podSkillsDigest(resolvePodSkills().skills).digest);
  if (digestOf && imageCommit === headCommit) {
    const want = digestOf();
    const lab = run('docker', ['image', 'inspect', image, '--format', '{{index .Config.Labels "elanous.pod-skills"}}']);
    const have = lab.status === 0 ? lab.stdout.trim() : '';
    if (have !== want) return { imageCommit, headCommit, fresh: false, reason: `Pod 스킬 세트가 바뀌었다(이미지 ${have && have !== '<no value>' ? have : '없음'} ≠ 지금 ${want})` };
  }
  return imageCommit === headCommit
    ? { imageCommit, headCommit, fresh: true, reason: 'HEAD 와 같다' }
    : { imageCommit, headCommit, fresh: false, reason: `이미지 ${imageCommit.slice(0, 12)} ≠ HEAD ${headCommit.slice(0, 12)}` };
}
