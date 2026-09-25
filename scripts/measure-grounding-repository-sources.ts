// 자: 그라운딩이 저장소 근거를 «내는가»를 요청 문면별로 잰다.
// ⛔⭐ 이 자는 «작업 디렉토리»에 의존한다 — 반드시 «저장소 안»에서 돌린다.
//   실측 2026-08-17: 같은 코드가 저장소 안에서 「완전 경로」 3 · /tmp 에서 «0».
//   저장소 탐색이 cwd 를 뿌리로 삼기 때문이고, 밖에서 돌리면 «전부 0» 이 되어 「부재」로 오독된다.
// ⛔ 로그로는 못 본다(직접 스크립트에 sink 미등록 — ⓒ 확정 2026-08-17). 반환값을 «직접» 읽는다.
//
// ⭐⭐ 2026-08-18(106차): 칸을 «둘»로 만들었다. 그전 판본은 deps 를 «안 넘겨» 심 없는 값만 냈고,
//   그래서 인계의 「심켜고 8·5·5·5」와 대조할 수 없었다 — 「값이 되돌아갔다」로 오독되는 자리였다.
//   ⇒ 이제 한 번 돌리면 두 칸이 «나란히» 나오고, 심이 무는지 아닌지가 표에서 갈린다.
import { groundGoalAuthoringContext } from '../src/self-implement/goal-authoring-grounding.js';

const CASES = [
  ['개념어만 ①', 'pr land 의 「도는 런」 경고가 미완 런 전부를 세는 것을 실제로 도는 런만 세도록 고친다'],
  ['개념어만 ②', '골 저작기가 판정 신호를 렌더할 때 출처 칸을 비우지 않게 한다'],
  ['영어 토막',   'pr-cli 의 queryFederatedUnfinishedRunLedgers 경고를 고친다'],
  ['완전 경로',   'src/cli/pr-cli.ts 의 도는 런 경고가 미완 런 전부를 세는 것을 고친다'],
];

console.log('| 요청 형태 | 심없이 repo | 심켜고 repo | 심없이 generic | 심켜고 generic | memory |');
console.log('|---|---:|---:|:---:|:---:|---:|');
for (const [label, ask] of CASES) {
  const off = await groundGoalAuthoringContext(ask);
  const on = await groundGoalAuthoringContext(ask, { targetRepositoryKnown: true });
  console.log(
    `| ${label} | ${off.repositorySourceCount} | ${on.repositorySourceCount}`
    + ` | ${off.genericSearchScope} | ${on.genericSearchScope} | ${on.memoryCount} |`,
  );
}
console.log('\n⇒ 기준선(2026-08-17 · #9956 까지 착지 · «저장소 안»에서 잰 값): 심없이 0·0·0·3 / 심켜고 8·5·5·5');
console.log('⛔ 저장소 «밖»에서 돌리면 전부 0 이다 — 그것은 「부재」가 아니라 「cwd 가 틀렸다」다.');
console.log('⛔ 「심없이」 칸이 0 인 것은 «정상»이다 — 앞 관문(isSelfRepositoryImplementationRequest)이');
console.log('   「src/ 세 글자」류를 요구하므로 한국어 개념어는 여기서 걸린다. 그 관문을 «여는» 것이 심이다.');
console.log('⇒ 「심켜고」 칸이 0 으로 내려가면 그때가 «회귀»다.');
