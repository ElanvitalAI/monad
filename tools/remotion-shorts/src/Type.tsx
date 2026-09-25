/**
 * ⌨️ 키네틱 타이포그래피 — ⛔ 「자막」이 아니라 «모션 그래픽»이다.
 *
 * 대표 2026-09-10: *"자막이 너무 디자인이 고루합니다"* ⊕ *"after effect 급의 텍스트 애니메이션"*
 *
 * ⛔ 그전 것이 왜 고루했나 (자기 진단):
 *   ① 낱말이 «색만» 바뀌었다 — 흰색/회색. 그것은 노래방 자막이지 모션이 아니다
 *   ② 모든 낱말이 «같은» 애니메이션을 받았다 — 강약이 없다
 *   ③ 서체가 시스템 폴백이었다 — 렌더 머신이 고르는 대로 나왔다
 *   ④ 위치가 늘 «하단 중앙 한 덩어리» — 화면을 안 썼다
 *
 * ⇒ 그래서 «애니메이터»를 여럿 두고 «역할»로 고른다. AE 의 Text Animator 와 같은 개념:
 *   본문은 `rise`, 핵심 낱말은 `punch`, 히어로 락업은 `flip3d` ⊕ `sweep`.
 *
 * ⭐ 전부 `useCurrentFrame()` 의 순수 함수다 — 같은 프레임 = 같은 픽셀.
 */
import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { C, SANS, SERIF } from './design';

/** 프레임 기준 0..1 진행도. `delayF` 프레임 뒤에 시작해 `durF` 프레임 동안 간다. */
const prog = (frame: number, delayF: number, durF: number) =>
  interpolate(frame, [delayF, delayF + durF], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

// ─────────────────────────────────────────────────────────────
// 애니메이터 — 하나가 「한 글자/한 낱말」의 style 을 낸다
// ─────────────────────────────────────────────────────────────

/** ⬆️ rise — 아래에서 흐릿하게 밀려 올라온다. 본문의 기본. */
export const rise = (frame: number, fps: number, delayF: number): React.CSSProperties => {
  const s = spring({ frame: frame - delayF, fps, config: { damping: 14, mass: 0.5, stiffness: 130 } });
  const p = prog(frame, delayF, 10);
  return {
    transform: `translateY(${(1 - s) * 34}px)`,
    opacity: p,
    filter: `blur(${(1 - p) * 7}px)`,
  };
};

/** 💥 punch — 오버슈트 스케일 ⊕ 살짝 기운다. 「핵심 낱말」 하나에만. */
export const punch = (frame: number, fps: number, delayF: number): React.CSSProperties => {
  const s = spring({ frame: frame - delayF, fps, config: { damping: 8, mass: 0.6, stiffness: 190 } });
  return {
    transform: `scale(${0.55 + s * 0.45}) rotate(${(1 - s) * -5}deg)`,
    opacity: prog(frame, delayF, 4),
  };
};

/** 🔄 flip3d — X축 회전으로 «떨어져» 앉는다. AE 키네틱 타입의 대표 동작. */
export const flip3d = (frame: number, fps: number, delayF: number): React.CSSProperties => {
  const s = spring({ frame: frame - delayF, fps, config: { damping: 12, mass: 0.5, stiffness: 120 } });
  return {
    transform: `perspective(700px) rotateX(${(1 - s) * -92}deg) translateY(${(1 - s) * 26}px)`,
    transformOrigin: '50% 100%',
    opacity: prog(frame, delayF, 5),
  };
};

/** ✂️ wipe — 마스크가 왼쪽에서 열린다. 「끊어 읽기」 느낌. */
export const wipe = (frame: number, delayF: number): React.CSSProperties => {
  const p = interpolate(frame, [delayF, delayF + 11], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.22, 1, 0.36, 1),
  });
  return { clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`, opacity: p > 0 ? 1 : 0 };
};

// ─────────────────────────────────────────────────────────────
// 글자 단위 스태거 — AE 의 "Range Selector" 에 해당
// ─────────────────────────────────────────────────────────────

export const StaggerChars: React.FC<{
  text: string;
  startF: number;
  perCharF?: number;
  animator?: (frame: number, fps: number, delayF: number) => React.CSSProperties;
  style?: React.CSSProperties;
}> = ({ text, startF, perCharF = 2, animator = flip3d, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <span style={{ display: 'inline-flex', ...style }}>
      {Array.from(text).map((ch, i) => (
        <span key={i} style={{ display: 'inline-block', whiteSpace: 'pre', ...animator(frame, fps, startF + i * perCharF) }}>
          {ch}
        </span>
      ))}
    </span>
  );
};

// ─────────────────────────────────────────────────────────────
// 자막 한 페이지
// ─────────────────────────────────────────────────────────────

export type Word = { t: string; atMs: number };

/**
 * ⭐ 액티브 낱말 뒤로 «금색 알약»이 스프링으로 «따라 이동»한다.
 * ⛔ 이것이 「색만 바꾸는」 옛 판과의 결정적 차이다 — 시선이 «끌려간다».
 */
export const CaptionLine: React.FC<{
  words: Word[];
  pageFromMs: number;
  /** 이 낱말 하나만 punch 로 강조한다(대본이 지정). ⛔ 「전부 강조」는 강조가 아니다. */
  emphasisIndex?: number;
  fontSize?: number;
  serif?: boolean;
}> = ({ words, pageFromMs, emphasisIndex, fontSize = 52, serif = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;

  // 현재 낱말
  let active = -1;
  words.forEach((w, i) => { if (nowMs >= w.atMs - pageFromMs) active = i; });

  return (
    <div style={{
      position: 'relative', display: 'flex', flexWrap: 'wrap',
      justifyContent: 'center', alignItems: 'baseline', gap: '4px 12px', maxWidth: 620,
    }}>
      {words.map((w, i) => {
        /**
         * ⛔ 그전엔 낱말이 «말할 때» 나타났다 — 그러면 줄 앞머리에서 «한 낱말만» 떠 있어
         *    줄이 「깨져」 보인다(영어판 1페이지 13낱말에서 특히 심했다).
         * ✅ 이제 줄 «전체»가 페이지 시작에 빠른 스태거로 들어오고,
         *    «발화 추적»은 금색 알약이 «혼자» 맡는다. 읽기와 싱크가 «다른 층»으로 갈렸다.
         */
        const enterF = i * 2;
        const speakF = Math.round(((w.atMs - pageFromMs) / 1000) * fps);
        const isEm = i === emphasisIndex;
        const anim = isEm ? punch(frame, fps, enterF) : rise(frame, fps, enterF);
        const isActive = i === active;
        const delayF = speakF;
        return (
          <span key={i} style={{ position: 'relative', display: 'inline-block', ...anim }}>
            {/* 금색 알약 — 액티브일 때만, 스프링으로 자란다 */}
            {isActive && (
              <span style={{
                position: 'absolute', inset: '-0.10em -0.34em',
                background: `linear-gradient(180deg, ${C.gold} 0%, #B8904C 100%)`,
                borderRadius: 12,
                transform: `scaleX(${spring({ frame: frame - delayF, fps, config: { damping: 13, stiffness: 220 } })})`,
                transformOrigin: 'left center',
                boxShadow: `0 6px 22px rgba(212,175,106,0.45)`,
                zIndex: 0,
              }} />
            )}
            <span style={{
              position: 'relative', zIndex: 1,
              fontFamily: serif ? SERIF : SANS,
              fontSize: isEm ? fontSize * 1.22 : fontSize,
              fontWeight: isEm ? 800 : 700,
              letterSpacing: serif ? '0.01em' : '-0.02em',
              color: isActive ? C.indigoDeep : C.paper,
              textShadow: isActive ? 'none' : `0 2px 10px rgba(11,10,20,0.75), 0 0 2px rgba(11,10,20,0.9)`,
              WebkitTextStroke: isActive ? '0' : `0.8px rgba(11,10,20,0.35)`,
              transition: 'none',
            }}>{w.t}</span>
          </span>
        );
      })}
    </div>
  );
};

/**
 * 🏷️ 히어로 락업 — 마지막 씬의 제품명.
 * ⛔ 본문과 «같은 모양»으로 두면 마무리가 안 선다. 세리프 ⊕ 자간 확장 ⊕ 금색 선 긋기.
 */
/** ⛔ Playfair 에는 **한글 글리프가 «없다»** — 한글에 세리프를 지정하면 «조용히» 폴백한다.
 *    실제로 첫 판이 그렇게 렌더됐고 화면만 봐선 안 보였다. ⇒ 한글은 Pretendard ExtraBold. */
const hasHangul = (s: string) => /[\u3131-\uD79D]/.test(s);

export const HeroLockup: React.FC<{ brand: string; product: string; startF: number }> = ({ brand, product, startF }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lineP = interpolate(frame, [startF + 14, startF + 34], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  // 자간이 «좁아지며» 앉는다 — 럭셔리 타이틀의 상투구지만 «제품이 그 결»이다
  const track = interpolate(frame, [startF, startF + 26], [0.42, 0.14], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{
        fontFamily: SANS, fontSize: 22, fontWeight: 700,
        letterSpacing: `${track}em`, color: C.goldLight, textTransform: 'uppercase',
        opacity: prog(frame, startF, 10),
        textShadow: '0 2px 12px rgba(11,10,20,0.8)',
      }}>{brand}</div>

      <StaggerChars
        text={product}
        startF={startF + 6}
        perCharF={1.6}
        animator={flip3d}
        style={{
          fontFamily: hasHangul(product) ? SANS : SERIF,
          fontSize: hasHangul(product) ? 62 : 60,
          fontWeight: hasHangul(product) ? 800 : 700,
          letterSpacing: hasHangul(product) ? '-0.03em' : '0',
          color: C.paper,
          textShadow: '0 4px 24px rgba(11,10,20,0.9), 0 1px 3px rgba(11,10,20,0.7)',
        }}
      />

      {/* 금색 선이 «그어진다» */}
      <div style={{
        width: 220 * lineP, height: 2,
        background: `linear-gradient(90deg, transparent, ${C.gold}, transparent)`,
        boxShadow: `0 0 14px ${C.gold}`,
      }} />
    </div>
  );
};
