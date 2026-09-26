// F2 Context Capsule durable handoff store — persist/read 왕복·격리·덮어씀·검증(cold-ledger 재사용).
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { persistContextCapsule, readContextCapsule, listContextCapsules } from './context-capsule-store.js';
import { buildHarnessContextCapsule, type HarnessContextCapsule } from './context-capsule.js';
import { groundMissionInCapsules, groundMissionInCodebase } from '../autopilot/mission-codebase-gate.js';
import { writeColdSnapshot } from '../agent-substrate/cold-ledger.js';
import { setElanousConfigDir, resetElanousConfigDir } from '../elanous-config-dir.js';

// CAPSULE_KIND 는 모듈-비공개 → 테스트 손상 주입은 리터럴 kind 사용.
const CAPSULE_KIND = 'context-capsule';

function mkCapsule(over: Partial<HarnessContextCapsule> = {}): HarnessContextCapsule {
  return buildHarnessContextCapsule({
    objective: 'F2 축', target: 'self', inScope: ['a'], outOfScope: ['b'],
    successCriteria: ['ok'], evidenceRequired: ['tsc'], riskBoundaries: [],
    groundingRefs: [{ ref: 'src/x.ts', provenance: 'code' }],
    createdAt: '2026-07-25T00:00:00.000Z', ...over,
  });
}

describe('context-capsule-store — F2 durable handoff(cold-ledger 재사용)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'capsule-store-')); setElanousConfigDir(dir); });
  afterEach(() => { resetElanousConfigDir(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } });

  it('persist → read 왕복(상류→하류 handoff)', () => {
    const cap = mkCapsule();
    expect(readContextCapsule('job-1')).toBeNull();   // 없음
    persistContextCapsule('job-1', cap);
    expect(readContextCapsule('job-1')).toEqual(cap);   // 완전 round-trip(JSON)
  });

  it('없는 jobId → null(하류는 자기 grounding 으로 진행·fail-soft)', () => {
    expect(readContextCapsule('nope')).toBeNull();
  });

  it('config-dir 격리 — 다른 스코프에선 안 보임', () => {
    persistContextCapsule('job-2', mkCapsule());
    const other = mkdtempSync(join(tmpdir(), 'capsule-other-'));
    setElanousConfigDir(other);
    expect(readContextCapsule('job-2')).toBeNull();   // 다른 config-dir → 격리
    try { rmSync(other, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('재저장은 덮어씀(최신 capsule)', () => {
    persistContextCapsule('job-3', mkCapsule({ objective: 'v1' }));
    persistContextCapsule('job-3', mkCapsule({ objective: 'v2' }));
    expect(readContextCapsule('job-3')!.objective).toBe('v2');
  });

  it('손상·구버전 데이터 → null(read 런타임 검증·should-fix)', () => {
    // cold-ledger 에 capsule 아닌 JSON 을 직접 심음(손상 시뮬)
    writeColdSnapshot('job-bad', CAPSULE_KIND, { objective: 'x' /* 필수필드 누락 */ });
    expect(readContextCapsule('job-bad')).toBeNull();
    // 알 수 없는 provenance(구버전) → null(buildHarnessContextCapsule 검증 재통과 실패)
    writeColdSnapshot('job-badprov', CAPSULE_KIND, {
      objective: 'x', target: 'y', inScope: [], outOfScope: [], successCriteria: [], evidenceRequired: [],
      riskBoundaries: [], groundingRefs: [{ ref: 'r', provenance: 'url' }], createdAt: '2026-07-25T00:00:00.000Z',
    });
    expect(readContextCapsule('job-badprov')).toBeNull();
    // 비정상 createdAt(파싱 불가) → null(최근성 정렬 오염 방지·should-fix)
    writeColdSnapshot('job-badtime', CAPSULE_KIND, {
      objective: 'x', target: 'y', inScope: [], outOfScope: [], successCriteria: [], evidenceRequired: [],
      riskBoundaries: [], groundingRefs: [], createdAt: 'not-a-timestamp',
    });
    expect(readContextCapsule('job-badtime')).toBeNull();
  });

  it('listContextCapsules — 저장분 전부 나열·손상분 제외(검색-코퍼스 소스)', () => {
    persistContextCapsule('list-1', mkCapsule({ objective: 'A' }));
    persistContextCapsule('list-2', mkCapsule({ objective: 'B' }));
    writeColdSnapshot('list-bad', CAPSULE_KIND, { objective: 'x' /* 손상 */ });
    const listed = listContextCapsules();
    const objectives = listed.map((e) => e.capsule.objective).sort();
    expect(objectives).toEqual(['A', 'B']);   // 유효 2개·손상 제외
    expect(listed.every((e) => typeof e.id === 'string' && e.id.length > 0)).toBe(true);
  });

  it('end-to-end handoff — persist → groundMissionInCapsules 실경로가 관련 상류를 pty 팩트로 발견(MF2)', async () => {
    // 상류 잡들이 자기 capsule persist(실 store)
    persistContextCapsule('upstream-x', mkCapsule({ objective: 'URL 라우터 파이프라인 구현', successCriteria: ['라우팅 통과'] }));
    persistContextCapsule('unrelated', mkCapsule({ objective: '김치 레시피 정리', successCriteria: [] }));
    // 하류 잡 grounding 검색 — 주입 없이 실 listContextCapsules 경로(persist→list→관련도)
    const { facts } = await groundMissionInCapsules('URL 라우터 배선 작업');
    expect(facts.some((f) => f.includes('[pty:upstream-x]') && f.includes('URL 라우터'))).toBe(true);   // 관련 상류 발견
    expect(facts.some((f) => f.includes('김치'))).toBe(false);   // 무관 제외(오염 방지)
  });

  it('end-to-end aggregator — persist → groundMissionInCodebase 가 ptyFacts 로 편입(MF3·실 grounding)', async () => {
    persistContextCapsule('up-agg', mkCapsule({ objective: 'auth 로그인 세션 리프레시', successCriteria: ['세션 유지'] }));
    // 다른 코퍼스(코드/skill/기억/ref)는 quiet → capsule 검색 기여만 확인
    const g = await groundMissionInCodebase('auth 로그인 개선', {
      // 지속 접지는 실제 모델 호출 경로이므로 이 검사는 capsule 기여만 검증한다.
      persistent: false,
      searchTerms: async () => [], skillIndex: () => [], recallMemory: () => [], recallSelf: async () => [], refDigest: () => '',
    });
    expect(g.ptyFacts.some((f) => f.includes('[pty:up-agg]') && f.includes('auth 로그인'))).toBe(true);
  });
});
