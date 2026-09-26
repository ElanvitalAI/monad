#!/usr/bin/env bun
// ── Self-Evolution · 로드맵 → 멀티페이즈 플랜 분해 (기존 TOX 재사용·2026-07-11) ──
// 발굴된 미구현 로드맵을 elanous 의 정식 TOX TaskGenerator.decompose() 로 분해한다.
// 새 분해기 금지 — 기존 엔진(dependsOn 그래프·acceptance 검증·재귀·비용) 재사용.
// 프롬프트는 4대 에이전트 패턴 보강본(generator-prompt.ts). 사용: bun scripts/se-decompose-roadmap.ts <내부 문서 `ROADMAP-*`>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TaskGenerator, type DecomposeCallable } from '../src/task-orchestrator/generator.js';
import { streamLLM, resolveDefaultProvider } from '../src/llm.js';

const repoRoot = join(import.meta.dir, '..');
const docArg = process.argv[2] ?? 'docs/archive/2026-04/ROADMAP-task-orchestrator.md';
const docPath = join(repoRoot, docArg);
const text = readFileSync(docPath, 'utf-8');

// 로드맵 실제 미완 항목 추출(목표 컨텍스트).
const openItems = text.split('\n').filter(l => /^\s*[-*]\s*\[ \]/.test(l))
  .map(l => l.trim().replace(/^[-*]\s*\[ \]\s*/, '')).slice(0, 20);
const title = (text.match(/^#\s*(.+)$/m)?.[1] ?? docArg).trim();

const objective = [
  `내부 미구현 로드맵 "${title}"(${docArg})을 elanous 에 구현한다.`,
  `미완 항목 ${openItems.length}개(발췌):`,
  ...openItems.map((it, i) => `  ${i + 1}. ${it}`),
  '',
  '위 로드맵을 실행 가능한 멀티페이즈 태스크로 분해하라. 각 태스크는 검증 가능(acceptance)하고,',
  '건드릴 파일과 재사용할 기존 함수를 description 에 명시하며, dependsOn 으로 순서를 표현하라.',
].join('\n');

// production LLM callable(streamLLM + 기본 provider) 재사용.
const provider = resolveDefaultProvider(undefined);
const callable: DecomposeCallable = async ({ prompt, signal }) => {
  const t = await streamLLM([{ role: 'user', content: prompt }], () => {},
    { ...(provider ? { provider } : {}), ...(signal ? { signal } : {}) });
  return { text: t, modelId: provider?.name };
};

console.log(`\n=== TOX 분해: ${title} (미완 ${openItems.length}개·provider ${provider?.name ?? '?'}) ===\n`);
const gen = new TaskGenerator({ callable });
const result = await gen.decompose({
  objective,
  context: { attachedFiles: [{ path: docArg, kind: 'doc', summary: `${title} 로드맵` }], goalSlug: 'se-decompose-demo' },
  constraints: { maxTasks: 7 },
  goalKind: 'coding',
  depth: 0,
});

const p = result.proposal;
console.log(`분해 근거(rationale): ${p.rationale}\n`);
console.log(`태스크 ${p.tasks.length}개${result.requiresApproval ? ` · ⚠️ 승인 필요(${result.approvalReasons.join(', ')})` : ''} · 예상 $${result.estimatedTotalUsd.toFixed(2)} · retry ${result.retries}\n`);
for (const t of p.tasks) {
  const deps = t.dependsOn?.length ? ` ←의존[${t.dependsOn.join(',')}]` : ' (독립)';
  console.log(`[${t.index}] ${t.title}${deps}  ·surface=${t.surface.kind}·${t.priority ?? 'medium'}`);
  if (t.description) console.log(`     ${t.description.slice(0, 220)}`);
  if (t.acceptance?.criteria?.length) console.log(`     ✓검증: ${t.acceptance.criteria.slice(0, 2).join(' / ')}`);
  const checks = t.acceptance?.checks?.map(c => c.kind).join(',');
  if (checks) console.log(`     ✓결정론체크: ${checks}`);
  console.log('');
}
