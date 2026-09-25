// ── system-repair 단위테스트 — 시스템 수리 미션 opt-in(가드 예외) ──
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isSystemRepairAuthorized,
  authorizeSystemRepair,
  revokeSystemRepair,
  listSystemRepairAuthorized,
} from './system-repair.js';

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'sysrepair-')), 'system-repair.json');
}

describe('system-repair — 시스템 수리 미션 opt-in(가드 예외)', () => {
  it('기본 fail-closed — 미등재 미션은 예외 없음(파일 부재)', () => {
    expect(isSystemRepairAuthorized('apm_x', tmpPath())).toBe(false);
  });

  it('authorize → true · revoke → false · authorize 멱등', () => {
    const p = tmpPath();
    authorizeSystemRepair('apm_x', p);
    expect(isSystemRepairAuthorized('apm_x', p)).toBe(true);
    authorizeSystemRepair('apm_x', p); // 멱등 — 중복 등재 안 됨
    expect(listSystemRepairAuthorized(p)).toEqual(['apm_x']);
    revokeSystemRepair('apm_x', p);
    expect(isSystemRepairAuthorized('apm_x', p)).toBe(false);
  });

  it('미션별 격리 — 등재된 것만 예외', () => {
    const p = tmpPath();
    authorizeSystemRepair('apm_a', p);
    expect(isSystemRepairAuthorized('apm_a', p)).toBe(true);
    expect(isSystemRepairAuthorized('apm_b', p)).toBe(false);
  });

  it('빈 missionId → false(방어)', () => {
    const p = tmpPath();
    authorizeSystemRepair('apm_a', p);
    expect(isSystemRepairAuthorized('', p)).toBe(false);
  });

  it('손상 JSON → fail-closed(예외 0)', () => {
    const p = tmpPath();
    writeFileSync(p, 'not json{');
    expect(isSystemRepairAuthorized('apm_x', p)).toBe(false);
    expect(listSystemRepairAuthorized(p)).toEqual([]);
  });
});
