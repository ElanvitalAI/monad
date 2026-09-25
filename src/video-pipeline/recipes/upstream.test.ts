/**
 * ⛔⭐ `verifyAssets` 의 ***중앙값 이상치 자***를 «모집단별»로 누른다.
 *
 * 🩸 계기 2026-09-22 — 이 자를 손으로 흔들어 보니 한 갈래에서 뜻이 달랐다:
 *   ***소재가 «둘»이면 중앙값은 「다수」가 아니라 그냥 «큰 쪽»이다.***
 *   ⇒ 사람은 다수결로 정해진 줄 아는데, 실제로는 «정렬 순서»가 정한다.
 *   ⛔ 동작은 안 바꿨다(무엇을 기준으로 삼을지는 정책·별건) — ***말하게*** 했다.
 *
 * ⛔ 모집단이 작을 때를 «반드시» 누른다 — 자가 뒤집히는 자리는 거기다.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './ffmpeg.js';
import { UPSTREAM } from './upstream.js';

function plate(dir: string, name: string, w: number, h: number): string {
  const p = join(dir, `${name}.png`);
  const r = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=0x1f2933:s=${w}x${h}`, '-frames:v', '1', p], 60_000);
  if (!r.ok) throw new Error(`픽스처 실패: ${r.err.split('\n')[0]}`);
  return p;
}

/** ⛔ 게이트는 `asset_files` 를 읽는다 — 파일 목록을 «직접» 준다. */
const gate = async (files: string[], wd: string) =>
  await UPSTREAM['verify-assets']!({ workdir: wd, log: () => {},
    state: { asset_files: files } } as never) as unknown as { outcome: string; note?: string };

describe('verify-assets — 중앙값 이상치 자', () => {
  const T = 60_000;

  // 🩸 2026-09-23 — 빈 목록이 중앙값 undefined 로 «던졌다». 분모 0 은 «못 쟀다»다.
  test('⛔ 지어낸 음성 — 소재 0개는 pass 도 예외도 아니라 unmeasurable', async () => {
    const d = mkdtempSync(join(tmpdir(), 'va-'));
    try { expect((await gate([], d)).outcome).toBe('unmeasurable'); }
    finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('✅ 넷이 같고 하나가 다르면 «그 하나»를 되돌린다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'va-'));
    try {
      const fs = [plate(d, 'a', 1280, 720), plate(d, 'b', 1280, 720),
                  plate(d, 'c', 1280, 720), plate(d, 'odd', 720, 720)];
      const r = await gate(fs, d);
      expect(r.outcome).toBe('ratio');
      expect(r.note ?? '').toContain('odd.png');
      // ⛔ 다수가 «있으므로» 그 경고는 «안» 나와야 한다.
      expect(r.note ?? '').not.toContain('다수가 없다');
    } finally { rmSync(d, { recursive: true, force: true }); }
  }, T);

  test('⛔⭐ 소재가 «둘»뿐이면 ***「다수결이 아니다」***라고 말한다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'va-'));
    try {
      const r = await gate([plate(d, 'wide', 1280, 720), plate(d, 'square', 720, 720)], d);
      expect(r.outcome).toBe('ratio');
      expect(r.note ?? '').toContain('다수가 없다');
      expect(r.note ?? '').toContain('정렬해서 큰 쪽');
    } finally { rmSync(d, { recursive: true, force: true }); }
  }, T);

  test('⭐ 다수가 «소수 비율»이면 그쪽이 기준이 된다 — 평균이 아니라 중앙값인 이유', async () => {
    const d = mkdtempSync(join(tmpdir(), 'va-'));
    try {
      // 1:1 이 셋 · 16:9 가 둘 ⇒ 기준은 1.0 이고 «16:9 쪽»이 되돌려진다
      const fs = [plate(d, 's1', 720, 720), plate(d, 's2', 720, 720), plate(d, 's3', 720, 720),
                  plate(d, 'w1', 1280, 720), plate(d, 'w2', 1280, 720)];
      const r = await gate(fs, d);
      expect(r.outcome).toBe('ratio');
      expect(r.note ?? '').toContain('기준 1.000');
      expect(r.note ?? '').toContain('w1.png');
    } finally { rmSync(d, { recursive: true, force: true }); }
  }, T);

  test('✅ 전부 같으면 통과하고 «기준»을 말한다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'va-'));
    try {
      const r = await gate([plate(d, 'a', 1280, 720), plate(d, 'b', 1920, 1080)], d);
      expect(r.outcome).toBe('pass');
      expect(r.note ?? '').toContain('1.778');
    } finally { rmSync(d, { recursive: true, force: true }); }
  }, T);

  test('⛔ 디코드 «못 하는» 소재는 「비율 문제」가 아니라 missing 이다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'va-'));
    try {
      const bad = join(d, 'broken.png');
      await Bun.write(bad, 'not an image');
      const r = await gate([plate(d, 'a', 1280, 720), bad], d);
      expect(r.outcome).toBe('missing');
      expect(r.note ?? '').toContain('디코드 못 한다');
    } finally { rmSync(d, { recursive: true, force: true }); }
  }, T);
});
