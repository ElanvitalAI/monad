// /scheduler 페이지 스모크 — SchedulerPanel 렌더 보장(2026-07-12 갱신·구 redirect 테스트 대체).
//
// 이력: 2026-05-11 "스케줄=workflow trigger 통합"이라며 /workflows 로 redirect 시켰으나, 실
// 예약(투자 크론 등)은 schedule_registry 에 살아 workflow 화면에서 안 보이는 공백이 있었다.
// 2026-07-08 redirect stub → SchedulerPanel 로 부활. 이 테스트는 그 부활 상태를 고정한다
// (redirect 회귀 방지 — /scheduler 는 실제 뷰이지 redirect 가 아니다).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGE_PATH = resolve(__dirname, '../../apps/pwa/src/app/scheduler/page.tsx');

describe('/scheduler page', () => {
  const source = readFileSync(PAGE_PATH, 'utf8');

  test('client component 로 선언된다', () => {
    expect(source).toMatch(/^'use client';\s*$/m);
  });

  test('SchedulerPanel 을 렌더한다(실 뷰·redirect 아님)', () => {
    expect(source).toContain('SchedulerPanel');
    expect(source).toMatch(/<SchedulerPanel\s*\/>/);
  });

  test('redirect 로 회귀하지 않는다', () => {
    // 주석은 옛 패턴을 맥락으로 서술하므로 코드 라인만 검사.
    const code = source.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    expect(code).not.toMatch(/window\.location\.replace/);
    expect(code).not.toMatch(/from ['"]next\/navigation['"]/);
    expect(code).not.toMatch(/\bredirect\(/);
    expect(code).not.toContain('/app/workflows/');
  });
});
