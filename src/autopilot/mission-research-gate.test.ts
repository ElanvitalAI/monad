// 미션 외부조사·보강 게이트 — 필요 판단 → 조사 → 보강/교정 추출(주입 seam).
import { describe, it, expect } from 'bun:test';
import { TaskStore } from '../task-orchestrator/store.js';
import { createMission } from './mission-registry.js';
import { researchAndEnrichMission, parseJsonLoose, isInternalGoal, hasExternalResearchSignal } from './mission-research-gate.js';

function memStore(): TaskStore { return new TaskStore({ path: ':memory:' }); }

describe('isInternalGoal — 외부조사 skip 판정', () => {
  it('로컬 스크립트 참조 + 유지보수/복원 = 내부(외부조사 불필요)', () => {
    expect(isInternalGoal('se-doc-map 크론 복원해줘. scripts/se-doc-map.ts --write 를 일요일 05:30 스케줄로')).toBe(true);
    expect(isInternalGoal('scripts/foo.ts 크론 재등록')).toBe(true);
  });
  it('외부 정보가 필요한 케이스는 안 걸림(보수적·둘 다 요구)', () => {
    expect(isInternalGoal('삼성전자 최근 실적 조사해서 리포트')).toBe(false); // 외부 조사 필요
    expect(isInternalGoal('반도체 시장 동향 크롤링')).toBe(false);
  });
});

describe('hasExternalResearchSignal — 외부조사 시그널 강제 감지(대표 2026-07-22)', () => {
  it('외부 레퍼런스/웹검색/조사 뉘앙스 = true', () => {
    expect(hasExternalResearchSignal('외부 레퍼런스 찾아서 반영해줘')).toBe(true);
    expect(hasExternalResearchSignal('웹검색으로 최신 방식 조사해줘')).toBe(true);
    expect(hasExternalResearchSignal('사람들이 많이 쓰는 배포 방식 참고자료 모아줘')).toBe(true);
    expect(hasExternalResearchSignal('tailscale funnel best practice 를 look up 해서 설계')).toBe(true);
    expect(hasExternalResearchSignal('업계 표준 확인하고 최신 트렌드 조사')).toBe(true);
  });
  it('외부 시그널 없는 내부작업 = false', () => {
    expect(hasExternalResearchSignal('내부 변수명 정리')).toBe(false);
    expect(hasExternalResearchSignal('scripts/foo.ts 크론 재등록')).toBe(false);
    expect(hasExternalResearchSignal('기존 자산 확장 작업')).toBe(false);
  });
});

describe('parseJsonLoose', () => {
  it('fence/prose 관대 파싱', () => {
    expect(parseJsonLoose('```json\n{"needed":true}\n```')?.needed).toBe(true);
    expect(parseJsonLoose('여기: {"a":1} 끝')?.a).toBe(1);
    expect(parseJsonLoose('없음')).toBeNull();
  });
});

describe('researchAndEnrichMission', () => {
  it('조사 불필요 판단 → skip(researched=false)', async () => {
    const store = memStore();
    try {
      const m = createMission(store, { goal: '내부 변수명 정리', source: 'human-intent', triage: { executionModel: 'task', tier: 'light', engine: 'tox' } });
      const r = await researchAndEnrichMission(m.id, {
        store,
        assessNeed: async () => ({ needed: false, reason: '순수 내부 리팩터' }),
        invoke: async () => { throw new Error('조사 호출되면 안 됨'); },
      });
      expect(r.ok).toBe(true);
      expect(r.researched).toBe(false);
      expect(r.needReason).toContain('내부');
    } finally { store.close(); }
  });

  // ★ 관측/UX 훅(대표 2026-07-17) — onAssess 가 luna 판단 직후 needed/reason 으로 호출된다.
  it('onAssess 훅 — 조사 필요/불필요 판단 결과를 실시간 통지', async () => {
    const store = memStore();
    try {
      const skip = createMission(store, { goal: '기존 자산 확장 작업', source: 'human-intent', triage: { executionModel: 'task', tier: 'light', engine: 'tox' } });
      const seen: { needed: boolean; reason: string; by: string }[] = [];
      await researchAndEnrichMission(skip.id, {
        store,
        assessNeed: async () => ({ needed: false, reason: '기존 자산 확장' }),
        invoke: async () => { throw new Error('조사 호출되면 안 됨'); },
        onAssess: (need) => seen.push(need),
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]).toEqual({ needed: false, reason: '기존 자산 확장', by: 'luna' });
    } finally { store.close(); }
  });

  // ★ 외부조사 시그널 강제(대표 2026-07-22) — 골에 시그널 있으면 luna needed=false 여도 강제 조사.
  it('외부조사 시그널 → luna 판정 무시하고 강제 조사(signal-forced)', async () => {
    const store = memStore();
    let assessed = false;
    try {
      const m = createMission(store, { goal: 'tailscale 외부노출 방법 웹검색으로 최신 자료 조사해서 설계', source: 'human-intent', triage: { executionModel: 'task', tier: 'heavy', engine: 'tox' } });
      const seen: { needed: boolean; reason: string; by: string }[] = [];
      const r = await researchAndEnrichMission(m.id, {
        store,
        assessNeed: async () => { assessed = true; return { needed: false, reason: '내부로 충분' }; }, // luna 오탐 시뮬
        invoke: async () => ({ ok: true, output: 'Tailscale Funnel 로 공개 노출 가능' }),
        extract: async () => ({ enrichments: ['Funnel 사용'], corrections: [] }),
        onAssess: (need) => seen.push(need),
      });
      expect(assessed).toBe(false);            // 시그널 강제 → luna assessNeed 호출 안 됨
      expect(seen[0]?.by).toBe('signal-forced');
      expect(r.researched).toBe(true);         // luna 가 false 였어도 조사 수행됨
    } finally { store.close(); }
  });

  // ★ 내부작업이라도 외부조사 시그널이 있으면 skip 하지 않는다(시그널 우선).
  it('내부작업 골 + 외부조사 시그널 → internal-heuristic skip 안 함', async () => {
    const store = memStore();
    try {
      const m = createMission(store, { goal: 'scripts/deploy.ts 크론 재등록하되 최신 배포 방식 웹검색으로 조사해서 반영', source: 'human-intent', triage: { executionModel: 'task', tier: 'light', engine: 'tox' } });
      const r = await researchAndEnrichMission(m.id, {
        store,
        assessNeed: async () => ({ needed: false, reason: 'x' }),
        invoke: async () => ({ ok: true, output: '조사 결과' }),
        extract: async () => ({ enrichments: ['e'], corrections: [] }),
      });
      expect(r.researched).toBe(true);   // 시그널이 internal-heuristic skip 을 override
    } finally { store.close(); }
  });

  it('필요 판단 → 조사 → 보강/교정 추출', async () => {
    const store = memStore();
    try {
      const m = createMission(store, { goal: '최신 EODHD API 로 배당 데이터 연동', source: 'human-intent', triage: { executionModel: 'task', tier: 'light', engine: 'tox' } });
      const r = await researchAndEnrichMission(m.id, {
        store,
        assessNeed: async () => ({ needed: true, reason: '외부 API 최신성' }),
        invoke: async () => ({ ok: true, output: 'EODHD v2 배당 엔드포인트는 /div/... 로 변경됨. rate limit 상향.' }),
        extract: async () => ({ enrichments: ['v2 엔드포인트 사용', 'rate limit 상향 반영'], corrections: ['구 엔드포인트 deprecated'] }),
      });
      expect(r.ok).toBe(true);
      expect(r.researched).toBe(true);
      expect(r.enrichments.length).toBe(2);
      expect(r.corrections).toContain('구 엔드포인트 deprecated');
    } finally { store.close(); }
  });

  it('heavy force → 필요판단 건너뛰고 강제 조사', async () => {
    const store = memStore();
    let assessed = false;
    try {
      const m = createMission(store, { goal: '전면 마이그레이션', source: 'human-intent', triage: { executionModel: 'task', tier: 'heavy', engine: 'tox' } });
      const r = await researchAndEnrichMission(m.id, {
        store, force: true,
        assessNeed: async () => { assessed = true; return { needed: false, reason: 'x' }; },
        invoke: async () => ({ ok: true, output: '조사 결과' }),
        extract: async () => ({ enrichments: ['e'], corrections: [] }),
      });
      expect(assessed).toBe(false);      // force 면 필요판단 skip
      expect(r.researched).toBe(true);
    } finally { store.close(); }
  });

  it('조사 실패 → fail-soft(researched=false·미션 안 막음)', async () => {
    const store = memStore();
    try {
      const m = createMission(store, { goal: 'x', source: 'human-intent', triage: { executionModel: 'task', tier: 'light', engine: 'tox' } });
      const r = await researchAndEnrichMission(m.id, {
        store,
        assessNeed: async () => ({ needed: true, reason: 'y' }),
        invoke: async () => { throw new Error('omni-crawl 다운'); },
      });
      expect(r.ok).toBe(false);
      expect(r.researched).toBe(false);
      expect(r.error).toContain('omni-crawl');
    } finally { store.close(); }
  });
});
