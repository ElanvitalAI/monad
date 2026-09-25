import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findOrphanQuotaSignals } from './orphan-quota-signals.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function tree(): string { const d = mkdtempSync(join(tmpdir(), 'orphan-signals-')); dirs.push(d); return d; }
function signal(root: string, name: string, ageMinutes = 0): void {
  const dir = join(root, 'budget');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, '{}');
  const t = (Date.now() - ageMinutes * 60_000) / 1000;
  utimesSync(file, t, t);
}

describe('findOrphanQuotaSignals — 파생 우주에 남은 옛 신호를 «센다»', () => {
  test('⭐ 파생 우주에 신호가 남아 있으면 수와 나이를 낸다', () => {
    const derived = tree(); const cred = tree();
    signal(derived, 'codex-quota-signal-aaa.json', 120);
    signal(derived, 'codex-quota-signal-bbb.json', 30);
    const r = findOrphanQuotaSignals(derived, cred, Date.now());
    expect(r.dir).toBe(join(derived, 'budget'));
    expect(r.count).toBe(2);
    // ⭐ 「가장 «새» 것」이다 — 가장 낡은 것을 내면 「전부 낡았다」로 오독된다
    expect(r.newestAgeMinutes).toBeGreaterThanOrEqual(29);
    expect(r.newestAgeMinutes).toBeLessThanOrEqual(31);
  });

  test('⛔ 두 뿌리가 «같으면» 고아가 원리상 없다 — 「해당 없음」이다', () => {
    const root = tree();
    signal(root, 'codex-quota-signal-aaa.json');
    expect(findOrphanQuotaSignals(root, root, Date.now())).toEqual({ dir: null, count: 0, newestAgeMinutes: null });
  });

  test('⛔ 신호가 «아닌» 파일은 안 센다', () => {
    const derived = tree(); const cred = tree();
    const dir = join(derived, 'budget'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'reset-credits.json'), '{}');
    expect(findOrphanQuotaSignals(derived, cred, Date.now()).count).toBe(0);
  });

  test('디렉터리가 없거나 뿌리가 비면 조용히 「없음」', () => {
    const cred = tree();
    expect(findOrphanQuotaSignals(tree(), cred, Date.now()).dir).toBeNull();
    expect(findOrphanQuotaSignals('', cred, Date.now()).dir).toBeNull();
  });

  test('⛔ «미래» mtime 은 손상으로 본다 — 음수 나이를 화면에 내지 않는다', () => {
    const derived = tree(); const cred = tree();
    signal(derived, 'codex-quota-signal-aaa.json', -600);
    const r = findOrphanQuotaSignals(derived, cred, Date.now());
    expect(r.count).toBe(1);
    expect(r.newestAgeMinutes).toBeNull();
  });
});
