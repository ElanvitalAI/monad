// ⭐ 72차 인시던트 ⑵: 도구가 ask 가 «댄» 경로를 후보로 «쓰지» 않고 「내 집합에 들어 있나」만 봤다.
//   ⇒ 접지 채널이 실패하면(제공자 장애 등) facts.files 가 비고, 그러면 ***ask 가 무엇을 대든*** 실패했다.
//   🅣 가 반대 사례도 찾았다(채널 성공인데 code=0) ⇒ 이 배선은 「장애 대비」가 아니라 그 자체로 옳다.
// ⛔ mirage 가드는 그대로 — ***git 이 추적하는 파일만*** 들인다.
import { describe, expect, test } from 'bun:test';
import { groundMissionInCodebase } from '../src/autopilot/mission-codebase-gate.js';

const repoRoot = new URL('..', import.meta.url).pathname;

// ⛔ 검색 채널을 «죽여» 놓고 본다 — 그래야 「seed 가 들어왔는가」만 남는다.
//   (검색이 우연히 같은 파일을 찾으면 이 시험이 아무것도 안 가른다.)
const deadSearch = { searchTerms: async () => [] as string[], persistent: false as const };

describe('groundMissionInCodebase — ask 가 «댄» 경로를 후보로 쓴다', () => {
  test('검색이 0을 내도 ask 가 댄 «추적되는» 파일은 후보가 된다', async () => {
    const facts = await groundMissionInCodebase(
      '대상 경로: src/self-dev/launch-preflight.ts 를 고친다.',
      { cwd: repoRoot, seedPaths: ['src/self-dev/launch-preflight.ts'], ...deadSearch },
    );
    expect(facts.files).toContain('src/self-dev/launch-preflight.ts');
  });

  // ⛔ 없는 파일을 지목하지 않는다 — 그게 이 저장소의 오래된 mirage 계약이다.
  test('추적되지 «않는» 경로는 들이지 않는다', async () => {
    const facts = await groundMissionInCodebase(
      '대상 경로: src/self-dev/this-file-does-not-exist-72.ts 를 고친다.',
      { cwd: repoRoot, seedPaths: ['src/self-dev/this-file-does-not-exist-72.ts'], ...deadSearch },
    );
    expect(facts.files).not.toContain('src/self-dev/this-file-does-not-exist-72.ts');
  });

  // ⛔ 경로 정책은 seed 에도 «그대로» 걸린다(skill 문서는 구현 후보가 아니다).
  test('skill 문서는 ask 가 대도 구현 후보가 아니다', async () => {
    const facts = await groundMissionInCodebase(
      '대상 경로: .claude/skills/absorb/SKILL.md 를 고친다.',
      { cwd: repoRoot, seedPaths: ['.claude/skills/absorb/SKILL.md'], ...deadSearch },
    );
    expect(facts.files).not.toContain('.claude/skills/absorb/SKILL.md');
  });

  test('seed 를 안 주면 종전과 «같다»', async () => {
    const facts = await groundMissionInCodebase('대상 경로: src/self-dev/launch-preflight.ts', { cwd: repoRoot, ...deadSearch });
    expect(facts.files).not.toContain('src/self-dev/launch-preflight.ts');
  });

  test('같은 경로를 두 번 대도 한 번만 들어간다', async () => {
    const facts = await groundMissionInCodebase(
      '대상 경로: src/self-dev/launch-preflight.ts · src/self-dev/launch-preflight.ts',
      { cwd: repoRoot, seedPaths: ['src/self-dev/launch-preflight.ts', 'src/self-dev/launch-preflight.ts'], ...deadSearch },
    );
    expect(facts.files.filter((path) => path === 'src/self-dev/launch-preflight.ts')).toHaveLength(1);
  });
});
