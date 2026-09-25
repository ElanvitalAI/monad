// S6 — skill 트리거 UX 를 SurfaceUx 막으로 리프팅. 결정→발사(서피스무관) 검증.
import { describe, test, expect } from 'bun:test';
import { runSkillRouteWithUx } from './skill-route-ux.js';
import type { SurfaceUx } from '../agent/surface-ux/types.js';

function fakeUx(over: Partial<SurfaceUx> = {}): SurfaceUx {
  return {
    surface: 'telegram',
    interactive: true,
    confirm: async () => true,
    question: async () => null,
    spillFile: () => {},
    progress: () => {},
    ...over,
  };
}

describe('runSkillRouteWithUx (S6)', () => {
  test('kind=none → no-op(발사 안 함)', async () => {
    let fired = false;
    const r = await runSkillRouteWithUx({ kind: 'none' }, fakeUx(), () => { fired = true; });
    expect(r.fired).toBe(false);
    expect(r.reason).toBe('none');
    expect(fired).toBe(false);
  });

  test('kind=auto → confirm 없이 즉시 실행', async () => {
    let confirmed = false; let executed = '';
    const ux = fakeUx({ confirm: async () => { confirmed = true; return true; } });
    const r = await runSkillRouteWithUx({ kind: 'auto', target: 'omni-digest' }, ux, (t) => { executed = t; });
    expect(r).toEqual({ fired: true, target: 'omni-digest', reason: 'auto' });
    expect(confirmed).toBe(false);   // auto 는 confirm 발사 안 함
    expect(executed).toBe('omni-digest');
  });

  test('kind=confirm → ux.confirm 승인 시 실행', async () => {
    let executed = '';
    const r = await runSkillRouteWithUx({ kind: 'confirm', target: 'omni-market' }, fakeUx({ confirm: async () => true }), (t) => { executed = t; });
    expect(r).toEqual({ fired: true, target: 'omni-market', reason: 'confirmed' });
    expect(executed).toBe('omni-market');
  });

  test('kind=confirm → 거절 시 실행 안 함', async () => {
    let executed = '';
    const r = await runSkillRouteWithUx({ kind: 'confirm', target: 'kr-flow' }, fakeUx({ confirm: async () => false }), (t) => { executed = t; });
    expect(r.fired).toBe(false);
    expect(r.reason).toBe('declined');
    expect(executed).toBe('');
  });

  test('비-interactive 서피스 → confirm fail-closed(false) → 자동실행 안 함(막 규율)', async () => {
    let executed = '';
    // 막 계약: interactive=false 면 confirm 이 항상 false 반환.
    const ux = fakeUx({ interactive: false, confirm: async () => false });
    const r = await runSkillRouteWithUx({ kind: 'confirm', target: 'omni-digest' }, ux, (t) => { executed = t; });
    expect(r.fired).toBe(false);
    expect(executed).toBe('');
  });

  test('confirm request 는 target 을 프롬프트에 실음', async () => {
    let seenPrompt = '';
    const ux = fakeUx({ confirm: async (req) => { seenPrompt = req.prompt; return false; } });
    await runSkillRouteWithUx({ kind: 'confirm', target: 'diagram-master' }, ux, () => {});
    expect(seenPrompt).toContain('diagram-master');
  });
});
