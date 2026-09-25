/**
 * 로그 인스턴스 레지스트리 — LF7-b 계약 (2026-07-13).
 *
 * 전부 temp 디렉토리 — 실 ~/.monad/logs/instances.json 미접촉.
 */
import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  registerLogInstance,
  readLogInstances,
  isTestInstance,
  type LogInstanceEntry,
} from './instance-registry.js';

function tempSetup(): { dir: string; registry: string; stateDir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'monad-loginst-'));
  const stateDir = join(dir, '.monad-test');
  mkdirSync(stateDir, { recursive: true });
  return { dir, registry: join(dir, 'instances.json'), stateDir };
}

function entry(over: Partial<LogInstanceEntry> = {}, stateDir: string): LogInstanceEntry {
  return {
    name: 'test:monad-agent',
    stateDir,
    pid: process.pid, // 살아있는 pid — liveness 판정 검증
    startedAt: '2026-07-13T00:00:00.000Z',
    ...over,
  };
}

describe('인스턴스 레지스트리 — 등록/조회/정리', () => {
  it('등록 → 조회 왕복 (liveness·dbExists 주석 포함)', () => {
    const { dir, registry, stateDir } = tempSetup();
    registerLogInstance(entry({}, stateDir), registry);
    const views = readLogInstances(registry);
    expect(views.length).toBe(1);
    expect(views[0]!.name).toBe('test:monad-agent');
    expect(views[0]!.alive).toBe(true);
    expect(views[0]!.liveness).toBe('alive');
    expect(views[0]!.dbExists).toBe(false); // logs/logs.db 미생성
    expect(views[0]!.dbPath).toBe(join(stateDir, 'logs', 'logs.db'));
    rmSync(dir, { recursive: true, force: true });
  });

  it('upsert 키 = stateDir — 같은 인스턴스 재등록은 항목 1개 유지·최신 승리', () => {
    const { dir, registry, stateDir } = tempSetup();
    registerLogInstance(entry({ startedAt: '2026-07-13T00:00:00.000Z' }, stateDir), registry);
    registerLogInstance(entry({ startedAt: '2026-07-13T01:00:00.000Z' }, stateDir), registry);
    const views = readLogInstances(registry);
    expect(views.length).toBe(1);
    expect(views[0]!.startedAt).toBe('2026-07-13T01:00:00.000Z');
    rmSync(dir, { recursive: true, force: true });
  });

  // 라이브 관측 provenance: 2026-08-07 02:0x KST · monad logs instances 전수.
  // test:monad-agent가 네 state 경로에 등록된 사례를 독립 temp fixture로 재현한다.
  it('같은 이름의 네 stateDir는 보존하고 모호성 메타데이터로 드러낸다', () => {
    const { dir, registry, stateDir } = tempSetup();
    const stateDirs = [
      stateDir,
      join(dir, 'elan', 'monad-agent', '.monad-test'),
      join(dir, 'pilot', 'monad-agent', '.monad-test'),
      join(dir, 'axon', 'monad-agent', '.monad-test'),
    ];
    for (const path of stateDirs) mkdirSync(path, { recursive: true });
    for (const path of stateDirs) registerLogInstance(entry({}, path), registry);
    const views = readLogInstances(registry);
    expect(views).toHaveLength(4);
    expect(views.map((view) => view.stateDir)).toEqual(stateDirs);
    expect(views.map((view) => ({ ambiguous: view.ambiguous, stateDirCount: view.stateDirCount })))
      .toEqual(Array.from({ length: 4 }, () => ({ ambiguous: true, stateDirCount: 4 })));
    rmSync(dir, { recursive: true, force: true });
  });

  it('죽은 pid 는 alive=false (항목은 유지 — 죽은 인스턴스 로그도 조회 가치)', () => {
    const { dir, registry, stateDir } = tempSetup();
    registerLogInstance(entry({ pid: 999_999_999 }, stateDir), registry);
    const views = readLogInstances(registry);
    expect(views.length).toBe(1);
    expect(views[0]!.alive).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('다른 hostId는 원격이고 hostId 없는 옛 항목은 같은 죽은 pid로 dead', () => {
    const { dir, registry, stateDir } = tempSetup();
    const legacyDir = join(dir, 'legacy', '.monad-test');
    mkdirSync(legacyDir, { recursive: true });
    const previous = process.env.MONAD_HOST_ID;
    process.env.MONAD_HOST_ID = '01THISHOST';
    try {
      registerLogInstance(entry({ hostId: '01OTHERHOST', hostname: 'win-box', pid: 999_999_999 }, stateDir), registry);
      registerLogInstance(entry({ pid: 999_999_999 }, legacyDir), registry);
      const views = readLogInstances(registry);
      expect(views).toHaveLength(2);
      expect(views[0]).toMatchObject({ hostId: '01OTHERHOST', hostname: 'win-box', alive: false, liveness: 'remote' });
      expect(views[1]).toMatchObject({ alive: false, liveness: 'dead' });
      expect(views[1]!.hostId).toBeUndefined();
      registerLogInstance(entry({ hostId: '01OTHERHOST', pid: process.pid }, stateDir), registry);
      expect(readLogInstances(registry)[1]).toMatchObject({ hostId: '01OTHERHOST', alive: false, liveness: 'remote' });
    } finally {
      if (previous === undefined) delete process.env.MONAD_HOST_ID;
      else process.env.MONAD_HOST_ID = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('없는 원격 stateDir는 조회와 레지스트리에 남고 없는 로컬·구항목은 정리된다', () => {
    const { dir, registry } = tempSetup();
    const previous = process.env.MONAD_HOST_ID;
    process.env.MONAD_HOST_ID = '01THISHOST';
    const remoteDir = join(dir, 'elsewhere', 'remote-state');
    const localDir = join(dir, 'gone-local');
    const legacyDir = join(dir, 'gone-legacy');
    try {
      registerLogInstance(entry({ name: 'remote', hostId: '01OTHERHOST', hostname: 'win-box', pid: 999_999_999 }, remoteDir), registry);
      registerLogInstance(entry({ name: 'local', hostId: '01THISHOST' }, localDir), registry);
      registerLogInstance(entry({ name: 'legacy' }, legacyDir), registry);
      const views = readLogInstances(registry);
      expect(views).toHaveLength(1);
      expect(views[0]).toMatchObject({ stateDir: remoteDir, hostId: '01OTHERHOST', liveness: 'remote', alive: false });
      expect(JSON.parse(readFileSync(registry, 'utf8')).instances).toEqual([
        entry({ name: 'remote', hostId: '01OTHERHOST', hostname: 'win-box', pid: 999_999_999 }, remoteDir),
      ]);
    } finally {
      if (previous === undefined) delete process.env.MONAD_HOST_ID;
      else process.env.MONAD_HOST_ID = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('state dir 폴더가 사라진 항목은 read 시점 정리(prune)', () => {
    const { dir, registry, stateDir } = tempSetup();
    registerLogInstance(entry({}, stateDir), registry);
    rmSync(stateDir, { recursive: true, force: true });
    expect(readLogInstances(registry).length).toBe(0);
    // 디스크에도 반영 — 재읽기도 0
    expect(readLogInstances(registry).length).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('test: 이름에 kind=prod로 잘못 스탬프한 항목은 read 시점에 디스크에서도 정리한다', () => {
    const { dir, registry } = tempSetup();
    const stateDir = join(dir, 'temporary-state-root');
    mkdirSync(stateDir, { recursive: true });
    registerLogInstance(entry({ kind: 'prod' }, stateDir), registry);
    expect(readLogInstances(registry)).toEqual([]);
    expect(JSON.parse(readFileSync(registry, 'utf8'))).toEqual({ instances: [] });
    rmSync(dir, { recursive: true, force: true });
  });

  it('레지스트리 파일 없음/파손 → 빈 배열 (fail-soft)', () => {
    const { dir, registry } = tempSetup();
    expect(readLogInstances(join(dir, 'nope.json')).length).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});

// fleet screen 등 데이터 연합의 test 제외 술어 — kind 누락 레거시도 관례로 제외해야 함(review must-fix).
describe('isTestInstance — 연합 test 제외 술어', () => {
  it('명시 kind=test 는 test', () => {
    expect(isTestInstance({ kind: 'test' })).toBe(true);
  });
  it('kind 누락이어도 name=test: prefix 는 test(레거시 test 인스턴스 노출 차단)', () => {
    expect(isTestInstance({ name: 'test:monad-agent' })).toBe(true);
  });
  it('kind 누락이어도 stateDir=.monad-test 는 test', () => {
    expect(isTestInstance({ stateDir: '/x/.monad-test' })).toBe(true);
  });
  it('명시 kind=prod 는 name=test: 여도 prod(명시 우선)', () => {
    expect(isTestInstance({ kind: 'prod', name: 'test:foo' })).toBe(false);
  });
  it('관례 미해당(axon 등 병렬)은 prod', () => {
    expect(isTestInstance({ name: 'axon' })).toBe(false);
    expect(isTestInstance({ stateDir: '/src/axon/.monad' })).toBe(false);
  });
});
