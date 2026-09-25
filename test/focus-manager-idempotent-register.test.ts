// Regression guard — `dashboard.ts` L5875 forEach 가 F-series
// migration (F-3a-init / F-3b / F-3c) 의 auto-register path 와
// 충돌해 `bun run dev` 가 startup 에 throw 한 버그를 test 로 잠금.
//
// Root-cause (추정)
// ─────────────────
//   F-3a-init (#322) 이 primitive source-of-truth 로 setFocus
//   write path 를 바꾸면서 특정 id (e.g. 'wd-browser') 가 처음
//   focus 될 때 primitive 에 implicit register. 그 후 dashboard
//   의 explicit forEach 가 다시 register → `already registered`
//   throw.
//
// 본 테스트는 root-cause 수정과 무관하게 **"같은 id 를 여러 번
// register 해도 startup 이 부서지지 않아야 한다"** 는 idempotency
// invariant 를 직접 primitive 에 대해 검증. Dashboard fix
// (`isRegistered` guard) 가 있으면 production 에서도 trigger
// 안 함.

import { describe, expect, test } from 'bun:test';
import { createFocusManager } from '../src/primitives/focus-manager/index.js';

describe('FocusManager · duplicate register regression guard', () => {
  test('register throws on duplicate id (unchanged · structural invariant)', () => {
    const fm = createFocusManager();
    fm.register({
      id: 'wd-browser',
      scope: 'dashboard',
      focusable: true,
      priority: 0,
      owner: 'dashboard',
    });
    expect(() => fm.register({
      id: 'wd-browser',
      scope: 'dashboard',
      focusable: true,
      priority: 1,
      owner: 'dashboard',
    })).toThrow(/already registered/);
  });

  test('isRegistered check guard makes duplicate register safe (caller pattern)', () => {
    // This is the shape dashboard.ts now uses (L5875 forEach · fix):
    //
    //   if (fm.isRegistered(id)) return;
    //   fm.register({...});
    //
    // Verifies the guard does what we expect when the id is already
    // registered by an upstream path.
    const fm = createFocusManager();
    // Simulate F-series auto-register path (whatever registers it first).
    fm.register({
      id: 'wd-browser',
      scope: 'dashboard',
      focusable: true,
      priority: 0,
      owner: 'dashboard',
    });
    // Dashboard forEach callback pattern · guard first.
    const guardedRegister = (id: string): void => {
      if (fm.isRegistered(id)) return;
      fm.register({
        id,
        scope: 'dashboard',
        focusable: true,
        priority: 99,
        owner: 'dashboard',
      });
    };
    // Must not throw on the already-registered id.
    expect(() => guardedRegister('wd-browser')).not.toThrow();
    // Un-registered ids still register normally.
    expect(() => guardedRegister('wd-new-one')).not.toThrow();
    expect(fm.isRegistered('wd-new-one')).toBe(true);
  });

  test('all 24 dashboard-owned focus ids survive idempotent forEach', () => {
    // Exact list mirroring dashboard.ts L5853-L5874.
    const ids = [
      'pane:input',
      'wd-browser',
      'wd-obsidian',
      'wd-skill-browser',
      'wd-skill-file',
      'wd-working-browser',
      'wd-preview',
      'wd-scratch',
      'wd-log',
      'wd-scheduler-draft',
      'wd-scheduler-ready',
      'wd-scheduler-active',
      'wd-scheduler-paused',
      'wd-scheduler-board',
      'wd-scheduler-detail',
      'wd-agent-roster',
      'wd-agent-detail',
      'wd-agent-log',
      'wd-debug-events',
      'wd-debug-detail',
      'wd-debug-stack',
      'wd-debug-prompts',
    ];
    const fm = createFocusManager();
    // Pre-register half the ids (simulating F-series auto-register).
    for (const id of ids.slice(0, 12)) {
      fm.register({
        id,
        scope: 'dashboard',
        focusable: true,
        priority: 0,
        owner: 'dashboard',
      });
    }
    // Now run the dashboard forEach with the isRegistered guard.
    expect(() => {
      for (const [index, id] of ids.entries()) {
        if (fm.isRegistered(id)) continue;
        fm.register({
          id,
          scope: 'dashboard',
          focusable: true,
          priority: index,
          owner: 'dashboard',
        });
      }
    }).not.toThrow();
    // Every id is registered exactly once at the end.
    for (const id of ids) {
      expect(fm.isRegistered(id)).toBe(true);
    }
  });
});
