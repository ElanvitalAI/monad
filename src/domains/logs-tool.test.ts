/**
 * logs_query 도구 계약 (통합 로그 패브릭 LF3 · 2026-07-13).
 * ELANOUS_STATE_DIR 을 임시 디렉토리로 — 실 ~/.elanous/logs 미접촉.
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { analyzeLogsZeroResult, dispatchLogsQuery, LOGS_QUERY_SPEC, tokenizeGrepPhrase } from './logs-tool.js';
import { LogStore, logsDbPath } from '../mss/logging/log-store.js';
import { debug } from '../debug/log.js';

let dir: string;
let prevStateDir: string | undefined;

beforeEach(() => {
  prevStateDir = process.env.ELANOUS_STATE_DIR;
  dir = mkdtempSync(join(tmpdir(), 'logs-tool-'));
  process.env.ELANOUS_STATE_DIR = dir;
});
afterEach(() => {
  if (prevStateDir === undefined) delete process.env.ELANOUS_STATE_DIR;
  else process.env.ELANOUS_STATE_DIR = prevStateDir;
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
});

function seed(): void {
  const store = new LogStore(logsDbPath());
  store.insertBatch([
    // OH10 PR-b2: 접미사 유도 삭제 → error 는 명시 level 로만. 필터 테스트용 명시.
    { rec: { ts: new Date().toISOString(), category: 'voice.stt.openai', event: 'handshake.error', level: 'error' }, surface: 'nexus' },
    { rec: { ts: new Date().toISOString(), category: 'webterm.tabs', event: 'list.ok' }, surface: 'pwa' },
    { rec: { ts: new Date().toISOString(), category: 'signal', event: 'lifecycle.bridge-attached' }, surface: 'nexus' },
    { rec: { ts: new Date().toISOString(), category: 'signal.gate1', event: 'headless.progress', data: { terminalTail: 'lifecycle.bridge-attached' } }, surface: 'nexus' },
    { rec: { ts: new Date(Date.now() - 2 * 3600_000).toISOString(), category: 'telegram.core', event: 'old.line' }, surface: 'telegram' },
  ]);
  store.close();
}

describe('logs_query 도구', () => {
  it('스토어 미생성 → fail-soft 안내(에러 아님)', async () => {
    const r = await dispatchLogsQuery({}) as { logs: unknown[]; note: string };
    expect(r.logs).toEqual([]);
    expect(r.note).toContain('미생성');
  });

  it('기본 30분 창 조회 — 2시간 전 행은 제외', async () => {
    seed();
    const r = await dispatchLogsQuery({}) as { count: number; logs: Array<{ surface: string }> };
    expect(r.count).toBe(4);
    expect(r.logs.map((l) => l.surface).sort()).toEqual(['nexus', 'nexus', 'nexus', 'pwa']);
  });

  it('level=error + surface 필터 조합', async () => {
    seed();
    const r = await dispatchLogsQuery({ level: 'error', surface: 'nexus,pwa' }) as { count: number; logs: Array<{ category: string; level: string }> };
    expect(r.count).toBe(1);
    expect(r.logs[0]!.category).toBe('voice.stt.openai');
    expect(r.logs[0]!.level).toBe('error');
  });

  it('exactCategory와 event를 스토어 정확 필터로 전달한다', async () => {
    seed();
    const r = await dispatchLogsQuery({ exactCategory: 'signal', event: 'lifecycle.bridge-attached' }) as {
      count: number;
      logs: Array<{ category: string; event: string; level: string; surface: string; ts: string }>;
    };
    expect(r.count).toBe(1);
    expect(r.logs[0]).toMatchObject({ category: 'signal', event: 'lifecycle.bridge-attached', level: 'debug', surface: 'nexus' });
    expect(r.logs[0]!.ts).toEqual(expect.any(String));
    expect(LOGS_QUERY_SPEC.parameters.properties).toHaveProperty('exactCategory');
    expect(LOGS_QUERY_SPEC.parameters.properties).toHaveProperty('event');
  });

  it('sinceMinutes 확장 시 과거 행 포함 · 무효 level 은 에러 안내', async () => {
    seed();
    const wide = await dispatchLogsQuery({ sinceMinutes: 180 }) as { count: number };
    expect(wide.count).toBe(5);
    const bad = await dispatchLogsQuery({ level: 'loud' }) as { error: string };
    expect(bad.error).toContain('level');
  });

  it('0건 — 유효 필터의 시간창 기록 부재는 no_records_in_window이며 경고하지 않는다', async () => {
    seed();
    const r = await dispatchLogsQuery({ grep: 'old.line', sinceMinutes: 30 }) as {
      count: number; zeroReason: string; note: string; retryGrepTokens?: string[];
    };
    expect(r.count).toBe(0);
    expect(r.zeroReason).toBe('no_records_in_window');
    expect(r.note).toBe('지정한 유효 필터에서 이 시간창에 일치하는 기록이 없습니다.');
    expect(r.retryGrepTokens).toBeUndefined();
  });

  it('공백/OR 다중 grep 0건은 재조회 토큰과 경고를 반환하고 관측한다', async () => {
    seed();
    const logSpy = spyOn(debug, 'log');
    try {
      const r = await dispatchLogsQuery({ grep: 'failed OR SelfImplement', sinceMinutes: 30 }) as {
        count: number; zeroReason: string; note: string; retryGrepTokens: string[];
      };
      expect(r.count).toBe(0);
      expect(r.zeroReason).toBe('grep_may_be_multi_token_literal');
      expect(r.retryGrepTokens).toEqual(['failed', 'SelfImplement']);
      expect(r.note).toBe('grep은 다중 키워드 OR 검색이 아니라 단일 부분문자열입니다. 이 0건을 기록 없음으로 결론내지 말고, retryGrepTokens의 각 토큰으로 나누어 다시 조회하세요.');
      expect(logSpy).toHaveBeenCalledWith('domains.logs-query', 'zero-result-classified', {
        reason: 'grep_may_be_multi_token_literal',
        grepLength: 23,
        retryTokenCount: 2,
        hasCandidateFilters: false,
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  it('후보가 없는 정확 필터 0건은 filter_has_no_candidates로 구분한다', async () => {
    seed();
    const r = await dispatchLogsQuery({ exactCategory: 'typo.missing', sinceMinutes: 30 }) as {
      count: number; zeroReason: string; note: string; retryGrepTokens?: string[];
    };
    expect(r.count).toBe(0);
    expect(r.zeroReason).toBe('filter_has_no_candidates');
    expect(r.note).toBe('지정한 필터에 해당하는 기록이 이 로그 스토어에 아예 없을 수 있으므로, 이 0건은 그 일이 일어나지 않았다는 근거가 될 수 없습니다. 스토어 보존 기간 때문이거나 필터 이름/범위의 오타일 수 있습니다. category/event/surface/level 등의 이름과 범위를 확인해 다시 조회하세요.');
    expect(r.retryGrepTokens).toBeUndefined();
  });

  it('후보 없는 필터와 다중 grep이 겹치면 확정 filter_has_no_candidates를 우선한다', async () => {
    seed();
    const r = await dispatchLogsQuery({
      exactCategory: 'typo.missing',
      grep: 'failed OR SelfImplement',
      sinceMinutes: 30,
    }) as { count: number; zeroReason: string; note: string; retryGrepTokens?: string[] };
    expect(r.count).toBe(0);
    expect(r.zeroReason).toBe('filter_has_no_candidates');
    expect(r.note).toBe('지정한 필터에 해당하는 기록이 이 로그 스토어에 아예 없을 수 있으므로, 이 0건은 그 일이 일어나지 않았다는 근거가 될 수 없습니다. 스토어 보존 기간 때문이거나 필터 이름/범위의 오타일 수 있습니다. category/event/surface/level 등의 이름과 범위를 확인해 다시 조회하세요.');
    expect(r.retryGrepTokens).toBeUndefined();
  });

  it('1건 이상은 기존 반환 형태를 유지하고 zero-result 필드를 추가하지 않는다', async () => {
    seed();
    const r = await dispatchLogsQuery({ grep: 'list.ok' }) as Record<string, unknown>;
    expect(r.count).toBe(1);
    expect(r.note).toBe('크로스서피스 디버그 로그(최근순·READ-ONLY). 레벨 변경은 CLI `elanous logs level <lvl>` 또는 PWA 대시보드에서.');
    expect('zeroReason' in r).toBe(false);
    expect('retryGrepTokens' in r).toBe(false);
  });

  it('공유 grep 토크나이저는 파이프·이스케이프 파이프·쉼표·OR·공백을 같은 기준으로 분해한다', () => {
    expect(tokenizeGrepPhrase('a\\|b')).toEqual(['a\\', 'b']);
    expect(tokenizeGrepPhrase('a|b')).toEqual(['a', 'b']);
    expect(tokenizeGrepPhrase('a,b')).toEqual(['a', 'b']);
    expect(tokenizeGrepPhrase('a OR b')).toEqual(['a', 'b']);
    expect(tokenizeGrepPhrase('a b')).toEqual(['a', 'b']);
    expect(tokenizeGrepPhrase('run-43b657de')).toEqual(['run-43b657de']);
  });

  it('순수 분류기는 공백 다중 토큰을 정확히 분해한다', () => {
    expect(analyzeLogsZeroResult({ grep: 'change implement 수정', filtersHaveNoCandidates: false })).toEqual({
      reason: 'grep_may_be_multi_token_literal',
      retryGrepTokens: ['change', 'implement', '수정'],
      note: 'grep은 다중 키워드 OR 검색이 아니라 단일 부분문자열입니다. 이 0건을 기록 없음으로 결론내지 말고, retryGrepTokens의 각 토큰으로 나누어 다시 조회하세요.',
    });
  });

  it('순수 분류기는 파이프·쉼표 다중 토큰을 정확히 분해하고 빈 토큰을 제거한다', () => {
    expect(analyzeLogsZeroResult({ grep: 'a|b|c', filtersHaveNoCandidates: false })).toEqual({
      reason: 'grep_may_be_multi_token_literal',
      retryGrepTokens: ['a', 'b', 'c'],
      note: 'grep은 다중 키워드 OR 검색이 아니라 단일 부분문자열입니다. 이 0건을 기록 없음으로 결론내지 말고, retryGrepTokens의 각 토큰으로 나누어 다시 조회하세요.',
    });
    expect(analyzeLogsZeroResult({ grep: 'a,,b|', filtersHaveNoCandidates: false })).toEqual({
      reason: 'grep_may_be_multi_token_literal',
      retryGrepTokens: ['a', 'b'],
      note: 'grep은 다중 키워드 OR 검색이 아니라 단일 부분문자열입니다. 이 0건을 기록 없음으로 결론내지 말고, retryGrepTokens의 각 토큰으로 나누어 다시 조회하세요.',
    });
  });

  it('순수 분류기는 단일 grep을 다중 토큰으로 오분류하지 않는다', () => {
    expect(analyzeLogsZeroResult({ grep: 'single', filtersHaveNoCandidates: false })).toEqual({
      reason: 'no_records_in_window',
      note: '지정한 유효 필터에서 이 시간창에 일치하는 기록이 없습니다.',
    });
  });

  it('spec — 코어 도구 형태(이름·READ-ONLY 안내 포함)', () => {
    expect(LOGS_QUERY_SPEC.name).toBe('logs_query');
    expect(LOGS_QUERY_SPEC.description).toContain('READ-ONLY');
  });
});
