// ── skill-runner tests ──
//
// Covers the pure pieces of the runner: frontmatter parsing, template
// substitution, and message construction with/without an attachment
// context. The `executeSkill` streaming path hits live providers, so it's
// verified manually — these tests assert only what the LLM would receive.

import { describe, test, expect, afterAll } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  parseSkillMd,
  substituteTemplate,
  buildSkillMessages,
  buildBrowserSessionTools,
  browserSessionDispatchers,
  type SkillManifest,
} from '../src/skills/runner';
import type { LLMMessage } from '../src/llm';
import { dispatchBrowserOpen, _resetCdpSessionsForTesting } from '../src/skills/tools/browser-iphone';
import type { CdpClient } from '../src/browser-cdp/client';
import {
  createContextRegistry,
  addAttachment,
  type ContextRegistry,
} from '../src/context';

// Wave 4 (2026-05-04) — message indices shifted when the universal
// preamble started emitting a session-guidance system message (gated
// on enabledTools, always present in skill runner since the gate-
// filtered catalog is non-empty). Helpers find skill-system / user
// by content shape so future wave shifts don't ripple through index
// arithmetic in every test.
function skillSystemIndex(msgs: LLMMessage[]): number {
  const i = msgs.findIndex(m =>
    m.role === 'system' &&
    typeof m.content === 'string' &&
    m.content.includes('You are executing the Claude Code skill'),
  );
  if (i < 0) throw new Error('skill systemPrompt not found in msgs');
  return i;
}
function userIndex(msgs: LLMMessage[]): number {
  const i = msgs.findIndex(m => m.role === 'user');
  if (i < 0) throw new Error('user message not found in msgs');
  return i;
}

const tmpRoot = mkdtempSync(join(tmpdir(), 'monad-sr-'));
// W4-B project tree integration: buildSkillMessages now emits a Project
// Layout system message when cwd has any visible files. Tests want a
// deterministic 3-message preamble — point at a path that the walker
// will see as empty (returns null tree). A non-existent path qualifies:
// safeReaddir returns [] → tree null → only the lifecycle preamble emits.
const emptyTestCwd = '/nonexistent-skill-test-cwd-12345';

afterAll(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writeSkill(name: string, body: string): string {
  const dir = join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), body);
  return dir;
}

function fakeManifest(over: Partial<SkillManifest> = {}): SkillManifest {
  return {
    name: 'demo',
    description: 'demo skill',
    model: undefined,
    allowedTools: undefined,
    content: 'Hello $ARGUMENTS — skill dir is ${CLAUDE_SKILL_DIR}',
    skillDir: '/skills/demo',
    ...over,
  };
}

describe('browser session runner wiring', () => {
  test('registers BrowserRead and dispatches it through the session tool caller', async () => {
    const client = {
      port: 9222,
      pid: 42,
      isAlive: true,
      navigate: async () => {},
      screenshot: async () => Buffer.alloc(0),
      evaluate: async () => 'Runner page text',
      close: async () => {},
    } as unknown as CdpClient;
    const open = await dispatchBrowserOpen({}, { createClient: async () => client });
    const session_id = open.output.match(/session_id=(\S+)/)?.[1]!;

    expect(buildBrowserSessionTools().map(tool => tool.name)).toContain('BrowserRead');
    const result = await browserSessionDispatchers.BrowserRead({ session_id });
    expect(result.output).toContain('Runner page text');
    _resetCdpSessionsForTesting();
  });
});

// ═══════════════════════════════════════════
// 1. parseSkillMd
// ═══════════════════════════════════════════

describe('parseSkillMd', () => {
  test('reads basic frontmatter + body', () => {
    writeSkill('alpha', [
      '---',
      'name: alpha',
      'description: Alpha skill',
      'model: gpt-4o-mini',
      '---',
      'Body line 1',
    ].join('\n'));

    const m = parseSkillMd('alpha', tmpRoot);
    expect(m).not.toBeNull();
    expect(m!.name).toBe('alpha');
    expect(m!.description).toBe('Alpha skill');
    expect(m!.model).toBe('gpt-4o-mini');
    expect(m!.content.startsWith('Body line 1')).toBe(true);
  });

  test('returns null when SKILL.md missing', () => {
    expect(parseSkillMd('no-such', tmpRoot)).toBeNull();
  });

  // Archon-port T1.1 (2026-05-08) — allowedTools/deniedTools fields.
  test('parses allowedTools (array form)', () => {
    writeSkill('al-arr', [
      '---',
      'name: al-arr',
      'description: Allow array',
      'allowed-tools:',
      '  - Read',
      '  - Bash',
      '---',
      'body',
    ].join('\n'));
    const m = parseSkillMd('al-arr', tmpRoot);
    expect(m!.allowedTools).toEqual(['Read', 'Bash']);
    expect(m!.deniedTools).toBeUndefined();
  });

  test('parses allowedTools (comma-separated string)', () => {
    writeSkill('al-csv', [
      '---',
      'name: al-csv',
      'description: Allow csv',
      'allowed-tools: Read, Bash, WebFetch',
      '---',
      'body',
    ].join('\n'));
    const m = parseSkillMd('al-csv', tmpRoot);
    expect(m!.allowedTools).toEqual(['Read', 'Bash', 'WebFetch']);
  });

  test('parses deniedTools (array form)', () => {
    writeSkill('dn-arr', [
      '---',
      'name: dn-arr',
      'description: Deny array',
      'denied-tools:',
      '  - Bash',
      '  - Edit',
      '---',
      'body',
    ].join('\n'));
    const m = parseSkillMd('dn-arr', tmpRoot);
    expect(m!.deniedTools).toEqual(['Bash', 'Edit']);
    expect(m!.allowedTools).toBeUndefined();
  });

  test('parses both allowedTools + deniedTools simultaneously', () => {
    writeSkill('both', [
      '---',
      'name: both',
      'description: Both',
      'allowed-tools: Read,Bash,Edit',
      'denied-tools: Edit',
      '---',
      'body',
    ].join('\n'));
    const m = parseSkillMd('both', tmpRoot);
    expect(m!.allowedTools).toEqual(['Read', 'Bash', 'Edit']);
    expect(m!.deniedTools).toEqual(['Edit']);
  });

  test('camelCase frontmatter keys (deniedTools) accepted', () => {
    writeSkill('camel', [
      '---',
      'name: camel',
      'description: Camel keys',
      'deniedTools: WebFetch',
      '---',
      'body',
    ].join('\n'));
    const m = parseSkillMd('camel', tmpRoot);
    expect(m!.deniedTools).toEqual(['WebFetch']);
  });
});

// ═══════════════════════════════════════════
// 2. substituteTemplate
// ═══════════════════════════════════════════

describe('substituteTemplate', () => {
  test('replaces $ARGUMENTS and ${CLAUDE_SKILL_DIR}', () => {
    const out = substituteTemplate(
      'run $ARGUMENTS in ${CLAUDE_SKILL_DIR}',
      'foo bar',
      '/tmp/dir',
    );
    expect(out).toBe('run foo bar in /tmp/dir');
  });

  test('positional args $1 $2', () => {
    expect(substituteTemplate('$1 then $2', 'alpha beta', '/x')).toBe('alpha then beta');
  });

  test('missing positional becomes empty string', () => {
    expect(substituteTemplate('[$3]', 'only-one', '/x')).toBe('[]');
  });
});

// ═══════════════════════════════════════════
// 3. buildSkillMessages (pure message shape)
// ═══════════════════════════════════════════

// P3 (2026-05-03) — buildSkillMessages now prepends the universal preamble
// (project anchor + family lifecycle + codex addendum). Tests pass
// `cwd: emptyTestCwd` (an empty dir without AGENTS.md/CLAUDE.md) so the preamble
// emits ONLY the family-agnostic lifecycle (1 system message), keeping
// indices deterministic. Production callers default to `process.cwd()`.
//
// Layout after P3 (with cwd: emptyTestCwd, no anchor files):
//   msgs[0] = lifecycle (system, "Coding Agent Pipelines …")
//   msgs[1] = skill systemPrompt (system)
//   msgs[2] = user

describe('buildSkillMessages', () => {
  test('no context: lifecycle + skill system + user string', () => {
    const msgs = buildSkillMessages(fakeManifest(), 'my-args', { cwd: emptyTestCwd });
    // The lifecycle preamble remains present even when the harness prepends its context.
    expect(msgs.some(message =>
      message.role === 'system' && typeof message.content === 'string' &&
      message.content.includes('Coding Agent Pipelines'),
    )).toBe(true);

    // Skill-specific systemPrompt — locate by content (Wave 4: index
    // shifted by the session-guidance system message).
    const sysIdx = skillSystemIndex(msgs);
    expect(typeof msgs[sysIdx]!.content).toBe('string');
    expect(msgs[sysIdx]!.content).toContain('demo');
    expect(msgs[sysIdx]!.content).toContain('/skills/demo');

    // User message
    const uIdx = userIndex(msgs);
    expect(msgs[uIdx]!.content).toContain('Arguments: my-args');
    expect(msgs[uIdx]!.content).toContain('my-args');
    expect(msgs[uIdx]!.content).toContain('/skills/demo');
  });

  test('empty args: user message skips "Arguments:" prefix', () => {
    const msgs = buildSkillMessages(fakeManifest(), '', { cwd: emptyTestCwd });
    const userContent = msgs[userIndex(msgs)]!.content as string;
    expect(userContent.startsWith('Arguments:')).toBe(false);
  });

  test('with systemContext: appended to skill system prompt', () => {
    const msgs = buildSkillMessages(fakeManifest(), '', { systemContext: 'extra-ctx-line', cwd: emptyTestCwd });
    expect(msgs[skillSystemIndex(msgs)]!.content).toContain('extra-ctx-line');
  });

  test('with context + loaded text attachment: section prepended to user text', () => {
    const reg = createContextRegistry();
    const att = addAttachment(reg, {
      kind: 'text',
      sourcePath: '/tmp/notes.txt',
      filename: 'notes.txt',
      sizeBytes: 20,
      mtime: 1,
    });
    // Simulate a loaded text attachment
    att.text = 'Q3 revenue: $42.5M';
    att.extractedBytes = att.text.length;
    att.loaded = true;

    const msgs = buildSkillMessages(fakeManifest(), 'what is revenue?', { context: reg, cwd: emptyTestCwd });
    const user = msgs[userIndex(msgs)]!.content as string;
    expect(user).toContain('[Attached Text #1: notes.txt]');
    expect(user).toContain('Q3 revenue: $42.5M');
    expect(user).toContain('what is revenue?');
  });

  test('with context + loaded image: user is ContentBlock[] with image + text', () => {
    const reg: ContextRegistry = createContextRegistry();
    const img = addAttachment(reg, {
      kind: 'image',
      sourcePath: '/tmp/pic.png',
      filename: 'pic.png',
      sizeBytes: 100,
      mtime: 1,
    });
    img.base64 = 'AAAA';
    img.mediaType = 'image/png';
    img.dimensions = { w: 10, h: 10 };
    img.loaded = true;

    const msgs = buildSkillMessages(fakeManifest(), '', { context: reg, cwd: emptyTestCwd });
    const user = msgs[userIndex(msgs)]!;
    expect(user.role).toBe('user');
    expect(Array.isArray(user.content)).toBe(true);
    const blocks = user.content as Array<{ type: string }>;
    const kinds = blocks.map(b => b.type).sort();
    expect(kinds).toEqual(['image', 'text']);
  });

  test('with empty context: behaves as no-context (string user content)', () => {
    const reg = createContextRegistry();  // empty
    const msgs = buildSkillMessages(fakeManifest(), 'args', { context: reg, cwd: emptyTestCwd });
    expect(typeof msgs[userIndex(msgs)]!.content).toBe('string');
  });
});

// User message location depends on universal preamble shape (Wave 4
// added session-guidance gating). Tests use `userIndex(msgs)` instead
// of hardcoded indices.
describe('buildSkillMessages — priorConversation thread', () => {
  test('no priorConversation → no "Recent conversation" section', () => {
    const msgs = buildSkillMessages(fakeManifest(), 'do it', { cwd: emptyTestCwd });
    expect(msgs[userIndex(msgs)]!.content as string).not.toContain('Recent conversation');
  });

  test('empty priorConversation array → nothing emitted', () => {
    const msgs = buildSkillMessages(fakeManifest(), 'do it', { priorConversation: [], cwd: emptyTestCwd });
    expect(msgs[userIndex(msgs)]!.content as string).not.toContain('Recent conversation');
  });

  test('priorConversation → chronological role-labeled block ABOVE the skill body', () => {
    const msgs = buildSkillMessages(fakeManifest(), 'deploy that', {
      cwd: emptyTestCwd,
      priorConversation: [
        { role: 'user', text: '삼성전자 전망 분석해줘' },
        { role: 'assistant', text: '분석 결과: 3개월 Bullish, 목표가 250K' },
      ],
    });
    const body = msgs[userIndex(msgs)]!.content as string;
    expect(body).toContain('## Recent conversation');
    expect(body).toContain('### User');
    expect(body).toContain('삼성전자 전망 분석해줘');
    expect(body).toContain('### Assistant');
    expect(body).toContain('분석 결과');
    // Ordering invariant: recent-conversation precedes Arguments line.
    const recentIdx = body.indexOf('Recent conversation');
    const argsIdx = body.indexOf('Arguments: deploy that');
    expect(recentIdx).toBeGreaterThanOrEqual(0);
    expect(argsIdx).toBeGreaterThan(recentIdx);
  });

  test('priorConversation threads through context registry (text-only attachment)', () => {
    // With only text attachments (no images), buildMessagesWithContext
    // returns a plain-string user message — assert the priorConversation
    // survives that path intact (joined with the attachment sections).
    const reg = createContextRegistry();
    const att = addAttachment(reg, {
      kind: 'text', sourcePath: '/t/a.md', filename: 'a.md', sizeBytes: 4, mtime: 1,
    });
    att.text = 'body'; att.loaded = true;
    const msgs = buildSkillMessages(fakeManifest(), '', {
      cwd: emptyTestCwd,
      context: reg,
      priorConversation: [
        { role: 'assistant', text: 'prior turn here' },
      ],
    });
    const user = msgs[userIndex(msgs)]!;
    expect(typeof user.content).toBe('string');
    expect(user.content as string).toContain('Recent conversation');
    expect(user.content as string).toContain('prior turn here');
  });

  test('priorConversation threads through context registry (with image → ContentBlock[])', () => {
    // With an image attachment, buildMessagesWithContext returns
    // ContentBlock[]. The priorConversation block must still ride
    // inside the text block of that array.
    const reg = createContextRegistry();
    const img = addAttachment(reg, {
      kind: 'image', sourcePath: '/t/p.png', filename: 'p.png', sizeBytes: 1, mtime: 1,
    });
    img.base64 = 'AAAA'; img.mediaType = 'image/png'; img.loaded = true;
    const msgs = buildSkillMessages(fakeManifest(), '', {
      cwd: emptyTestCwd,
      context: reg,
      priorConversation: [{ role: 'user', text: 'earlier Q' }],
    });
    const user = msgs[userIndex(msgs)]!;
    expect(Array.isArray(user.content)).toBe(true);
    const blocks = user.content as Array<{ type: string; text?: string }>;
    const textBlock = blocks.find(b => b.type === 'text');
    expect(textBlock?.text ?? '').toContain('Recent conversation');
    expect(textBlock?.text ?? '').toContain('earlier Q');
  });
});
