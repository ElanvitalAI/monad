// ── shell-runner-boot 표면-중립 이전 shim 무결성 (RFC §6b · M1 · 2026-07-17) ──
//
// shell-runner boot 은 크로스서피스 장치라 dashboard/ → surface/ 로 이전했다.
// 구경로(dashboard/shell-runner-boot) shim 이 새 경로를 re-export 하는지 잠근다 —
// God-object(index.ts) 가 아직 구경로로 import 하므로 shim 이 깨지면 부팅이 죽는다.

import { describe, it, expect } from 'bun:test';
import { bootDashboardShellRunner as fromSurface } from './shell-runner-boot.js';
import { bootDashboardShellRunner as fromShim } from '../dashboard/shell-runner-boot.js';

describe('shell-runner-boot — 표면-중립 이전 shim', () => {
  it('중립 home(surface/) 이 boot 을 export 한다', () => {
    expect(typeof fromSurface).toBe('function');
  });

  it('구경로 shim(dashboard/) 이 동일 심볼을 re-export 한다(하위호환)', () => {
    expect(fromShim).toBe(fromSurface);
  });
});
