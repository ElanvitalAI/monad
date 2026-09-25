#!/usr/bin/env bun
// ── Self-Evolution 검증 V0 · 발굴·플랜 품질 리포트 (2026-07-10) ────────────
// se-discovery-cycle 과 동일 발굴 → seeds + 플랜 초안 + 실 근거(내부 미완 체크박스·외부
// 커밋)를 렌더. **미션/파일/큐 생성 0(READ-ONLY 미리보기).** 대표 품질 평가용.
// 사용: bun scripts/se-v0-quality-report.ts [--sync]

import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { scanDocs } from '../src/autopilot/discovery/doc-inventory.js';
import { rankUnimplemented, filterAlreadyImplemented, countStrongTopicMatches } from '../src/autopilot/discovery/roadmap-scan.js';
import { openSurfaceEventsDb, surfaceEventsDbPath, recallEvents } from '../src/domains/surface-events.js';
import { SELF_DOMAIN } from '../src/domains/self-awareness.js';
import { syncAllRefs, REF_REPOS } from '../src/autopilot/discovery/ref-sync.js';
import { digCommits, clusterByArea, synthesizeCandidates, type AbsorptionCandidate } from '../src/autopilot/discovery/ref-dig.js';
import { planProposals } from '../src/autopilot/discovery/discovery-cycle.js';
import { buildPlanDraft } from '../src/autopilot/proposal/draft-plan.js';

const repoRoot = join(import.meta.dir, '..');
const nowMs = Date.parse(new Date().toISOString());
const doSync = process.argv.includes('--sync');

function makeSelfRecall() {
  if (!existsSync(surfaceEventsDbPath())) return undefined;
  return async (query: string) => {
    const db = openSurfaceEventsDb();
    try { return { hits: countStrongTopicMatches(recallEvents(db, { domain: SELF_DOMAIN, query, sinceHours: 720, limit: 40, bump: false }), query) }; }
    catch { return { hits: 0 }; } finally { db.close(); }
  };
}

/** 로드맵 문서의 실제 미완 체크박스 첫 N줄(근거). */
function openBoxLines(path: string, n = 6): string[] {
  try {
    return readFileSync(join(repoRoot, path), 'utf-8').split('\n')
      .filter(l => /^\s*[-*]\s*\[ \]/.test(l))
      .slice(0, n).map(l => l.trim().replace(/^[-*]\s*\[ \]\s*/, '').slice(0, 100));
  } catch { return []; }
}

// ── 발굴(se-discovery-cycle 과 동일) ──
const entries = scanDocs(join(repoRoot, 'docs'));
const ranked = rankUnimplemented(entries, { nowMs });
const { live, likelyDone } = await filterAlreadyImplemented(ranked, makeSelfRecall());
const unimplemented = live.slice(0, 6);

let absorption: AbsorptionCandidate[] = [];
if (doSync) for (const r of syncAllRefs()) console.error(`[sync] ${r.key}: ${r.note}`);
for (const repo of REF_REPOS) {
  const commits = digCommits(repo.dir, null, undefined, 40);
  absorption.push(...synthesizeCandidates(repo.key, clusterByArea(commits), 2));
}
absorption = absorption.sort((a, b) => b.score - a.score).slice(0, 4);

const plans = planProposals({ unimplemented, absorption, internalCap: 3, externalCap: 2 });

// ── 리포트 렌더 ──
const L: string[] = [];
L.push('# Self-Evolution 검증 V0 · 발굴·플랜 품질 리포트');
L.push('');
L.push(`> READ-ONLY 미리보기(미션/파일 생성 0). 발굴 상위 = 내부 미구현 로드맵 ${unimplemented.length} + 외부 흡수후보 ${absorption.length} → 제안 ${plans.length}건.`);
L.push(`> self_recall 교차로 강등된 유령(이미 구현중/완료) ${likelyDone.length}건: ${likelyDone.slice(0, 6).map(p => p.topic).join(', ')}`);
L.push('');
L.push('---');
L.push('');

plans.forEach((p, i) => {
  const s = p.seed;
  L.push(`## 제안 ${i + 1}. [${s.source === 'internal-roadmap' ? '내부·미구현 로드맵' : '외부·repo 흡수'}·${s.tier === 'heavy' ? '멀티페이즈' : '소형'}] ${s.title}`);
  L.push('');
  L.push(`- **왜(rationale)**: ${s.rationale}`);
  L.push('');
  // 실 근거.
  if (s.source === 'internal-roadmap') {
    const um = unimplemented.find(u => u.topic === s.slug);
    if (um) {
      L.push(`- **실 근거**: \`${um.filename}\` 미완 ${um.openBoxes}개·완료율 ${Math.round(um.completionRatio * 100)}%·우선점수 ${um.priorityScore}`);
      const lines = openBoxLines(um.path);
      if (lines.length) { L.push('- **실제 미완 항목(발췌)**:'); for (const l of lines) L.push(`  - [ ] ${l}`); }
    }
  } else {
    L.push(`- **실 근거(외부 커밋/변경)**:`);
    for (const e of s.evidence.slice(0, 4)) L.push(`  - ${e}`);
  }
  L.push('');
  L.push('<details><summary>자동 생성 플랜 초안(draft-plan)</summary>');
  L.push('');
  L.push('```markdown');
  L.push(buildPlanDraft(s));
  L.push('```');
  L.push('');
  L.push('</details>');
  L.push('');
  L.push('**대표 평가**: 발굴 가치 [ ] · 플랜 실행가능성 [ ] · 우선순위 [ ] · 페이즈 분해 [ ]');
  L.push('');
  L.push('---');
  L.push('');
});

console.log(L.join('\n'));
