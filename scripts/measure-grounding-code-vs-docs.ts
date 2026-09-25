// 자: 골 저작 그라운딩이 실은 «코드»를 싣는가 «문서»를 싣는가를 요청 종류별로 가른다.
//
// ⛔ 무엇을 푸는가 — 105차 §4b ⑰ 는 「분해 프롬프트에 실린 근거 8건이 «전부» 내부 문서 `*` 다」에서 멎었고,
//   그 원인을 「탐색이 찾은 files 가 왜 문서인가」로 적어 뒀다. 그런데 코드를 열면 갈림이 «둘»이다:
//     ⓐ goal-authoring-grounding.ts:156-158 — codeChannel === 'disabled' 면 근거로 «documentFacts»를 쓴다
//     ⓑ 아니면 repository.files 를 쓴다 (mission-codebase-gate.ts:68 은 docs 를 files 로 «승격 안 한다»고 못 박는다)
//   ⇒ 그러므로 「files 가 왜 문서인가」는 ***틀린 물음일 수 있다*** — ⓐ 였다면 files 는 애초에 안 쓰였다.
//   이 자는 그 둘을 «값으로» 가른다.
//
// ⛔⭐ 이 자는 «작업 디렉토리»에 의존한다 — 반드시 «저장소 안»에서 돌린다(자매 자와 동형).
// ⛔ 로그로는 못 본다(직접 스크립트에 sink 미등록). 스파이를 끼워 «반환값»을 직접 읽는다.
import { groundGoalAuthoringContext } from '../src/self-implement/goal-authoring-grounding.js';
import {
  groundMissionInCodebase, searchCodebase, defaultSearchTerms, expandHyphenatedSearchTerms,
} from '../src/autopilot/mission-codebase-gate.js';
import type { CodebaseGrounding } from '../src/autopilot/mission-codebase-gate.js';

const CASES: Array<[string, string]> = [
  ['개념어만 ①', 'pr land 의 「도는 런」 경고가 미완 런 전부를 세는 것을 실제로 도는 런만 세도록 고친다'],
  ['개념어만 ②', '골 저작기가 판정 신호를 렌더할 때 출처 칸을 비우지 않게 한다'],
  ['영어 토막',   'pr-cli 의 queryFederatedUnfinishedRunLedgers 경고를 고친다'],
  ['완전 경로',   'src/cli/pr-cli.ts 의 도는 런 경고가 미완 런 전부를 세는 것을 고친다'],
];

const isDoc = (p: string): boolean => p.startsWith('docs/') || p.endsWith('.md');

console.log('| 요청 형태 | codeChannel | files | files 중 코드 | files 중 문서 | documentFacts | 근거로 쓴 채널 | repoSrc |');
console.log('|---|---|---:|---:|---:|---:|---|---:|');

for (const [label, ask] of CASES) {
  let seen: CodebaseGrounding | undefined;
  const result = await groundGoalAuthoringContext(ask, {
    targetRepositoryKnown: true,
    repositoryGrounding: async (a, options) => {
      seen = await groundMissionInCodebase(a, options);
      return seen;
    },
  });
  const files = seen?.files ?? [];
  const docsInFiles = files.filter(isDoc);
  const codeInFiles = files.filter((p) => !isDoc(p));
  // ⛔⭐ 2026-08-18 정정 — 이 칸은 원래 goal-authoring-grounding.ts:156-158 을 «거울»로 흉내 냈다.
  //   그러자 그 로직이 바뀐 «그 순간» 이 칸이 거짓을 말했다(수리 뒤에도 "documentFacts" 라고 찍혔는데
  //   실제 근거 줄에는 src/ 가 7개 있었다). ⇒ 🔑 거울은 자가 아니다.
  //   이제 «반환된 근거 줄»을 직접 세어 말한다 — 피측정자의 로직을 복제하지 않는다.
  const srcLines = result.documentLines.filter((l) => l.includes('[repository topology] src/')).length;
  const docLines = result.documentLines.filter((l) => /\[repository topology] (?:docs|\S*\.md)/.test(l)).length;
  const used = srcLines > 0 ? `코드 ${srcLines}` : docLines > 0 ? `문서 ${docLines}` : '없음';
  console.log(
    `| ${label} | ${seen?.codeChannel ?? '(미호출)'} | ${files.length} | ${codeInFiles.length}`
    + ` | ${docsInFiles.length} | ${seen?.documentFacts?.length ?? 0} | ${used} | ${result.repositorySourceCount} |`,
  );
  const sample = files.slice(0, 4);
  if (sample.length) console.log(`|   ↳ 표본 | ${sample.join(' · ')} | | | | | | |`);

  // ⭐⭐ 결정적 칸 — 「싼 코드 채널」이 «있는데 안 쓰인다».
  //   codeFiles 는 오직 persistent 루프(:588)에서만 오고, 저작 경로는 persistent:false 를 넘긴다.
  //   그런데 같은 파일에 git-grep 기반 searchCodebase(:212)가 «있고» 운영 호출자가 «0곳»이다.
  //   ⇒ 그것을 켜면 src/ 가 나오나? 이 줄이 그 답을 «값»으로 낸다.
  //   ⛔ 0 이면 처방은 「채널을 켜라」가 아니라 「검색어를 봐라」로 «갈린다» — 그래서 여기서 잰다.
  const terms = expandHyphenatedSearchTerms(await defaultSearchTerms(ask));
  const cheap = await searchCodebase(terms, 12);
  const cheapCode = cheap.filter((p) => !isDoc(p));
  console.log(
    `|   ↳ 싼 채널(searchCodebase · 미사용) | terms=${terms.length} | ${cheap.length}`
    + ` | ${cheapCode.length} | ${cheap.length - cheapCode.length} | | | |`,
  );
  if (cheapCode.length) console.log(`|   ↳ 그 표본 | ${cheapCode.slice(0, 4).join(' · ')} | | | | | | |`);
}

console.log('\n⛔ 읽는 법');
console.log('  · 「근거로 쓴 채널」이 documentFacts 면 ***files 는 애초에 안 쓰였다*** — 「files 가 왜 문서냐」는 틀린 물음이다.');
console.log('  · files 면 「files 중 문서」가 답이다 — 그 수가 크면 그때가 탐색 층 문제다.');
console.log('  · codeChannel 은 files:[] 의 뜻을 가른다(ok=찾아봤다 · failed=채널이 죽었다 · incomplete=못 끝냈다 · disabled=껐다).');
console.log('⛔ 표본 1 로 판정하지 마라 — 자매 자(measure-grounding-repository-sources)가 3회에 9·8·7 로 흔들렸다.');
