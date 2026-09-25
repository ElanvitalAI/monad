import { describe, it, expect } from 'bun:test';
import { rfcToProposedTasks, checkRfcConformance } from './mission-rfc-extract.js';
import type { AuthoredRfc } from './mission-rfc-author.js';

const rfc: AuthoredRfc = {
  markdown: '# RFC — X',
  title: 'RFC — Telegram YouTube 흡수',
  openQuestions: [],
  arcs: [
    { heading: '인입·회신', workItems: [{ title: '인입 배선 계약 확정' }, { title: '빠른 요약 회신 배선' }] },
    { heading: '저장', workItems: [{ title: 'Knowledge 저장 배선' }] },
  ],
};

describe('rfcToProposedTasks — 결정론 work-item=phase', () => {
  it('작업항목 3개 → 페이즈 3개 (인덱스 순차)', () => {
    const tasks = rfcToProposedTasks('apm_x_2a014e', rfc);
    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.index)).toEqual([0, 1, 2]);
    expect(tasks[0]!.title).toBe('인입 배선 계약 확정');
    expect(tasks[2]!.title).toBe('Knowledge 저장 배선');
  });

  it('선형 dependsOn 체인 (첫 페이즈 선행 없음)', () => {
    const tasks = rfcToProposedTasks('m', rfc);
    expect(tasks[0]!.dependsOn).toBeUndefined();
    expect(tasks[1]!.dependsOn).toEqual([0]);
    expect(tasks[2]!.dependsOn).toEqual([1]);
  });

  it('description 에 RFC 설계계약 참조(아크 제목 + rfc.md 경로)', () => {
    const tasks = rfcToProposedTasks('apm_x_2a014e', rfc);
    expect(tasks[0]!.description).toContain('RFC 설계계약');
    expect(tasks[0]!.description).toContain('인입·회신'); // arc heading
    expect(tasks[0]!.description).toContain('rfc.md');
    expect(tasks[2]!.description).toContain('저장'); // 2번째 아크 heading
  });

  it('surface = subagent + acceptance criteria 부착', () => {
    const tasks = rfcToProposedTasks('m', rfc);
    expect(tasks[0]!.surface.kind).toBe('subagent');
    expect(tasks[0]!.acceptance?.criteria?.length).toBeGreaterThan(0);
  });

  it('빈 RFC → 빈 태스크', () => {
    expect(rfcToProposedTasks('m', { markdown: '', title: 'X', arcs: [], openQuestions: [] })).toHaveLength(0);
  });

  it('detail 필드 → description 에 산출물·완료계약 합류', () => {
    const withDetail: AuthoredRfc = {
      markdown: '', title: 'X', openQuestions: [],
      arcs: [{ heading: 'A', workItems: [{ title: '배선 확정', detail: 'dispatchYoutubeTranscript 재사용·완료계약 명시' }] }],
    };
    const t = rfcToProposedTasks('m', withDetail)[0]!;
    expect(t.title).toBe('배선 확정');
    expect(t.description).toContain('산출물·완료계약: dispatchYoutubeTranscript 재사용·완료계약 명시');
  });

  it('title 80자 초과는 캡(Task.title 한도 정합 — throw 근절)', () => {
    const longRfc: AuthoredRfc = {
      markdown: '', title: 'X', openQuestions: [],
      arcs: [{ heading: 'A', workItems: [{ title: '가'.repeat(150) }] }],
    };
    expect(rfcToProposedTasks('m', longRfc)[0]!.title.length).toBe(80);
  });
});

describe('checkRfcConformance — 작업항목↔페이즈 정합', () => {
  it('사전(actual 미지): 기대 페이즈 수 = 작업항목 합', () => {
    const c = checkRfcConformance(rfc);
    expect(c.expectedPhases).toBe(3);
    expect(c.arcs).toBe(2);
    expect(c.conformant).toBe(true);
  });

  it('사후 정합: actual==expected → conformant', () => {
    expect(checkRfcConformance(rfc, 3).conformant).toBe(true);
  });

  it('사후 누락 감지', () => {
    const c = checkRfcConformance(rfc, 2);
    expect(c.conformant).toBe(false);
    expect(c.reason).toContain('누락');
  });

  it('사후 과잉 감지', () => {
    const c = checkRfcConformance(rfc, 5);
    expect(c.conformant).toBe(false);
    expect(c.reason).toContain('과잉');
  });

  it('작업항목 0 → 비정합(RFC 없음)', () => {
    const c = checkRfcConformance({ markdown: '', title: 'X', arcs: [], openQuestions: [] });
    expect(c.conformant).toBe(false);
  });
});
