// 웹 도메인 executor — fake publish/verify(실 배포·CDP 무접촉). published 종결·changes:[]·A3 게시우선.
import { describe, test, expect } from 'bun:test';
import { buildWebDomainExecute, parseVercelUrl, validPublishedUrl } from './web-executor.js';
import { triageRun } from '../self-dev/orchestrate.js';
import { resolveDomainExecute } from './domain-presets.js';
import type { DomainExecuteCtx } from './skill-executor.js';

const ctx = (objective: string, priorFindings?: string[]): DomainExecuteCtx => ({ objective, round: 1, cwd: '/tmp/x', ...(priorFindings ? { priorFindings } : {}) });

describe('parseVercelUrl', () => {
  test('vercel URL 추출', () => {
    expect(parseVercelUrl('배포 완료: https://my-report.vercel.app 확인')).toBe('https://my-report.vercel.app');
  });
  test('URL 없으면 null', () => { expect(parseVercelUrl('생성 중...')).toBeNull(); });
});

describe('validPublishedUrl', () => {
  test('공백을 제거한 절대 HTTP(S) URL만 유지한다', () => {
    expect(validPublishedUrl(' https://x.vercel.app/report ')).toBe('https://x.vercel.app/report');
    expect(validPublishedUrl('')).toBeNull();
    expect(validPublishedUrl('not-a-url')).toBeNull();
    expect(validPublishedUrl('ftp://x.vercel.app')).toBeNull();
  });
});

describe('buildWebDomainExecute', () => {
  const okVerify = async () => ({ ok: true, findings: [] });

  test('⭐ 게시 성공 → published 종결·changes:[]·ref=URL', async () => {
    const exec = buildWebDomainExecute({
      publish: async () => ({ url: 'https://x.vercel.app', detail: '리포트 게시' }),
      verify: okVerify,
    });
    const r = await exec(ctx('반도체 리포트 웹으로'));
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('published');
    expect(r.changes).toEqual([]);   // 파일 PR 아님·게시(published 종결 조건)
    expect(r.ref).toBe('https://x.vercel.app');
    expect(r.summary).toContain('렌더 정상');
  });

  test('confirmed·suspected finding을 등급과 target으로 보존하고 confirmed만 수리 조각이 된다', async () => {
    const exec = buildWebDomainExecute({
      publish: async () => ({ url: 'https://x.vercel.app', detail: '게시' }),
      verify: async () => ({
        ok: false,
        url: 'https://x.vercel.app',
        findings: ['본문 비어있음', '제목이 비어 보임'],
        structuredFindings: [
          { kind: 'empty-body', message: '본문 비어있음', certainty: 'confirmed' },
          { kind: 'empty-title', message: '제목이 비어 보임', certainty: 'suspected' },
        ],
      }),
    });
    const r = await exec(ctx('게시해줘'));
    expect(r.ok).toBe(true);            // 게시 성공(A3)
    expect(r.outcome).toBe('published');
    expect(r.summary).toContain('렌더 경고');   // 경고는 summary 에
    expect(r.deployFindings?.get('https://x.vercel.app')).toEqual({
      target: 'https://x.vercel.app',
      findings: [
        { kind: 'empty-body', message: '본문 비어있음', certainty: 'confirmed' },
        { kind: 'empty-title', message: '제목이 비어 보임', certainty: 'suspected' },
      ],
    });
    expect(triageRun([], r.deployFindings).repairable).toEqual(['https://x.vercel.app']);
  });

  test('suspected finding만이면 보존되지만 수리 조각은 만들지 않는다', async () => {
    const exec = buildWebDomainExecute({
      publish: async () => ({ url: 'https://x.vercel.app', detail: '게시' }),
      verify: async () => ({
        ok: false,
        url: 'https://x.vercel.app',
        findings: ['제목이 비어 보임'],
        structuredFindings: [{ kind: 'empty-title', message: '제목이 비어 보임', certainty: 'suspected' }],
      }),
    });
    const r = await exec(ctx('게시해줘'));
    expect(r.deployFindings?.get('https://x.vercel.app')?.findings?.[0]?.certainty).toBe('suspected');
    expect(triageRun([], r.deployFindings).repairable).toEqual([]);
  });

  test('CDP 없으면 측정 불가 사유를 별도 표면에 남기고 게시를 막지 않는다', async () => {
    const exec = buildWebDomainExecute({
      publish: async () => ({ url: 'https://x.vercel.app', detail: '게시' }),
      verify: async () => ({ ok: false, url: 'https://x.vercel.app', findings: [], skipped: 'no-cdp' }),
    });
    const r = await exec(ctx('게시'));
    expect(r.ok).toBe(true);
    expect(r.summary).toContain('렌더검증 skip');
    expect(r.deployFindings?.has('https://x.vercel.app')).toBe(false);
    expect(r.unmeasuredDeliverables).toEqual([{
      taskId: 'https://x.vercel.app',
      kind: 'deliverable-unobserved',
      reason: 'no-cdp',
    }]);
  });

  test('부분 측정 불가면 graded finding은 보존하되 triage Map에서는 제외한다', async () => {
    const exec = buildWebDomainExecute({
      publish: async () => ({ url: 'https://x.vercel.app', detail: '게시' }),
      verify: async () => ({
        ok: false,
        url: 'https://x.vercel.app',
        findings: ['본문 비어있음'],
        structuredFindings: [{ kind: 'empty-body', message: '본문 비어있음', certainty: 'confirmed' }],
        unmeasured: ['javascript-errors'],
      }),
    });
    const r = await exec(ctx('게시'));
    expect(r.ok).toBe(true);
    expect(r.summary).toContain('렌더 경고');
    expect(r.deployFindings?.has('https://x.vercel.app')).toBe(false);
    expect(r.deployFindingObservations).toEqual([{
      target: 'https://x.vercel.app',
      findings: [{ kind: 'empty-body', message: '본문 비어있음', certainty: 'confirmed' }],
    }]);
    expect(r.unmeasuredDeliverables).toEqual([{
      taskId: 'https://x.vercel.app',
      kind: 'signal-unmeasured',
      reason: 'javascript-errors',
    }]);
    expect(triageRun([], r.deployFindings, true).repairable).toEqual([]);
  });

  test('게시 URL 없음·공백·잘못된 형식 → ok:false', async () => {
    for (const url of ['', '   ', 'not-a-url', 'ftp://x.vercel.app'] as const) {
      const exec = buildWebDomainExecute({ publish: async () => ({ url, detail: '게시' }), verify: okVerify });
      const r = await exec(ctx('게시'));
      expect(r.ok).toBe(false);
      expect(r.summary).toContain('유효한 게시 URL 산출 없음');
    }
    const absent = buildWebDomainExecute({ publish: async () => null, verify: okVerify });
    expect((await absent(ctx('게시'))).ok).toBe(false);
  });

  test('publish 예외 → ok:false(fail-soft)', async () => {
    const exec = buildWebDomainExecute({ publish: async () => { throw new Error('deploy boom'); }, verify: okVerify });
    const r = await exec(ctx('게시'));
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('게시 실패');
  });

  test('rework — priorFindings 를 publish objective 에 얹음', async () => {
    let seenObjective = '';
    const exec = buildWebDomainExecute({
      publish: async (obj) => { seenObjective = obj; return { url: 'https://x.vercel.app', detail: '재게시' }; },
      verify: okVerify,
    });
    await exec(ctx('게시', ['제목 오타']));
    expect(seenObjective).toContain('제목 오타');
    expect(seenObjective).toContain('반영해 재게시');
  });
});

describe('resolveDomainExecute — web 분기', () => {
  test("'web' → 웹 executor(프리셋 아님)", () => {
    expect(resolveDomainExecute('web')).not.toBeNull();
    expect(resolveDomainExecute('publish')).not.toBeNull();
  });
  test('code/self·미지정 domain → null(코드 executor·무회귀)', () => {
    expect(resolveDomainExecute('code')).toBeNull();
    expect(resolveDomainExecute('self')).toBeNull();
    expect(resolveDomainExecute(undefined)).toBeNull();
  });
  test('프리셋 미매칭 임의 문자열 → 범용 스킬 executor(하드코딩 탈피)', () => {
    // ★ 2026-07-23: 미매칭이 더는 null 아님 — generic skill executor 로 라우팅(luna 발견).
    expect(typeof resolveDomainExecute('nonsense')).toBe('function');
  });
});
