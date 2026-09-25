/**
 * 🎨 디자인 토큰 — ⛔ 색과 서체를 «지어내지 않는다». 실물 패키지에서 가져온다.
 *
 * 📏 근거(제품 실사 `real-hi.jpg` · outpaint 원본 픽셀):
 *   · 케이스   = 딥 인디고/바이올렛 ⊕ **금색 얇은 테두리**
 *   · `ROSEMINE` = 금색 **하이컨트라스트 세리프** (Didone 계열)
 *   · 보틀    = 창백한 라벤더 그라데이션 (아래로 갈수록 밝다)
 *   · 엠블럼   = 남색 사각 안 **장미** (⛔ 고양이가 아니다 — §2ⓙ 에서 내가 오독한 자리)
 *
 * ⇒ 그래서 자막의 액센트는 «금색»이고, 히어로 문구는 «세리프»다.
 *   임의의 네온/형광이 아니라 ***제품이 이미 쓰고 있는 두 색***이다.
 */

export const C = {
  ink: '#0B0A14',           // 거의 검정 — 그림자·스트로크용
  indigo: '#241C63',        // 케이스 본색
  indigoDeep: '#140F3D',
  gold: '#D4AF6A',          // ROSEMINE 각인 금색
  goldLight: '#F2DCA8',
  lavender: '#CFC7F0',      // 보틀 상단
  paper: '#FFFFFF',
} as const;

/** 본문 = Pretendard (한글·라틴 겸용). ⛔ 시스템 폴백에 맡기지 않는다 — 렌더 머신이 다르면 글자가 바뀐다. */
export const SANS = '"Pretendard", system-ui, sans-serif';
/** 히어로 = Playfair Display — 패키지의 하이컨트라스트 세리프에 대응. */
export const SERIF = '"PlayfairDisplay", Georgia, serif';

/** ⛔ 폰트는 «파일»로 싣는다. Remotion 렌더는 헤드리스 크롬이라 설치 폰트를 못 믿는다. */
export const FONT_CSS = (url: (f: string) => string) => `
@font-face{font-family:'Pretendard';src:url('${url('fonts/Pretendard-Medium.woff2')}') format('woff2');font-weight:500;font-display:block}
@font-face{font-family:'Pretendard';src:url('${url('fonts/Pretendard-Bold.woff2')}') format('woff2');font-weight:700;font-display:block}
@font-face{font-family:'Pretendard';src:url('${url('fonts/Pretendard-ExtraBold.woff2')}') format('woff2');font-weight:800;font-display:block}
@font-face{font-family:'PlayfairDisplay';src:url('${url('fonts/PlayfairDisplay.ttf')}') format('truetype');font-weight:400 900;font-display:block}
`;
