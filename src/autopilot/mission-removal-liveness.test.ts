import { describe, it, expect } from 'bun:test';
import {
  extractRemovalTargets, checkRemovalLiveness, formatRemovalLivenessWarning,
} from './mission-removal-liveness.js';

// ★ 근본 B(RFC 처분 사실오류) liveness 게이트 — a85843 실사례로 계약 고정.
describe('extractRemovalTargets — 제거 대상 심볼 결정론 추출', () => {
  it('제거 문장의 camelCase 심볼 추출(a85843 phase2/3)', () => {
    const t = extractRemovalTargets('dispatchYoutubeTranscript 정의, export, call site 를 제거한다. saveKnowledgeNote 는 유지.');
    expect(t).toContain('dispatchYoutubeTranscript');
    // "유지" 문장의 saveKnowledgeNote 는 제거 문장이 아니라 미추출(보수적)
    expect(t).not.toContain('saveKnowledgeNote');
  });
  it('backtick 심볼도 추출', () => {
    expect(extractRemovalTargets('`absorbContentToKnowledge` 를 삭제하라')).toContain('absorbContentToKnowledge');
  });
  it('제거 키워드 없는 문장은 무시(오탐 방지)', () => {
    expect(extractRemovalTargets('dispatchYoutubeTranscript 를 재사용하라')).toEqual([]);
  });
  it('일반 소문자 단어는 심볼로 안 잡음(camelCase만)', () => {
    expect(extractRemovalTargets('이 파일을 제거한다')).toEqual([]);
  });
});

describe('checkRemovalLiveness — 제거집합 밖 live 참조 판정', () => {
  const grepFor = (map: Record<string, string[]>) => (s: string) => map[s] ?? [];

  it('live 운영 call-site 있으면 conflict (dispatchYoutubeTranscript 실사례)', () => {
    const grep = grepFor({ dispatchYoutubeTranscript: [
      'src/skills/tools/youtube-transcript.ts:99: export function dispatchYoutubeTranscript',
      'src/skills/runner.ts:1377: const r = await dispatchYoutubeTranscript(a);',   // 운영 배선 = live
      'test/skill-tool-youtube-transcript.test.ts:47: describe(...)',                // 자기 테스트 = OK
    ] });
    const c = checkRemovalLiveness(['dispatchYoutubeTranscript'], ['src/skills/tools/youtube-transcript.ts'], grep);
    expect(c).toHaveLength(1);
    expect(c[0]!.liveRefs).toEqual(['src/skills/runner.ts:1377: const r = await dispatchYoutubeTranscript(a);']);
  });

  it('제거집합 안 참조 + 테스트만 있으면 conflict 없음 (진짜 dead·content-absorb 실사례)', () => {
    const grep = grepFor({ absorbContentToKnowledge: [
      'src/content-absorb/absorb-to-knowledge.ts:40: export function absorbContentToKnowledge',
      'src/content-absorb/absorb-to-knowledge.test.ts:12: it(...)',
    ] });
    const c = checkRemovalLiveness(['absorbContentToKnowledge'], ['src/content-absorb/'], grep);
    expect(c).toEqual([]);   // 제거집합 내부 + 자기 테스트 = 안전하게 제거 가능
  });

  it('문서(.md) 언급은 live 아님 — 코드 참조만 (false-positive 방지·실사례)', () => {
    const grep = grepFor({ saveKnowledgeNote: [
      'docs/FEATURE-REPORT-x.md:110: vault 저장(saveKnowledgeNote + 18 테스트)은 이미 안착',   // 문서 언급 ≠ live
      'docs/HANDOFF-y.md:45: saveKnowledgeNote 판정',
    ] });
    // 코드 정의(vault-adapter.ts)가 제거돼 코드 참조 0 → dead → conflict 없음(안전 제거)
    expect(checkRemovalLiveness(['saveKnowledgeNote'], [], grep)).toEqual([]);
  });

  it('코드 참조 있으면 live — 문서 노이즈 섞여도 코드만 골라냄', () => {
    const grep = grepFor({ dispatchYoutubeTranscript: [
      'docs/DESIGN-x.md:11: dispatchYoutubeTranscript 를 primitive 로',   // 노이즈
      'src/skills/runner.ts:1377: await dispatchYoutubeTranscript(a)',     // 진짜 live
    ] });
    const c = checkRemovalLiveness(['dispatchYoutubeTranscript'], [], grep);
    expect(c).toHaveLength(1);
    expect(c[0]!.liveRefs).toEqual(['src/skills/runner.ts:1377: await dispatchYoutubeTranscript(a)']);
  });

  it('grep 실패(예외)는 스킵(fail-soft)', () => {
    const grep = () => { throw new Error('git grep fail'); };
    expect(checkRemovalLiveness(['X'], [], grep)).toEqual([]);
  });
});

describe('formatRemovalLivenessWarning — premise 교정 블록', () => {
  it('conflict 없으면 빈 문자열', () => {
    expect(formatRemovalLivenessWarning([])).toBe('');
  });
  it('conflict 있으면 "제거하지 말고 보고" 지시 + 심볼·참조', () => {
    const w = formatRemovalLivenessWarning([{ symbol: 'dispatchYoutubeTranscript', liveRefs: ['src/skills/runner.ts:1377'] }]);
    expect(w).toContain('liveness 사실 확인');
    expect(w).toContain('제거하지 말고');
    expect(w).toContain('dispatchYoutubeTranscript');
    expect(w).toContain('src/skills/runner.ts:1377');
  });
});
