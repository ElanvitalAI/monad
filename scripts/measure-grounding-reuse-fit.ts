// 자: 「비싼 저작 접지(①)의 결과로 싼 접지(②③)를 «대체할 수 있나»」를 값으로 답한다.
//
// ⛔ 왜 이 자가 필요한가 — 2026-08-18 §9 설계는 「①을 한 번 하고 아래로 나른다」를 제안한다.
//   그런데 ①과 ②③은 «씨앗»이 다르다(askPathTokens ↔ requestedRepositoryPaths).
//   ⇒ 씨앗이 다르면 ①의 산출이 ②③의 소비자를 «만족시키지 못할» 수 있다. 그것을 먼저 잰다.
//   ⛔ 안 재고 배선하면 「형태로 착지했는데 실행 경로 밖」을 또 만든다(105차가 두 번 밟은 자리).
//
// ⛔⭐ 저장소 «안»에서 돌린다(자매 자와 동형 — 밖에서는 전부 0 이다).
import { groundForGoalAuthor } from '../src/self-implement/goal-author.js';
import { groundGoalAuthoringContext } from '../src/self-implement/goal-authoring-grounding.js';

const CASES: Array<[string, string]> = [
  ['개념어만 ①', 'pr land 의 「도는 런」 경고가 미완 런 전부를 세는 것을 실제로 도는 런만 세도록 고친다'],
  ['개념어만 ②', '골 저작기가 판정 신호를 렌더할 때 출처 칸을 비우지 않게 한다'],
  ['영어 토막',   'pr-cli 의 queryFederatedUnfinishedRunLedgers 경고를 고친다'],
  ['완전 경로',   'src/cli/pr-cli.ts 의 도는 런 경고가 미완 런 전부를 세는 것을 고친다'],
];

const cwd = process.cwd();
const evidencePath = (line: string): string | null =>
  /\[repository topology\] (\S+)/.exec(line)?.[1] ?? null;

console.log('| 요청 | ①비싼 files | ②싼 근거경로 | ②⊆① | ①만 있는 것 | ②만 있는 것 |');
console.log('|---|---:|---:|:---:|---|---|');

for (const [label, ask] of CASES) {
  const expensive = await groundForGoalAuthor(ask, cwd);
  const cheap = await groundGoalAuthoringContext(ask, { targetRepositoryKnown: true });

  const a = new Set(expensive.facts.files ?? []);
  const b = new Set(cheap.documentLines.flatMap((l) => {
    const p = evidencePath(l);
    return p ? [p] : [];
  }));

  const onlyA = [...a].filter((p) => !b.has(p));
  const onlyB = [...b].filter((p) => !a.has(p));
  // ⛔ 「②⊆①」이 참이어야 ①이 ②를 «대체»할 수 있다. 거짓이면 대체가 아니라 «합집합»이 필요하다.
  const covered = onlyB.length === 0;

  console.log(
    `| ${label} | ${a.size} | ${b.size} | ${covered ? '✅' : '❌'}`
    + ` | ${onlyA.slice(0, 2).join(' · ') || '—'} | ${onlyB.slice(0, 2).join(' · ') || '—'} |`,
  );
}

console.log('\n⛔ 읽는 법');
console.log('  · 「②⊆①」이 ✅ 면 — ①의 결과로 ②를 «대체»할 수 있다(설계 §9d 가 성립).');
console.log('  · ❌ 면 — 대체가 아니라 ***합집합***이 필요하다. 그때는 「한 번」이 아니라 「한 번 ⊕ 보강」이다.');
console.log('  · 「①만 있는 것」이 크면 ①이 더 좁은 게 아니라 «다른 것»을 본다는 뜻이다 — 씨앗 차이의 실물.');
console.log('⛔ 표본 4 다. ①은 끈질긴 탐색(LLM)이라 비결정적이다 — 최소 2회 돌려 흔들림을 같이 본다.');
