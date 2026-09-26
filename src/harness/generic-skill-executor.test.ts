// generic-skill-executor 테스트 — 순수 헬퍼(아티팩트/체인 파싱) + ★anti-drift 나침반 배선(P3·2026-07-23).
//   핵심 계약: 플래너가 스킬별 한문장 task 로 원문을 치환해도, 실행 스킬은 **원문 전체(compass)를 본다**
//   = 발표덱 드리프트 근원을 닫음. deps 주입으로 헤르메틱(LLM/db 무접촉·enhance:false 로 결정론).
import { test, expect, describe, spyOn } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGitCommand } from '../git-fs/runner.js';
import { debug } from '../debug/log.js';
import {
  parseSkillArtifact, parseSkillChainPlan, selectSkillArtifacts, buildGenericSkillExecute,
  type SkillCandidate, type ComposedSkillDeps,
} from './generic-skill-executor.js';

describe('parseSkillArtifact (순수)', () => {
  test('파일 경로 추출(.pptx/.html 등)', () => {
    expect(parseSkillArtifact('완료. 산출: /tmp/wt/deck.pptx')).toBe('/tmp/wt/deck.pptx');
    expect(parseSkillArtifact('결과 ./out/report.html 저장')).toBe('./out/report.html');
  });
  test('파일 없으면 URL 폴백', () => {
    expect(parseSkillArtifact('게시됨: https://example.com/p/1')).toBe('https://example.com/p/1');
  });
  test('아무것도 없으면 null', () => {
    expect(parseSkillArtifact('그냥 텍스트 응답')).toBeNull();
  });
});

describe('parseSkillChainPlan (순수)', () => {
  const cands: SkillCandidate[] = [
    { name: 'native-deck', description: 'PPT' },
    { name: 'diagram-master', description: '다이어그램' },
  ];
  test('JSON 배열 → 후보에 있는 스킬만·순서 유지', () => {
    const raw = '앞말 [{"skill":"diagram-master","task":"미엘린 그림"},{"skill":"native-deck","task":"덱"}] 뒷말';
    expect(parseSkillChainPlan(raw, cands)).toEqual([
      { skill: 'diagram-master', task: '미엘린 그림' },
      { skill: 'native-deck', task: '덱' },
    ]);
  });
  test('후보에 없는 skill·깨진 JSON 은 제거/빈배열', () => {
    expect(parseSkillChainPlan('[{"skill":"ghost","task":"x"}]', cands)).toEqual([]);
    expect(parseSkillChainPlan('not json', cands)).toEqual([]);
  });
});

describe('skill artifact evidence selection (순수)', () => {
  const cwd = '/workspace';

  test('new files outrank a mismatched regex citation with fs evidence', () => {
    const created = join(cwd, 'created.md');
    const selected = selectSkillArtifacts([created], join(cwd, 'read.md'), cwd);

    expect(selected.verifiedArtifacts).toEqual([created]);
    expect(selected.artifacts).toEqual([created]);
    expect(selected.source).toBe('fs');
  });

  test('uses the existing regex fallback only when no new files exist', () => {
    const cited = join(cwd, 'existing.md');
    const selected = selectSkillArtifacts([], cited, cwd);

    expect(selected.verifiedArtifacts).toEqual([cited]);
    expect(selected.artifacts).toEqual([cited]);
    expect(selected.source).toBe('regex');
  });

  test('moves a matching regex citation to the representative artifact while preserving every new file', () => {
    const first = join(cwd, 'first.md');
    const matching = join(cwd, 'matching.md');
    const selected = selectSkillArtifacts([first, matching], matching, cwd);

    expect(selected.verifiedArtifacts).toEqual([matching, first]);
    expect(selected.artifacts[0]).toBe(matching);
    expect(selected.source).toBe('fs');
  });

  test('keeps verified artifacts empty when neither evidence source exists', () => {
    expect(selectSkillArtifacts([], null, cwd)).toEqual({ artifacts: [], verifiedArtifacts: [], source: 'none' });
  });
});

describe('generic no-change publication evidence', () => {
  function tempRepo(): string {
    const cwd = mkdtempSync(join(tmpdir(), 'generic-skill-'));
    const git = (args: string[]) => {
      const result = runGitCommand(cwd, args, { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(String(result.stderr ?? `git ${args[0]} failed`));
    };
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    writeFileSync(join(cwd, 'seed.md'), 'seed\n');
    git(['add', '-A']);
    git(['commit', '-qm', 'seed']);
    return cwd;
  }

  function deps(runSkill: ComposedSkillDeps['runSkill']): ComposedSkillDeps {
    return {
      enhance: false,
      discover: async () => [{ name: 'writer', description: 'artifact writer' }],
      planChain: async () => [{ skill: 'writer', task: 'write artifact' }],
      runSkill,
    };
  }

  test('per-skill task directs a new in-worktree file into its absolute output root and verifies it', async () => {
    const cwd = tempRepo();
    const expectedOutputRoot = join(cwd, '.elanous-skill-artifacts', 'step-1');
    let receivedTask = '';
    let createdFiles = 0;
    try {
      const result = await buildGenericSkillExecute(deps(async (_skill, task, _prior, worktree) => {
        receivedTask = task;
        const artifact = join(worktree, '.elanous-skill-artifacts', 'step-1', 'report.md');
        writeFileSync(artifact, 'new artifact');
        createdFiles += 1;
        return `created: ${artifact}`;
      }))({ objective: 'create report', round: 1, cwd });

      expect(receivedTask).not.toHaveLength(0);
      expect(receivedTask).toContain('write artifact');
      expect(receivedTask).toContain('create report');
      expect(receivedTask).toContain(expectedOutputRoot);
      expect(receivedTask).toContain('텍스트만 답하는 것은 금지');
      expect(receivedTask).toContain('실제 새 파일로 저장');
      expect(createdFiles).toBeGreaterThan(0);
      expect(result).toMatchObject({
        ok: true,
        outcome: 'published',
        ref: join(expectedOutputRoot, 'report.md'),
        nonCodeEvidence: 'artifact-created',
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('clears only the prior artifact files in the current step output root before regenerating', async () => {
    const cwd = tempRepo();
    const outputRoot = join(cwd, '.elanous-skill-artifacts', 'step-1');
    const stale = join(outputRoot, 'stale.md');
    const created = join(outputRoot, 'current.md');
    const outsideOutputRoot = join(cwd, '.elanous-skill-artifacts', 'outside.md');
    try {
      mkdirSync(outputRoot, { recursive: true });
      writeFileSync(stale, 'previous round artifact\n');
      writeFileSync(outsideOutputRoot, 'must remain\n');

      await buildGenericSkillExecute(deps(async () => {
        writeFileSync(created, 'current round artifact\n');
        return `created: ${created}`;
      }))({ objective: 'regenerate report', round: 2, cwd });

      expect(existsSync(stale)).toBeFalse();
      expect(existsSync(created)).toBeTrue();
      expect(existsSync(outsideOutputRoot)).toBeTrue();
      expect(existsSync(join(cwd, 'seed.md'))).toBeTrue();
      expect(existsSync(join(cwd, '.git'))).toBeTrue();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('refuses a symbolic artifact root without deleting files in its external target', async () => {
    const cwd = tempRepo();
    const outside = mkdtempSync(join(tmpdir(), 'generic-skill-external-artifacts-'));
    const externalOutputRoot = join(outside, 'step-1');
    const externalArtifact = join(externalOutputRoot, 'stale.md');
    const preserved = join(outside, 'preserved.md');
    const artifactRoot = join(cwd, '.elanous-skill-artifacts');
    try {
      mkdirSync(externalOutputRoot, { recursive: true });
      writeFileSync(externalArtifact, 'external stale artifact\n');
      writeFileSync(preserved, 'must remain\n');
      symlinkSync(outside, artifactRoot);

      const result = await buildGenericSkillExecute(deps(async () => {
        throw new Error('runSkill must not execute through a symbolic artifact root');
      }))({ objective: 'regenerate report', round: 2, cwd });

      expect(result).toMatchObject({ ok: false, changes: [] });
      expect(existsSync(externalArtifact)).toBeTrue();
      expect(existsSync(preserved)).toBeTrue();
      expect(existsSync(join(cwd, 'seed.md'))).toBeTrue();
      expect(existsSync(join(cwd, '.git'))).toBeTrue();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('a created file remains verified and promoted when output first cites a different existing file', async () => {
    const cwd = tempRepo();
    const created = join(cwd, '.elanous-skill-artifacts', 'step-1', 'created.md');
    const read = join(cwd, 'seed.md');
    const observations: string[] = [];
    const logSpy = spyOn(debug, 'log').mockImplementation(() => undefined);
    try {
      const result = await buildGenericSkillExecute(deps(async () => {
        writeFileSync(created, 'created\n');
        return `read first: ${read}\ncreated: ${created}`;
      }))({ objective: 'create report', round: 1, cwd, onProgress: (message) => observations.push(message) });

      expect(created).not.toBe(read);
      expect(result).toMatchObject({
        ok: true,
        outcome: 'published',
        ref: created,
        nonCodeEvidence: 'artifact-created',
      });
      expect(observations.some((message) => message.includes(created))).toBeTrue();
      const stepDone = logSpy.mock.calls.find(([, event]) => event === 'step-done');
      expect(stepDone?.[2]).toMatchObject({ source: 'fs', newFiles: 1, artifact: expect.stringContaining('created.md') });
    } finally {
      logSpy.mockRestore();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('modifying an existing clean file does not issue artifact-created evidence', async () => {
    const cwd = tempRepo();
    try {
      const existing = join(cwd, 'seed.md');
      const result = await buildGenericSkillExecute(deps(async () => {
        writeFileSync(existing, 'modified\n');
        return `updated: ${existing}`;
      }))({ objective: 'update existing file', round: 1, cwd });

      expect(result).toMatchObject({ ok: true, outcome: 'published' });
      expect(result).not.toHaveProperty('ref');
      expect(result).not.toHaveProperty('nonCodeEvidence');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('a new file outside the worktree does not issue artifact-created evidence', async () => {
    const cwd = tempRepo();
    const outside = mkdtempSync(join(tmpdir(), 'generic-skill-outside-'));
    try {
      const result = await buildGenericSkillExecute(deps(async () => {
        const artifact = join(outside, 'report.md');
        writeFileSync(artifact, 'outside artifact');
        return `created: ${artifact}`;
      }))({ objective: 'create report elsewhere', round: 1, cwd });

      expect(result).toMatchObject({ ok: true, outcome: 'published' });
      expect(result).not.toHaveProperty('ref');
      expect(result).not.toHaveProperty('nonCodeEvidence');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('★ anti-drift 나침반 배선 (원 드리프트 경로 닫힘)', () => {
  const OBJECTIVE = '발표덱: RTX4090 24GB·구독 월 $200·미엘린 3층 다이어그램·정확히 16주제 필수';

  // 헤르메틱 deps — enhance:false(결정론) + 주입 discover/planChain/runSkill(LLM/fs 무접촉).
  function harness() {
    const runSkillTasks: string[] = [];
    const deps: ComposedSkillDeps = {
      enhance: false, // enhancePrompt(LLM) 우회 — compass 베이스=원문 자체(그것만으로 한문장 치환 드리프트는 닫힘)
      discover: async () => [{ name: 'native-deck', description: 'PPT' }],
      planChain: async () => [{ skill: 'native-deck', task: '슬라이드 만들기' }], // ← 플래너 한문장(원문 소실 위험)
      runSkill: async (_skill, task) => { runSkillTasks.push(task); return 'done: /tmp/wt/deck.pptx'; },
    };
    return { deps, runSkillTasks };
  }

  test('플래너 한문장 task 뒤에 원문 전체와 절대 산출 경로가 스킬에 도달', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'generic-skill-compass-'));
    try {
      const { deps, runSkillTasks } = harness();
      const exec = buildGenericSkillExecute(deps);
      const res = await exec({ objective: OBJECTIVE, round: 1, cwd });

      expect(runSkillTasks).toHaveLength(1);
      const task = runSkillTasks[0]!;
      // 플래너 한문장(역할)은 유지되고…
      expect(task).toContain('슬라이드 만들기');
      // …원문의 구체 사실(수치·고유명사·요구 장수)이 통째로 스킬에 도달(드리프트 닫힘)
      expect(task).toContain('RTX4090 24GB');
      expect(task).toContain('구독 월 $200');
      expect(task).toContain('미엘린 3층 다이어그램');
      expect(task).toContain('정확히 16주제 필수');
      expect(task).toContain('원문 나침반'); // 나침반 마커
      expect(task).toContain(cwd);
      expect(task).toContain('텍스트만 답하는 것은 금지');
      expect(task).toContain('실제 새 파일로 저장');
      expect(res.outcome).toBe('published');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('capability-driven: enhance 강제 OFF(deps.enhance:false)여도 원문 나침반은 도달(memory capability 유지)', async () => {
    // enhance:false = explicitEnhance→resolveActiveCapabilities 가 enhance 비활성. 그래도 compass 베이스=원문이라
    //   한문장 치환 드리프트는 여전히 닫힘(capability 게이트가 anti-drift 최저선을 깨지 않음).
    const cwd = mkdtempSync(join(tmpdir(), 'generic-skill-compass-'));
    try {
      const { deps, runSkillTasks } = harness(); // harness() 는 enhance:false
      const exec = buildGenericSkillExecute(deps);
      await exec({ objective: OBJECTIVE, round: 1, cwd });
      const task = runSkillTasks[0]!;
      expect(task).toContain('RTX4090 24GB');       // 원문 사실 도달(드리프트 닫힘)
      expect(task).toContain('정확히 16주제 필수');
      expect(task).toContain('원문 나침반');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
