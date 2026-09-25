// 검증된 클린-빌드 앵커 (2026-07-20) — 측정(벤치)→운영(self-run) 단일 출처.
//
// [[REPORT-gemma-goalloop-lever-2026-07-20]] §D 에서 gemma 를 실측 실패모드에서 끌어올린 디시플린:
// single-plain 52(자문자답/dead-code 주석·spec-drift·거짓완료) → 앵커 적용 시 single-aug 93,
// loop-aug **99**. 약한 모델일수록 이득이 크고, 강한 모델엔 무해(이미 지키는 규율).
//
// 이 상수를 self-implement 의 자식 monad 프롬프트(seams.featurePrompt)와 벤치의
// `PER_PROVIDER_AUG.local`(scripts/tui-sim-bench.ts) 이 **공유**한다 — 측정에서 통한 앵커가
// 그대로 운영(monad 자율 self-build)에 적용되도록. 앵커 문구 변경은 여기 한 곳에서.

export const CLEAN_BUILD_ANCHOR = [
  '⚠️ 클린 빌드 규율:',
  '- 계획·설명 대신 즉시 실제 코드를 파일에 써라. 껍데기/주석 스텁 금지.',
  '- 사고과정/자문자답 주석 금지 — "Wait, the requirement…"·"Let me rewrite…" 류를 코드에 남기지 마라.',
  '- dead code 금지 — 버린 시도·미사용 함수는 삭제. 최종 파일엔 실사용 코드만.',
  '- 스펙 그대로 — 요구된 시그니처·테스트케이스를 문자 그대로 구현(임의 대체·추가 금지).',
  '- 완료 직전 파일을 다시 읽어 죽은 코드·사고주석을 제거한 뒤 마무리하라.',
].join('\n');
