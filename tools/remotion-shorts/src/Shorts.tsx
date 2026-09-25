import React from 'react';
import {
  AbsoluteFill, Audio, OffthreadVideo, Sequence, staticFile,
  useCurrentFrame, useVideoConfig, interpolate, continueRender, delayRender, Easing,
} from 'remotion';
import { PAGES as PAGES_KO } from './captions';
import { PAGES as PAGES_EN } from './captions-en';
import { CaptionLine, HeroLockup } from './Type';
import { C, FONT_CSS } from './design';

/**
 * ⛔ 폰트는 «파일»로 싣고 «로드를 기다린다».
 *   Remotion 렌더는 헤드리스 크롬이라 설치 폰트를 못 믿고,
 *   기다리지 않으면 첫 프레임들이 «폴백 서체»로 굳는다(그래서 깜빡임처럼 보인다).
 */
const useFonts = () => {
  const [handle] = React.useState(() => delayRender('fonts'));
  React.useEffect(() => {
    const css = FONT_CSS((f) => staticFile(f));
    const el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
    void (document as unknown as { fonts: FontFaceSet }).fonts.ready.then(() => continueRender(handle));
  }, [handle]);
};

export type Lang = 'ko' | 'en';

/**
 * ⛔ 한 페이지에 낱말이 너무 많으면 «읽을 수 없다» — 영어 1페이지가 13낱말이었다.
 *    대본의 「한 줄」과 화면의 「한 컷」은 «다른 단위»다.
 * ⇒ 최대 N낱말로 쪼개고, 각 조각의 시작·끝은 «그 조각의 낱말»에서 다시 계산한다.
 */
const chunkPage = <T extends { words: { t: string; atMs: number }[] }>(page: T, max: number) => {
  const out: { fromMs: number; toMs: number; words: { t: string; atMs: number }[] }[] = [];
  for (let i = 0; i < page.words.length; i += max) {
    const ws = page.words.slice(i, i + max);
    const next = page.words[i + max];
    out.push({
      fromMs: ws[0].atMs,
      // 끝은 «다음 조각의 시작»까지 — 그래야 사이에 빈 화면이 안 생긴다
      toMs: next ? next.atMs : (page as unknown as { toMs: number }).toMs,
      words: ws,
    });
  }
  return out;
};

/** 대본이 지정한 «강조 낱말» — ⛔ 전부 강조하면 강조가 아니다. 페이지마다 «하나»만. */
const EMPHASIS: Record<Lang, (number | undefined)[]> = {
  ko: [2, 3, 1, undefined],       // 향이 · 퍼퓸이에요 · 넣어두면 · (마지막은 히어로가 대신한다)
  en: [6, 5, 3, undefined],
};

const BRAND = { ko: 'EVAS', en: 'EVAS' };
const HERO = { ko: '블루 로즈마인', en: 'Blue Rosemine' };
const SUB = { ko: '샤워코롱 · 185ml', en: 'Shower Cologne · 185ml' };

export const Shorts: React.FC<{ lang?: Lang }> = ({ lang = 'ko' }) => {
  useFonts();
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  const pages = lang === 'ko' ? PAGES_KO : PAGES_EN;
  const cut = Math.round(durationInFrames / 3);
  const fade = interpolate(frame, [durationInFrames - 18, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const heroStart = Math.round((pages[pages.length - 1].fromMs / 1000) * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: C.ink }}>
      {/* ── 컷 ── */}
      <Sequence from={0} durationInFrames={cut}><OffthreadVideo src={staticFile('cut1.mp4')} muted /></Sequence>
      <Sequence from={cut} durationInFrames={cut}><OffthreadVideo src={staticFile('cut2.mp4')} muted /></Sequence>
      <Sequence from={cut * 2}><OffthreadVideo src={staticFile('cut1.mp4')} muted /></Sequence>

      {/*
        ⭐ 하단 그라디언트 스크림 — 자막이 «어떤 배경 위에서도» 읽히게.
        ⛔ 그전엔 텍스트 그림자에만 기댔고, 밝은 배경에서 흰 글자가 «떠 보였다».
      */}
      <AbsoluteFill style={{
        background: `linear-gradient(to top, rgba(20,15,61,0.92) 0%, rgba(20,15,61,0.62) 20%, rgba(20,15,61,0.18) 36%, transparent 52%)`,
        pointerEvents: 'none',
      }} />

      {/* ── 오디오 (VO 100% · BGM 22% · SFX 35%) ── */}
      <Audio src={staticFile(lang === 'ko' ? 'vo-el.mp3' : 'vo-en.mp3')} volume={1} />
      <Audio src={staticFile('bgm.mp3')} volume={0.22} />
      <Sequence from={9}><Audio src={staticFile('sfx-water.mp3')} volume={0.35} /></Sequence>

      {/* ── 자막: 마지막 페이지 «전»까지, 길면 쪼개서 ── */}
      {pages.slice(0, -1).flatMap((p, pi) =>
        chunkPage(p, lang === 'ko' ? 5 : 6).map((c, ci) => (
          <Sequence
            key={`${pi}-${ci}`}
            from={Math.round((c.fromMs / 1000) * fps)}
            durationInFrames={Math.max(6, Math.round(((c.toMs - c.fromMs + 220) / 1000) * fps))}
          >
            <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 250 }}>
              <CaptionLine
                words={c.words}
                pageFromMs={c.fromMs}
                /* 강조는 «그 조각 안»의 낱말일 때만 — 아니면 강조 없이 간다 */
                emphasisIndex={(() => {
                  const e = EMPHASIS[lang][pi];
                  if (e === undefined) return undefined;
                  const idx = p.words.indexOf(c.words[0]);
                  const local = e - idx;
                  return local >= 0 && local < c.words.length ? local : undefined;
                })()}
                fontSize={lang === 'ko' ? 52 : 46}
              />
            </AbsoluteFill>
          </Sequence>
        )),
      )}

      {/* ── 히어로 락업 ── */}
      <Sequence from={heroStart}>
        <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 210 }}>
          <HeroLockup brand={BRAND[lang]} product={HERO[lang]} startF={0} />
          <div style={{
            marginTop: 16, fontFamily: '"Pretendard", system-ui, sans-serif',
            fontSize: 20, fontWeight: 500, letterSpacing: '0.16em',
            color: 'rgba(255,255,255,0.82)', textTransform: 'uppercase',
            opacity: interpolate(frame - heroStart, [24, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) }),
            textShadow: '0 2px 12px rgba(11,10,20,0.85)',
          }}>{SUB[lang]}</div>
        </AbsoluteFill>
      </Sequence>

      <AbsoluteFill style={{ backgroundColor: C.ink, opacity: fade, pointerEvents: 'none' }} />
    </AbsoluteFill>
  );
};
