import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { LandingHistorySource } from '../../src/mission-capabilities/report/landingcount.js';
import provider, {
  countLandings,
  landingCountSince,
  landingHistorySourceFor,
  probeLandingCount,
  readLandingHistoryIn,
} from '../../src/mission-capabilities/report/landingcount.js';
import { probeCapability, resolveCapabilityProvider } from '../../src/mission-capabilities/registry.js';

function git(root: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** 착지가 «있는» 저장소와 «없는» 저장소를 진짜로 만든다 — 흉내가 아니다. */
function repoWithCommit(): string {
  const root = mkdtempSync(join(tmpdir(), 'landing-with-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'test');
  writeFileSync(join(root, 'a.txt'), 'a\n');
  git(root, 'add', 'a.txt');
  git(root, 'commit', '-q', '-m', 'first');
  return root;
}
function repoWithoutCommit(): string {
  const root = mkdtempSync(join(tmpdir(), 'landing-empty-'));
  git(root, 'init', '-q');
  return root;
}

describe('report.landingcount — 「어느 트리를 쟀나」가 산출에 있다', () => {
  test('착지가 있는 트리와 없는 트리에서 ok 가 «서로 다르다»', async () => {
    const filled = repoWithCommit();
    const empty = repoWithoutCommit();
    try {
      expect(probeLandingCount(landingHistorySourceFor(filled))).toEqual({ ok: true });
      const source = landingHistorySourceFor(empty);
      const degraded = probeLandingCount(source);
      expect(degraded.ok).toBe(false);
      if (degraded.ok) throw new Error('빈 저장소인데 ok:true 다 — probe 가 외부 상태를 안 보고 있다.');
      // ⛔ 「어느 트리를 쟀나」가 사유에 «있어야» 어긋남이 보인다.
      expect(degraded.reason).toContain(empty);
      // ⛔ 1판은 src/cli/pr-granularity.ts 를 댔다 — 이 능력과도 git 이력과도 무관한 경로였다.
      expect(degraded.repairHint.paths).toEqual(['src/mission-capabilities/report/landingcount.ts']);
      expect(degraded.repairHint.paths).not.toContain('src/cli/pr-granularity.ts');
    } finally {
      rmSync(filled, { recursive: true, force: true });
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test('묶은 트리가 «그 트리»를 잰다 — 현재 작업 디렉토리를 재지 않는다', () => {
    const empty = repoWithoutCommit();
    try {
      // ⚠️ 이 저장소의 최근 커밋 «수»를 전제하지 않는다 — 두 트리가 «서로 다른 답»을 내는지만 본다.
      const filled = repoWithCommit();
      try {
        expect(countLandings(readLandingHistoryIn(filled))).toBeGreaterThan(0);
        expect(probeLandingCount(landingHistorySourceFor(filled)).ok).toBe(true);
        expect(probeLandingCount(landingHistorySourceFor(empty)).ok).toBe(false);
      } finally { rmSync(filled, { recursive: true, force: true }); }
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test('측정 창은 «한 곳»에서만 정해진다', () => {
    expect(landingCountSince).toBe('1 day ago');
    // 능력이 내보내는 그 상수를 블루프린트가 «가져다» 쓴다 — 문자열을 두 곳에 두지 않는다.
    const blueprintSource = Bun.file(resolve(import.meta.dir, '../../src/mission-blueprints/req-v1-10a9d92906d400c4.ts'));
    return blueprintSource.text().then(text => {
      expect(text).toContain('landingCountSince');
      expect(text).not.toContain("'1 day ago'");
    });
  });

  test('레지스트리가 «이 provider» 에 실제로 연결된다', async () => {
    const registered = await resolveCapabilityProvider('report.landingcount');
    if (!registered) throw new Error('경로 규칙으로 report.landingcount 를 못 찾았다.');
    expect(registered.id).toBe(provider.id);
    // ⛔ 「{ ok } 모양이다」로 끝내지 않는다 — 레지스트리 경유와 직접 호출이 «같은 값»인지 본다.
    //   ⚠️ 「이 저장소에 최근 커밋이 있다」를 전제하지 «않는다» — 하루 지난 체크아웃에서 비결정적으로 빨개진다(리뷰 지적).
    //     대신 «같은 트리에 묶은» 두 경로가 같은 답을 내는지로 본다.
    const viaRegistry = await probeCapability('report.landingcount');
    const direct = await provider.probe();
    expect(viaRegistry).toEqual(direct);
  });

  test('리더와 «그 리더가 읽는 트리»는 갈릴 수 없다 — 재지도 않은 트리를 단정하지 않는다', () => {
    const empty = repoWithoutCommit();
    try {
      // ⛔ 1판은 (reader, root) 를 «따로» 받아서, 남의 트리를 읽고도 사유에 cwd 를 「잰 트리」라 적을 수 있었다.
      const degraded = probeLandingCount(landingHistorySourceFor(empty));
      expect(degraded.ok).toBe(false);
      if (degraded.ok) throw new Error('빈 저장소인데 ok:true 다.');
      expect(degraded.reason).toContain(empty);
      expect(degraded.reason).not.toContain(process.cwd());

      // ⭐ 반례: 밖에서 «리더와 트리가 어긋난» 소스를 지어 넣어 본다 — 받아들이면 안 된다.
      const forged = { root: process.cwd(), readHistory: () => readLandingHistoryIn(empty) } as unknown as LandingHistorySource;
      const refused = probeLandingCount(forged);
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error('밖에서 지은 소스를 받아들였다.');
      expect(refused.reason).toContain('landingHistorySourceFor');
    } finally { rmSync(empty, { recursive: true, force: true }); }
  });
});