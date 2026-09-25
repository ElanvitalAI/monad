// ── PX-7 P2: parser tests ──

import { describe, test, expect } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseDeclarationFile,
  toAgentContribution,
  toMissionDefinition,
  toSkillWorkflow,
  toHookContribution,
  toRouteContribution,
  toSkillContribution,
} from '../src/plugin-declarative/parser';

function scratch(): string { return mkdtempSync(join(tmpdir(), 'pd-parser-')); }

describe('PX-7 P2 — parseDeclarationFile', () => {
  test('missing file → null', () => {
    expect(parseDeclarationFile('/nowhere/nope.md', 'agents', 'user')).toBeNull();
  });

  test('frontmatter + body parsed', () => {
    const dir = scratch();
    const path = join(dir, 'x.md');
    writeFileSync(path,
      `---\nid: custom\nname: Custom\n---\nsystem prompt\n`);
    const p = parseDeclarationFile(path, 'agents', 'user');
    expect(p?.id).toBe('custom');
    expect(p?.frontmatter.name).toBe('Custom');
    expect(p?.body.trim()).toBe('system prompt');
  });

  test('id defaults to filename stem when frontmatter omits', () => {
    const dir = scratch();
    const path = join(dir, 'my-agent.md');
    writeFileSync(path, `---\nname: Nameless\n---\nbody`);
    const p = parseDeclarationFile(path, 'agents', 'user');
    expect(p?.id).toBe('my-agent');
  });

  test('mission id defaults to parent directory name', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'goal-x'));
    const path = join(dir, 'goal-x', 'mission.md');
    writeFileSync(path, `---\nname: Goal X\n---\n`);
    const p = parseDeclarationFile(path, 'missions', 'user');
    expect(p?.id).toBe('goal-x');
  });
});

describe('PX-7 P2 — toAgentContribution', () => {
  test('frontmatter fields map through; body → systemPrompt', () => {
    const dir = scratch();
    const path = join(dir, 'expert.md');
    writeFileSync(path,
      `---\nname: Expert\nmodel: haiku\ntools: [Read, Grep]\nomitClaudeMd: true\nmaxTurns: 30\nisolation: worktree\n---\nYou are the expert.`);
    const p = parseDeclarationFile(path, 'agents', 'user')!;
    const def = toAgentContribution(p);
    expect(def.name).toBe('Expert');
    expect(def.model).toBe('haiku');
    expect(def.tools).toEqual(['Read', 'Grep']);
    expect(def.omitInheritedContext).toBe(true);
    expect(def.maxTurns).toBe(30);
    expect(def.isolation).toBe('worktree');
    expect(def.systemPrompt).toContain('the expert');
  });

  test('new omitInheritedContext key takes precedence over omitClaudeMd', () => {
    const dir = scratch();
    const path = join(dir, 'context-precedence.md');
    writeFileSync(path,
      `---\nomitClaudeMd: true\nomitInheritedContext: false\n---\nYou are the expert.`);
    const parsed = parseDeclarationFile(path, 'agents', 'user')!;
    const def = toAgentContribution(parsed);
    expect(def.omitInheritedContext).toBe(false);
    expect('omitClaudeMd' in def).toBe(false);
  });
});

describe('PX-7 P2 — toMissionDefinition', () => {
  test('accepts full frontmatter', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'gogo'));
    const path = join(dir, 'gogo', 'mission.md');
    writeFileSync(join(dir, 'gogo', 'evaluator.sh'), `#!/bin/sh\nexit 0\n`);
    chmodSync(join(dir, 'gogo', 'evaluator.sh'), 0o755);
    writeFileSync(path,
      `---\nname: GoGo\nkeepPolicy: pass_only\nmaxIterations: 5\nevaluator:\n---\n`);
    // evaluator block list is not parsed by minimal YAML — use inline.
    writeFileSync(path,
      `---\nname: GoGo\nkeepPolicy: pass_only\nmaxIterations: 5\nevaluator: { command: ./evaluator.sh, timeoutMs: 3000 }\n---\n`);
    const p = parseDeclarationFile(path, 'missions', 'user')!;
    const def = toMissionDefinition(p);
    expect(def?.id).toBe('gogo');
    expect(def?.keepPolicy).toBe('pass_only');
    expect(def?.maxIterations).toBe(5);
    expect(def?.evaluator.timeoutMs).toBe(3000);
    expect(def?.evaluator.command).toContain('evaluator.sh');
  });

  test('rejects missing evaluator', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'bad'));
    const path = join(dir, 'bad', 'mission.md');
    writeFileSync(path, `---\nname: Bad\nkeepPolicy: pass_only\n---\n`);
    const p = parseDeclarationFile(path, 'missions', 'user')!;
    expect(toMissionDefinition(p)).toBeNull();
  });

  test('maxIterations clamped to 1000', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'mx'));
    const path = join(dir, 'mx', 'mission.md');
    writeFileSync(path,
      `---\nname: Mx\nkeepPolicy: never\nmaxIterations: 99999\nevaluator: { command: ./e.sh }\n---\n`);
    const p = parseDeclarationFile(path, 'missions', 'user')!;
    const def = toMissionDefinition(p);
    expect(def?.maxIterations).toBe(1000);
  });
});

describe('PX-7 P2 — toSkillWorkflow', () => {
  test('requires non-empty steps[]', () => {
    const dir = scratch();
    const path = join(dir, 'wf.md');
    writeFileSync(path, `---\nname: WF\n---\n`);
    const p = parseDeclarationFile(path, 'workflows', 'user')!;
    expect(toSkillWorkflow(p)).toBeNull();
  });
  // Minimal YAML does not parse nested arrays-of-objects; workflows
  // authored via declarative are expected to use a small codec trick
  // (steps: ['tool:Bash']) OR fall back to Layer 1 plugin.json. The
  // test suite keeps the converter behaviour stable — parsing support
  // for richer step syntax lives in a follow-up.
});

describe('PX-7 P2 — toHookContribution', () => {
  test('requires event + command', () => {
    const dir = scratch();
    const path = join(dir, 'h.md');
    writeFileSync(path, `---\nevent: Turn\ncommand: ./hook.sh\n---\n`);
    const p = parseDeclarationFile(path, 'hooks', 'user')!;
    expect(toHookContribution(p)?.event).toBe('Turn');
  });
});

describe('PX-7 P2 — toRouteContribution', () => {
  test('requires target.kind + id', () => {
    const dir = scratch();
    const path = join(dir, 'r.md');
    writeFileSync(path, `---\ntarget: { kind: agent, id: explore }\naliases: [search]\n---\n`);
    const p = parseDeclarationFile(path, 'routes', 'user')!;
    const def = toRouteContribution(p);
    expect(def?.target.kind).toBe('agent');
    expect(def?.target.id).toBe('explore');
    expect(def?.aliases).toEqual(['search']);
  });

  test('unknown target.kind → null', () => {
    const dir = scratch();
    const path = join(dir, 'bad.md');
    writeFileSync(path, `---\ntarget: { kind: widget, id: x }\n---\n`);
    const p = parseDeclarationFile(path, 'routes', 'user')!;
    expect(toRouteContribution(p)).toBeNull();
  });
});

describe('PX-7 P2 — toSkillContribution', () => {
  test('captures body as-is', () => {
    const dir = scratch();
    const path = join(dir, 'my-skill.md');
    writeFileSync(path, `---\ndescription: does a thing\n---\nDo the thing.\n`);
    const p = parseDeclarationFile(path, 'skills', 'user')!;
    const def = toSkillContribution(p);
    expect(def.id).toBe('my-skill');
    expect(def.body).toContain('Do the thing');
  });
});
