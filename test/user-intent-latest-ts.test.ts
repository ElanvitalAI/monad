// ── latestUserIntentTs — 야간 무음 우회용 최신 사용자 활동 시각(대표 2026-07-14) ──
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { latestUserIntentTs, setUserIntentJsonlDirOverride } from '../src/user-intent/index.js';

let tmpDir: string;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'uilatest-')); setUserIntentJsonlDirOverride(tmpDir); });
afterEach(() => { setUserIntentJsonlDirOverride(null); rmSync(tmpDir, { recursive: true, force: true }); });

const line = (ts: string, layer: string, kind = 'x') => JSON.stringify({ ts, surface: 'telegram', intent: { layer, kind } }) + '\n';
const writeDay = (utcDate: string, body: string) => writeFileSync(join(tmpDir, `${utcDate}.jsonl`), body);

describe('latestUserIntentTs', () => {
  test('당일 파일의 마지막 genuine 인텐트 ts 반환', () => {
    writeDay('2026-07-14', line('2026-07-14T10:00:00.000Z', 'utterance') + line('2026-07-14T10:05:00.000Z', 'selection'));
    expect(latestUserIntentTs('2026-07-14T10:06:00.000Z')).toBe('2026-07-14T10:05:00.000Z');
  });

  test('자율 레이어(ambient/system)는 제외 — 그 뒤의 genuine 최신을 찾는다', () => {
    writeDay('2026-07-14', line('2026-07-14T10:00:00.000Z', 'selection') + line('2026-07-14T23:00:00.000Z', 'ambient') + line('2026-07-14T23:30:00.000Z', 'system'));
    expect(latestUserIntentTs('2026-07-14T23:31:00.000Z')).toBe('2026-07-14T10:00:00.000Z');
  });

  test('UTC 자정 경계 — 당일 genuine 없으면 어제 파일로 폴백', () => {
    writeDay('2026-07-13', line('2026-07-13T23:50:00.000Z', 'utterance'));
    writeDay('2026-07-14', line('2026-07-14T00:01:00.000Z', 'ambient')); // 자율만
    expect(latestUserIntentTs('2026-07-14T00:05:00.000Z')).toBe('2026-07-13T23:50:00.000Z');
  });

  test('HITL 버튼 탭(selection) 인식', () => {
    writeDay('2026-07-14', JSON.stringify({ ts: '2026-07-14T00:20:00.000Z', surface: 'telegram', intent: { layer: 'selection', kind: 'telegram.selection.hitl_check' } }) + '\n');
    expect(latestUserIntentTs('2026-07-14T00:25:00.000Z')).toBe('2026-07-14T00:20:00.000Z');
  });

  test('파일 없음/빈/깨진 줄 → null·fail-soft', () => {
    expect(latestUserIntentTs('2026-07-14T00:00:00.000Z')).toBeNull();
    writeDay('2026-07-14', 'not-json\n\n{bad\n');
    expect(latestUserIntentTs('2026-07-14T00:00:00.000Z')).toBeNull();
  });
});
