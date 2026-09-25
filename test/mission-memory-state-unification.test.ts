// 워킹메모리↔State 일원화 U1+U2 — 배선·불변식 검증 (2026-07-19)
//
// U1(READ fold)의 순수 로직은 mission-state-assemble.test.ts 가 커버(foldMissionState workingMemory 채널).
// 여기선 U2(WRITE 게이트) 불변식을 검증: (1) run-mission 이 appendWorkingMemory 를 직접 호출하지 않고
// 게이트만 쓴다(우회 차단·이중진실원 재발 방지) (2) 게이트가 관측 3박자(memory-record·error·persisted)를 남긴다.
import { test, expect, describe } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const runMissionSrc = readFileSync(join(root, 'scripts/run-mission.ts'), 'utf8');
const gateSrc = readFileSync(join(root, 'src/autopilot/pipeline/coordinator-memory.ts'), 'utf8');

/** src/·scripts/ 재귀 .ts 수집(테스트·정의·게이트 제외). */
function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st: ReturnType<typeof statSync>; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (name !== 'node_modules') collectTsFiles(p, out); }
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('U2 — 워킹메모리 write 게이트 단일 관문(우회 차단)', () => {
  test('run-mission 은 appendWorkingMemory 를 직접 호출하지 않는다(게이트만)', () => {
    // import 라인/주석의 단어 언급은 허용, 실제 호출 `appendWorkingMemory(` 은 0 이어야 한다.
    const callSites = runMissionSrc.match(/\bappendWorkingMemory\s*\(/g) ?? [];
    expect(callSites.length).toBe(0);
  });
  test('run-mission 이 coordinatorRecordMemory 게이트를 쓴다', () => {
    expect(runMissionSrc).toContain("import { coordinatorRecordMemory }");
    const gateCalls = runMissionSrc.match(/\bcoordinatorRecordMemory\s*\(/g) ?? [];
    expect(gateCalls.length).toBeGreaterThanOrEqual(6); // 종전 6 직접호출 → 전부 게이트로 이관
  });

  // ★ U2.6(게이트 우회 이관) — 레포 전역 단일-writer 불변식. appendWorkingMemory 직접 호출은 게이트
  //   (coordinator-memory)와 정의 모듈(mission-working-memory)에만 허용. 그 외 우회는 이중진실원 재발.
  test('전역 불변식 — appendWorkingMemory 직접 호출은 게이트/정의 모듈에만(우회 0)', () => {
    const allowed = new Set([
      join(root, 'src/autopilot/mission-working-memory.ts'),      // 정의(내부 라이브 append)
      join(root, 'src/autopilot/pipeline/coordinator-memory.ts'), // 게이트(appendWorkingMemory 래핑)
    ]);
    const offenders: string[] = [];
    for (const dir of [join(root, 'src'), join(root, 'scripts')]) {
      for (const f of collectTsFiles(dir)) {
        if (allowed.has(f)) continue;
        if (/\bappendWorkingMemory\s*\(/.test(readFileSync(f, 'utf8'))) offenders.push(f.replace(root + '/', ''));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('U2 — 게이트 write (durable + 아카이브 미러 + compaction)', () => {
  test('라이브 durable append + 리비전별 풀 아카이브 미러', () => {
    expect(gateSrc).toContain('appendWorkingMemory(missionId, entry)');
    expect(gateSrc).toContain('appendWorkingMemoryArchive(missionId, entry, generation)');
  });
  test('U2.5 — 무거운 assemble/persist 제거(persisted wm 채널 미read·read-time fresh fold 가 정합)', () => {
    // import 부재로 검증 — 게이트가 assemble/persist 를 import 하지 않으므로 호출 불가(주석 언급은 무관).
    const importLines = gateSrc.split('\n').filter((l) => l.startsWith('import'));
    expect(importLines.some((l) => l.includes('assembleMissionState') || l.includes('persistMissionState'))).toBe(false);
    expect(gateSrc).toContain('compactWorkingMemoryIfNeeded(missionId)');
  });
});

describe('U2 — 게이트 관측(제1원칙·자기인지)', () => {
  test('memory-record 관측 — totalEntries/generation/compacted 로 자기인지', () => {
    expect(gateSrc).toMatch(/debug\.log\('mission\.coordinator',\s*'memory-record'/);
    expect(gateSrc).toContain('totalEntries');
    expect(gateSrc).toContain('generation');
  });
  test('실패도 관측 — memory-record.error(드리프트 자기인지·삼킴 금지)', () => {
    expect(gateSrc).toMatch(/debug\.log\('mission\.coordinator',\s*'memory-record\.error'/);
  });
});
