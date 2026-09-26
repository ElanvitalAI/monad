import { afterEach, describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { conatusDataDir, conatusPath, elanousDataDir, elanousDataPath } from './conatus-data-dir.js';
import {
  conatusDataDir as conatusDataDirFromNeutral,
  conatusPath as conatusPathFromNeutral,
  elanousDataDir as elanousDataDirFromNeutral,
  elanousDataPath as elanousDataPathFromNeutral,
} from './elanous-data-dir.js';

function restore(key: string, prev: string | undefined): void {
  if (prev === undefined) delete process.env[key];
  else process.env[key] = prev;
}

describe('conatusDataDir 경로 해석 규칙 (이 골에서 바꾸지 않음)', () => {
  const prevConatus = process.env.CONATUS_DATA_DIR;
  const prevState = process.env.ELANOUS_STATE_DIR;

  afterEach(() => {
    restore('CONATUS_DATA_DIR', prevConatus);
    restore('ELANOUS_STATE_DIR', prevState);
  });

  test('CONATUS_DATA_DIR 이 최우선이다', () => {
    process.env.CONATUS_DATA_DIR = '/tmp/explicit-conatus-data';
    process.env.ELANOUS_STATE_DIR = '/tmp/state-must-lose';
    expect(conatusDataDir()).toBe('/tmp/explicit-conatus-data');
    expect(conatusPath('outbound_deferred.jsonl')).toBe(join('/tmp/explicit-conatus-data', 'outbound_deferred.jsonl'));
  });

  test('ELANOUS_STATE_DIR 가 있으면 <state>/conatus 이다', () => {
    delete process.env.CONATUS_DATA_DIR;
    process.env.ELANOUS_STATE_DIR = '/tmp/elanous-state-isolation';
    expect(conatusDataDir()).toBe(join('/tmp/elanous-state-isolation', 'conatus'));
  });

  test('명시 노브가 없으면 테스트 폴백이지 ~/.elanous/conatus 가 아니다', () => {
    delete process.env.CONATUS_DATA_DIR;
    delete process.env.ELANOUS_STATE_DIR;
    const dir = conatusDataDir();
    expect(dir).not.toBe(join(homedir(), '.elanous', 'conatus'));
    expect(dir).toContain('elanous-test-conatus-');
  });
});

describe('중립 이름과 레거시 이름은 같은 경로를 낸다', () => {
  const prevConatus = process.env.CONATUS_DATA_DIR;
  const prevState = process.env.ELANOUS_STATE_DIR;

  afterEach(() => {
    restore('CONATUS_DATA_DIR', prevConatus);
    restore('ELANOUS_STATE_DIR', prevState);
  });

  test('elanousDataDir/elanousDataPath 는 conatusDataDir/conatusPath 와 같은 문자열이다', () => {
    process.env.CONATUS_DATA_DIR = '/tmp/explicit-conatus-data';
    expect(elanousDataDir()).toBe(conatusDataDir());
    expect(elanousDataPath('outbound_deferred.jsonl')).toBe(conatusPath('outbound_deferred.jsonl'));
    expect(elanousDataDirFromNeutral()).toBe(conatusDataDir());
    expect(elanousDataPathFromNeutral('outbound_deferred.jsonl')).toBe(conatusPath('outbound_deferred.jsonl'));
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
    process.env.ELANOUS_STATE_DIR = '/tmp/elanous-state-isolation';
    expect(elanousDataDir()).toContain('conatus');
    expect(conatusDataDir()).toContain('conatus');
    expect(elanousDataDir()).toBe(join('/tmp/elanous-state-isolation', 'conatus'));
    expect(elanousDataPath('regime.db')).toContain('conatus');
  });
});
