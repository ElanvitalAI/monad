import { test, expect, describe } from 'bun:test';
import { intakeSeedsAsMissions, domainSideEffect, decideAutoAccept } from './discovery-intake.js';
import { openAutopilotMissionsDb, listMissions } from './mission-registry.js';
import type { ProposalSeed } from './proposal/draft-plan.js';
import { DEFAULT_RESEARCH_MANDATE } from '../domains/research-mandate.js';

function seed(over: Partial<ProposalSeed> = {}): ProposalSeed {
  return {
    slug: 'test-feature', title: '테스트 발굴 기능', source: 'internal-roadmap',
    rationale: '우선순위 1', evidence: ['docs/x.md'], tier: 'light', ...over,
  };
}

/** id slug seam — luna(LLM) 우회(테스트 결정론·네트워크 0). */
const slugFn = async () => 'stub-title';

describe('intakeSeedsAsMissions', () => {
  test('seed → 미션(proposed·source=discovery) 생성', async () => {
    const db = openAutopilotMissionsDb(':memory:');
    // autoAcceptArmed:false 명시 — 실 arming 파일 의존 제거(결정론·§12.5 자동수용 off 기준).
    const r = await intakeSeedsAsMissions([seed({ title: '반도체 리서치 자동화' })], { db, slugFn, autoAcceptArmed: false });
    expect(r.created).toBe(1);
    expect(r.skipped).toBe(0);
    const rows = listMissions(db, {});
    expect(rows[0]!.goal).toBe('반도체 리서치 자동화');
    expect(rows[0]!.source).toBe('discovery');
    expect(rows[0]!.status).toBe('proposed');   // 자동 실행 아님
    db.close();
  });

  test('id 는 영문 slug — slug 보강 창구 경유(한글 휴리스틱 id 구멍 회귀 가드·2026-07-14)', async () => {
    const db = openAutopilotMissionsDb(':memory:');
    const r = await intakeSeedsAsMissions([seed({ title: '한글 골 발굴 후보' })], { db, slugFn, autoAcceptArmed: false });
    expect(r.ids[0]).toMatch(/^apm_stub-title_[0-9a-f]{6}$/);
    db.close();
  });

  test('dedup — 같은 goal 재인입 skip', async () => {
    const db = openAutopilotMissionsDb(':memory:');
    await intakeSeedsAsMissions([seed({ title: '중복 기능' })], { db, slugFn });
    const r2 = await intakeSeedsAsMissions([seed({ title: '중복 기능' }), seed({ title: '새 기능' })], { db, slugFn });
    expect(r2.created).toBe(1);   // 새 기능만
    expect(r2.skipped).toBe(1);   // 중복 기능 skip
    expect(listMissions(db, {}).length).toBe(2);
    db.close();
  });

  test('tier 는 seed 값 사용', async () => {
    const db = openAutopilotMissionsDb(':memory:');
    await intakeSeedsAsMissions([seed({ title: '대규모 리팩토링', tier: 'heavy' })], { db, slugFn });
    expect(listMissions(db, {})[0]!.tier).toBe('heavy');
    db.close();
  });

  test('플랜 초안 아티팩트 기록 (SE2 — 미션 id 로 키잉·SE4 입력)', async () => {
    const { mkdtempSync, existsSync, readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const { tmpdir } = require('node:os') as typeof import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'se-draft-'));
    const db = openAutopilotMissionsDb(':memory:');
    const r = await intakeSeedsAsMissions([seed({ title: '초안 검증 기능', rationale: '왜 지금 이것' })], {
      db, slugFn, draftPathFor: (id) => join(dir, `${id}.md`),
    });
    const draft = join(dir, `${r.ids[0]}.md`);
    expect(existsSync(draft)).toBe(true);
    expect(readFileSync(draft, 'utf-8')).toContain('왜 지금 이것');   // buildPlanDraft rationale
    db.close();
  });

  test('draftPathFor null → 초안 skip(미션은 생성)', async () => {
    const db = openAutopilotMissionsDb(':memory:');
    const r = await intakeSeedsAsMissions([seed({ title: 'skip 초안' })], { db, slugFn, draftPathFor: () => null });
    expect(r.created).toBe(1);
    db.close();
  });

  test('배선 가드 — se-discovery-cycle 이 --missions 인입', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const src = readFileSync(join(import.meta.dir, '..', '..', 'scripts', 'se-discovery-cycle.ts'), 'utf-8');
    expect(src).toContain('intakeSeedsAsMissions(');
    expect(src).toContain("'--missions'");
  });
});

describe('§12.5 discovery 자동수용', () => {
  test('domainSideEffect — coding=code·investment=trade·business/general=none', () => {
    expect(domainSideEffect('coding')).toBe('code');
    expect(domainSideEffect('investment')).toBe('trade');
    expect(domainSideEffect('business')).toBe('none');
    expect(domainSideEffect('general')).toBe('none');
  });

  test('decideAutoAccept — business/general + armed → 자동수용', () => {
    expect(decideAutoAccept('business', DEFAULT_RESEARCH_MANDATE, true).autoAccept).toBe(true);
    expect(decideAutoAccept('general', DEFAULT_RESEARCH_MANDATE, true).autoAccept).toBe(true);
  });
  test('decideAutoAccept — coding/investment 은 경계(매매·코드변경) → 항상 proposed', () => {
    expect(decideAutoAccept('coding', DEFAULT_RESEARCH_MANDATE, true).autoAccept).toBe(false);
    expect(decideAutoAccept('investment', DEFAULT_RESEARCH_MANDATE, true).autoAccept).toBe(false);
  });
  test('decideAutoAccept — arming off → 자격 있어도 proposed(fail-closed)', () => {
    const d = decideAutoAccept('business', DEFAULT_RESEARCH_MANDATE, false);
    expect(d.autoAccept).toBe(false);
    expect(d.reason).toContain('disarmed');
  });

  test('intake — business 발굴 + arming on → status=armed(HITL 스킵)', async () => {
    const db = openAutopilotMissionsDb(':memory:');
    const r = await intakeSeedsAsMissions([seed({ title: '반도체 산업 보고서 작성' })], { db, slugFn, autoAcceptArmed: true });
    expect(r.autoAccepted).toBe(1);
    expect(listMissions(db, {})[0]!.status).toBe('armed');
    db.close();
  });
  test('intake — investment 발굴은 arming on 이어도 proposed(경계)', async () => {
    const db = openAutopilotMissionsDb(':memory:');
    const r = await intakeSeedsAsMissions([seed({ title: '삼성전자 매수 자동화' })], { db, slugFn, autoAcceptArmed: true });
    expect(r.autoAccepted).toBe(0);
    expect(listMissions(db, {})[0]!.status).toBe('proposed');
    db.close();
  });
  test('intake — arming off(기본) → business 도 proposed', async () => {
    const db = openAutopilotMissionsDb(':memory:');
    const r = await intakeSeedsAsMissions([seed({ title: '경쟁사 마케팅 전략 분석' })], { db, slugFn, autoAcceptArmed: false });
    expect(r.autoAccepted).toBe(0);
    expect(listMissions(db, {})[0]!.status).toBe('proposed');
    db.close();
  });
});
