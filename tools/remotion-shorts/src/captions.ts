// ⛔ 손으로 추정하지 않는다 — ElevenLabs /with-timestamps 가 «오디오와 같은 호출»에서 낸 실측값.
// ⛔ 이 파일은 «생성물»이다. 손으로 고치지 말고 scripts/vo-with-timestamps.ts 를 다시 돌려라.
export type Page = { fromMs: number; toMs: number; words: { t: string; atMs: number }[] };

export const PAGES: Page[] = [
  { fromMs: 0, toMs: 3280, words: [{ t: '샤워하고', atMs: 0 }, { t: '나왔는데,', atMs: 560 }, { t: '향이', atMs: 1480 }, { t: '아직', atMs: 1813 }, { t: '남아', atMs: 2000 }, { t: '있어요.', atMs: 2280 }] },
  { fromMs: 3400, toMs: 6320, words: [{ t: '바디워시가', atMs: 3400 }, { t: '아니라,', atMs: 4020 }, { t: '바디', atMs: 4560 }, { t: '퍼퓸이에요.', atMs: 5040 }] },
  { fromMs: 6480, toMs: 11200, words: [{ t: '냉장고에', atMs: 6480 }, { t: '넣어두면', atMs: 7000 }, { t: '더', atMs: 7600 }, { t: '좋습니다.', atMs: 7800 }, { t: '브랜드가', atMs: 8960 }, { t: '그렇게', atMs: 9440 }, { t: '안내해요.', atMs: 9813 }] },
  { fromMs: 11320, toMs: 13840, words: [{ t: '에바스', atMs: 11320 }, { t: '블루', atMs: 11840 }, { t: '로즈마인', atMs: 12280 }, { t: '샤워코롱.', atMs: 13040 }] },
];
