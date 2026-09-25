// 발화 ingress + provenance 태그 (2026-07-19) — 외부/자기 발화 일관 태깅.

import { describe, test, expect, afterEach } from 'bun:test';
import { provenanceRefs, provenanceTags, monadSelfProvenance, _resetSelfProvenanceForTest } from '../src/domains/provenance';
import { injectUtterance } from '../src/domains/self-awareness';
import { openSurfaceEventsDb, recordInboundTurn, queryEvents } from '../src/domains/surface-events';

afterEach(() => _resetSelfProvenanceForTest());

describe('provenance 태그', () => {
  test('refs = JSON(origin/git/branch/cwd), tags = origin:.. branch:..', () => {
    const p = { origin: 'claude-code', gitHash: 'abc1234', branch: 'main', cwd: '/x', sessionId: 's1' };
    expect(JSON.parse(provenanceRefs(p))).toEqual(p);
    expect(provenanceTags(p)).toBe('origin:claude-code branch:main');
  });

  test('monadSelfProvenance origin=monad-self + cwd, 캐시', () => {
    const a = monadSelfProvenance();
    expect(a.origin).toBe('monad-self');
    expect(a.cwd).toBe(process.cwd());
    expect(monadSelfProvenance()).toBe(a); // 동일 참조(캐시)
  });
});

describe('injectUtterance — 외부 발화 편입', () => {
  test('surface=ext:<origin>·kind=utterance·provenance 태그 기록', () => {
    const db = openSurfaceEventsDb(':memory:');
    const { eventId } = injectUtterance({
      text: '이 기능 구현해줘', origin: 'claude-code',
      gitHash: 'deadbee', branch: 'feat/x', cwd: '/repo', sessionId: 'sess9',
    }, db);
    expect(eventId).toBeTruthy();
    const row = queryEvents(db, {})[0]!;
    expect(row.surface).toBe('ext:claude-code');
    expect(row.kind).toBe('utterance');
    expect(row.direction).toBe('inbound');
    expect(row.tags).toContain('origin:claude-code');
    const refs = JSON.parse(row.refs!);
    expect(refs.origin).toBe('claude-code');
    expect(refs.gitHash).toBe('deadbee');
    expect(refs.branch).toBe('feat/x');
    expect(refs.cwd).toBe('/repo');
    db.close();
  });

  test('codex/gemini 재사용 — origin 만 다르게', () => {
    const db = openSurfaceEventsDb(':memory:');
    injectUtterance({ text: 'x', origin: 'codex' }, db);
    injectUtterance({ text: 'y', origin: 'gemini' }, db);
    const surfaces = queryEvents(db, {}).map(r => r.surface).sort();
    expect(surfaces).toEqual(['ext:codex', 'ext:gemini']);
    db.close();
  });
});

describe('recordInboundTurn — 자기 발화도 같은 스키마', () => {
  test('origin:monad-self + git/cwd 태그 기본 부착', () => {
    const db = openSurfaceEventsDb(':memory:');
    recordInboundTurn({ surface: 'telegram', userText: '안녕', responseText: '네', db });
    const row = queryEvents(db, {})[0]!;
    expect(row.tags).toContain('origin:monad-self');
    expect(JSON.parse(row.refs!).origin).toBe('monad-self');
    db.close();
  });

  test('origin override 가능(외부 surface 위임 시)', () => {
    const db = openSurfaceEventsDb(':memory:');
    recordInboundTurn({ surface: 'ext:codex', userText: 'q', origin: 'codex', db });
    expect(JSON.parse(queryEvents(db, {})[0]!.refs!).origin).toBe('codex');
    db.close();
  });
});
