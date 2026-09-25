/**
 * 인스턴스 스코프 로그 레벨 — LF7-c 계약 (2026-07-13).
 *
 * 전부 temp 경로 — 실 ~/.monad 미접촉. 핵심: 레벨 영속이 공유 config 를
 * 절대 만지지 않고 state dir 로컬 파일에만 간다(overlay persist 사건의
 * 오염 벡터 원천 제거).
 */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  persistScopedDebugLevel,
  persistScopedRenderLogs,
  readScopedDebugLevel,
  readScopedRenderLogs,
  resolveRenderSuppressed,
  scopedLevelPath,
} from './scoped-level.js';

describe('scoped-level — 인스턴스 로컬 레벨 영속', () => {
  it('persist → read 왕복 (원자적 write · 디렉토리 자동 생성)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'monad-lvl-'));
    const p = join(dir, 'logs', 'level.json');
    persistScopedDebugLevel('diag', p);
    expect(readScopedDebugLevel(p)).toBe('diag');
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as { level: string; pid: number };
    expect(raw.pid).toBe(process.pid);
    rmSync(dir, { recursive: true, force: true });
  });

  it('파일 없음/파손/무효 레벨 → null (config 기본값 fallback)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'monad-lvl-'));
    expect(readScopedDebugLevel(join(dir, 'nope.json'))).toBeNull();
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, 'not-json');
    expect(readScopedDebugLevel(bad)).toBeNull();
    const invalid = join(dir, 'invalid.json');
    writeFileSync(invalid, JSON.stringify({ level: 'loud' }));
    expect(readScopedDebugLevel(invalid)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it('OH9 — render 필드 round-trip · level 과 read-merge(서로 안 덮음)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'monad-lvl-'));
    const p = join(dir, 'logs', 'level.json');
    persistScopedDebugLevel('diag', p);
    persistScopedRenderLogs(false, p);           // render off = 억제
    expect(readScopedDebugLevel(p)).toBe('diag');  // level 보존
    expect(readScopedRenderLogs(p)).toBe(false);
    persistScopedRenderLogs(true, p);            // render on = 발화
    expect(readScopedDebugLevel(p)).toBe('diag');  // 여전히 보존
    expect(readScopedRenderLogs(p)).toBe(true);
    persistScopedDebugLevel('trail', p);         // level 변경이 render 를 안 덮음
    expect(readScopedRenderLogs(p)).toBe(true);
    expect(readScopedDebugLevel(p)).toBe('trail');
    rmSync(dir, { recursive: true, force: true });
  });

  it('OH9 — render 부재/파손이면 null (시드로 폴백)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'monad-lvl-'));
    expect(readScopedRenderLogs(join(dir, 'nope.json'))).toBeNull();
    const noRender = join(dir, 'lvl-only.json');
    persistScopedDebugLevel('diag', noRender);
    expect(readScopedRenderLogs(noRender)).toBeNull();  // level 만 있고 render 없음
    rmSync(dir, { recursive: true, force: true });
  });

  it('OH9 — resolveRenderSuppressed 우선순위: level.json.render > config.renderLogs > uiMode essential', () => {
    // 1. level.json.render 명시가 최상위 (config/uiMode 무시)
    expect(resolveRenderSuppressed({ scopedRender: true, configRenderLogs: false, uiModeEssential: true })).toBe(false);
    expect(resolveRenderSuppressed({ scopedRender: false, configRenderLogs: true, uiModeEssential: false })).toBe(true);
    // 2. scoped 없음 + config.renderLogs === true → 절대 억제 안 함(override)
    expect(resolveRenderSuppressed({ scopedRender: null, configRenderLogs: true, uiModeEssential: true })).toBe(false);
    // 3. scoped 없음 + config 미설정 → essential 이면 억제 · rich 면 비억제
    expect(resolveRenderSuppressed({ scopedRender: null, configRenderLogs: false, uiModeEssential: true })).toBe(true);
    expect(resolveRenderSuppressed({ scopedRender: null, configRenderLogs: false, uiModeEssential: false })).toBe(false);
    expect(resolveRenderSuppressed({ scopedRender: null, uiModeEssential: false })).toBe(false);
  });

  it('경로는 MONAD_STATE_DIR 존중 — logs.db 와 같은 루트(격리 동형)', () => {
    const prev = process.env.MONAD_STATE_DIR;
    process.env.MONAD_STATE_DIR = '/tmp/monad-isolated';
    try {
      expect(scopedLevelPath()).toBe('/tmp/monad-isolated/logs/level.json');
    } finally {
      if (prev === undefined) delete process.env.MONAD_STATE_DIR;
      else process.env.MONAD_STATE_DIR = prev;
    }
  });
});
