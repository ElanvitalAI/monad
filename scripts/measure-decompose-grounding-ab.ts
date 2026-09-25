// 자: 분해에 «어느 접지»를 먹이면 조각이 실재 파일을 대나 — A/B.
//
// ⛔ 무엇을 가르나 (2026-08-18 §9e ②)
//   reuse-fit 자가 「①의 결과로 ②를 «대체» 못 한다」를 냈다(4/4 ❌ · 두 채널이 다른 것을 본다).
//   그런데 ***「대체 못 한다」와 「대체하면 손해다」는 다른 물음***이다 —
//   ②만 있는 것(src/index.ts 같은 허브)이 «가치»인지 «잡음»인지는 안 쟀다.
//   ⇒ 이 자가 그것을 «분해 산출»로 답한다. 판정은 「조각이 실재 파일을 대나」다(축 G 끝단).
//
// ⛔⭐ 저장소 «안»에서 · LLM 을 부른다(수 분) · 비결정적이라 표본 하나로 판정하지 마라.
import { decomposeFabricRequest } from '../src/self-dev/fabric-decompose-adapter.js';
import { groundForGoalAuthor } from '../src/self-implement/goal-author.js';
import type { GoalAuthoringGroundingResult } from '../src/self-implement/goal-authoring-grounding.js';

const REQUEST = process.env.DECOMPOSE_AB_REQUEST?.trim()
  ?? 'pr land 의 「도는 런」 경고가 미완 런 전부를 세는 것을 실제로 도는 런만 세도록 고친다';

const isPlaceholder = (p: string): boolean => p === '.' || p === './' || p === '' || p === '*';

/** ①(비싼 저작 접지)의 files 를 근거 줄 형식으로 바꾼다 — ②③이 읽는 문면과 «같은» 모양으로. */
async function expensiveAsEvidence(ask: string): Promise<GoalAuthoringGroundingResult> {
  const expensive = await groundForGoalAuthor(ask, process.cwd());
  const lines = (expensive.facts.files ?? []).map((p) => `- [repository topology] ${p}`);
  // ⛔ 다른 칸은 «비운다» — 이 실험이 가르려는 축은 「저장소 경로 근거」 하나다.
  return {
    documentLines: lines,
    memoryCount: 0,
    localSourceCount: 0,
    repositorySourceCount: lines.length,
    genericSearchScope: false,
    localReferenceAttempts: [],
    externalCount: 0,
    externalStatus: 'unavailable',
  };
}

type DecomposeGround = NonNullable<Parameters<typeof decomposeFabricRequest>[1]>['ground'];

async function arm(label: string, ground?: DecomposeGround) {
  const t0 = Bun.nanoseconds();
  const r = await decomposeFabricRequest(REQUEST, ground ? { ground } : {});
  const sec = ((Bun.nanoseconds() - t0) / 1e9).toFixed(0);
  if (r.status !== 'decomposed') {
    console.log(`| ${label} | ${sec}s | ${r.status} | — | — | — |`);
    return;
  }
  const goals = r.goals ?? [];
  let named = 0;
  const samples: string[] = [];
  for (const g of goals) {
    const paths = g.hotPaths ?? [];
    if (paths.length && !paths.every(isPlaceholder)) { named += 1; if (samples.length < 2) samples.push(paths[0]!); }
  }
  console.log(
    `| ${label} | ${sec}s | goals=${goals.length} · omitted=${r.omittedGoalCount ?? '-'}`
    + ` | ${named}/${goals.length} | ${samples.join(' · ') || '—'} |`,
  );
}

console.log(`요청: ${REQUEST}\n`);
console.log('| 팔 | 소요 | 분해 결과 | 실재 경로를 댄 조각 | 표본 |');
console.log('|---|---:|---|---:|---|');
await arm('A · 기본(싼 접지 ②)');
await arm('B · ①(비싼 저작 접지) 주입', expensiveAsEvidence);

console.log('\n⛔ 읽는 법');
console.log('  · B 의 「실재 경로를 댄 조각」이 A 보다 크면 — ①을 아래로 나르는 설계(§9d)가 값을 낸다.');
console.log('  · 같거나 작으면 — ②만 있던 허브 파일이 «잡음이 아니라 재료»였다는 뜻이다. 그때는 합집합으로 간다.');
console.log('  · 양쪽 다 0 이면 — 병목이 「접지 내용」이 아니라 «프롬프트/산출 계약»이다(105차 §⑯ 의 자리).');
console.log('⛔ 표본 하나다. 최소 2회 돌려 흔들림을 같이 본다.');
