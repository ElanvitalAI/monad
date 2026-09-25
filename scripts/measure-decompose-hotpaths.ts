// 자: 분해 «조각»이 고칠 파일을 «실제 이름»으로 대는가 — 축 G 의 «끝단».
//
// ⛔ 왜 이 자가 따로 있나 — 「근거가 실렸다」와 「조각이 그것을 «쓴다»」는 «다른 축»이다.
//   2026-08-18: 근거 채널을 고쳐 src/ 줄이 0→7 이 됐다(#9975). 그런데 그것은 «입력»이고,
//   조각이 hotPaths 를 대는지는 «모델 산출»이라 배선으로 못 닫는다 ⇒ 값으로 재야 한다.
//   📏 105차 기준선(수리 «전»): 아크 2 · 조각 각 1개 · hotPaths = null 과 ["."] · goals 0 · omitted 2
//
// ⛔⭐ 저장소 «안»에서 돌린다(자매 자와 동형 — 밖에서는 접지가 전부 0 이다).
// ⛔ 이 자는 LLM 을 부른다(RFC 저작 ⊕ 아크별 분해). 수 분 걸리고 «비결정적»이다 — 표본 하나로 판정하지 마라.
import { decomposeFabricRequest } from '../src/self-dev/fabric-decompose-adapter.js';

const REQUEST = process.env.DECOMPOSE_HOTPATHS_REQUEST?.trim()
  ?? 'pr land 의 「도는 런」 경고가 미완 런 전부를 세는 것을 실제로 도는 런만 세도록 고친다';

const isPlaceholder = (p: string): boolean => p === '.' || p === './' || p === '' || p === '*';

const result = await decomposeFabricRequest(REQUEST);
console.log(`요청: ${REQUEST}`);
console.log(`status: ${result.status}`);

if (result.status !== 'decomposed') {
  // ⛔ 「분해 안 됨」의 뜻이 여럿이다 — 상태 이름을 그대로 남기고 0 으로 접지 않는다.
  console.log(`⇒ 분해가 «안 됐다». 이것은 「조각이 파일을 못 댔다」가 «아니다» — 다른 사건이다.`);
  console.log(JSON.stringify(result, null, 2).slice(0, 1200));
  process.exit(2);
}

const goals = result.goals ?? [];
console.log(`goals=${goals.length} · omitted=${result.omittedGoalCount ?? 'null'}`
  + ` · skippedArcs=${result.budgetSkippedArcCount ?? 'null'} · limited=${result.budgetLimited ?? 'null'}`);

let named = 0, placeholder = 0, empty = 0;
console.log('\n| # | 조각 | hotPaths | 판정 |');
console.log('|---:|---|---|---|');
goals.forEach((goal, i) => {
  const paths = goal.hotPaths ?? null;
  let verdict: string;
  if (!paths || paths.length === 0) { verdict = '❌ 없음'; empty += 1; }
  else if (paths.every(isPlaceholder)) { verdict = '❌ 자리표시자'; placeholder += 1; }
  else { verdict = '✅ 실제 경로'; named += 1; }
  const title = (goal.title ?? goal.id ?? `#${i + 1}`).slice(0, 46);
  console.log(`| ${i + 1} | ${title} | ${paths ? paths.join(' · ').slice(0, 70) : 'null'} | ${verdict} |`);
});

console.log(`\n📏 조각 ${goals.length} 중 — 실제 경로 ${named} · 자리표시자 ${placeholder} · 없음 ${empty}`);
console.log('⛔ 표본 하나로 판정하지 마라 — 이 경로는 LLM 산출이라 흔들린다. 최소 3회.');
console.log('⛔ goals=0 이면 「조각이 이름을 못 댔다」와 「분해기가 애초에 안 만들었다」를 omitted 로 가른다.');
