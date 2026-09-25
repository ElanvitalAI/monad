// 영상 제작 레시피 — 합성 소재로 «실제 ffmpeg» 를 태운다.
//
// ⛔ 무는 것: 관문이 «진짜로» 가르나 ⊕ 되돌아가는 간선이 «수렴»하나.
//   🩸 2026-09-23 실물(DaVinciStack): ⑴ 검수 자가 build.py 가 «일부러» 어둡게 깐 배경을 결함으로 읽었다
//   ⑵ fail 이 나면 같은 자르기로 되돌아가 «예산이 다할 때까지» 돌았다.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpeg, run, type RunResult } from './ffmpeg.js';
import type { RecipeCtx } from './types.js';
import { barGridGate, contactSheetReview, epidemicMcpFetch, FILM, inkRuler, measureBpmWithHyperframesBeats, measureInk, perRatioComposition, stretchOf, zoomFor, type BeatsRunner, type PlanRow } from './film.js';

let root = '';
const ctxOf = (state: Record<string, unknown>): RecipeCtx => ({ workdir: join(root, 'work'), state, log: () => {} });

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'film-rec-'));
  // 가운데에 밝은 상자 — 잉크는 가운데 1/3 쯤이어야 한다.
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:r=24:d=2', '-vf', 'drawbox=x=640:y=300:w=640:h=480:color=white:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(root, 'box.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=white:s=1920x1080:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(root, 'photo.mp4')]);
  // ⛔ 검정 띠 9:16 — build.py 가 피한 모양.
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=1080x608:r=24:d=3', '-vf', 'pad=1080:1920:0:656', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(root, 'reels_9x16.mp4')]);
  // 멀쩡한 9:16 — 화면을 꽉 채운다.
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=24:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(root, 'full_9x16.mp4')]);
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe('hyperframes beats — 사람이 BPM 을 안 적으면 음악에서 잰다', () => {
  function trackFile(dir: string): string {
    const p = join(dir, 'track.wav');
    writeFileSync(p, 'not-a-real-wav');
    return p;
  }
  function fake(body: { ok: boolean; code: number | null; out: string; err?: string }, calls: { env?: NodeJS.ProcessEnv; cwd?: string; args?: readonly string[] }[]): BeatsRunner {
    return (_bin, args, _t, cwd, env) => {
      calls.push({ env, cwd, args });
      return { ok: body.ok, code: body.code, signal: null, err: body.err ?? '', out: body.out };
    };
  }

  it('가짜 ok JSON 이면 bpm·beats_path 만 돌려주고 프로젝트는 <audio id="bgm"> 이다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'film-beats-ok-'));
    try {
      const calls: { env?: NodeJS.ProcessEnv; cwd?: string }[] = [];
      const got = await measureBpmWithHyperframesBeats(d, trackFile(d), fake({ ok: true, code: 0, out: '{"ok":true,"bpm":120,"file":"beats/x.json"}' }, calls));
      expect(got).toEqual({ bpm: 120, beats_path: 'beats/x.json', reason: null });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.env?.HYPERFRAMES_SKIP_SKILLS).toBe('1');
      expect(calls[0]!.env?.HYPERFRAMES_NO_TELEMETRY).toBe('1');
      expect(calls[0]!.cwd).toBe(join(d, 'beats-project'));
      const html = readFileSync(join(d, 'beats-project', 'index.html'), 'utf8');
      expect(html).toContain('<audio id="bgm"');
      expect(html).toContain('data-start="0"');
      // 🩸 종전 단언은 `src="../track.wav"` 였다 — 실물 `hyperframes beats` 는 프로젝트 밖 상대경로를 못 찾는다(Audio file not found).
      //   ⇒ 음악은 프로젝트 «안»의 파일 이름이고, 그 파일이 실재하며 원본과 같은 바이트다.
      const src = /<audio id="bgm" src="([^"]+)"/.exec(html)?.[1] ?? '';
      expect(src).not.toContain('/');
      expect(readFileSync(join(d, 'beats-project', src), 'utf8')).toBe('not-a-real-wav');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('bpm 이 0·음수·비유한이면 null 이고 추정값을 안 짓는다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'film-beats-bad-'));
    try {
      const track = trackFile(d);
      for (const bpm of [0, -3, 'NaN', null]) {
        const calls: { env?: NodeJS.ProcessEnv }[] = [];
        const got = await measureBpmWithHyperframesBeats(d, track, fake({ ok: true, code: 0, out: JSON.stringify({ ok: true, bpm, file: 'beats/x.json' }) }, calls));
        expect(got.bpm).toBeNull();
        expect(got.beats_path).toBeNull();
        expect(got.reason).toContain('양의 유한수');
      }
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('러너 rc 1 이면 null 과 실패 이유만 남긴다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'film-beats-rc-'));
    try {
      const calls: { env?: NodeJS.ProcessEnv }[] = [];
      const got = await measureBpmWithHyperframesBeats(d, trackFile(d), fake({ ok: false, code: 1, out: '', err: 'boom' }, calls));
      expect(got.bpm).toBeNull();
      expect(got.beats_path).toBeNull();
      expect(got.reason).toContain('rc 1');
      expect(got.reason).toContain('boom');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('epidemicMcpFetch — bpm 없음 · track 있음 · 가짜 120 이면 bpm 120 · bar_seconds 2 · bpm_source hyperframes-beats', async () => {
    const d = mkdtempSync(join(tmpdir(), 'film-fetch-beats-'));
    try {
      const track = trackFile(d);
      const calls: { env?: NodeJS.ProcessEnv }[] = [];
      const out = await epidemicMcpFetch({
        workdir: join(d, 'work'),
        state: { track_path: track, beats_run: fake({ ok: true, code: 0, out: '{"ok":true,"bpm":120,"file":"beats/x.json"}' }, calls) },
        log: () => {},
      });
      expect(out.outcome).toBe('ok');
      expect(out.produced?.bpm).toBe(120);
      expect(out.produced?.bar_seconds).toBe(2);
      expect(out.produced?.bpm_source).toBe('hyperframes-beats');
      expect(out.produced?.beats_path).toBe('beats/x.json');
      expect(calls).toHaveLength(1);
      const grid = await barGridGate({ workdir: join(d, 'work'), state: { ...out.produced, plan: [['A', 0, 2]] as PlanRow[] }, log: () => {} });
      expect(grid.outcome).not.toBe('no-bpm');
      expect(grid.outcome).toBe('snapped');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('state.bpm 96 이면 러너 0회 · bpm_source state — 사람이 준 값이 이긴다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'film-fetch-state-'));
    try {
      const track = trackFile(d);
      const calls: unknown[] = [];
      const out = await epidemicMcpFetch({
        workdir: join(d, 'work'),
        state: {
          track_path: track,
          bpm: 96,
          beats_run: () => { calls.push(1); return { ok: true, code: 0, signal: null, err: '', out: '{"ok":true,"bpm":120}' }; },
        },
        log: () => {},
      });
      expect(calls).toHaveLength(0);
      expect(out.produced?.bpm).toBe(96);
      expect(out.produced?.bpm_source).toBe('state');
      expect(out.produced?.bar_seconds).toBeCloseTo((60 / 96) * 4, 8);
      expect(existsSync(join(d, 'work', 'beats-project'))).toBe(false);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('러너 rc 1 이면 epidemicMcpFetch 의 bpm 은 null 이고 note 에 실패 이유가 있다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'film-fetch-fail-'));
    try {
      const track = trackFile(d);
      const out = await epidemicMcpFetch({
        workdir: join(d, 'work'),
        state: { track_path: track, beats_run: fake({ ok: false, code: 1, out: '', err: 'detector down' }, []) },
        log: () => {},
      });
      expect(out.produced?.bpm).toBeNull();
      expect(out.produced?.bar_seconds).toBeNull();
      expect(out.produced?.bpm_source).toBeNull();
      expect(out.note).toContain('detector down');
      const grid = await barGridGate({ workdir: join(d, 'work'), state: { bpm: out.produced?.bpm, plan: [['A', 0, 2]] }, log: () => {} });
      expect(grid.outcome).toBe('no-bpm');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('bar-grid-gate — 마디 격자', () => {
  const bpm = 128;             // 1마디 1.875s
  it('전부 마디 위면 snapped', async () => {
    const plan: PlanRow[] = [['A', 0, 3.75], ['B', 3.75, 1.875]];
    expect((await barGridGate(ctxOf({ plan, bpm }))).outcome).toBe('snapped');
  });
  it('⭐ 마디 밖이면 off-grid 로 «고친 원장»을 내고, 그 원장으로 다시 재면 snapped — 되돌이가 수렴한다', async () => {
    const plan: PlanRow[] = [['A', 0, 3.5], ['B', 3.5, 2.0]];
    const r1 = await barGridGate(ctxOf({ plan, bpm }));
    expect(r1.outcome).toBe('off-grid');
    const r2 = await barGridGate(ctxOf({ plan: r1.produced!.plan, bpm }));
    expect(r2.outcome).toBe('snapped');
  });
  it('BPM 을 모르면 no-bpm', async () => {
    expect((await barGridGate(ctxOf({ plan: [['A', 0, 2]] }))).outcome).toBe('no-bpm');
  });
});

describe('잉크 · 줌 — build.py 규칙', () => {
  it('⭐ 잉크는 밝은 상자의 가로 범위를 잡는다(1920 기준)', () => {
    const k = measureInk(join(root, 'box.mp4'), 2);
    expect(k.L).toBeGreaterThanOrEqual(600);
    expect(k.R).toBeLessThanOrEqual(1320);
    expect(Math.abs(k.cx - 960)).toBeLessThan(40);
  }, 60_000);
  it('전폭 가정 샷에서 얼굴이 6/8이면 cx=1344 · 로그, 3/8이면 중앙 960; 선화는 얼굴 자를 부르지 않는다', async () => {
    const photo = join(root, 'photo.mp4');
    expect(measureInk(photo, 1).note).toBe('측정불가-전폭가정');
    const plan: PlanRow[] = [['PHOTO', 0, 1]];
    const logs: { event: string; data: unknown }[] = [];
    let calls = 0;
    const base = { plan, shot_sources: { PHOTO: photo }, focus_measure: (paths: readonly string[]) => {
      calls++;
      expect(paths).toEqual([photo]);
      return [{ path: photo, focusPeak: 2665, frames: 8, faceFrames: 6, faceCenterX: 0.7 }];
    } };
    const yes = await inkRuler({ workdir: root, state: base, log: (event, data) => logs.push({ event, data }) });
    expect(yes.produced?.ink).toMatchObject({ PHOTO: { L: 0, R: 1920, cx: 1344, note: '얼굴-중심' } });
    expect(logs).toEqual([{ event: 'ink.face-center', data: { cut: 'PHOTO', faceCenterX: 0.7, faceFrames: 6, frames: 8 } }]);
    expect(calls).toBe(1);
    const no = await inkRuler(ctxOf({ ...base, focus_measure: () => [{ path: photo, focusPeak: 2665, frames: 8, faceFrames: 3, faceCenterX: 0.7 }] }));
    expect(no.produced?.ink).toMatchObject({ PHOTO: { L: 0, R: 1920, cx: 960, note: '측정불가-전폭가정' } });
    const missing = await inkRuler(ctxOf({ ...base, focus_measure: () => null }));
    expect(missing.produced?.ink).toMatchObject({ PHOTO: { cx: 960, note: '측정불가-전폭가정' } });
    const line = await inkRuler(ctxOf({ plan: [['BOX', 0, 2]], shot_sources: { BOX: join(root, 'box.mp4') }, focus_measure: () => { throw new Error('선화 샷에는 얼굴 자 호출 금지'); } }));
    expect(line.produced?.ink).toMatchObject({ BOX: { cx: expect.any(Number) } });
    expect((line.produced?.ink as Record<string, { note?: string }>).BOX!.note).not.toBe('얼굴-중심');
  }, 60_000);
  it('⛔ 줌은 1 아래로 못 내려간다 — 잉크가 화면보다 넓어도(crop 이 입력보다 큰 폭을 요구하고 죽는다)', () => {
    const z = zoomFor({ L: 0, R: 1920, cx: 960 }, 1920, 1080, { key: '9x16', name: 'r', w: 1080, h: 1920, cy: 0.44 });
    expect(z.z).toBeGreaterThanOrEqual(1);
    expect(z.band).toBe(true);
  });
  it('소재가 슬롯보다 짧으면 «살짝» 늘인다 · 길면 그대로', () => {
    expect(stretchOf(3.5, 3.75, 24)).toBeCloseTo(3.75 / 3.5, 5);
    expect(stretchOf(4, 3.75, 24)).toBe(1);
  });
});

describe('contact-sheet-review — «검정 띠»를 잰다 (어두운 디자인이 아니라)', () => {
  it('⛔ 지어낸 음성 — 검정 띠 9:16 은 fail · 그 비율을 dark_ratios 로 낸다', async () => {
    const r = await contactSheetReview(ctxOf({ social_paths: [join(root, 'reels_9x16.mp4')] }));
    expect(r.outcome).toBe('fail');
    expect(r.produced?.dark_ratios).toEqual(['reels_9x16']);
  }, 60_000);
  it('✅ 꽉 찬 9:16 은 pass', async () => {
    expect((await contactSheetReview(ctxOf({ social_paths: [join(root, 'full_9x16.mp4')] }))).outcome).toBe('pass');
  }, 60_000);
});

describe('⭐ 되돌이 수렴 — review fail 로 돌아오면 «같은 자르기»를 다시 하지 않는다', () => {
  it('dark_ratios 가 있으면 잉크 자가 그 비율을 전용 합성 필요로 돌리고, 전용 합성이 없으면 error(→ master-only)', async () => {
    const plan: PlanRow[] = [['BOX', 0, 2]];
    const base = { plan, shot_sources: { BOX: join(root, 'box.mp4') }, targets: [{ key: '9x16', name: 'reels_9x16', w: 1080, h: 1920, cy: 0.44 }] };
    const first = await inkRuler(ctxOf(base));
    expect(first.outcome).toBe('croppable');                         // 처음엔 자른다(build.py 기본)
    const again = await inkRuler(ctxOf({ ...base, dark_ratios: ['reels_9x16'] }));
    expect(again.outcome).toBe('needs-native');
    const comp = await perRatioComposition(ctxOf({ native_needed: again.produced!.native_needed }));
    expect(comp.outcome).toBe('error');                              // 전용 합성이 없다 → master-only
    expect(comp.note).toContain('BOX@9x16');
  }, 60_000);
});

describe('per-ratio-composition — HyperFrames 로 없는 컷@비율을 짓는다', () => {
  const target = { key: '9x16', name: 'reels_9x16', w: 1080, h: 1920, cy: 0.44 };
  function project(dir: string): string {
    const p = join(dir, 'hf');
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, 'index.html'), '<div data-composition-id="root" data-width="1920" data-height="1080" data-duration="1"></div>');
    return p;
  }
  function lavfi(path: string, w: number, h: number): void {
    const r = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=${w}x${h}:d=1:r=30`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path], 60_000);
    if (!r.ok) throw new Error(r.err.split('\n')[0] ?? 'lavfi');
  }
  function fakeRunner(calls: { cwd?: string }[]): (bin: string, args: readonly string[], timeoutMs: number, cwd?: string) => RunResult {
    return (bin, args, _t, cwd) => {
      calls.push({ cwd });
      if (bin === 'ffprobe') return run('ffprobe', args);
      const sub = args[1];
      if (bin === 'npx' && sub === 'check') return { ok: true, code: 0, signal: null, err: '', out: '{"ok":true}' };
      if (bin === 'npx' && sub === 'snapshot') return { ok: true, code: 0, signal: null, err: '', out: '' };
      if (bin === 'npx' && sub === 'render') {
        const html = readFileSync(join(cwd!, 'index.html'), 'utf8');
        const w = Number(/data-width="(\d+)"/.exec(html)?.[1]);
        const h = Number(/data-height="(\d+)"/.exec(html)?.[1]);
        lavfi(args[args.indexOf('-o') + 1]!, w, h);
        return { ok: true, code: 0, signal: null, err: '', out: '' };
      }
      return { ok: false, code: 1, signal: null, err: 'unexpected', out: '' };
    };
  }
  function probe(path: string): { w: number; h: number } {
    const r = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', path]);
    const j = JSON.parse(r.out) as { streams: { width: number; height: number }[] };
    return { w: j.streams[0]!.width, h: j.streams[0]!.height };
  }

  it('프로젝트가 있으면 9x16 으로 지어 native_sources 에 싣고 원본 index.html 은 그대로다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'film-hf-'));
    try {
      const proj = project(d);
      const before = readFileSync(join(proj, 'index.html'), 'utf8');
      const given = join(d, 'given-1x1.mp4');
      lavfi(given, 64, 64);
      const calls: { cwd?: string }[] = [];
      const out = await perRatioComposition(ctxOf({
        native_needed: [{ cut: 'a', ratio: '9x16' }, { cut: 'b', ratio: '1x1' }],
        native_sources: { b: { '1x1': given } },
        hyperframes_projects: { a: proj },
        targets: [target, { key: '1x1', name: 'sq', w: 1080, h: 1080, cy: 0.5 }],
        hyperframes_run: fakeRunner(calls),
      }));
      expect(out.outcome).toBe('ok');
      const sources = out.produced?.native_sources as Record<string, Record<string, string>>;
      expect(probe(sources.a!['9x16']!)).toEqual({ w: 1080, h: 1920 });
      expect(sources.b!['1x1']).toBe(given);
      expect(out.produced?.native_built).toBe(1);
      expect(out.produced?.native_given).toBe(1);
      expect((out.produced?.native_paths as string[]).length).toBe(2);
      expect(readFileSync(join(proj, 'index.html'), 'utf8')).toBe(before);
      expect(out.note).toContain('native_built 1');
      expect(out.note).toContain('native_given 1');
    } finally { rmSync(d, { recursive: true, force: true }); }
  }, 60_000);

  it('같은 컷의 두 비율을 지으면 파일이 둘이고 각자 자기 크기다(덮어쓰지 않는다)', async () => {
    const d = mkdtempSync(join(tmpdir(), 'film-hf-two-'));
    try {
      const proj = project(d);
      const calls: { cwd?: string }[] = [];
      const out = await perRatioComposition(ctxOf({
        native_needed: [{ cut: 'a', ratio: '9x16' }, { cut: 'a', ratio: '4x5' }],
        native_sources: {},
        hyperframes_projects: { a: proj },
        targets: [target, { key: '4x5', name: 'feed', w: 1080, h: 1350, cy: 0.48 }],
        hyperframes_run: fakeRunner(calls),
      }));
      expect(out.outcome).toBe('ok');
      const sources = out.produced?.native_sources as Record<string, Record<string, string>>;
      expect(sources.a!['9x16']).not.toBe(sources.a!['4x5']);
      expect(probe(sources.a!['9x16']!)).toEqual({ w: 1080, h: 1920 });
      expect(probe(sources.a!['4x5']!)).toEqual({ w: 1080, h: 1350 });
    } finally { rmSync(d, { recursive: true, force: true }); }
  }, 60_000);

  it('hyperframes_projects 가 없으면 error 이고 note 에 a@9x16 이 있다', async () => {
    const out = await perRatioComposition(ctxOf({
      native_needed: [{ cut: 'a', ratio: '9x16' }],
      native_sources: {},
      targets: [target],
    }));
    expect(out.outcome).toBe('error');
    expect(out.note).toContain('a@9x16');
  });

  it('프로젝트가 workdir 자체면 예외 없이 error 이고 note 에 a@9x16', async () => {
    const d = mkdtempSync(join(tmpdir(), 'film-hf-nest-'));
    try {
      const proj = project(d);
      const out = await perRatioComposition({
        workdir: proj,
        state: {
          native_needed: [{ cut: 'a', ratio: '9x16' }],
          hyperframes_projects: { a: proj },
          targets: [target],
        },
        log: () => {},
      });
      expect(out.outcome).toBe('error');
      expect(out.note).toContain('a@9x16');
      expect(out.note).toContain('못 부름');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('프로젝트가 있는데 check 가 실패하면 error 이고 note 에 check-fail', async () => {
    const d = mkdtempSync(join(tmpdir(), 'film-hf-fail-'));
    try {
      const proj = project(d);
      const out = await perRatioComposition(ctxOf({
        native_needed: [{ cut: 'a', ratio: '9x16' }],
        hyperframes_projects: { a: proj },
        targets: [target],
        hyperframes_run: () => ({ ok: true, code: 0, signal: null, err: '', out: '{"ok":false}' }),
      }));
      expect(out.outcome).toBe('error');
      expect(out.note).toContain('check-fail');
      expect(out.note).toContain('a@9x16');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

it('레시피 표 — film 선언의 열넷 이름이 «전부» 있다', async () => {
  const decl = (await import('node:fs')).readFileSync(join(import.meta.dir, '../../../graphs/video/film-production-standard.yaml'), 'utf8');
  const names = [...new Set([...decl.matchAll(/recipe:\s*([\w-]+)/g)].map((m) => m[1]!))].filter((n) => !n.startsWith('terminal-'));
  expect(names.length).toBe(14);
  expect(names.filter((n) => !(n in FILM))).toEqual([]);
});
