/**
 * ⛔⭐ 이 시험이 답하는 것: ***shipcheck 가 「지어낸 음성」을 잡나.***
 *
 * 🩸 계기 2026-09-22 — 실물 결함 하나가 ***종단 delivered · qc pass 를 통과했다***:
 *   1080×1920 마스터에서 뽑은 1920×1080 납품물에 ***자막이 통째로 없었다.***
 *   ⇒ 그 결함을 «픽스처로 재현»해서, 자가 그것을 «다시» 놓치지 않는지 못 박는다.
 * ⛔ 초록만 보면 「멎은 자」와 구별이 안 된다 ⇒ ***틀린 판을 만들어 눌러야 한다.***
 *
 * ⚠️ 1판은 «빨강이었는데 이유가 틀렸다» — `inspectDeliverables` 가 async 인데 `await` 를 안 해서
 *   Promise 의 `.outcome`(=undefined)을 읽었다. ***다섯 개가 전부 실패했고 전부 같은 이유였다.***
 *   🔑 ***「빨강」도 「초록」처럼 이유를 물어야 한다*** — 내 시험이 틀려서 빨간 것과
 *     대상이 틀려서 빨간 것은 «다른 값»이다(여기서는 앞쪽이었다).
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './ffmpeg.js';
import { inspectDeliverables } from './shipcheck.js';

/** 아래쪽에 «흰 띠»를 가진 세로 영상 = 「자막이 구워진 마스터」의 최소 모형. */
function makeMaster(dir: string, w = 540, h = 960): { master: string; edl: string } {
  const master = join(dir, 'master.mp4');
  const r = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=0x203040:s=${w}x${h}:d=3:r=30`,
    // ⛔⭐⭐ 자막은 ***「어두운 바탕의 «작은» 밝은 것」***이다 — 가로를 «채우는 띠»가 아니다.
    //   🩸 1판 픽스처가 가로 전체 흰 띠였다. 그러면 ***흐린 배경도 밝아져***
    //      옛(고장난) 코드가 «아래 25%»를 찍어도 통과한다 ⇒ ***시험이 아무것도 안 가렸다.***
    //   🔑 ***내가 지어낸 픽스처가 결함을 재현하지 않으면, 초록은 「고쳤다」가 아니라 「안 쟀다」다.***
    //   ⇒ 폭 12% 짜리로 좁힌다. 그러면 흐린 배경은 어둡고, 자막이 «있는 자리»만 밝다.
    '-vf', 'drawbox=x=iw*0.06:y=ih*0.88:w=iw*0.12:h=ih*0.08:color=white@1.0:t=fill',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', master], 120_000);
  if (!r.ok) throw new Error(`픽스처를 못 만들었다: ${r.err.split('\n')[0]}`);
  const edl = join(dir, 'edl.json');
  writeFileSync(edl, JSON.stringify({ fps: 30, w, h, cuts: [{ dur: 3, text: '자막' }], clips: [] }), 'utf8');
  return { master, edl };
}

const ctxOf = (wd: string, master: string, edl: string, files: string[]) =>
  ({ workdir: wd, log: () => {}, state: { deliverables: files, master, edl_json: edl } }) as never;

describe('shipcheck — «지어낸 음성»을 잡는다', () => {
  const T = 60_000;

  test('⛔ 자막을 «잘라낸» 납품물을 잡는다 (아침에 실제로 난 결함)', async () => {
    const wd = mkdtempSync(join(tmpdir(), 'sc-'));
    try {
      const { master, edl } = makeMaster(wd);
      const d = join(wd, 'del'); mkdirSync(d);
      const out = join(d, '960x540.mp4');
      // 가로로 «잘라» 만든다 ⇒ 아래 자막 띠가 사라진다
      run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', master,
        '-vf', 'scale=960:540:force_original_aspect_ratio=increase,crop=960:540',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', out], 120_000);
      const r = await inspectDeliverables(ctxOf(wd, master, edl, [out])) as unknown as { outcome: string; note?: string };
      expect(r.outcome).toBe('ship-broken');
      expect(r.note ?? '').toContain('자막이 «사라졌다»');
    } finally { rmSync(wd, { recursive: true, force: true }); }
  }, T);

  // ⛔⭐⭐ ***내가 방금 낸 거짓 양성을 막는 시험이다.***
  //   🩸 1판은 자막이 «아래 25%»에 있다고 «가정»했다. 비율이 뒤집히면 «가운데»로 간다:
  //     640×360 → 360×640(fit) 에서 자막이 y=320..480 였다(아래가 아니다).
  //     ⇒ ***기본 경로(fit)에서 「자막이 사라졌다」는 거짓 양성***이 났다.
  //   🔑 두 모드를 «나란히» 돌려서 보였다 — 한쪽만 봤으면 초록이라 넘어갔다.
  test('✅ 비율이 «뒤집혀도» 맞춰 넣기는 통과한다 (자막이 «가운데»로 간다)', async () => {
    const wd = mkdtempSync(join(tmpdir(), 'sc-'));
    try {
      // ⛔⭐⭐ ***방향이 중요하다*** — 세로→가로는 «필러박스»라 자막이 «아래에 남는다».
      //   🩸 1판 시험이 세로 마스터를 썼고, 그래서 ***옛 코드에서도 초록이었다***
      //     (540×960 → 960×540 은 높이가 딱 맞아 위아래 여백이 «0»이다).
      //   ⇒ 거짓 양성이 나는 방향은 ***가로 → 세로***(레터박스라 내용이 «가운데»로 밀린다).
      //   🔑 ***시험이 초록인 이유를 물었더니, 재현을 안 하고 있었다.***
      const { master, edl } = makeMaster(wd, 960, 540);   // 가로
      const d = join(wd, 'del'); mkdirSync(d);
      const out = join(d, '540x960.mp4');                 // ⇒ 세로로 «뒤집는다»
      run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', master,
        '-filter_complex',
        '[0:v]scale=540:960:force_original_aspect_ratio=increase,crop=540:960,boxblur=luma_radius=30:luma_power=2[bg];'
        + '[0:v]scale=540:960:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', out], 120_000);
      const ctx = { workdir: wd, log: () => {},
        state: { deliverables: [out], master, edl_json: edl, deliver_mode: 'fit' } } as never;
      const r = await inspectDeliverables(ctx) as unknown as { outcome: string; note?: string };
      // ⛔ 자막은 «살아 있다» — 자리만 옮겼다. 통과해야 한다.
      expect(r.outcome).toBe('pass');
    } finally { rmSync(wd, { recursive: true, force: true }); }
  }, T);

  test('⛔ 길이가 «다른» 납품물을 잡는다', async () => {
    const wd = mkdtempSync(join(tmpdir(), 'sc-'));
    try {
      const { master, edl } = makeMaster(wd);
      const d = join(wd, 'del'); mkdirSync(d);
      const out = join(d, '540x960.mp4');
      run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', master, '-t', '1', '-c', 'copy', out], 120_000);
      const r = await inspectDeliverables(ctxOf(wd, master, edl, [out])) as unknown as { outcome: string; note?: string };
      expect(r.outcome).toBe('ship-broken');
      expect(r.note ?? '').toContain('길이가 다르다');
    } finally { rmSync(wd, { recursive: true, force: true }); }
  }, T);

  test('⛔ 규격이 «약속과 다른» 납품물을 잡는다', async () => {
    const wd = mkdtempSync(join(tmpdir(), 'sc-'));
    try {
      const { master, edl } = makeMaster(wd);
      const d = join(wd, 'del'); mkdirSync(d);
      const out = join(d, '1080x1920.mp4');   // ⛔ 이름은 1080×1920 인데 내용은 540×960
      run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', master, '-c', 'copy', out], 120_000);
      const r = await inspectDeliverables(ctxOf(wd, master, edl, [out])) as unknown as { outcome: string; note?: string };
      expect(r.outcome).toBe('ship-broken');
      expect(r.note ?? '').toContain('규격이 다르다');
    } finally { rmSync(wd, { recursive: true, force: true }); }
  }, T);

  test('✅ 정상 판은 통과한다 (자가 «아무거나» 막지 않는다)', async () => {
    const wd = mkdtempSync(join(tmpdir(), 'sc-'));
    try {
      const { master, edl } = makeMaster(wd);
      const d = join(wd, 'del'); mkdirSync(d);
      const out = join(d, '540x960.mp4');
      run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', master, '-c', 'copy', out], 120_000);
      const r = await inspectDeliverables(ctxOf(wd, master, edl, [out])) as unknown as { outcome: string; note?: string };
      expect(r.outcome).toBe('pass');
    } finally { rmSync(wd, { recursive: true, force: true }); }
  }, T);

  test('⛔ 납품물 목록이 «없으면» 통과가 아니라 «못 쟀다»', async () => {
    const wd = mkdtempSync(join(tmpdir(), 'sc-'));
    try {
      const r = await inspectDeliverables(ctxOf(wd, '/없다.mp4', '/없다.json', [])) as unknown as { outcome: string };
      expect(r.outcome).toBe('unmeasurable');
    } finally { rmSync(wd, { recursive: true, force: true }); }
  }, T);
});
