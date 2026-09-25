// 반사실 실험 — #6268 당시 변경파일 스코프 게이트를 돌렸다면 낡은 기대값을 잡았을까?
// ⛔ 주장이 아니라 실행으로 답한다. 출력만 낸다.
import { existsSync } from 'node:fs';
import { deriveRelatedTests, resolveGateScope } from '../src/self-implement/gate-scope.js';

const exists = (p: string) => existsSync(p);

// #6268 이 실제로 바꾼 파일 (gh pr view 6268 --json files 출력 그대로)
const changed6268 = [
  'src/self-implement/orchestrator.test.ts',
  'src/self-implement/orchestrator.ts',
];

console.log('=== 입력: #6268 의 변경 파일 ===');
for (const f of changed6268) console.log('  ' + f);

console.log('\n=== deriveRelatedTests 결과 ===');
const related = deriveRelatedTests(changed6268, exists);
for (const f of related) console.log('  ' + f);

console.log('\n=== resolveGateScope 결정 ===');
const decision = resolveGateScope(changed6268, exists);
console.log(JSON.stringify(decision, null, 2));

const target = 'test/self-implement-orchestrator.test.ts';
const inRelated = related.includes(target);
const runSet = (decision as { testArgs?: readonly string[] }).testArgs ?? [];
const inRunSet = runSet.includes(target);

console.log('\n=== 판정 ===');
console.log(`연관 테스트에 ${target} 포함: ${inRelated}`);
console.log(`실제 실행 집합(testArgs)에 포함: ${inRunSet}`);
console.log(`⇒ ${inRunSet ? '✅ 그 명령이 있었으면 그 파일이 돌았다' : '⛔ 안 돌았다 — 주장 수정 필요'}`);
