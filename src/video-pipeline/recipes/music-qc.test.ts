/**
 * ⛔⭐ 이 시험이 있는 이유: ***이 자를 손으로 한 번 눌러 보고 «그 누름을 버렸다».***
 *
 * 🩸 2026-09-22 — `lyricFidelity` 를 다섯 갈래로 흔들어 확인했는데,
 *   그 스크립트를 «지웠다». ⇒ 그 반증은 ***한 번 돌고 다시 안 돈다.***
 *   🔑 ***조용한 반증은 돌지 않은 반증이다.*** 그래서 여기 옮긴다.
 *
 * ⛔ 이 자는 「몇 줄 맞혔나」가 아니라 ***「가사가 어디까지 살아 있나」***를 답하는 데 쓴다.
 */
import { describe, expect, test } from 'bun:test';
import { lyricFidelity, lyricLines, sayLyricFidelity } from './music-qc.js';

const LYRICS = `[Verse]
Quiet hands are moving in the early light.
Every small correction makes the picture right.
[Chorus]
We watch it close, we let it show.`;

const srt = (rows: [string, string, string][]): string =>
  rows.map(([a, b, t], i) => `${i + 1}\n${a} --> ${b}\n${t}\n`).join('\n');

describe('lyricLines — 구조 태그는 «부르는 말»이 아니다', () => {
  test('[Verse]·[Chorus] 는 안 센다 — 세면 분모가 부푼다', () => {
    expect(lyricLines(LYRICS)).toHaveLength(3);
  });
  test('기악([inst] 뿐)이면 0줄이다 — 「잴 것이 없다」의 근거', () => {
    expect(lyricLines('[inst]\n[outro]')).toHaveLength(0);
  });
});

describe('lyricFidelity — ⛔ 「못 쟀다」를 «0줄 불렀다»로 접지 않는다', () => {
  test('✅ 다 부르면 가사 끝이 «마지막 맞힌 구간의 끝»이다', () => {
    const f = lyricFidelity(srt([
      ['00:00:00,000', '00:00:10,000', 'Quiet hands are moving in the early light'],
      ['00:00:10,000', '00:00:20,000', 'Every small correction makes the picture right'],
      ['00:00:20,000', '00:00:30,000', 'We watch it close, we let it show'],
    ]), LYRICS, 40);
    expect(f.matched).toBe(3);
    expect(f.onScriptEnd).toBe(30);
    expect(f.offScript).toBe(10);          // 40 − 30
  });

  test('⛔ 받아쓰기가 «죽으면»(빈 SRT) 「0줄」이 아니라 «못 쟀다»', () => {
    const f = lyricFidelity('', LYRICS, 40);
    expect(f.onScriptEnd).toBeNull();
    expect(f.why ?? '').toContain('못 읽었다');
    expect(sayLyricFidelity(f)).toContain('못 쟀다');
  });

  test('⛔ «다른 가사»를 불렀으면 그것도 «못 쟀다»다 — 「0줄 맞음」이 아니다', () => {
    const f = lyricFidelity(srt([['00:00:00,000', '00:00:05,000', 'totally different words']]), LYRICS, 40);
    expect(f.matched).toBe(0);
    expect(f.onScriptEnd).toBeNull();
    expect(f.why ?? '').toContain('«한 줄도» 없다');
  });

  test('기악(가사 0줄)이면 «잴 것이 없다»', () => {
    const f = lyricFidelity(srt([['00:00:00,000', '00:00:05,000', 'la la la']]), '[inst]', 20);
    expect(f.given).toBe(0);
    expect(f.why ?? '').toContain('기악');
  });

  test('⛔⭐ 길이를 «안 주면» 가사 밖 구간을 «추정하지 않는다»', () => {
    // 🩸 1판은 「마지막 자막의 끝」을 길이로 «썼다». 실측에서 그것이 파일보다 29초 길었고,
    //   그래서 가사 밖 구간이 24.0s 대신 53.2s 로 나왔다 — ***둘 다 그럴듯해서 못 알아볼 뻔했다.***
    const rows = srt([['00:00:00,000', '00:00:10,000', 'We watch it close, we let it show']]);
    expect(lyricFidelity(rows, LYRICS).offScript).toBeNull();
    expect(lyricFidelity(rows, LYRICS, 40).offScript).toBe(30);
  });

  test('⛔⭐ 후렴이 «되풀이»되면 마지막 등장까지 산다 — 그래도 matched 는 «서로 다른 줄»', () => {
    // 🩸 1판은 «처음 맞힌 한 번»만 세서 쓸 수 있는 구간을 48초나 짧게 잘랐다.
    const f = lyricFidelity(srt([
      ['00:00:05,000', '00:00:10,000', 'We watch it close, we let it show'],
      ['00:00:50,000', '00:00:58,000', 'We watch it close, we let it show'],
    ]), LYRICS, 60);
    expect(f.onScriptEnd).toBe(58);
    expect(f.matched).toBe(1);
  });

  test('⛔⭐ «깨진» 구간(끝<시작)은 버리되 ***「버렸다」를 말한다***', () => {
    // 🩸 실측 산출에 `61.3 → 49.2` 가 있었다. `parseSrt` 가 그것을 «조용히» 버리고 있었고,
    //   그래서 부르는 쪽은 ***「13개 중 2개가 깨졌다」와 「11개였다」를 구별할 수 없었다.***
    //   🔑 ***버리는 것 자체는 옳다. 말 안 하는 것이 결함이다.***
    const f = lyricFidelity(srt([
      ['00:00:20,000', '00:00:10,000', 'We watch it close, we let it show'],
    ]), LYRICS, 60);
    expect(f.onScriptEnd).toBeNull();                 // 쓸 구간이 «없다»
    expect(f.why ?? '').toContain('버린» 구간 1개');   // ⛔ 그 사실이 «수»로 나온다
  });

  test('⛔ 깨진 구간이 섞여 있으면 «성한 것»으로 재고 버린 수를 말한다', () => {
    const f = lyricFidelity(srt([
      ['00:00:20,000', '00:00:10,000', '깨진 구간'],
      ['00:00:00,000', '00:00:12,000', 'We watch it close, we let it show'],
    ]), LYRICS, 30);
    expect(f.matched).toBe(1);
    expect(f.onScriptEnd).toBe(12);
  });

  test('⚠️ 동음이의는 «덜 맞았다» 쪽으로만 틀린다 — 그 방향을 못 박는다', () => {
    // 준 것 "makes the picture right" ↔ 받아쓴 것 "makes the picture write"
    const f = lyricFidelity(srt([
      ['00:00:00,000', '00:00:10,000', 'Quiet hands are moving in the early light'],
      ['00:00:10,000', '00:00:20,000', 'Every small correction makes the picture write'],
    ]), LYRICS, 30);
    expect(f.matched).toBe(1);             // ⛔ 2가 «아니다» — 귀로는 맞지만 글자로는 다르다
    expect(f.onScriptEnd).toBe(10);        // ⇒ 보수적으로 «짧게» 답한다
  });
});
