// 트랙 R2 — 도메인 프리셋 resolver 테스트. 명시 domain 매칭·미매칭 null(무회귀)·프리셋 내용.
import { test, expect, describe } from 'bun:test';
import { resolveDomainExecute, DOMAIN_PRESETS, DOMAIN_PRESET_NAMES } from './domain-presets.js';

describe('resolveDomainExecute (R2 도메인 프리셋)', () => {
  test('invest → DomainExecute(skill executor 함수)', () => {
    expect(typeof resolveDomainExecute('invest')).toBe('function');
  });

  test('대소문자·공백 무관', () => {
    expect(typeof resolveDomainExecute('  INVEST  ')).toBe('function');
    expect(typeof resolveDomainExecute('Research')).toBe('function');
  });

  test('미지정/비문자열/빈 → null(코드 executor·무회귀)', () => {
    expect(resolveDomainExecute(undefined)).toBeNull();
    expect(resolveDomainExecute('')).toBeNull();
    expect(resolveDomainExecute(42)).toBeNull();
  });

  test('code/self 신호 → null(코드 executor 폴백·무회귀)', () => {
    expect(resolveDomainExecute('code')).toBeNull();
    expect(resolveDomainExecute('self')).toBeNull();
  });

  test('프리셋 미매칭 임의 도메인 → 범용 스킬 executor(하드코딩 탈피·luna 발견)', () => {
    // ★ 수습 P0(2026-07-23): 프리셋에 안 걸리는 문자열은 null 이 아니라 generic skill executor.
    //   스킬이 늘어도 시스템 층 수술 없이 luna 발견 경로로 실행(대표 지적 반영).
    expect(typeof resolveDomainExecute('unknown')).toBe('function');
    expect(typeof resolveDomainExecute('skill')).toBe('function');
  });

  test('invest 프리셋 = 고정 read-only allowlist 세트(집행 아님)', () => {
    expect(DOMAIN_PRESETS.invest.skills).toEqual(['omni-market', 'kr-flow']);
    expect(DOMAIN_PRESETS.invest.outputFile).toBe('investment-brief.md');
  });

  test('research 프리셋 = luna fan-out(고정 skill 없음)', () => {
    expect(DOMAIN_PRESETS.research.skills).toBeUndefined();
  });

  test('프리셋 이름 노출(invest/research/digest)', () => {
    expect(DOMAIN_PRESET_NAMES).toEqual(expect.arrayContaining(['invest', 'research', 'digest']));
  });
});
