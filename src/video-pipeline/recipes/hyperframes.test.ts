/**
 * hyperframes-render — 가짜 러너만 쓴다. 진짜 `npx` 는 부르지 않는다.
 * 실물 mp4 는 시험이 `ffmpeg -f lavfi` 로 선언과 같은(또는 일부러 다른) 크기·길이로 쓴다.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { run, type RunResult } from './ffmpeg.js';
import { hyperframesRender, renderProjectAtSize, runHyperframes, HYPERFRAMES } from './hyperframes.js';
import { UNOBSERVED, type RecipeCtx } from './types.js';
import { ALL_RECIPES } from '../walk-line.js';

const T = 60_000;

function project(dir: string, w: number, h: number, dur: number): string {
  const p = join(dir, 'hf-project');
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, 'index.html'), `<!doctype html><html data-width="${w}" data-height="${h}" data-duration="${dur}"><body></body></html>`);
  return p;
}

function lavfiMp4(path: string, w: number, h: number, dur: number): void {
  const r = run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=black:s=${w}x${h}:d=${dur}:r=30`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    path,
  ], 60_000);
  if (!r.ok) throw new Error(`픽스처 mp4 실패: ${r.err.split('\n')[0]}`);
}

function ctxOf(workdir: string, projectDir: string | undefined): RecipeCtx {
  return {
    workdir,
    state: projectDir === undefined ? {} : { hyperframes_project: projectDir },
    log: () => {},
  };
}

interface Call { bin: string; args: readonly string[]; cwd?: string }

type Runner = (bin: string, args: readonly string[], timeoutMs: number, cwd?: string) => RunResult;

const registered = ALL_RECIPES['hyperframes-render'];

function scripted(handlers: {
  check: RunResult;
  snapshot?: (args: readonly string[]) => RunResult;
  render?: (args: readonly string[]) => RunResult;
}): { runner: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: Runner = (bin, args, _timeoutMs, cwd) => {
    calls.push({ bin, args, cwd });
    if (bin === 'ffprobe') {
      return run('ffprobe', args);
    }
    const sub = args[1];
    if (bin === 'npx' && sub === 'check') return handlers.check;
    if (bin === 'npx' && sub === 'snapshot') return (handlers.snapshot ?? (() => ({ ok: true, code: 0, signal: null, err: '', out: '' })))(args);
    if (bin === 'npx' && sub === 'render') return (handlers.render ?? (() => ({ ok: true, code: 0, signal: null, err: '', out: '' })))(args);
    return { ok: false, code: 1, signal: null, err: `unexpected ${bin} ${args.join(' ')}`, out: '' };
  };
  return { runner, calls };
}

describe('hyperframes-render', () => {
  test('ALL_RECIPES 가 hyperframes-render 를 기존 키와 겹치지 않게 싣는다', () => {
    expect(registered).toBeFunction();
    expect(Object.keys(ALL_RECIPES).filter((k) => k === 'hyperframes-render')).toHaveLength(1);
  });

  test('check ok 이고 render 가 선언과 같은 mp4 를 쓰면 outcome ok 와 hf_render_path', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-ok-'));
    try {
      const proj = project(d, 320, 240, 1);
      const work = join(d, 'work');
      mkdirSync(work, { recursive: true });
      const { runner, calls } = scripted({
        check: { ok: true, code: 0, signal: null, err: '', out: JSON.stringify({ ok: true, lint: { errorCount: 0 }, runtime: { errorCount: 0 }, layout: { errorCount: 0 } }) },
        render: (args) => {
          const o = args[args.indexOf('-o') + 1]!;
          lavfiMp4(o, 320, 240, 1);
          return { ok: true, code: 0, signal: null, err: '', out: '' };
        },
      });
      const out = await hyperframesRender({ run: runner })(ctxOf(work, proj));
      expect(out.outcome).toBe('ok');
      expect(typeof out.produced?.hf_render_path).toBe('string');
      expect(String(out.produced?.hf_render_path)).toContain(work);
      expect(String(out.produced?.hf_snapshot_dir)).toContain(work);
      expect(out.produced?.hf_check).toEqual({ lint: 0, runtime: 0, layout: 0 });
      const bins = calls.map((c) => `${c.bin} ${c.args[1] ?? ''}`.trim());
      expect(bins.filter((b) => b.startsWith('npx'))).toEqual(['npx check', 'npx snapshot', 'npx render']);
      expect(calls.some((c) => c.bin === 'npx' && c.args.includes('--json'))).toBe(true);
      expect(calls.filter((c) => c.bin === 'npx').every((c) => c.cwd === proj)).toBe(true);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }, T);

  test('check ok=false 면 check-fail 이고 render 호출은 0', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-fail-'));
    try {
      const proj = project(d, 1080, 1080, 3);
      const { runner, calls } = scripted({
        check: { ok: true, code: 0, signal: null, err: '', out: '{"ok":false,"lint":{"errorCount":2}}' },
      });
      const out = await hyperframesRender({ run: runner })(ctxOf(d, proj));
      expect(out.outcome).toBe('check-fail');
      expect(out.produced?.hf_check).toEqual({ lint: 2, runtime: 0, layout: 0 });
      expect(calls.filter((c) => c.bin === 'npx' && c.args[1] === 'render')).toHaveLength(0);
      expect(calls.filter((c) => c.bin === 'npx' && c.args[1] === 'snapshot')).toHaveLength(0);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }, T);

  test('렌더가 선언보다 작으면(1080 선언 · 640 실측) render-mismatch', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-mis-'));
    try {
      const proj = project(d, 1080, 1080, 1);
      const work = join(d, 'work');
      mkdirSync(work, { recursive: true });
      const { runner } = scripted({
        check: { ok: true, code: 0, signal: null, err: '', out: '{"ok":true}' },
        render: (args) => {
          const o = args[args.indexOf('-o') + 1]!;
          lavfiMp4(o, 640, 640, 1);
          return { ok: true, code: 0, signal: null, err: '', out: '' };
        },
      });
      const out = await hyperframesRender({ run: runner })(ctxOf(work, proj));
      expect(out.outcome).toBe('render-mismatch');
    } finally { rmSync(d, { recursive: true, force: true }); }
  }, T);

  test('hyperframes_project 가 없으면 UNOBSERVED 이고 npx 를 안 부른다', async () => {
    const { runner, calls } = scripted({
      check: { ok: true, code: 0, signal: null, err: '', out: '{"ok":true}' },
    });
    const out = await hyperframesRender({ run: runner })(ctxOf('/tmp', undefined));
    expect(out.outcome).toBe(UNOBSERVED);
    expect(calls).toHaveLength(0);
  });

  test('기본 러너는 자식 env 에 SKIP_SKILLS 와 NO_TELEMETRY 를 싣는다', () => {
    const r = runHyperframes(process.execPath, ['-e', 'process.stdout.write(process.env.HYPERFRAMES_SKIP_SKILLS + " " + process.env.HYPERFRAMES_NO_TELEMETRY)'], 10_000);
    expect(r.ok).toBe(true);
    expect(r.out).toBe('1 1');
  });

  test('상대 workdir 이어도 -o 는 resolve 된 절대경로이고 workdir 안이다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-abs-'));
    const rel = join('rel-hf-work', String(Date.now()));
    try {
      const proj = project(d, 320, 240, 1);
      mkdirSync(rel, { recursive: true });
      const { runner, calls } = scripted({
        check: { ok: true, code: 0, signal: null, err: '', out: '{"ok":true}' },
        snapshot: () => ({ ok: false, code: 1, signal: null, err: 'stop', out: '' }),
      });
      await hyperframesRender({ run: runner })(ctxOf(rel, proj));
      const outs = calls.filter((c) => c.bin === 'npx' && c.args.includes('-o')).map((c) => c.args[c.args.indexOf('-o') + 1]!);
      const root = resolve(rel);
      expect(outs.length).toBeGreaterThan(0);
      expect(outs.every((p) => isAbsolute(p) && p.startsWith(root + '/'))).toBe(true);
    } finally {
      rmSync(rel, { recursive: true, force: true });
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('renderProjectAtSize 는 복사본의 data-width·data-height 만 바꾸고 원본은 그대로 둔다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-size-'));
    try {
      const proj = project(d, 1920, 1080, 1);
      const html = '<div data-composition-id="root" data-width="1920" data-height="1080" data-duration="1"></div>';
      writeFileSync(join(proj, 'index.html'), html);
      const work = join(d, 'work');
      mkdirSync(work, { recursive: true });
      const { runner, calls } = scripted({
        check: { ok: true, code: 0, signal: null, err: '', out: '{"ok":true}' },
        render: (args) => {
          const cwd = calls.at(-1)?.cwd;
          const copied = readFileSync(join(cwd!, 'index.html'), 'utf8');
          const w = /data-width="(\d+)"/.exec(copied)?.[1];
          const h = /data-height="(\d+)"/.exec(copied)?.[1];
          const o = args[args.indexOf('-o') + 1]!;
          lavfiMp4(o, Number(w), Number(h), 1);
          return { ok: true, code: 0, signal: null, err: '', out: '' };
        },
      });
      const out = await renderProjectAtSize(
        { projectDir: proj, workdir: work, width: 1080, height: 1920, label: 'a-9x16' },
        { run: runner },
      );
      expect(out.outcome).toBe('ok');
      expect(readFileSync(join(proj, 'index.html'), 'utf8')).toBe(html);
      const copiedHtml = calls.filter((c) => c.bin === 'npx').map((c) => readFileSync(join(c.cwd!, 'index.html'), 'utf8'));
      expect(copiedHtml.every((s) => s.includes('data-width="1080"') && s.includes('data-height="1920"'))).toBe(true);
      expect(copiedHtml.every((s) => !s.includes('data-width="1920"'))).toBe(true);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }, T);

  test('renderProjectAtSize — index.html 이 심볼릭 링크여도 원본 대상은 안 바뀐다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-size-link-'));
    try {
      const proj = join(d, 'hf-project');
      mkdirSync(proj, { recursive: true });
      const target = join(d, 'real-index.html');
      const html = '<div data-composition-id="root" data-width="1920" data-height="1080" data-duration="1"></div>';
      writeFileSync(target, html);
      symlinkSync(target, join(proj, 'index.html'));
      const { runner, calls } = scripted({
        check: { ok: true, code: 0, signal: null, err: '', out: '{"ok":true}' },
        render: (args) => {
          const cwd = calls.at(-1)?.cwd;
          const copied = readFileSync(join(cwd!, 'index.html'), 'utf8');
          const w = /data-width="(\d+)"/.exec(copied)?.[1];
          const h = /data-height="(\d+)"/.exec(copied)?.[1];
          const o = args[args.indexOf('-o') + 1]!;
          lavfiMp4(o, Number(w), Number(h), 1);
          return { ok: true, code: 0, signal: null, err: '', out: '' };
        },
      });
      const out = await renderProjectAtSize(
        { projectDir: proj, workdir: join(d, 'work'), width: 1080, height: 1920, label: 'a-9x16' },
        { run: runner },
      );
      expect(out.outcome).toBe('ok');
      expect(readFileSync(target, 'utf8')).toBe(html);
      const copiedIndex = calls.find((c) => c.bin === 'npx')?.cwd;
      expect(lstatSync(join(copiedIndex!, 'index.html')).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(copiedIndex!, 'index.html'), 'utf8')).toContain('data-width="1080"');
    } finally { rmSync(d, { recursive: true, force: true }); }
  }, T);

  test('renderProjectAtSize — 이미 요청한 크기여도 전용본이 없으면 렌더한다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-size-same-'));
    try {
      const proj = project(d, 1080, 1920, 1);
      const html = '<div data-composition-id="root" data-width="1080" data-height="1920" data-duration="1"></div>';
      writeFileSync(join(proj, 'index.html'), html);
      const { runner, calls } = scripted({
        check: { ok: true, code: 0, signal: null, err: '', out: '{"ok":true}' },
        render: (args) => {
          const cwd = calls.at(-1)?.cwd;
          const copied = readFileSync(join(cwd!, 'index.html'), 'utf8');
          const w = /data-width="(\d+)"/.exec(copied)?.[1];
          const h = /data-height="(\d+)"/.exec(copied)?.[1];
          const o = args[args.indexOf('-o') + 1]!;
          lavfiMp4(o, Number(w), Number(h), 1);
          return { ok: true, code: 0, signal: null, err: '', out: '' };
        },
      });
      const out = await renderProjectAtSize(
        { projectDir: proj, workdir: join(d, 'work'), width: 1080, height: 1920, label: 'a-9x16' },
        { run: runner },
      );
      expect(out.outcome).toBe('ok');
      expect(typeof out.path).toBe('string');
      expect(calls.filter((c) => c.bin === 'npx' && c.args[1] === 'render')).toHaveLength(1);
      expect(readFileSync(join(proj, 'index.html'), 'utf8')).toBe(html);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }, T);

  test('data-duration 이 0·음수·비수면 길이 검증을 생략하지 않고 거부한다', async () => {
    for (const bad of ['0', '-1', 'nope', '']) {
      const d = mkdtempSync(join(tmpdir(), 'hf-dur-bad-'));
      try {
        const proj = project(d, 320, 240, 1);
        writeFileSync(
          join(proj, 'index.html'),
          `<html data-width="320" data-height="240" data-duration="${bad}"></html>`,
        );
        const { runner, calls } = scripted({
          check: { ok: true, code: 0, signal: null, err: '', out: '{"ok":true}' },
          render: (args) => {
            const o = args[args.indexOf('-o') + 1]!;
            lavfiMp4(o, 320, 240, 1);
            return { ok: true, code: 0, signal: null, err: '', out: '' };
          },
        });
        const out = await hyperframesRender({ run: runner })(ctxOf(join(d, 'work'), proj));
        expect(out.outcome).not.toBe('ok');
        expect(calls.filter((c) => c.bin === 'npx' && c.args[1] === 'render')).toHaveLength(0);
      } finally { rmSync(d, { recursive: true, force: true }); }
    }
  });

  test('선언한 양수 duration 과 실측이 어긋나면 render-mismatch', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-dur-mis-'));
    try {
      const proj = project(d, 320, 240, 1);
      const work = join(d, 'work');
      mkdirSync(work, { recursive: true });
      const { runner } = scripted({
        check: { ok: true, code: 0, signal: null, err: '', out: '{"ok":true}' },
        render: (args) => {
          const o = args[args.indexOf('-o') + 1]!;
          lavfiMp4(o, 320, 240, 3);
          return { ok: true, code: 0, signal: null, err: '', out: '' };
        },
      });
      const out = await hyperframesRender({ run: runner })(ctxOf(work, proj));
      expect(out.outcome).toBe('render-mismatch');
    } finally { rmSync(d, { recursive: true, force: true }); }
  }, T);

  test('data-duration 이 없으면 길이 검증을 생략하지 않고 거부한다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-dur-absent-'));
    try {
      const proj = project(d, 320, 240, 1);
      writeFileSync(join(proj, 'index.html'), '<html data-width="320" data-height="240"></html>');
      const { runner, calls } = scripted({
        check: { ok: true, code: 0, signal: null, err: '', out: '{"ok":true}' },
        render: (args) => {
          const o = args[args.indexOf('-o') + 1]!;
          lavfiMp4(o, 320, 240, 2);
          return { ok: true, code: 0, signal: null, err: '', out: '' };
        },
      });
      const out = await hyperframesRender({ run: runner })(ctxOf(join(d, 'work'), proj));
      expect(out.outcome).not.toBe('ok');
      expect(out.note ?? '').toContain('data-duration');
      expect(calls.filter((c) => c.bin === 'npx' && c.args[1] === 'render')).toHaveLength(0);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('renderProjectAtSize — check 실패면 렌더를 안 하고 check-fail', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-size-fail-'));
    try {
      const proj = project(d, 1920, 1080, 1);
      writeFileSync(join(proj, 'index.html'), '<div data-composition-id="root" data-width="1920" data-height="1080" data-duration="1"></div>');
      const { runner, calls } = scripted({
        check: { ok: true, code: 0, signal: null, err: '', out: '{"ok":false,"lint":{"errorCount":1}}' },
      });
      const out = await renderProjectAtSize(
        { projectDir: proj, workdir: join(d, 'work'), width: 1080, height: 1920, label: 'a-9x16' },
        { run: runner },
      );
      expect(out.outcome).toBe('check-fail');
      expect(calls.filter((c) => c.args[1] === 'render')).toHaveLength(0);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }, T);

  test('renderProjectAtSize — 프로젝트가 workdir 이거나 그 상위면 예외 없이 거부한다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-size-nest-'));
    try {
      const proj = project(d, 1920, 1080, 1);
      writeFileSync(join(proj, 'index.html'), '<div data-composition-id="root" data-width="1920" data-height="1080" data-duration="1"></div>');
      const before = readFileSync(join(proj, 'index.html'), 'utf8');
      const same = await renderProjectAtSize(
        { projectDir: proj, workdir: proj, width: 1080, height: 1920, label: 'a-9x16' },
        { run: () => { throw new Error('runner must not be called'); } },
      );
      expect(same.outcome).toBe(UNOBSERVED);
      expect(same.note).toContain('상위');
      const parent = await renderProjectAtSize(
        { projectDir: d, workdir: proj, width: 1080, height: 1920, label: 'a-9x16' },
        { run: () => { throw new Error('runner must not be called'); } },
      );
      expect(parent.outcome).toBe(UNOBSERVED);
      expect(parent.note).toContain('상위');
      expect(readFileSync(join(proj, 'index.html'), 'utf8')).toBe(before);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('renderProjectAtSize — 복사 실패는 예외가 아니라 결과다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-size-copy-'));
    try {
      const proj = project(d, 1920, 1080, 1);
      writeFileSync(join(proj, 'index.html'), '<div data-composition-id="root" data-width="1920" data-height="1080" data-duration="1"></div>');
      const blocked = join(d, 'blocked');
      writeFileSync(blocked, 'not-a-dir');
      const out = await renderProjectAtSize(
        { projectDir: proj, workdir: blocked, width: 1080, height: 1920, label: 'a-9x16' },
        { run: () => { throw new Error('runner must not be called'); } },
      );
      expect(out.outcome).toBe(UNOBSERVED);
      expect(out.note.length).toBeGreaterThan(0);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('renderProjectAtSize — 복사·읽기·쓰기 실패는 예외가 아니라 결과다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-size-io-'));
    try {
      const proj = project(d, 1920, 1080, 1);
      writeFileSync(join(proj, 'index.html'), '<div data-composition-id="root" data-width="1920" data-height="1080" data-duration="1"></div>');
      const spec = { projectDir: proj, workdir: join(d, 'work'), width: 1080, height: 1920, label: 'a-9x16' };
      const boom = () => { throw new Error('runner must not be called'); };
      const copied = await renderProjectAtSize(spec, {
        run: boom,
        files: { copy: () => { throw new Error('EACCES copy'); } },
      });
      expect(copied.outcome).toBe(UNOBSERVED);
      expect(copied.note).toContain('복사 실패');
      const read = await renderProjectAtSize(spec, {
        run: boom,
        files: { read: () => { throw new Error('EACCES read'); } },
      });
      expect(read.outcome).toBe(UNOBSERVED);
      expect(read.note).toContain('읽기 실패');
      const wrote = await renderProjectAtSize(spec, {
        run: boom,
        files: { write: () => { throw new Error('EACCES write'); } },
      });
      expect(wrote.outcome).toBe(UNOBSERVED);
      expect(wrote.note).toContain('쓰기 실패');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('renderProjectAtSize — 못 띄운 npx 는 못 부름(UNOBSERVED)', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-size-sig-'));
    try {
      const proj = project(d, 1920, 1080, 1);
      writeFileSync(join(proj, 'index.html'), '<div data-composition-id="root" data-width="1920" data-height="1080" data-duration="1"></div>');
      const { runner } = scripted({
        check: { ok: false, code: null, signal: 'SIGTERM', err: '', out: '' },
      });
      const out = await renderProjectAtSize(
        { projectDir: proj, workdir: join(d, 'work'), width: 1080, height: 1920, label: 'a-9x16' },
        { run: runner },
      );
      expect(out.outcome).toBe(UNOBSERVED);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('storyboard-gate — 전부 animated 이고 src 가 있으면 approved · frames_total 3', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-sb-ok-'));
    try {
      const proj = project(d, 320, 240, 1);
      const frames = ['01-open.html', '02-mid.html', '03-end.html'];
      mkdirSync(join(proj, 'compositions/frames'), { recursive: true });
      for (const name of frames) writeFileSync(join(proj, 'compositions/frames', name), '<div></div>');
      writeFileSync(join(proj, 'STORYBOARD.md'), [
        '## Frame 1 — open',
        '- status: animated',
        '- src: compositions/frames/01-open.html',
        '### Beat 2 — mid',
        '- status: animated',
        '- src: compositions/frames/02-mid.html',
        '## Scene 3 — end',
        '- status: animated',
        '- src: compositions/frames/03-end.html',
        '',
      ].join('\n'));
      const before = readFileSync(join(proj, 'STORYBOARD.md'), 'utf8');
      const out = await HYPERFRAMES['storyboard-gate']!(ctxOf(join(d, 'work'), proj));
      expect(out.outcome).toBe('approved');
      expect(out.produced?.frames_total).toBe(3);
      expect(out.produced?.status_counts).toEqual({ animated: 3 });
      expect(readFileSync(join(proj, 'STORYBOARD.md'), 'utf8')).toBe(before);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('storyboard-gate — 한 프레임이 built 면 not-ready 이고 그 번호가 produced 에 있다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-sb-built-'));
    try {
      const proj = project(d, 320, 240, 1);
      mkdirSync(join(proj, 'compositions/frames'), { recursive: true });
      writeFileSync(join(proj, 'compositions/frames/01.html'), '<div></div>');
      writeFileSync(join(proj, 'compositions/frames/02.html'), '<div></div>');
      writeFileSync(join(proj, 'STORYBOARD.md'), [
        '## Frame 1',
        '- status: animated',
        '- src: compositions/frames/01.html',
        '## Frame 2',
        '- status: built',
        '- src: compositions/frames/02.html',
        '',
      ].join('\n'));
      const out = await HYPERFRAMES['storyboard-gate']!(ctxOf(join(d, 'work'), proj));
      expect(out.outcome).toBe('not-ready');
      expect(out.produced?.not_ready_frames).toEqual([2]);
      expect(out.produced?.frames_total).toBe(2);
      expect(out.produced?.status_counts).toEqual({ animated: 1, built: 1 });
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('storyboard-gate — STORYBOARD.md 가 없으면 no-storyboard', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-sb-none-'));
    try {
      const proj = project(d, 320, 240, 1);
      expect(existsSync(join(proj, 'STORYBOARD.md'))).toBe(false);
      const out = await HYPERFRAMES['storyboard-gate']!(ctxOf(join(d, 'work'), proj));
      expect(out.outcome).toBe('no-storyboard');
      expect(out.outcome).not.toBe('approved');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('storyboard-gate — 선언한 src 파일이 없으면 missing-src', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-sb-miss-'));
    try {
      const proj = project(d, 320, 240, 1);
      mkdirSync(join(proj, 'compositions/frames'), { recursive: true });
      writeFileSync(join(proj, 'compositions/frames/01.html'), '<div></div>');
      writeFileSync(join(proj, 'STORYBOARD.md'), [
        '## Frame 1',
        '- status: animated',
        '- src: compositions/frames/01.html',
        '## Frame 4',
        '- status: animated',
        '- src: compositions/frames/04-missing.html',
        '',
      ].join('\n'));
      const out = await HYPERFRAMES['storyboard-gate']!(ctxOf(join(d, 'work'), proj));
      expect(out.outcome).toBe('missing-src');
      expect(out.produced?.missing_src_frames).toEqual([4]);
      expect(out.produced?.frames_total).toBe(2);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('storyboard-gate — 같은 번호가 두 번 나와도 앞 프레임을 덮지 않고, 번호 없는 제목도 프레임이며, 다른 제목이 절을 닫는다', async () => {
    // 🩸 #20061 착지 직후 실물: 같은 번호의 뒤 블록이 앞의 `built`·없는 src 를 덮어 approved 가 났다.
    const d = mkdtempSync(join(tmpdir(), 'hf-sb-dup-'));
    try {
      const proj = project(d, 320, 240, 1);
      mkdirSync(join(proj, 'compositions/frames'), { recursive: true });
      writeFileSync(join(proj, 'compositions/frames/02b.html'), '<div></div>');
      writeFileSync(join(proj, 'STORYBOARD.md'), [
        '## Frame 2 — The problem',
        '- status: built',
        '## Frame 2 — Proof',
        '- status: animated',
        '- src: compositions/frames/02b.html',
        '## Frame — Outro',
        '* status: outline',
        '## Notes',
        '- status: animated',
        '',
      ].join('\n'));
      const out = await HYPERFRAMES['storyboard-gate']!(ctxOf(join(d, 'work'), proj));
      expect(out.outcome).toBe('not-ready');
      expect(out.produced?.frames_total).toBe(3);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('storyboard-gate — 모르는 status 는 통과가 아니라 not-ready', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-sb-unk-'));
    try {
      const proj = project(d, 320, 240, 1);
      mkdirSync(join(proj, 'compositions/frames'), { recursive: true });
      writeFileSync(join(proj, 'compositions/frames/01.html'), '<div></div>');
      writeFileSync(join(proj, 'STORYBOARD.md'), [
        '## Frame 7',
        '- status: sketched',
        '- src: compositions/frames/01.html',
        '',
      ].join('\n'));
      const out = await HYPERFRAMES['storyboard-gate']!(ctxOf(join(d, 'work'), proj));
      expect(out.outcome).toBe('not-ready');
      expect(out.produced?.not_ready_frames).toEqual([7]);
      expect(out.produced?.status_counts).toEqual({ sketched: 1 });
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('storyboard-gate — 인식된 프레임이 0개면 approved 가 아니라 not-ready', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-sb-empty-'));
    try {
      const proj = project(d, 320, 240, 1);
      writeFileSync(join(proj, 'STORYBOARD.md'), '# notes only\\nno Frame heading here\\n');
      const empty = await HYPERFRAMES['storyboard-gate']!(ctxOf(join(d, 'work'), proj));
      expect(empty.outcome).toBe('not-ready');
      expect(empty.outcome).not.toBe('approved');
      expect(empty.produced?.frames_total).toBe(0);
      expect(empty.produced?.not_ready_frames).toBeUndefined();
      expect(empty.note).not.toContain('전부 animated');
      writeFileSync(join(proj, 'STORYBOARD.md'), '');
      const blank = await HYPERFRAMES['storyboard-gate']!(ctxOf(join(d, 'work'), proj));
      expect(blank.outcome).toBe('not-ready');
      expect(blank.produced?.frames_total).toBe(0);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('storyboard-gate — status 가 없으면 outline 으로 세고 not-ready', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-sb-def-'));
    try {
      const proj = project(d, 320, 240, 1);
      writeFileSync(join(proj, 'STORYBOARD.md'), '## Frame 1 — untitled\n- src: compositions/frames/01.html\n');
      const out = await HYPERFRAMES['storyboard-gate']!(ctxOf(join(d, 'work'), proj));
      expect(out.outcome).toBe('not-ready');
      expect(out.produced?.status_counts).toEqual({ outline: 1 });
      expect(out.produced?.not_ready_frames).toEqual([1]);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('npx spawn 실패(signal)는 실패가 아니라 UNOBSERVED', async () => {
    const d = mkdtempSync(join(tmpdir(), 'hf-sig-'));
    try {
      const proj = project(d, 320, 240, 1);
      const { runner } = scripted({
        check: { ok: false, code: null, signal: 'SIGTERM', err: '', out: '' },
      });
      const out = await hyperframesRender({ run: runner })(ctxOf(d, proj));
      expect(out.outcome).toBe(UNOBSERVED);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
