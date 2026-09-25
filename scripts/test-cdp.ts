#!/usr/bin/env bun
/** CDP(실제 브라우저)를 타는 시험만 돈다 — `test:deterministic` 이 «뺀» 바로 그 목록이다.
 *
 *  ⛔⭐ ***브라우저가 없으면 이 레인은 «실패»한다 — 건너뛰지 «않는다».***
 *     🅣 부탁(2026-09-24): 판정 신호 기준선 대조가 `(fail)` «이름»으로 가르는데,
 *     건너뛰기와 실패가 섞이면 ***「기준선에서도 실패」로 잘못 읽힌다***.
 *     ⇒ 그래서 «둘 중 하나»를 골라 여기 적는다: ***실패***다.
 *     이유: 이 레인의 «존재 이유»가 브라우저를 타는 것이고, 조용히 건너뛰면
 *     「돌았는데 아무것도 안 물었다」가 초록으로 보인다(이 저장소가 여러 번 밟은 모양).
 *  📏 목록은 `deriveCdpTestPatterns()` 가 파생한다 — 손으로 적지 않으므로 새 CDP 시험이 자동으로 따라온다.
 *  🩸 왜 갈랐나: 🅕 실측 2026-09-24 — CDP 시험 123~199건 × 약 14초 ⇒ 29~46분.
 *     그리고 그 결과가 «브라우저 유무·부하»에 따라 달라져 `deterministic` 이라는 이름에 안 맞았다. */
import { deriveCdpTestPatterns } from './test-deterministic.js';

const files = deriveCdpTestPatterns();
if (files.length === 0) {
  console.error('[test:cdp] ⛔ CDP 시험을 하나도 «못 찾았다» — 파생이 깨졌는지 본다 (rg -l requireCdpBase test scripts).');
  process.exit(2);
}
console.error(`[test:cdp] CDP 시험 ${files.length}개 파일 — ⛔ 브라우저(9333)가 없으면 이 레인은 «실패»한다(건너뛰지 않는다).`);
const child = Bun.spawn({ cmd: ['bun', 'test', ...files, ...process.argv.slice(2)], stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' });
process.exit(await child.exited);
