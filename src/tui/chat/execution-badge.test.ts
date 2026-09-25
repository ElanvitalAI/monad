// ── execution-badge tui/ 이전 shim 무결성 (RFC §6b · M2 · 2026-07-17) ──
//
// execution-badge 를 dashboard/ → tui/chat/ 으로 이전했다. caller(turn-finalize-
// runtime)가 아직 구경로로 import 하므로 shim 이 새 경로를 re-export 하는지 잠근다.

import { describe, it, expect } from 'bun:test';
import { resolveDashboardExecutionBadge as fromTui } from './execution-badge.js';
import { resolveDashboardExecutionBadge as fromShim } from '../../dashboard/execution-badge.js';

describe('execution-badge — tui/ 이전 shim', () => {
  it('tui/chat/ 가 badge 리졸버를 export 한다', () => {
    expect(typeof fromTui).toBe('function');
  });

  it('구경로 shim(dashboard/) 이 동일 심볼을 re-export 한다(하위호환)', () => {
    expect(fromShim).toBe(fromTui);
  });
});
