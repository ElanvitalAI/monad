// ── Last selection persistence + Grok context + action parsing tests ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ── Test helpers: inline the persistence logic to avoid import side effects ──
const DATA_DIR = join(import.meta.dir, '..', 'data');
const LAST_SEL_PATH = join(DATA_DIR, 'last-selection.json');

interface LastSelection { skills: string[]; servers: string[]; services: string[]; mode: string; ts: string; }

function saveLastSelection(sel: LastSelection): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(LAST_SEL_PATH, JSON.stringify(sel, null, 2));
}

function loadLastSelection(): LastSelection | null {
  try {
    if (!existsSync(LAST_SEL_PATH)) return null;
    return JSON.parse(readFileSync(LAST_SEL_PATH, 'utf-8'));
  } catch { return null; }
}

// ── Inline buildContext for testing ──
interface DashboardContext {
  skill?: string;
  filePath?: string;
  fileContent?: string;
  mode: 'browse' | 'sync' | 'syncing';
  syncMode?: string;
  selectedSkills?: string[];
  selectedServers?: string[];
  selectedServices?: string[];
  recentStatus?: string[];
  lastSelection?: LastSelection | null;
}

// Mirrors src/chat.ts::buildContext (mode-gated since session 12 —
// sync-specific fields only emit in sync/syncing modes so that chat
// in browse mode doesn't leak action-block DSL into responses).
function buildContext(ctx: DashboardContext & { includeSyncDSL?: boolean }): string {
  const parts: string[] = [];
  const isSyncish = ctx.mode === 'sync' || ctx.mode === 'syncing';
  parts.push(`Dashboard mode: ${ctx.mode}`);
  if (ctx.skill) parts.push(`Current skill: ${ctx.skill}`);
  if (ctx.filePath) parts.push(`Selected file: ${ctx.filePath}`);
  if (isSyncish) {
    if (ctx.syncMode) parts.push(`Sync mode: ${ctx.syncMode}`);
    if (ctx.selectedSkills?.length) parts.push(`Selected skills: ${ctx.selectedSkills.join(', ')}`);
    if (ctx.selectedServers?.length) parts.push(`Selected servers: ${ctx.selectedServers.join(', ')}`);
    if (ctx.selectedServices?.length) parts.push(`Selected services: ${ctx.selectedServices.join(', ')}`);
    if (ctx.lastSelection) {
      const ls = ctx.lastSelection;
      parts.push(`\nLast selection (${ls.ts}): ${ls.skills.length} skills [${ls.skills.slice(0, 5).join(',')}${ls.skills.length > 5 ? '...' : ''}] → ${ls.servers.join(',')} × ${ls.services.join(',')} mode:${ls.mode}`);
    }
  }
  if (ctx.fileContent) {
    const preview = ctx.fileContent.slice(0, 3000);
    parts.push(`\nFile content (first 3000 chars):\n\`\`\`\n${preview}\n\`\`\``);
  }
  if (ctx.recentStatus?.length) {
    parts.push(`\nRecent status output:\n${ctx.recentStatus.join('\n')}`);
  }
  if (ctx.includeSyncDSL) {
    parts.push('\n```action\n{"select": ...}\n```');
  }
  return parts.join('\n');
}

// ── Action parser (same logic as dashboard.ts) ──
function parseAction(response: string): any | null {
  const match = response.match(/```action\s*\n([\s\S]*?)\n```/);
  if (!match) return null;
  try { return JSON.parse(match[1]!); } catch { return null; }
}

// Backup/restore last-selection.json
let backup: string | null = null;

beforeEach(() => {
  if (existsSync(LAST_SEL_PATH)) {
    backup = readFileSync(LAST_SEL_PATH, 'utf-8');
  } else {
    backup = null;
  }
});

afterEach(() => {
  if (backup !== null) {
    writeFileSync(LAST_SEL_PATH, backup);
  } else if (existsSync(LAST_SEL_PATH)) {
    unlinkSync(LAST_SEL_PATH);
  }
});

// ═══════════════════════════════════════════
// 1. Persistence tests
// ═══════════════════════════════════════════

describe('Last selection persistence', () => {
  test('saves and loads selection to JSON', () => {
    const sel: LastSelection = {
      skills: ['ast-grep', 'omni-crawl'],
      servers: ['node-b'],
      services: ['hermes', 'openclaw'],
      mode: 'diff',
      ts: '2026-04-14T00:00:00.000Z',
    };

    saveLastSelection(sel);
    const loaded = loadLastSelection();

    expect(loaded).not.toBeNull();
    expect(loaded!.skills).toEqual(['ast-grep', 'omni-crawl']);
    expect(loaded!.servers).toEqual(['node-b']);
    expect(loaded!.services).toEqual(['hermes', 'openclaw']);
    expect(loaded!.mode).toBe('diff');
  });

  test('returns null when no file exists', () => {
    if (existsSync(LAST_SEL_PATH)) unlinkSync(LAST_SEL_PATH);
    expect(loadLastSelection()).toBeNull();
  });

  test('overwrites previous selection', () => {
    saveLastSelection({ skills: ['a'], servers: ['s1'], services: ['v1'], mode: 'merge', ts: 't1' });
    saveLastSelection({ skills: ['b', 'c'], servers: ['s2'], services: ['v2'], mode: 'clean', ts: 't2' });

    const loaded = loadLastSelection();
    expect(loaded!.skills).toEqual(['b', 'c']);
    expect(loaded!.mode).toBe('clean');
  });

  test('JSON file is human-readable', () => {
    saveLastSelection({ skills: ['x'], servers: ['y'], services: ['z'], mode: 'smart', ts: 'now' });
    const raw = readFileSync(LAST_SEL_PATH, 'utf-8');
    expect(raw).toContain('"skills"');
    expect(raw).toContain('\n'); // pretty-printed
  });
});

// ═══════════════════════════════════════════
// 2. Context building tests
// ═══════════════════════════════════════════

describe('Grok context with lastSelection', () => {
  test('includes last selection in context string (sync mode)', () => {
    const ctx = buildContext({
      mode: 'sync',
      skill: 'ast-grep',
      lastSelection: {
        skills: ['ast-grep', 'omni-crawl'],
        servers: ['node-b'],
        services: ['hermes'],
        mode: 'diff',
        ts: '2026-04-14T00:00:00.000Z',
      },
    });

    expect(ctx).toContain('Last selection');
    expect(ctx).toContain('ast-grep,omni-crawl');
    expect(ctx).toContain('node-b');
    expect(ctx).toContain('hermes');
    expect(ctx).toContain('mode:diff');
  });

  // Regression — session 12 fix for bleed of sync DSL into unrelated chat.
  test('browse mode SUPPRESSES lastSelection even when present', () => {
    const ctx = buildContext({
      mode: 'browse',
      lastSelection: {
        skills: ['ast-grep'],
        servers: ['node-b'],
        services: ['hermes'],
        mode: 'diff',
        ts: '2026-04-14T00:00:00.000Z',
      },
    });
    expect(ctx).not.toContain('Last selection');
    expect(ctx).not.toContain('ast-grep');
  });

  test('browse mode SUPPRESSES selected skills/servers/services', () => {
    const ctx = buildContext({
      mode: 'browse',
      selectedSkills: ['a'],
      selectedServers: ['node-b'],
      selectedServices: ['hermes'],
      syncMode: 'Merge',
    });
    expect(ctx).not.toContain('Selected skills');
    expect(ctx).not.toContain('Selected servers');
    expect(ctx).not.toContain('Sync mode');
  });

  test('includeSyncDSL is the gate for the action-block DSL addendum', () => {
    const ctxOff = buildContext({ mode: 'sync' });
    expect(ctxOff).not.toContain('```action');
    const ctxOn = buildContext({ mode: 'sync', includeSyncDSL: true });
    expect(ctxOn).toContain('```action');
  });

  test('omits last selection when null', () => {
    const ctx = buildContext({ mode: 'browse', lastSelection: null });
    expect(ctx).not.toContain('Last selection');
  });

  test('includes current sync selections', () => {
    const ctx = buildContext({
      mode: 'sync',
      syncMode: 'Merge',
      selectedSkills: ['skill-a'],
      selectedServers: ['node-b', 'minio'],
      selectedServices: ['hermes'],
    });

    expect(ctx).toContain('Sync mode: Merge');
    expect(ctx).toContain('Selected skills: skill-a');
    expect(ctx).toContain('Selected servers: node-b, minio');
  });

  test('includes recent status output', () => {
    const ctx = buildContext({
      mode: 'browse',
      recentStatus: ['[1/2] node-b:hermes/ast-grep differs', '  + 3 local-only'],
    });

    expect(ctx).toContain('Recent status output');
    expect(ctx).toContain('node-b:hermes/ast-grep differs');
  });

  test('truncates skills list beyond 5 (sync mode)', () => {
    const ctx = buildContext({
      mode: 'sync',
      lastSelection: {
        skills: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        servers: ['s1'], services: ['v1'], mode: 'merge', ts: 'x',
      },
    });

    expect(ctx).toContain('7 skills');
    expect(ctx).toContain('a,b,c,d,e...');
  });
});

// ═══════════════════════════════════════════
// 3. Action parsing tests
// ═══════════════════════════════════════════

describe('Grok action block parsing', () => {
  test('parses select + mode + run action', () => {
    const response = `이전 설정으로 diff를 실행합니다.

\`\`\`action
{"select": {"skills": ["ast-grep"], "servers": ["node-b"], "services": ["hermes"]}, "mode": "diff", "run": "diff"}
\`\`\``;

    const action = parseAction(response);
    expect(action).not.toBeNull();
    expect(action.select.skills).toEqual(['ast-grep']);
    expect(action.select.servers).toEqual(['node-b']);
    expect(action.select.services).toEqual(['hermes']);
    expect(action.mode).toBe('diff');
    expect(action.run).toBe('diff');
  });

  test('parses select-all with wildcard', () => {
    const response = `\`\`\`action
{"select": {"skills": ["*"], "servers": ["node-b", "minio"], "services": ["hermes", "openclaw"]}, "mode": "merge", "run": "sync"}
\`\`\``;

    const action = parseAction(response);
    expect(action.select.skills).toEqual(['*']);
    expect(action.select.servers).toHaveLength(2);
  });

  test('parses select-only action (no run)', () => {
    const response = `설정만 적용합니다.

\`\`\`action
{"select": {"skills": ["omni-crawl"], "servers": ["node-b"], "services": ["hermes"]}, "mode": "smart"}
\`\`\``;

    const action = parseAction(response);
    expect(action).not.toBeNull();
    expect(action.run).toBeUndefined();
    expect(action.mode).toBe('smart');
  });

  test('returns null for response without action block', () => {
    const response = '이 스킬은 AST 기반 코드 검색 도구입니다. 별도 설정 없이도 사용 가능합니다.';
    expect(parseAction(response)).toBeNull();
  });

  test('returns null for malformed JSON', () => {
    const response = '```action\n{invalid json}\n```';
    expect(parseAction(response)).toBeNull();
  });

  test('handles modified last selection', () => {
    // Simulating: "이전 설정에서 서버만 minio로 바꿔서 sync 해줘"
    const response = `이전 설정에서 서버를 minio로 변경하여 sync합니다.

\`\`\`action
{"select": {"skills": ["ast-grep", "omni-crawl"], "servers": ["minio"], "services": ["hermes"]}, "mode": "merge", "run": "sync"}
\`\`\``;

    const action = parseAction(response);
    expect(action.select.servers).toEqual(['minio']); // changed from node-b
    expect(action.select.skills).toEqual(['ast-grep', 'omni-crawl']); // preserved
    expect(action.mode).toBe('merge'); // changed from diff
    expect(action.run).toBe('sync');
  });
});

// ═══════════════════════════════════════════
// 4. Action application simulation
// ═══════════════════════════════════════════

describe('Action application to dashboard state', () => {
  const ALL_SKILLS = ['ast-grep', 'omni-crawl', 'omni-digest', 'youtube-master'];
  const SERVERS = ['node-b', 'minio', 'node-c', 'mba', 'mbp'];
  const SERVICES = ['hermes', 'openclaw', 'opencode', 'codex'];
  const SYNC_MODES = [
    { id: 'clean', label: 'Clean' },
    { id: 'merge', label: 'Merge' },
    { id: 'smart', label: 'Smart' },
    { id: 'diff',  label: 'Diff' },
  ];

  // Simulate dashboard state
  function applyAction(action: any) {
    const state = {
      mode: 'browse' as string,
      syncModeIdx: 2,
      selected: [new Set<string>(), new Set<string>(), new Set<string>()],
      ran: null as string | null,
    };

    if (action.select) {
      state.mode = 'sync';

      if (action.select.skills) {
        state.selected[0]!.clear();
        const targets = action.select.skills[0] === '*' ? ALL_SKILLS : action.select.skills;
        for (const s of targets) {
          if (ALL_SKILLS.includes(s)) state.selected[0]!.add(s);
        }
      }
      if (action.select.servers) {
        state.selected[1]!.clear();
        for (const s of action.select.servers) state.selected[1]!.add(s);
      }
      if (action.select.services) {
        state.selected[2]!.clear();
        for (const s of action.select.services) state.selected[2]!.add(s);
      }
    }

    if (action.mode) {
      const idx = SYNC_MODES.findIndex(m => m.id === action.mode);
      if (idx >= 0) state.syncModeIdx = idx;
    }

    if (action.run && state.selected[0]!.size && state.selected[1]!.size && state.selected[2]!.size) {
      state.ran = action.run;
    }

    return state;
  }

  test('selects targets and switches mode', () => {
    const action = {
      select: { skills: ['ast-grep'], servers: ['node-b'], services: ['hermes'] },
      mode: 'diff',
    };

    const state = applyAction(action);
    expect(state.mode).toBe('sync');
    expect(state.selected[0]!.has('ast-grep')).toBe(true);
    expect(state.selected[1]!.has('node-b')).toBe(true);
    expect(state.selected[2]!.has('hermes')).toBe(true);
    expect(state.syncModeIdx).toBe(3); // diff
    expect(state.ran).toBeNull(); // no run
  });

  test('wildcard selects all skills', () => {
    const action = {
      select: { skills: ['*'], servers: ['node-b'], services: ['hermes'] },
      mode: 'merge',
    };

    const state = applyAction(action);
    expect(state.selected[0]!.size).toBe(ALL_SKILLS.length);
    expect(state.selected[0]!.has('youtube-master')).toBe(true);
  });

  test('auto-executes sync when run is specified', () => {
    const action = {
      select: { skills: ['ast-grep'], servers: ['node-b'], services: ['hermes'] },
      mode: 'merge',
      run: 'sync',
    };

    const state = applyAction(action);
    expect(state.ran).toBe('sync');
  });

  test('auto-executes diff when run is specified', () => {
    const action = {
      select: { skills: ['omni-crawl'], servers: ['minio'], services: ['openclaw'] },
      mode: 'diff',
      run: 'diff',
    };

    const state = applyAction(action);
    expect(state.ran).toBe('diff');
    expect(state.syncModeIdx).toBe(3);
  });

  test('does not run when selection is incomplete', () => {
    const action = {
      select: { skills: ['ast-grep'], servers: [], services: ['hermes'] },
      run: 'sync',
    };

    const state = applyAction(action);
    expect(state.ran).toBeNull(); // server empty → no run
  });

  test('ignores unknown skills', () => {
    const action = {
      select: { skills: ['nonexistent', 'ast-grep'], servers: ['node-b'], services: ['hermes'] },
    };

    const state = applyAction(action);
    expect(state.selected[0]!.size).toBe(1); // only ast-grep
    expect(state.selected[0]!.has('ast-grep')).toBe(true);
  });
});

// ═══════════════════════════════════════════
// 5. End-to-end scenario
// ═══════════════════════════════════════════

describe('E2E: save → context → action → apply', () => {
  test('full round-trip: diff → ask Grok → restore → run', () => {
    // Step 1: User runs diff manually, selection saved
    const manualSel: LastSelection = {
      skills: ['ast-grep', 'omni-crawl'],
      servers: ['node-b'],
      services: ['hermes'],
      mode: 'diff',
      ts: new Date().toISOString(),
    };
    saveLastSelection(manualSel);

    // Step 2: Context includes lastSelection when in sync mode
    // (browse mode suppresses it — see session-12 bleed fix).
    const loaded = loadLastSelection();
    const ctx = buildContext({
      mode: 'sync',
      skill: 'omni-digest',
      lastSelection: loaded,
    });
    expect(ctx).toContain('Last selection');
    expect(ctx).toContain('ast-grep,omni-crawl');

    // Step 3: Grok responds with action to restore + run
    const grokResponse = `지난번 설정으로 diff를 다시 실행합니다.

\`\`\`action
{"select": {"skills": ["ast-grep", "omni-crawl"], "servers": ["node-b"], "services": ["hermes"]}, "mode": "diff", "run": "diff"}
\`\`\``;

    const action = parseAction(grokResponse);
    expect(action).not.toBeNull();

    // Step 4: Apply action to dashboard state
    const ALL_SKILLS = ['ast-grep', 'omni-crawl', 'omni-digest'];
    const state = {
      selected: [new Set<string>(), new Set<string>(), new Set<string>()],
      syncModeIdx: 2,
      ran: null as string | null,
    };

    if (action.select?.skills) {
      const targets = action.select.skills[0] === '*' ? ALL_SKILLS : action.select.skills;
      for (const s of targets) state.selected[0]!.add(s);
    }
    if (action.select?.servers) for (const s of action.select.servers) state.selected[1]!.add(s);
    if (action.select?.services) for (const s of action.select.services) state.selected[2]!.add(s);
    if (action.mode === 'diff') state.syncModeIdx = 3;
    if (action.run && state.selected[0]!.size && state.selected[1]!.size && state.selected[2]!.size) {
      state.ran = action.run;
    }

    // Verify final state matches original manual selection
    expect([...state.selected[0]!]).toEqual(['ast-grep', 'omni-crawl']);
    expect([...state.selected[1]!]).toEqual(['node-b']);
    expect([...state.selected[2]!]).toEqual(['hermes']);
    expect(state.syncModeIdx).toBe(3); // diff
    expect(state.ran).toBe('diff'); // auto-executed
  });
});
