import { Composition } from 'remotion';
import { Shorts } from './Shorts';
import { PAGES as KO } from './captions';
import { PAGES as EN } from './captions-en';

const FPS = 30;
/** ⛔ 길이는 VO 에서 «계산»한다 — 손으로 박으면 마지막 낱말이 잘린다(§2ⓠ 함정 3). */
const framesFor = (pages: { toMs: number }[], tailMs = 900) =>
  Math.ceil(((pages[pages.length - 1].toMs + tailMs) / 1000) * FPS);

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="EvasShortsKo" component={Shorts} defaultProps={{ lang: 'ko' as const }}
      durationInFrames={framesFor(KO)} fps={FPS} width={720} height={1280}
    />
    <Composition
      id="EvasShortsEn" component={Shorts} defaultProps={{ lang: 'en' as const }}
      durationInFrames={framesFor(EN)} fps={FPS} width={720} height={1280}
    />
  </>
);
