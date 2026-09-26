// ── deriveGateScopes 단위테스트 — 게이트 오탐 수정(변경 파일 기준 스코프·대표 2026-07-12). ──
import { describe, it, expect } from 'bun:test';
import { deriveGateScopes, extractFailCount, extractFailingTests, extractDelegateFailureReason, isDepsNoise, realChangedFiles } from './nocturnal-deps.js';

describe('isDepsNoise / realChangedFiles — 빈 구현 오탐 방지(대표 2026-07-12)', () => {
  it('node_modules·apps/pwa/out 심링크는 노이즈', () => {
    expect(isDepsNoise('node_modules')).toBe(true);
    expect(isDepsNoise('apps/pwa/out')).toBe(true);
    expect(isDepsNoise('apps/pwa/out/index.html')).toBe(true);
  });
  it('실제 src/test 파일은 노이즈 아님', () => {
    expect(isDepsNoise('src/domains/memory-lifecycle.ts')).toBe(false);
    expect(isDepsNoise('apps/pwa/src/x.tsx')).toBe(false);
  });
  it('realChangedFiles 는 노이즈만 있으면 빈 배열(=변경 없음)', () => {
    expect(realChangedFiles(['node_modules', 'apps/pwa/out'])).toEqual([]);
  });
  it('실제 변경이 섞이면 그것만 남김', () => {
    expect(realChangedFiles(['node_modules', 'src/domains/a.ts'])).toEqual(['src/domains/a.ts']);
  });
});

describe('extractFailCount — 게이트 baseline 제외(대표 2026-07-12)', () => {
  it('bun test 로그의 "N fail" 추출', () => {
    expect(extractFailCount('1039 pass\n 5 fail\nRan 1044 tests')).toBe(5);
  });
  it('0 fail → 0', () => {
    expect(extractFailCount(' 12 pass\n 0 fail\n')).toBe(0);
  });
  it('여러 요약이면 합산', () => {
    expect(extractFailCount('2 fail\n...\n3 fail')).toBe(5);
  });
  it('fail 없으면 0', () => {
    expect(extractFailCount('all good')).toBe(0);
  });
});

describe('extractFailingTests — failClass 관측(base-preexisting vs regression 대조)', () => {
  it('"(fail) <name> [ms]" 라인에서 테스트 식별자 추출', () => {
    const log = '(pass) a > ok\n(fail) mod > does X [1.23ms]\n(fail) mod > does Y [0.5ms]\n5 fail';
    expect(extractFailingTests(log)).toEqual(['mod > does X', 'mod > does Y']);
  });
  it('시간 표기 없어도 추출', () => {
    expect(extractFailingTests('(fail) foo > bar')).toEqual(['foo > bar']);
  });
  it('실패 라인 없으면 빈 배열', () => {
    expect(extractFailingTests('1039 pass\n0 fail')).toEqual([]);
  });
  it('base 대비 새 실패만 골라내는 set 연산의 입력으로 사용 가능', () => {
    const base = new Set(extractFailingTests('(fail) old > preexisting [1ms]'));
    const wt = extractFailingTests('(fail) old > preexisting [1ms]\n(fail) new > regression [2ms]');
    expect(wt.filter((t) => !base.has(t))).toEqual(['new > regression']);
  });
});

describe('extractDelegateFailureReason — delegate 실패 "왜" 관측(유실 방지)', () => {
  it('빈 tail 은 빈 문자열', () => {
    expect(extractDelegateFailureReason('')).toBe('');
    expect(extractDelegateFailureReason('   ')).toBe('');
  });
  it('goal-loop stopReason+iter+tools 추출', () => {
    const tail = '[elanous-self] goal-loop stopReason=no_progress · iterations=4 · toolCalls=18';
    const r = extractDelegateFailureReason(tail);
    expect(r).toContain('stopReason=no_progress');
    expect(r).toContain('iter=4');
    expect(r).toContain('tools=18');
  });
  it('내부 verify PASS + blocked(HITL) 신호 포착 — dogfood 실사례', () => {
    const tail = [
      'IMPLEMENTATION_STATUS: SKIPPED_BLOCKED — Task 0 remains CONTRACT_STATUS: BLOCKED pending approval',
      'Verification passed: bun test src/autopilot/ — 2156 passed, 0 failed',
      '명시적 HITL 승인 전 receiver 변경은 금지되어 있어 목표를 blocked로 기록했습니다.',
      '[elanous-self] goal-loop stopReason=no_progress · iterations=4 · toolCalls=18',
    ].join('\n');
    const r = extractDelegateFailureReason(tail);
    expect(r).toContain('stopReason=no_progress');
    expect(r).toContain('verify=PASS');       // ③ 스코프 검증 통과가 보임(전체 스위트 doomed 아님)
    expect(r).toContain('blocked');            // 진짜 사유(missing-capability 오표기 아님)
    expect(r).toContain('마지막:');             // 에이전트 마지막 서술
  });
  it('tool/마커 라인은 마지막 서술에서 제외', () => {
    const tail = '실제 사유 문장\n[tool #5] Bash\n[elanous-self] goal-loop stopReason=done';
    const r = extractDelegateFailureReason(tail);
    expect(r).toContain('마지막: 실제 사유 문장');
  });
});

describe('deriveGateScopes', () => {
  it('변경 파일의 디렉토리를 union + base 항상 포함', () => {
    const s = deriveGateScopes([
      'src/domains/memory-archive.ts',
      'src/knowledge/kgs/types.ts',
      'test/memory-lifecycle.test.ts',
    ]);
    expect(s).toContain('src/autopilot/');       // base(브릿지 자체)
    expect(s).toContain('src/domains/');          // 변경 파일 디렉토리
    expect(s).toContain('src/knowledge/kgs/');
    expect(s).toContain('test/');
  });

  it('src/·test/ 밖 파일(scripts 등)은 스코프에서 제외', () => {
    const s = deriveGateScopes(['scripts/x.ts', 'docs/y.md', 'src/domains/a.ts']);
    expect(s).toContain('src/domains/');
    expect(s.some((x) => x.startsWith('scripts'))).toBe(false);
    expect(s.some((x) => x.startsWith('docs'))).toBe(false);
  });

  it('변경 없음 → base 만', () => {
    expect(deriveGateScopes([])).toEqual(['src/autopilot/']);
  });

  it('★오탐 재현 방지: src/domains 변경이면 src/autopilot 만이 아니라 src/domains 도 테스트', () => {
    // 이전 버그: gateScope 고정 'src/autopilot/' → src/domains 변경의 test 미실행 → false pass.
    const s = deriveGateScopes(['src/domains/memory-archive.ts']);
    expect(s).toContain('src/domains/');
  });

  it('★tests/(복수) 커버리지: tests/ 아래 변경 테스트도 스코프에 포함(price-guard sub8 근본)', () => {
    // 이전 버그: /^(src|test)\// 가 tests/(복수)를 놓쳐 tests/ deliverable 테스트가 게이트 미실행 → false pass.
    const s = deriveGateScopes(['tests/price-guard-replay.test.ts']);
    expect(s).toContain('tests/'); // tests/ 디렉토리 → bun test tests/ 로 그 테스트 실행
  });

  it('커스텀 base', () => {
    expect(deriveGateScopes([], 'src/foo/')).toEqual(['src/foo/']);
  });
});
