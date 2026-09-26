// conatus 데이터 루트 단일 해석기 (2026-07-24)
//
// 왜 생겼나: `~/.elanous/conatus/**` 경로가 **69지점에 하드코딩**돼 있었고, 올바른
// 헬퍼(`conatus-panel.ts:31 conatusDataDir`)가 이미 있었는데 **1곳만** 그걸 썼다.
// 타임존 사태(`src/time/format.ts` 참조)와 정확히 같은 구조 — 계약이 있어도 전파할
// 통로가 없으면 각자 하드코딩한다.
//
// 무엇이 터졌나: `test/morning-report.test.ts` 가 "부작용 없이(upload:false)"라고
// 주석에 적어두고 실제로는 **운영 `regime.db` 에 쓰고 실시간 시장 API 를 호출**했다.
// `upload:false` 는 S3 만 막고 DB 쓰기는 그대로였다. 실증: 그 테스트 2개만 돌려도
// `macro_snapshots` 의 `created_at` 이 갱신된다(01:52:54 → 01:59:50). 남은 흔적은
// `as_of='2026-07-05'`(테스트 픽스처 날짜) 행과 `regime_vector` 의 동일 픽스처.
//
// 이 레포에서 test→운영 누출은 이번이 **네 번째**다 — PTY 매니페스트(#5246) ·
// 세션 스토어(#5252) · `process.env.TZ` 오염 · 여기. 그래서 개별 수리가 아니라
// **해석기에 안전망**을 둔다(#5252 `sessionRoot()` 와 동형).
//
// 일반 유틸이 도메인 이름을 달면 「분리 비용」이 실제보다 커 보인다.
// 들이는 31곳 중 18곳이 투자와 무관하다. 디스크 경로(`~/.elanous/conatus/`)와
// 해석 순서(env → 심링크 → dated 폴백)는 한 글자도 바꾸지 않고, 모듈·이름만
// `elanousDataDir` · `elanousDataPath` (`./elanous-data-dir.ts`) 로 중립화한다.
// 이 파일은 옛 이름 `conatusDataDir` · `conatusPath` 를 계속 import 가능하게
// 하는 호환 창구다. 31곳 호출부는 옮기지 않는다 — 옛 이름이 계속 되므로
// 고칠 필요가 없다.

export {
  elanousDataDir,
  elanousDataPath,
  conatusDataDir,
  conatusPath,
} from './elanous-data-dir.js';
