#!/usr/bin/env bun
/**
 * 📏 생성된 «컷»이 정적 카메라 요청을 «지켰나»를 잰다.
 *
 * ⛔ 왜 필요한가 (2026-09-10 실측):
 *   같은 `start_image` · 같은 계열 프롬프트로 `kling3_0_turbo` 컷 둘을 뽑았는데
 *   ***하나는 지켰고 하나는 «줌인했다»***. ⇒ 「static camera」는 «경향»이지 «보증»이 아니다.
 *   그래서 ***「만들었다」로 끝내지 말고 「지켜졌나」를 «재고 고른다»***.
 *
 * ⛔⛔ 자를 «접지» 마라 — `scale=1:1` 의 기본 보간(bicubic)이 «0을 만든다».
 *   같은 날 내가 그것으로 outpaint 픽셀 차를 0 으로 «잘못» 읽었다(매뉴얼 §2ⓥ).
 *   ⇒ 전 픽셀을 rawvideo 로 받아 «센다».
 *
 * 사용:
 *   bun scripts/measure-cut-static.ts cut1.mp4 cut2.mp4
 *   bun scripts/measure-cut-static.ts --json cuts/*.mp4
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

interface CutVerdict {
  readonly file: string;
  /** 첫 프레임 ↔ 끝 프레임 픽셀 차 */
  readonly maxDiff: number;
  readonly meanDiff: number;
  /** ⭐ 끝 프레임을 «축소해 되돌렸을 때» 차가 얼마나 주는가(%) — 순수 줌이면 «크게» 준다. */
  readonly unzoomGainPct: number;
  readonly bestZoom: number;
  readonly note: string;
}

/**
 * ⛔⛔ **판정선을 두지 «않는다».**
 *
 * 🩸 첫 판에서 나는 `MEAN_STATIC_MAX = 12` 를 박고 주석에
 *   *"지킨 컷과 어긴 컷을 재서 갈린 자리"* 라고 적었다. **거짓이었다 — 재기 «전»에 썼다.**
 *   누르자마자 «넷 다» 드리프트로 나왔고 그중엔 내가 눈으로 정적이라 한 것도 있었다.
 *
 * 📌 그래서 이 도구는 ***판정하지 않고 «수»를 낸다***. 고르는 것은 «상대 비교»다 —
 *   같은 발주에서 뽑은 컷들 중 `raw` 가 가장 낮은 것.
 * ⚠️ 절대선을 세우려면 표본을 늘려라(조명 연출도 값을 올려서 축이 섞인다).
 */

const frame = (file: string, args: readonly string[], out: string): boolean => {
  const r = spawnSync('ffmpeg', ['-v', 'error', ...args, '-i', file, '-frames:v', '1', '-y', out]);
  return r.status === 0 && existsSync(out);
};

export function measureCut(file: string): CutVerdict {
  const a = `/tmp/_cut_a_${process.pid}.png`;
  const z = `/tmp/_cut_z_${process.pid}.png`;
  // ⛔ 「못 쟀다」와 「정적이다」를 «다른 값»으로 낸다 — fail-closed.
  if (!frame(file, ['-ss', '0.2'], a) || !frame(file, ['-sseof', '-1'], z)) {
    return { file, maxDiff: -1, meanDiff: -1, unzoomGainPct: -1, bestZoom: 1, note: '⛔ 프레임 추출 실패 — 「못 쟀다」이지 「정적」이 아니다' };
  }
  const r = spawnSync('ffmpeg', [
    '-v', 'error', '-i', a, '-i', z,
    '-filter_complex', 'blend=all_mode=difference,format=gray',
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
  ], { maxBuffer: 1024 * 1024 * 256 });
  if (r.status !== 0 || !r.stdout || r.stdout.length === 0) {
    return { file, maxDiff: -1, meanDiff: -1, unzoomGainPct: -1, bestZoom: 1, note: '⛔ 차 계산 실패(크기 불일치?)' };
  }
  const buf = r.stdout;
  let max = 0, sum = 0;
  // ⛔ Buffer 를 for..of 로 돌면 tsc 가 downlevelIteration 을 요구한다 — 인덱스로 돈다.
  for (let i = 0; i < buf.length; i++) { const b = buf[i]!; if (b > max) max = b; sum += b; }
  const mean = sum / buf.length;
  // ⭐ 줌을 «되돌려» 본다 — 순수 스케일 변화면 차가 크게 준다. 아니면 프레이밍이 옮겨간 것이다.
  let best = mean, bestZoom = 1;
  for (const zf of [1.03, 1.06, 1.1, 1.15, 1.22, 1.3]) {
    const w = Math.floor(720 / zf / 2) * 2, h = Math.floor(1280 / zf / 2) * 2;
    const un = `/tmp/_cut_un_${process.pid}.png`;
    const c = spawnSync('ffmpeg', ['-v', 'error', '-i', z, '-vf',
      `crop=${w}:${h}:${(720 - w) >> 1}:${(1280 - h) >> 1},scale=720:1280`, '-y', un]);
    if (c.status !== 0) continue;
    const d = spawnSync('ffmpeg', ['-v', 'error', '-i', a, '-i', un, '-filter_complex',
      'blend=all_mode=difference,format=gray', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
      { maxBuffer: 1024 * 1024 * 256 });
    if (d.status !== 0 || !d.stdout?.length) continue;
    let s2 = 0;
    for (let i = 0; i < d.stdout.length; i++) s2 += d.stdout[i]!;
    const m2 = s2 / d.stdout.length;
    if (m2 < best) { best = m2; bestZoom = zf; }
  }
  const gain = mean > 0 ? ((mean - best) / mean) * 100 : 0;
  return {
    file,
    maxDiff: max,
    meanDiff: Number(mean.toFixed(2)),
    unzoomGainPct: Number(gain.toFixed(1)),
    bestZoom,
    note: gain >= 15
      ? `⚠️ 줌을 되돌리니 ${gain.toFixed(1)}% 줄었다(@${bestZoom}) — «스케일 변화»가 지배적이다`
      : `프레이밍 변화가 «순수 줌은 아니다»(되돌려도 ${gain.toFixed(1)}%만 줄었다)`,
  };
}

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (files.length === 0) {
  console.error('사용: bun scripts/measure-cut-static.ts <cut.mp4>...');
  process.exit(2);
}
const results = files.map(measureCut);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ note: '⛔ 절대 임계 없음 — 같은 발주 안에서 meanDiff 가 가장 낮은 것을 고른다', results }, null, 2));
} else {
  // ⭐ «상대 비교»로 고른다 — 같은 발주에서 raw 가 가장 낮은 것.
  const ranked = [...results].sort((x, y) => x.meanDiff - y.meanDiff);
  const bestFile = ranked.find((v) => v.meanDiff >= 0)?.file;
  for (const v of ranked) {
    const mark = v.file === bestFile ? '⭐ 가장 정적' : '  ';
    console.log(`${mark} mean=${String(v.meanDiff).padStart(6)} max=${String(v.maxDiff).padStart(3)} unzoom=${String(v.unzoomGainPct).padStart(5)}%  ${v.file}`);
    console.log(`     ${v.note}`);
  }
  console.log('\n⛔ 이 도구는 «판정하지 않는다» — 절대 임계가 없다(표본 부족). 같은 발주 안에서 «가장 낮은 것»을 골라라.');
}
// ⛔ 「못 잰 것이 있나」만 exit 로 낸다 — 「정적인가」는 «판정하지 않는다».
process.exit(results.some((v) => v.meanDiff < 0) ? 1 : 0);
