import { afterEach, describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { conatusDataDir, conatusPath, monadDataDir, monadDataPath } from './conatus-data-dir.js';
import {
  conatusDataDir as conatusDataDirFromNeutral,
  conatusPath as conatusPathFromNeutral,
  monadDataDir as monadDataDirFromNeutral,
  monadDataPath as monadDataPathFromNeutral,
} from './monad-data-dir.js';

function restore(key: string, prev: string | undefined): void {
  if (prev === undefined) delete process.env[key];
  else process.env[key] = prev;
}

describe('conatusDataDir 경로 해석 규칙 (이 골에서 바꾸지 않음)', () => {
  const prevConatus = process.env.CONATUS_DATA_DIR;
  const prevState = process.env.MONAD_STATE_DIR;

  afterEach(() => {
    restore('CONATUS_DATA_DIR', prevConatus);
    restore('MONAD_STATE_DIR', prevState);
  });

  test('CONATUS_DATA_DIR 이 최우선이다', () => {
    process.env.CONATUS_DATA_DIR = '/tmp/explicit-conatus-data';
    process.env.MONAD_STATE_DIR = '/tmp/state-must-lose';
    expect(conatusDataDir()).toBe('/tmp/explicit-conatus-data');
    expect(conatusPath('outbound_deferred.jsonl')).toBe(join('/tmp/explicit-conatus-data', 'outbound_deferred.jsonl'));
  });

  test('MONAD_STATE_DIR 가 있으면 <state>/conatus 이다', () => {
    delete process.env.CONATUS_DATA_DIR;
    process.env.MONAD_STATE_DIR = '/tmp/monad-state-isolation';
    expect(conatusDataDir()).toBe(join('/tmp/monad-state-isolation', 'conatus'));
  });

  test('명시 노브가 없으면 테스트 폴백이지 ~/.monad/conatus 가 아니다', () => {
    delete process.env.CONATUS_DATA_DIR;
    delete process.env.MONAD_STATE_DIR;
    const dir = conatusDataDir();
    expect(dir).not.toBe(join(homedir(), '.monad', 'conatus'));
    expect(dir).toContain('monad-test-conatus-');
  });
});

describe('중립 이름과 레거시 이름은 같은 경로를 낸다', () => {
  const prevConatus = process.env.CONATUS_DATA_DIR;
  const prevState = process.env.MONAD_STATE_DIR;

  afterEach(() => {
    restore('CONATUS_DATA_DIR', prevConatus);
    restore('MONAD_STATE_DIR', prevState);
  });

  test('monadDataDir/monadDataPath 는 conatusDataDir/conatusPath 와 같은 문자열이다', () => {
    process.env.CONATUS_DATA_DIR = '/tmp/explicit-conatus-data';
    expect(monadDataDir()).toBe(conatusDataDir());
    expect(monadDataPath('outbound_deferred.jsonl')).toBe(conatusPath('outbound_deferred.jsonl'));
    expect(monadDataDirFromNeutral()).toBe(conatusDataDir());
    expect(monadDataPathFromNeutral('outbound_deferred.jsonl')).toBe(conatusPath('outbound_deferred.jsonl'));
  });

  test('옛 이름 conatusDataDir · conatusPath 는 계속 import 된다', () => {
    process.env.CONATUS_DATA_DIR = '/tmp/legacy-still-works';
    expect(conatusDataDir()).toBe('/tmp/legacy-still-works');
    expect(conatusPath('a', 'b')).toBe(join('/tmp/legacy-still-works', 'a', 'b'));
    expect(conatusDataDirFromNeutral()).toBe('/tmp/legacy-still-works');
    expect(conatusPathFromNeutral('a', 'b')).toBe(join('/tmp/legacy-still-works', 'a', 'b'));
  });

  test('반환 경로는 여전히 conatus 조각을 담는다', () => {
    delete process.env.CONATUS_DATA_DIR;
    process.env.MONAD_STATE_DIR = '/tmp/monad-state-isolation';
    expect(monadDataDir()).toContain('conatus');
    expect(conatusDataDir()).toContain('conatus');
    expect(monadDataDir()).toBe(join('/tmp/monad-state-isolation', 'conatus'));
    expect(monadDataPath('regime.db')).toContain('conatus');
  });
});
