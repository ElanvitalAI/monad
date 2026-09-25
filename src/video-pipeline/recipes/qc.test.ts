/**
 * ⛔⭐⭐ ***이 파일이 파이프라인의 «심장»인데 시험이 없었다.***
 *
 * 🩸 2026-09-22 — 여기서 실물 결함이 둘 났고 둘 다 «지어낸 음성»으로 눌러 고쳤는데,
 *   그 누름을 ***다시 안 돌게*** 두었다:
 *     ⓐ 「의도한 어둠」을 빈 렌더로 오판 ⇒ 못 고치는 곳으로 되돌려 ***예산 소진·종단 없음***
 *     ⓑ 자막이 «안 그려졌는데» ffmpeg 는 exit 0 ⇒ 픽셀로만 잡힌다
 * 🔑 ***자를 고쳤으면 그 누름을 남긴다.*** 안 남기면 다음 판이 조용히 되돌린다.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './ffmpeg.js';
import { inspectMaster } from './qc.js';

interface Built { wd: string; master: string; edl: string; clip: string }

/**
 * 컷 하나짜리 최소 판. `caption` 이 true 면 마스터에 «자막처럼» 밝은 글자를 굽는다.
 * ⛔ 원본 컷(`clip`)에는 «안» 굽는다 — qc 가 그 둘을 «빼서» 자막을 찾기 때문이다.
 */
function build(bg: string, caption: boolean, dur = 2): Built {
  const wd = mkdtempSync(join(tmpdir(), 'qc-'));
  const clips = join(wd, 'clips'); mkdirSync(clips, { recursive: true });
  const clip = join(clips, 'c00.mp4');
  const base = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', `color=c=${bg}:s=320x180:d=${dur}:r=30`];
  const enc = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'];
  if (!run('ffmpeg', [...base, ...enc, clip], 60_000).ok) throw new Error('clip 픽스처 실패');
  const master = join(wd, 'master.mp4');
  // 자막은 «작은 밝은 것»이다 — 가로를 채우는 띠가 아니다(그러면 배경까지 밝아져 자가 멎는다).
  const vf = caption ? ['-vf', 'drawbox=x=iw*0.08:y=ih*0.86:w=iw*0.14:h=ih*0.09:color=white@1.0:t=fill'] : [];
  if (!run('ffmpeg', [...base, ...vf, ...enc, master], 60_000).ok) throw new Error('master 픽스처 실패');
  const edl = join(wd, 'edl.json');
  writeFileSync(edl, JSON.stringify({ fps: 30, w: 320, h: 180,
    cuts: [{ dur, text: caption ? '자막' : '' }], clips: [clip] }), 'utf8');
  return { wd, master, edl, clip };
}

const ctxOf = (b: Built) =>
  ({ workdir: b.wd, log: () => {}, state: { master: b.master, edl_json: b.edl } }) as never;

describe('inspectMaster — 「의도한 어둠」과 「빈 렌더」를 가른다', () => {
  const T = 60_000;

  test('⛔⭐⭐ ***통째로 검정인 렌더는 잡는다*** (지어낸 음성)', async () => {
    const b = build('black', false);
    try {
      const r = await inspectMaster(ctxOf(b)) as unknown as { outcome: string; note?: string };
      expect(r.outcome).toBe('blackframe');
      expect(r.note ?? '').toContain('빈 렌더');
    } finally { rmSync(b.wd, { recursive: true, force: true }); }
  }, T);

  test('✅ ***어둡지만 「빛이 있는」 화면은 통과한다*** — 기본 경로가 막히면 안 된다', async () => {
    // 🩸 실물 결함: "vast dark navy void" 컷을 빈 렌더로 오판해 ***종단 없이 예산을 태웠다.***
    const b = build('black', true);   // 어두운 바탕 ⊕ 작은 «밝은» 것
    try {
      const r = await inspectMaster(ctxOf(b)) as unknown as { outcome: string; note?: string };
      expect(r.outcome).toBe('pass');
      // ⛔ 통과할 때도 «무엇을 봤는지» 말해야 한다 — 조용한 통과는 「안 봤다」와 같은 얼굴이다.
      expect(r.note ?? '').toContain('의도한 어둠');
    } finally { rmSync(b.wd, { recursive: true, force: true }); }
  }, T);

  test('⛔ 자막이 «있어야 하는데 안 그려졌으면» 잡는다 — ffmpeg 는 exit 0 이었다', async () => {
    const b = build('0x2b3a42', false);          // 밝은 바탕 · 자막 «안» 구움
    try {
      // edl 은 「자막이 있다」고 말하는데 마스터엔 없다 — 폰트를 못 찾은 판의 모습.
      writeFileSync(b.edl, JSON.stringify({ fps: 30, w: 320, h: 180,
        cuts: [{ dur: 2, text: '있어야 할 자막' }], clips: [b.clip] }), 'utf8');
      const r = await inspectMaster(ctxOf(b)) as unknown as { outcome: string; note?: string };
      expect(r.outcome).toBe('layer-missing');
      expect(r.note ?? '').toContain('자막이 안 그려졌다');
    } finally { rmSync(b.wd, { recursive: true, force: true }); }
  }, T);

  test('⭐ 큰 빈 렌더를 «픽셀로» 잡는다 — 바이트 문턱에 기대지 않는다', async () => {
    // ⚠️ ***이 시험은 「1판이 못 잡던 것」이 아니다.*** 1판도 잡았다 — 문턱을 통과한 뒤
    //   아래 픽셀 검사가 걸었기 때문이다(눌러서 확인했다).
    //   🔑 그래서 이 시험이 지키는 것은 ***「문턱을 걷어도 잡는 능력이 남아 있나」***다.
    //     ⛔ 문턱을 지우면서 «잡는 힘»까지 지웠는지를 여기서 묻는다.
    const b = build('black', false, 4);   // 작지만, 아래에서 «크게» 다시 굽는다
    try {
      const big = join(b.wd, 'big.mp4');
      const r0 = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
        // ⛔ 8초여야 «문턱 위»가 된다 — 📏 4s=9,511B(아래) · 6s=10,471B · 8s=11,431B
        //   🔑 ***조건이 t=0 에 거짓이면 그 시험은 그 축을 «안 누른다».*** 그래서 길이를 재서 골랐다.
        '-i', 'color=c=black:s=1080x1920:d=8:r=30', '-c:v', 'libx264', '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p', big], 120_000);
      expect(r0.ok).toBe(true);
      // ⛔ 「문턱 위」임을 «확인»하고 재야 이 시험이 그 축을 누른 것이 된다.
      expect(statSync(big).size).toBeGreaterThan(10_000);
      writeFileSync(b.edl, JSON.stringify({ fps: 30, w: 1080, h: 1920,
        cuts: [{ dur: 8, text: '' }], clips: [b.clip] }), 'utf8');
      const r = await inspectMaster({ workdir: b.wd, log: () => {},
        state: { master: big, edl_json: b.edl } } as never) as unknown as { outcome: string; note?: string };
      expect(r.outcome).toBe('blackframe');
      expect(r.note ?? '').toContain('빈 렌더');
    } finally { rmSync(b.wd, { recursive: true, force: true }); }
  }, T);

  test('⛔ master 가 «없으면» 실패가 아니라 «못 쟀다»', async () => {
    const wd = mkdtempSync(join(tmpdir(), 'qc-'));
    try {
      const r = await inspectMaster({ workdir: wd, log: () => {},
        state: { master: join(wd, '없다.mp4') } } as never) as unknown as { outcome: string };
      expect(r.outcome).toBe('unmeasurable');
    } finally { rmSync(wd, { recursive: true, force: true }); }
  }, T);

  test('⛔ edl 이 «없으면» 자막 층을 «대조할 수 없다» ⇒ 못 쟀다', async () => {
    const b = build('0x2b3a42', true);
    try {
      const r = await inspectMaster({ workdir: b.wd, log: () => {},
        state: { master: b.master, edl_json: join(b.wd, '없다.json') } } as never) as unknown as { outcome: string };
      expect(r.outcome).toBe('unmeasurable');
    } finally { rmSync(b.wd, { recursive: true, force: true }); }
  }, T);
});
