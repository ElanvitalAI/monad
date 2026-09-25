import { describe, expect, test } from 'bun:test';
import { podJobManifest, podJobName, podSelfImplementSpawn, type Kubectl } from './self-implement-pod.js';

const CREDS = () => ({ monadAuth: '{"m":1}', codexAuth: '{"c":1}', ghToken: 'gho_x' });

function fakeKubectl(conditions: string[], logs: string) {
  const calls: Array<{ args: string; input?: string }> = [];
  let polls = 0;
  const k: Kubectl = (args, input) => {
    calls.push({ args: args.join(' '), ...(input ? { input } : {}) });
    if (args.includes('get') && args.includes('job')) return { status: 0, stdout: conditions[Math.min(polls++, conditions.length - 1)] ?? '', stderr: '' };
    if (args.includes('logs')) return { status: 0, stdout: logs, stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { k, calls };
}

describe('podSelfImplementSpawn', () => {
  test('job names are per-run (parallel-safe) and k8s-valid', () => {
    const a = podJobName('orch-1234/goal A');
    const b = podJobName('orch-1234/goal B');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-z0-9-]{1,58}$/);
  });

  test('applies secret then job, polls to Complete, parses the last JSON line, deletes the secret, drops the pod-internal worktreePath', async () => {
    const json = JSON.stringify({ stage: 'pr-opened', ok: true, worktreePath: '/home/ubuntu/x', prUrl: 'https://github.com/o/r/pull/9', prNumber: 9 });
    const { k, calls } = fakeKubectl(['', '', 'Complete'], `noise\n${json}\n`);
    const spawn = podSelfImplementSpawn({ kubectl: k, sleep: async () => {}, credentials: CREDS, env: { MONAD_RUN_ID: 'run-7' } });
    const { address, done } = spawn({ feature: 'do x', spaceId: 'orch-1', openPr: true });
    expect(address).toBe('self-impl:orch-1');
    const r = await done;
    expect(r.exitCode).toBe(0);
    expect(r.disposition?.prUrl).toBe('https://github.com/o/r/pull/9');
    expect(r.disposition?.worktreePath).toBeUndefined();
    const applied = calls.filter((c) => c.args === 'apply -f -').map((c) => JSON.parse(c.input!));
    expect(applied.map((m) => m.kind)).toEqual(['Secret', 'Job']);
    expect(applied[0].stringData.feature).toBe('do x');
    const env = applied[1].spec.template.spec.containers[0].env;
    expect(env).toContainEqual({ name: 'MONAD_RUN_ID', value: 'run-7' });
    expect(env).toContainEqual({ name: 'MONAD_SUBSTRATE', value: 'pod' });
    expect(applied[1].spec.template.spec.containers[0].args[0]).toContain("'--open-pr'");
    expect(calls.some((c) => c.args.includes('delete secret'))).toBe(true);
  });

  test('a failed Job is a non-zero exit with a named error', async () => {
    const { k } = fakeKubectl(['Failed'], 'boom');
    const r = await podSelfImplementSpawn({ kubectl: k, sleep: async () => {}, credentials: CREDS })({ feature: 'x', spaceId: 's' }).done;
    expect(r.exitCode).toBe(1);
    expect(r.error?.code).toBe('pod-job-failed');
  });

  test('abort deletes the Job', async () => {
    const ac = new AbortController();
    ac.abort();
    const { k, calls } = fakeKubectl([''], '');
    const r = await podSelfImplementSpawn({ kubectl: k, sleep: async () => {}, credentials: CREDS })({ feature: 'x', spaceId: 's', signal: ac.signal }).done;
    expect(r.error?.code).toBe('aborted');
    expect(calls.some((c) => c.args.includes('delete job') && c.args.includes('--wait=false'))).toBe(true);
  });

  test('passEnv puts only present host keys into the secret and pod env (benchmark billing paths)', async () => {
    const { k, calls } = fakeKubectl(['Complete'], '');
    await podSelfImplementSpawn({ kubectl: k, sleep: async () => {}, credentials: CREDS, passEnv: ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY'], env: { OPENROUTER_API_KEY: 'sk-or-1' }, readKeyCache: () => undefined })({ feature: 'x', spaceId: 's' }).done;
    const [secret, job] = calls.filter((c) => c.args === 'apply -f -').map((c) => JSON.parse(c.input!));
    expect(Object.keys(secret.stringData)).toContain('env-OPENROUTER_API_KEY');
    expect(Object.keys(secret.stringData)).not.toContain('env-ANTHROPIC_API_KEY');
    // ⭐ 과금 키만 본다 — run-origin 칸(MONAD_POD_NAME 등)은 별도 시험이 문다.
    expect(job.spec.template.spec.containers[0].env.map((e: { name: string }) => e.name).filter((n: string) => n.endsWith('_API_KEY'))).toEqual(['OPENROUTER_API_KEY']);
  });

  test('every Job carries the isolation gate init container', () => {
    const m = podJobManifest({ name: 'n', namespace: 'monad-test', image: 'i', repoUrl: 'r', args: [], passEnv: [], deadlineSeconds: 60 }) as { spec: { template: { spec: { initContainers: Array<{ name: string }> } } } };
    expect(m.spec.template.spec.initContainers[0]!.name).toBe('isolation-gate');
  });
});

// RFC F2 — Pod 의 토큰·비용 rollup 한 줄 → 호스트 llm-usage 재방출.
import { reemitPodUsage } from './self-implement-pod.js';
import { rollup } from '../../../scripts/usage-rollup.js';
describe('pod usage rollup', () => {
  test('rollup groups llm-usage rows by site/provider/model and keeps unknown cost separate', () => {
    const rows = [
      JSON.stringify({ event: 'llm-usage', data: { site: 'agent-turn', provider: 'openai', model: 'gpt-6-sol', inputTokens: 100, outputTokens: 5, cost: { kind: 'known', usd: 0.5 } } }),
      JSON.stringify({ event: 'llm-usage', data: { site: 'agent-turn', provider: 'openai', model: 'gpt-6-sol', inputTokens: 50, outputTokens: 1, cost: { kind: 'unknown' } } }),
      JSON.stringify({ event: 'other', data: {} }),
      'monad logs: result may be truncated (limitReached=true)',
    ];
    const r = rollup(rows);
    expect(r.truncated).toBe(true);
    expect(r.rows).toEqual([{ site: 'agent-turn', provider: 'openai', model: 'gpt-6-sol', calls: 2, inputTokens: 150, outputTokens: 6, cacheReadInputTokens: 0, usdKnown: 0.5, unknownCostCalls: 1, includedCalls: 0, apiEquivalentUsd: 0 }]);
  });
  test('the host re-emits each row as llm-usage with a pod-rollup site; partial cost when some calls were unpriced', () => {
    const out: Array<{ c: string; e: string; d: Record<string, unknown> }> = [];
    const line = `MONAD_USAGE_ROLLUP ${JSON.stringify({ measured: true, runId: 'run-9', rows: [{ site: 'agent-turn', provider: 'openai', model: 'gpt-6-sol', calls: 2, inputTokens: 150, outputTokens: 6, cacheReadInputTokens: 0, usdKnown: 0.5, unknownCostCalls: 1 }] })}`;
    expect(reemitPodUsage(`x\n${line}\n{"ok":true}\n`, 'si-1', (c, e, d) => out.push({ c, e, d }))).toBe(1);
    expect(out[0]).toMatchObject({ c: 'llm.usage', e: 'llm-usage', d: { site: 'pod-rollup:agent-turn', inputTokens: 150, substrate: 'pod', job: 'si-1', podRunId: 'run-9', cost: { kind: 'partial', usd: 0.5 } } });
  });
  test('no rollup line → a named miss, nothing re-emitted', () => {
    const out: string[] = [];
    expect(reemitPodUsage('{"ok":true}', 'si-2', (_c, e) => out.push(e))).toBe(0);
    expect(out).toEqual(['usage-rollup-missing']);
  });
});

// RFC fleet 슈퍼바이저 §A3·F4 — 벤치 팔.
import { benchArmEnv, benchGoals, benchPodSpawn, parseBenchArms } from './self-implement-pod.js';
import { lookupLlmTierSpec } from '../../model-tier/llm-tier-map.js';
import { resolveEscalateTarget } from '../../self-implement/rework-policy.js';
describe('bench arms', () => {
  test('parses id=provider[:model][@KEY+KEY]', () => {
    expect(parseBenchArms('codex=openai-codex; or-kimi=openrouter:openrouter/moonshotai/kimi-k3@OPENROUTER_API_KEY; claude=anthropic:claude-sonnet-5@ANTHROPIC_API_KEY')).toEqual([
      { id: 'codex', provider: 'openai-codex', model: lookupLlmTierSpec('openai-codex', 'better').model, modelSource: 'ladder', passEnv: [] },
      { id: 'or-kimi', provider: 'openrouter', model: 'openrouter/moonshotai/kimi-k3', modelSource: 'explicit', passEnv: ['OPENROUTER_API_KEY'] },
      { id: 'claude', provider: 'anthropic', model: 'claude-sonnet-5', modelSource: 'explicit', passEnv: ['ANTHROPIC_API_KEY'] },
    ]);
  });
  test('rejects a single arm, duplicate ids and malformed parts', () => {
    expect(() => parseBenchArms('a=grok')).toThrow('둘 이상');
    expect(() => parseBenchArms('a=grok;a=openai-codex')).toThrow('겹친다');
    expect(() => parseBenchArms('a grok;b=grok')).toThrow('못 읽는');
  });
  test('goals differ by exactly one label line (A/B rule ②)', () => {
    const arms = parseBenchArms('a=grok;b=openai-codex');
    const [ga, gb] = benchGoals('대상 경로: x.md · 만든다', arms);
    expect(ga!.split('\n').slice(0, -1)).toEqual(gb!.split('\n').slice(0, -1));
    expect(ga).toEndWith('[bench-arm: a]');
    expect(gb).toEndWith('[bench-arm: b]');
  });
  test('each arm pod gets its provider/model/arm id and only its own billing key', async () => {
    const calls: Array<{ args: string; input?: string }> = [];
    const k = ((args: readonly string[], input?: string) => { calls.push({ args: args.join(' '), ...(input ? { input } : {}) }); return { status: 0, stdout: args.includes('get') ? 'Complete' : '', stderr: '' }; });
    const arms = parseBenchArms('codex=openai-codex;or-kimi=openrouter:openrouter/moonshotai/kimi-k3@OPENROUTER_API_KEY');
    const spawn = benchPodSpawn(arms, { kubectl: k, sleep: async () => {}, credentials: CREDS, env: {}, readKeyCache: (n) => (n === 'OPENROUTER_API_KEY' ? 'sk-or-cached' : undefined) });
    const [, gKimi] = benchGoals('g', arms);
    await spawn({ feature: gKimi!, spaceId: 's-kimi' }).done;
    const [secret, job] = calls.filter((c) => c.args === 'apply -f -').map((c) => JSON.parse(c.input!));
    expect(secret.stringData['env-OPENROUTER_API_KEY']).toBe('sk-or-cached');
    const env = job.spec.template.spec.containers[0].env as Array<{ name: string; value?: string }>;
    expect(env).toContainEqual({ name: 'MONAD_LLM_PROVIDER', value: 'openrouter' });
    expect(env).toContainEqual({ name: 'MONAD_LLM_MODEL', value: 'openrouter/moonshotai/kimi-k3' });
    expect(env).toContainEqual({ name: 'MONAD_ARM_ID', value: 'pod/or-kimi' });
  });
  test('an arm without a model never falls to the legacy provider constant', () => {
    const [claude] = parseBenchArms('claude=anthropic;codex=openai-codex');
    expect(claude!.model).toBe(lookupLlmTierSpec('anthropic', 'better').model);
    expect(claude!.model).not.toContain('haiku');
  });
  test('rework escalation stays inside the arm (sol and opus tiers)', () => {
    const [claude] = parseBenchArms('claude=anthropic:claude-sonnet-5;codex=openai-codex');
    const env = benchArmEnv(claude!);
    for (const tier of ['sol', 'opus'] as const) {
      expect(resolveEscalateTarget(tier, env)).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5' });
    }
    expect(resolveEscalateTarget('sol', {})!.provider).toBe('openai-codex');   // 대조군 — 덮지 않으면 codex 로 샌다
  });
  test('local arm: ladder model, host LLM url, and only its pod carries the local-llm egress label', async () => {
    const arms = parseBenchArms('local=local;codex=openai-codex');
    expect(arms[0]!.model).toBe(lookupLlmTierSpec('local', 'better').model);
    expect(benchArmEnv(arms[0]!).LOCAL_LLM_URL).toBe('http://host.orb.internal:1234/v1');
    expect(benchArmEnv(arms[1]!).LOCAL_LLM_URL).toBeUndefined();
    const labelsFor = async (goal: string): Promise<Record<string, string>> => {
      const calls: Array<{ args: string; input?: string }> = [];
      const k = ((args: readonly string[], input?: string) => { calls.push({ args: args.join(' '), ...(input ? { input } : {}) }); return { status: 0, stdout: args.includes('get') ? 'Complete' : '', stderr: '' }; });
      await benchPodSpawn(arms, { kubectl: k, sleep: async () => {}, credentials: CREDS, env: {} })({ feature: goal, spaceId: 's' }).done;
      const job = calls.filter((c) => c.args === 'apply -f -').map((c) => JSON.parse(c.input!)).find((m) => m.kind === 'Job');
      return job.spec.template.metadata.labels;
    };
    const [gLocal, gCodex] = benchGoals('g', arms);
    expect((await labelsFor(gLocal!))['monad.egress/local-llm']).toBe('true');
    expect((await labelsFor(gCodex!))['monad.egress/local-llm']).toBeUndefined();
  });
  test('a goal without a known arm label fails with a named error (no silent default arm)', async () => {
    const r = await benchPodSpawn(parseBenchArms('a=grok;b=openai-codex'), { credentials: CREDS })({ feature: 'no label', spaceId: 's' }).done;
    expect(r.error?.code).toBe('bench-arm-missing');
  });
});

// BACKLOG E6 — 이미지 판 대조.
import { podImageFreshness } from './self-implement-pod.js';
describe('pod image freshness', () => {
  const fake = (head: string | null, label: string | null, imageExists = true) => (cmd: string) =>
    cmd === 'git'
      ? { status: head ? 0 : 128, stdout: head ? `${head}\n` : '' }
      : { status: imageExists ? 0 : 1, stdout: label === null ? '<no value>\n' : `${label}\n` };
  test('fresh only when the image label equals HEAD', () => {
    expect(podImageFreshness({ run: fake('abc', 'abc') }).fresh).toBe(true);
    expect(podImageFreshness({ run: fake('abc', 'old') })).toMatchObject({ fresh: false, imageCommit: 'old', headCommit: 'abc' });
  });
  test('missing label, missing image, unreadable HEAD are all stale (never assumed fresh)', () => {
    expect(podImageFreshness({ run: fake('abc', null) }).fresh).toBe(false);
    expect(podImageFreshness({ run: fake('abc', 'abc', false) }).fresh).toBe(false);
    expect(podImageFreshness({ run: fake(null, 'abc') }).fresh).toBe(false);
  });
});

// BACKLOG C5·C1b — 모름을 0 으로 보이지 않고, 호스트가 다시 매긴다.
import { podRowCost } from './self-implement-pod.js';
describe('pod rollup row cost (BACKLOG C5·C1b)', () => {
  const row = { model: 'openrouter/moonshotai/kimi-k3', calls: 16, inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 0, usdKnown: 0, unknownCostCalls: 16 };
  test('all-unknown without a host price is unknown with usd null — never $0', () => {
    expect(podRowCost(row)).toEqual({ kind: 'unknown', usd: null, unknownCostCalls: 16 });
    expect(podRowCost(row, () => ({ kind: 'unknown' }))).toMatchObject({ kind: 'unknown', usd: null });
  });
  test('host reprice turns pod-unknown into known with its source named', () => {
    expect(podRowCost(row, () => ({ kind: 'known', usd: 3 }))).toEqual({ kind: 'known', usd: 3, source: 'host-reprice', podUnknownCostCalls: 16 });
  });
  test('fully known rows pass through; partial keeps the known share', () => {
    expect(podRowCost({ ...row, unknownCostCalls: 0, usdKnown: 1.5 })).toEqual({ kind: 'known', usd: 1.5, unknownCostCalls: 0 });
    expect(podRowCost({ ...row, unknownCostCalls: 4, usdKnown: 1.5 })).toEqual({ kind: 'partial', usd: 1.5, unknownCostCalls: 4 });
  });
});

// BACKLOG C6 — 구독·local 은 «포함»(청구 0)이고 «모름»이 아니다.
import { llmUsageCostFields } from '../../budget/llm-cost.js';
describe('included cost for subscription/local (BACKLOG C6)', () => {
  test('subscription call is included with an api-equivalent, not a known API charge', () => {
    const f = llmUsageCostFields('gpt-6-sol', { inputTokens: 1_000_000, outputTokens: 0 }, { configPricing: {} }, 'subscription');
    expect(f.cost).toMatchObject({ kind: 'included', usd: 0, billing: 'subscription', apiEquivalentUsd: 2 });
    expect(llmUsageCostFields('gpt-6-sol', { inputTokens: 1_000_000, outputTokens: 0 }, { configPricing: {} }, 'api').cost).toMatchObject({ kind: 'known', usd: 2 });
  });
  test('rollup counts included calls apart from unknown; pod row of all-included stays included', () => {
    const r = rollup([JSON.stringify({ event: 'llm-usage', data: { site: 'agent-turn', provider: 'openai', billingProvider: 'openai-codex', model: 'gpt-6-sol', inputTokens: 10, outputTokens: 1, cost: { kind: 'included', usd: 0, apiEquivalentUsd: 0.25 } } })]);
    expect(r.rows[0]).toMatchObject({ provider: 'openai-codex', calls: 1, unknownCostCalls: 0, includedCalls: 1, apiEquivalentUsd: 0.25, usdKnown: 0 });
    expect(podRowCost(r.rows[0] as unknown as Record<string, unknown>)).toMatchObject({ kind: 'included', usd: 0, apiEquivalentUsd: 0.25 });
  });
});

// 🅣 RFC run-origin(#20457 §A3) — Pod 가 자기 출처를 env 로 갖는다(칸 이름 합의).
describe('pod run-origin env (RFC run-origin §A3)', () => {
  test('downward API pod/node/namespace, supervisor hostId and image commit are in the child env', () => {
    const job = podJobManifest({ name: 'si-x', namespace: 'monad-test', image: 'monad-harness:local', repoUrl: 'r', args: [], passEnv: [], deadlineSeconds: 60, hostId: 'host-abc', imageCommit: 'deadbeef' }) as { spec: { template: { spec: { containers: Array<{ env: Array<Record<string, unknown>> }> } } } };
    const env = job.spec.template.spec.containers[0]!.env;
    expect(env).toContainEqual({ name: 'MONAD_POD_NAME', valueFrom: { fieldRef: { fieldPath: 'metadata.name' } } });
    expect(env).toContainEqual({ name: 'MONAD_NODE_NAME', valueFrom: { fieldRef: { fieldPath: 'spec.nodeName' } } });
    expect(env).toContainEqual({ name: 'MONAD_POD_NAMESPACE', valueFrom: { fieldRef: { fieldPath: 'metadata.namespace' } } });
    expect(env).toContainEqual({ name: 'MONAD_HOST_ID', value: 'host-abc' });
    expect(env).toContainEqual({ name: 'MONAD_IMAGE_COMMIT', value: 'deadbeef' });
  });
  test('rollup origin fields are re-emitted on the host', () => {
    const out: Array<Record<string, unknown>> = [];
    const line = `MONAD_USAGE_ROLLUP ${JSON.stringify({ runId: 'r1', podName: 'si-x-abc', nodeName: 'k3d-node-0', hostId: 'host-abc', rows: [{ site: 'agent-turn', model: 'gpt-6-sol', calls: 1, inputTokens: 1, outputTokens: 1, usdKnown: 0.1, unknownCostCalls: 0 }] })}`;
    reemitPodUsage(line, 'si-x', (_c, _e, d) => out.push(d));
    expect(out[0]).toMatchObject({ podName: 'si-x-abc', nodeName: 'k3d-node-0', podHostId: 'host-abc' });
  });
});
