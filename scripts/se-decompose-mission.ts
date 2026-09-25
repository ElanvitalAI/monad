#!/usr/bin/env bun
// ── Self-Evolution · 자유형 미션 → 멀티페이즈 분해 도그푸드 (2026-07-11) ──────
// se-decompose-roadmap.ts 의 자유형 판 — 로드맵 doc 이 아니라 임의 미션 문장을 정식
// TaskGenerator.decompose() 로 분해해 "멀티페이즈 분해 로직이 미션 분해로 작동하는지"
// 검증한다. 새 분해기 금지 — 기존 엔진(dependsOn 그래프·acceptance·재귀·비용) 재사용.
// 사용: bun scripts/se-decompose-mission.ts "<미션 문장>" [--max N] [--json]

import { TaskGenerator, type DecomposeCallable } from '../src/task-orchestrator/generator.js';
import { streamLLM, resolveDefaultProvider } from '../src/llm.js';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const maxIdx = args.indexOf('--max');
const maxTasks = maxIdx >= 0 ? Number(args[maxIdx + 1]) : 8;
const mission = args.filter((a, i) => !a.startsWith('--') && !(maxIdx >= 0 && i === maxIdx + 1)).join(' ')
  || 'Persistence migration, NL acceptance 평가 + self-heal';

const objective = [
  `monad 에 다음 미션을 구현한다: "${mission}"`,
  '',
  '이 미션을 실행 가능한 멀티페이즈 태스크로 분해하라. 각 태스크는:',
  '- 검증 가능한 acceptance(자연어 criteria + 가능하면 결정론적 check)를 가진다.',
  '- 건드릴 파일과 재사용할 기존 함수를 description 에 명시한다(새 엔진/직렬화기 금지·재사용 우선).',
  '- dependsOn 으로 페이즈 순서를 표현한다(예: 스키마 → 마이그레이션 → 평가 → self-heal → 테스트).',
  '- 매매/arming/safety/재부팅 등 불변 코어는 건드리지 않는다.',
].join('\n');

const provider = resolveDefaultProvider(undefined);
const callable: DecomposeCallable = async ({ prompt, signal }) => {
  const t = await streamLLM([{ role: 'user', content: prompt }], () => {},
    { ...(provider ? { provider } : {}), ...(signal ? { signal } : {}) });
  return { text: t, modelId: provider?.name };
};

if (!jsonOut) console.log(`\n=== 미션 분해 도그푸드 ===\n미션: ${mission}\nprovider: ${provider?.name ?? '?'} · maxTasks: ${maxTasks}\n`);

const gen = new TaskGenerator({ callable });
const result = await gen.decompose({
  objective,
  context: { goalSlug: 'se-mission-dogfood' },
  constraints: { maxTasks },
  goalKind: 'coding',
  depth: 0,
});

const p = result.proposal;
if (jsonOut) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }

console.log(`분해 근거: ${p.rationale}\n`);
console.log(`페이즈(태스크) ${p.tasks.length}개${result.requiresApproval ? ` · ⚠️승인필요(${result.approvalReasons.join(', ')})` : ''} · 예상 $${result.estimatedTotalUsd.toFixed(2)} · retry ${result.retries}\n`);
for (const t of p.tasks) {
  const deps = t.dependsOn?.length ? ` ←의존[${t.dependsOn.join(',')}]` : ' (독립)';
  console.log(`[${t.index}] ${t.title}${deps}  ·surface=${t.surface?.kind ?? '?'}·${t.priority ?? 'medium'}`);
  if (t.description) console.log(`     ${t.description.slice(0, 260)}`);
  if (t.acceptance?.criteria?.length) console.log(`     ✓criteria(NL): ${t.acceptance.criteria.slice(0, 3).join(' / ')}`);
  const checks = t.acceptance?.checks?.map((c) => c.kind).join(',');
  if (checks) console.log(`     ✓결정론체크: ${checks}`);
  console.log('');
}
