import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

/**
 * ⛔⭐ 「나레이션이 영상을 «자른다»」 회귀 방어.
 *
 * 🩸 2026-09-22 실물: 타임라인 15.17s 인데 완성본이 11.04s 였고 그 11.04 는 `vo.wav` 길이였다.
 *   기전 = `[vo]` 에 `apad` 가 «없고» `amix` 가 `duration=first` 라 믹스가 나레이션 끝에서 멎고,
 *          `-shortest` 가 그림을 거기서 잘랐다.
 *   ⇒ `readback` 이 wrong-length 를 내고 `plan` 으로 되돌아가지만 되돌아간 쪽이 측정값을 못 받아
 *     ***영영 수렴하지 못한다***(실물: 네 바퀴 돌고 budget-exceeded · 종단 없음).
 *
 * ⛔ 이 시험은 «인자 문면»이 아니라 ***실제 ffmpeg 산출의 길이***를 잰다 —
 *   문면만 보면 필터를 다른 곳에서 덮어써도 초록이 된다.
 */
const HAS = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0
  && spawnSync('ffprobe', ['-version'], { encoding: 'utf8' }).status === 0;

function dur(p: string): number {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], { encoding: 'utf8' });
  return Number((r.stdout ?? '').trim());
}

describe('render — 소리가 짧아도 «그림 길이»가 이긴다', () => {
  it.skipIf(!HAS)('나레이션이 영상보다 짧으면 완성본은 «영상» 길이다', () => {
    const d = mkdtempSync(join(tmpdir(), 'renderlen-'));
    const v = join(d, 'v.mp4'), a = join(d, 'vo.wav'), m = join(d, 'bg.wav'), out = join(d, 'master.mp4');
    // 그림 6초 · 나레이션 2초 · 음악 10초 — 수리 «전» 코드는 2초로 잘랐다
    spawnSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=navy:s=320x240:r=30','-t','6',v]);
    spawnSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=f=440:r=48000','-t','2',a]);
    spawnSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=f=220:r=48000','-t','10',m]);

    // free-line.ts 의 vo+music 갈래와 «같은» 체인
    const chain =
      '[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,apad[vo];'
      + '[2:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=-14dB,apad[bg];'
      + '[vo][bg]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[aout]';
    const r = spawnSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',v,'-i',a,'-i',m,
      '-filter_complex', chain, '-map','0:v','-map','[aout]','-c:a','aac','-b:a','160k','-shortest', out], { encoding: 'utf8' });
    expect(r.status).toBe(0);

    const got = dur(out);
    // ⛔ 2.x 면 나레이션에 잘린 것이다 — 그것이 수리 «전»의 값이다
    expect(got).toBeGreaterThan(5.5);
    expect(got).toBeLessThan(6.5);
  });

  it('소스가 apad[vo] ⊕ duration=longest 를 «쓰고 있다»', () => {
    const src = readFileSync(new URL('./free-line.ts', import.meta.url), 'utf8');
    expect(src).toContain('channel_layouts=stereo,apad[vo];');
    expect(src).toContain('amix=inputs=2:duration=longest');
    // 🩸 수리 전 문면이 남아 있으면 «되돌아간» 것이다
    expect(src).not.toContain('amix=inputs=2:duration=first');
  });
});
