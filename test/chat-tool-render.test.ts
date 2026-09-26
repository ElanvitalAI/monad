import { describe, expect, test } from 'bun:test';
import chalk from 'chalk';
import { foldHint } from '../src/log-entry.js';
import { renderToolBlock } from '../src/chat/tool-render/block.js';
import {
  isToolRenderSupported,
  renderToolCallEvent,
  renderToolResultEvent,
  renderToolResultVariants,
} from '../src/chat/tool-render/index.js';
import type { ToolRenderModel } from '../src/chat/tool-render/types.js';

chalk.level = 1;

const inlineToBlock = {
  displayMode: 'inline-to-block' as const,
  blockMaxLines: 4,
};
const richInlineToBlock = {
  ...inlineToBlock,
  expandHint: true,
};

describe('tool renderer dispatch', () => {
  test('renders inline row for supported running tool', () => {
    const rows = renderToolCallEvent({
      id: 'call-1',
      name: 'Bash',
      args: { command: 'ls -la' },
    }, inlineToBlock);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toContain('Bash');
    expect(rows?.[0]).toContain('ls -la');
  });

  test('renders AstGrep and update_goal through the folded renderer', () => {
    expect(isToolRenderSupported('AstGrep')).toBe(true);
    expect(isToolRenderSupported('update_goal')).toBe(true);

    const astGrepCall = renderToolCallEvent({
      id: 'ast-grep-1',
      name: 'AstGrep',
      args: { pattern: 'console.log($$$)', lang: 'typescript', path: 'src', output_mode: 'summary' },
    }, inlineToBlock);
    const updateGoalCall = renderToolCallEvent({
      id: 'update-goal-1',
      name: 'update_goal',
      args: { status: 'complete', evidence: 'Focused renderer test passed' },
    }, inlineToBlock);
    const astGrepResult = renderToolResultEvent({
      id: 'ast-grep-1',
      name: 'AstGrep',
      args: { pattern: 'console.log($$$)', lang: 'typescript', path: 'src', output_mode: 'summary' },
      result: { output: 'Found 1 AST match\nsrc/log.ts:4:1: console.log(message)' },
    }, inlineToBlock);
    const updateGoalResult = renderToolResultEvent({
      id: 'update-goal-1',
      name: 'update_goal',
      args: { status: 'complete', evidence: 'Focused renderer test passed' },
      result: { output: 'Goal marked complete' },
    }, inlineToBlock);

    expect(astGrepCall?.[0]).toContain('AstGrep');
    expect(astGrepCall?.[0]).not.toContain('{"pattern"');
    expect(updateGoalCall?.[0]).toContain('UpdateGoal');
    expect(astGrepResult?.join('\n')).toContain('Found 1 AST match');
    expect(updateGoalResult?.join('\n')).toContain('Goal marked complete');
  });

  test('preserves the existing seven tool render paths', () => {
    const cases: Array<[string, Record<string, unknown>, unknown]> = [
      ['Grep', { pattern: 'needle', path: 'src' }, { output: 'src/a.ts:1: needle' }],
      ['Read', { file_path: '/tmp/a.ts' }, { output: '     1\tconst value = true;' }],
      ['Bash', { command: 'printf ok' }, { output: 'ok' }],
      ['Edit', { file_path: '/tmp/a.ts' }, { output: 'updated' }],
      ['Glob', { pattern: '**/*.ts', path: 'src' }, { output: 'src/a.ts' }],
      ['ListDir', { path: 'src' }, { output: 'a.ts' }],
      ['Write', { file_path: '/tmp/a.ts' }, { output: 'written' }],
    ];
    for (const [name, args, result] of cases) {
      expect(renderToolCallEvent({ id: `call-${name}`, name, args }, inlineToBlock)).not.toBeNull();
      expect(renderToolResultEvent({ id: `result-${name}`, name, args, result }, inlineToBlock)).not.toBeNull();
    }
  });

  test('renders inline rows for common discovery tools instead of raw fallback', () => {
    const globRows = renderToolCallEvent({
      id: 'glob-1',
      name: 'Glob',
      args: { pattern: '**/*debug*', path: '.', head_limit: 200 },
    }, inlineToBlock);
    const listDirRows = renderToolCallEvent({
      id: 'ls-1',
      name: 'ListDir',
      args: { path: 'src', sort: 'name' },
    }, inlineToBlock);
    const webRows = renderToolCallEvent({
      id: 'web-1',
      name: 'WebSearch',
      args: { query: 'monad-agent debug architecture', limit: 5 },
    }, inlineToBlock);
    expect(globRows?.[0]).toContain('Glob');
    expect(globRows?.[0]).toContain('**/*debug*');
    expect(listDirRows?.[0]).toContain('ListDir');
    expect(listDirRows?.[0]).toContain('src');
    expect(webRows?.[0]).toContain('WebSearch');
    expect(webRows?.[0]).toContain('monad-agent debug architecture');
  });

  test('summarizes broad structural shortlist calls more compactly while running', () => {
    const grepRows = renderToolCallEvent({
      id: 'grep-structural',
      name: 'Grep',
      args: { pattern: 'debug|trace|logger', path: '.', glob: 'src/**/*.{ts,tsx}', output_mode: 'files_with_matches' },
    }, inlineToBlock);
    expect(grepRows?.[0]).toContain('Grep(structural shortlist)');
    expect(grepRows?.[0]).not.toContain('src/**/*.{ts,tsx}');
  });

  test('renders block rows for supported completed tool', () => {
    const rows = renderToolResultEvent({
      id: 'call-1',
      name: 'Read',
      args: { file_path: '/tmp/a.ts', offset: 10 },
      result: { output: '     1\timport { ok } from "./x.js";\n     2\texport const value = true;' },
    }, inlineToBlock);
    expect(rows?.length).toBeGreaterThan(1);
    expect(rows?.join('\n')).toContain('Read');
    expect(rows?.join('\n')).toContain('/tmp/a.ts offset=10');
    expect(rows?.join('\n')).toContain('import');
    expect(rows?.join('\n')).toContain('\x1b[');
  });

  test('highlights auto-narrowed code previews inside grep results', () => {
    const rows = renderToolResultEvent({
      id: 'call-grep-read',
      name: 'Grep',
      args: { pattern: 'debug', path: 'src', output_mode: 'files_with_matches' },
      result: {
        output: [
          '[AUTO-NARROWED] Repeated candidate-listing search converted into Read(file_path="/tmp/debug-surface.ts").',
          '',
          '     1\timport { formatLine, type DebugEvent } from "../debug/log.js";',
          '     2\texport interface DebugSurfaceStatus {',
        ].join('\n'),
      },
    }, inlineToBlock);
    const text = rows?.join('\n') ?? '';
    // Phase 5 wraps abs paths in OSC 8 hyperlinks (\x1b]8;…\x1b\\).
    // Strip them for the assertion so we cover the actual label text.
    const sansOsc8 = text.replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
    expect(sansOsc8).toContain('read candidate selected: /tmp/debug-surface.ts');
    expect(text).toContain('formatLine');
    expect(text).toContain('\x1b[');
    expect(sansOsc8).toContain('Read(/tmp/debug-surface.ts) via auto-narrow');
    // Positive: the OSC 8 wrapper is actually present on the abs path.
    expect(text).toContain('\x1b]8;;file:///tmp/debug-surface.ts');
  });

  test('summarizes shortlist and blocked structural search results more compactly', () => {
    const shortlistRows = renderToolResultEvent({
      id: 'call-grep-shortlist',
      name: 'Grep',
      args: { pattern: 'debug', path: '.', glob: 'src/**/*.{ts,tsx}', output_mode: 'files_with_matches' },
      result: {
        output: [
          'Found 50+ files',
          '[Suggested next Read/Lsp candidates]',
          '- /tmp/debug/log.ts',
        ].join('\n'),
      },
    }, inlineToBlock);
    const blockedRows = renderToolResultEvent({
      id: 'call-grep-blocked',
      name: 'Grep',
      args: { pattern: 'debug', path: '.', glob: 'src/**/*.{ts,tsx}', output_mode: 'files_with_matches' },
      result: 'RUNTIME BLOCKED — repeated broad search loop detected',
    }, inlineToBlock);
    expect(shortlistRows?.join('\n')).toContain('Grep(structural shortlist)');
    expect(blockedRows?.join('\n')).toContain('Grep(narrowing blocked)');
  });

  test('renders structured blocks for run-shell and dashboard-state tools', () => {
    const runShellRows = renderToolResultEvent({
      id: 'shell-1',
      name: 'RunShell',
      args: { command: ['bun', 'test'], cwd: '/repo', mode: 'inline' },
      result: { output: 'ok\n2 passed' },
    }, inlineToBlock);
    const stateRows = renderToolResultEvent({
      id: 'state-1',
      name: 'GetDashboardState',
      args: {},
      result: { output: '{"panes":2,"tools":["Read","Grep"]}' },
    }, inlineToBlock);
    expect(runShellRows?.join('\n')).toContain('RunShell');
    expect(runShellRows?.join('\n')).toContain('bun test');
    expect(runShellRows?.join('\n')).toContain('2 passed');
    expect(stateRows?.join('\n')).toContain('GetDashboardState');
    expect(stateRows?.join('\n')).toContain('current dashboard snapshot');
  });

  test('renders synthetic guard tool results as compact summaries', () => {
    const explorationRows = renderToolResultEvent({
      id: 'guard-1',
      name: 'Read',
      args: { file_path: 'src/debug/log.ts' },
      result: '===== EXPLORATION BUDGET EXHAUSTED =====\nStop gathering more files.\n========================================',
    }, inlineToBlock);
    const inspectRows = renderToolResultEvent({
      id: 'guard-1b',
      name: 'Read',
      args: { file_path: 'src/debug/call-stack.ts' },
      result: 'INSPECT BUDGET EXHAUSTED — already inspected 2 candidate file(s). Stop gathering more files and synthesize the structure you found from the inspected files.',
    }, inlineToBlock);
    const runtimeRows = renderToolResultEvent({
      id: 'guard-2',
      name: 'Grep',
      args: { pattern: 'debug', path: 'src' },
      result: 'RUNTIME BLOCKED — repeated broad search loop detected',
    }, inlineToBlock);
    expect(explorationRows?.join('\n')).toContain('search budget exhausted');
    expect(explorationRows?.join('\n')).not.toContain('Stop gathering more files');
    expect(inspectRows?.join('\n')).toContain('inspect budget exhausted');
    expect(runtimeRows?.join('\n')).toContain('reuse current candidates');
    expect(runtimeRows?.join('\n')).not.toContain('runtime blocked');
  });

  test('preserves persisted output reference when block body is truncated', () => {
    const rows = renderToolResultEvent({
      id: 'call-1',
      name: 'Grep',
      args: { pattern: 'foo', path: '/repo' },
      result: {
        output: [
          'a',
          'b',
          'c',
          'd',
          '... Full output saved to `/tmp/tool-results/foo.txt`. Read with offset/limit or Grep against that path.',
        ].join('\n'),
      },
    }, richInlineToBlock);
    const text = rows?.join('\n') ?? '';
    expect(text).toContain('Full output saved to');
    expect(text).toContain('press f to expand');
  });

  test('listing tools fold more aggressively inside one thread', () => {
    const rows = renderToolResultEvent({
      id: 'call-glob',
      name: 'Glob',
      args: { pattern: '**/*debug*', path: '/repo' },
      result: {
        output: [
          '12 files matched "**/*debug*"',
          '',
          '/repo/a.ts',
          '/repo/b.ts',
          '/repo/c.ts',
          '/repo/d.ts',
          '/repo/e.ts',
          '/repo/f.ts',
          '/repo/g.ts',
          '/repo/h.ts',
          '/repo/i.ts',
          '... Full output saved to `/tmp/tool-results/glob.txt`. Read with offset/limit or Grep against that path.',
        ].join('\n'),
      },
    }, {
      displayMode: 'inline-to-block',
      blockMaxLines: 20,
      expandHint: true,
    });
    const text = rows?.join('\n') ?? '';
    expect(text).toContain('press f to expand');
    expect(text).toContain('Full output saved to');
    expect(text).not.toContain('/repo/i.ts');
  });

  test('shows deterministic result summaries only in collapsed headers', () => {
    const edit = renderToolResultVariants({
      id: 'collapsed-edit',
      name: 'Edit',
      args: { file_path: '/tmp/a.ts' },
      result: {
        edit: {
          ok: true,
          file_path: '/tmp/a.ts',
          structuredPatch: [],
          originalContent: 'a\n',
          newContent: 'aa\n',
          edits: [],
          linesAdded: 2,
          linesRemoved: 1,
        },
      },
    }, { ...inlineToBlock, blockMaxLines: 1 });
    const read = renderToolResultVariants({
      id: 'collapsed-read',
      name: 'Read',
      args: { file_path: '/tmp/a.ts' },
      result: { output: '     1\tfirst\n     2\tsecond' },
    }, { ...inlineToBlock, blockMaxLines: 1 });
    const bash = renderToolResultVariants({
      id: 'collapsed-bash',
      name: 'Bash',
      args: { command: 'bun test test/chat-tool-render.test.ts' },
      result: { output: 'one\ntwo' },
    }, { ...inlineToBlock, blockMaxLines: 1 });

    expect(edit?.collapsed[0]).toContain('1 file changed (+2 / -1)');
    expect(edit?.expanded?.[0]).not.toContain('1 file changed');
    expect(read?.collapsed[0]).toContain('2 lines read');
    expect(read?.expanded?.[0]).not.toContain('2 lines read');
    expect(bash?.collapsed[0]).toContain('bun test test/chat-tool-render.test.ts');
  });

  test('does not describe failed Edit or Write results as changed files', () => {
    const failedEdit = renderToolResultVariants({
      id: 'failed-edit',
      name: 'Edit',
      args: { file_path: '/tmp/missing.ts' },
      result: {
        error: 'Edit failed: file not found',
        edit: {
          ok: false,
          file_path: '/tmp/missing.ts',
          structuredPatch: [],
          originalContent: '',
          newContent: '',
          edits: [],
          linesAdded: 1,
          linesRemoved: 0,
        },
      },
    }, { ...inlineToBlock, blockMaxLines: 1 });
    const failedWrite = renderToolResultVariants({
      id: 'failed-write',
      name: 'Write',
      args: { file_path: '/tmp/protected.ts' },
      result: {
        edit: {
          ok: false,
          file_path: '/tmp/protected.ts',
          structuredPatch: [],
          originalContent: '',
          newContent: 'new content\n',
          edits: [],
          linesAdded: 1,
          linesRemoved: 0,
        },
      },
    }, { ...inlineToBlock, blockMaxLines: 1 });

    expect(failedEdit?.collapsed[0]).not.toContain('1 file changed');
    expect(failedWrite?.collapsed[0]).not.toContain('1 file changed');
  });

  test('does not describe failed Read error lines as lines read', () => {
    const variants = renderToolResultVariants({
      id: 'failed-read',
      name: 'Read',
      args: { file_path: '/tmp/missing.ts' },
      result: { error: 'ENOENT: no such file\n/tmp/missing.ts' },
    }, { ...inlineToBlock, blockMaxLines: 1 });

    expect(variants?.collapsed[0]).not.toContain('2 lines read');
    expect(variants?.collapsed[0]).toBe(variants?.expanded?.[0]);
  });

  test('leaves collapsed headers unchanged when no result summary is derivable', () => {
    // ⚠️ 예시 툴을 `Agent` → `GetDashboardState` 로 바꿨다(2026-08-03 · `U-1c` 커버리지 확대).
    //   ⭐ **이 테스트의 의도는 그대로다** — *"요약을 못 뽑으면 머리글을 안 바꾼다"*.
    //   다만 `Agent` 는 이제 *"N lines returned"* 를 뽑을 수 있게 됐으므로 더 이상
    //   *"못 뽑는 툴"* 의 예시가 아니다. `GetDashboardState` 는 **의도적으로** undefined 를
    //   돌려준다(크기를 말하는 것이 뜻이 없다 · `dispatch.ts` 원칙 ⑵ "모르면 지어내지 않는다").
    const variants = renderToolResultVariants({
      id: 'collapsed-no-summary',
      name: 'GetDashboardState',
      args: {},
      result: { output: 'one\ntwo' },
    }, { ...inlineToBlock, blockMaxLines: 1 });

    expect(variants?.collapsed[0]).toBe(variants?.expanded?.[0]);
  });

  test('renders compact edit/write body without duplicating full diff rows', () => {
    const rows = renderToolResultEvent({
      id: 'call-edit',
      name: 'Edit',
      args: { file_path: '/tmp/a.ts' },
      result: {
        output: 'Update(/tmp/a.ts) — +2 / -1',
        edit: {
          ok: true,
          file_path: '/tmp/a.ts',
          structuredPatch: [],
          originalContent: 'a\n',
          newContent: 'aa\n',
          edits: [],
          linesAdded: 2,
          linesRemoved: 1,
        },
      },
    }, inlineToBlock);
    const text = rows?.join('\n') ?? '';
    expect(text).toContain('Edit');
    expect(text).toContain('/tmp/a.ts');
    expect(text).toContain('delta +2 / -1');
    expect(text).not.toContain('Added 2 lines');
  });

  test('renders update_plan using the plan board rows', () => {
    const rows = renderToolResultEvent({
      id: 'call-plan',
      name: 'update_plan',
      args: {
        plan: [
          { step: 'Inventory hot path', status: 'completed' },
          { step: 'Extract seam', status: 'in_progress' },
        ],
      },
      result: {
        output: 'update_plan: 1/2 complete — now: "Extract seam"',
        state: {
          steps: [
            { step: 'Inventory hot path', status: 'completed' },
            { step: 'Extract seam', status: 'in_progress' },
          ],
          updatedAt: Date.now(),
          version: 2,
          lastExplanation: 'split rendering seam',
        },
      },
    }, inlineToBlock);
    const text = rows?.join('\n') ?? '';
    expect(text).toContain('UpdatePlan');
    expect(text).toContain('Plan');
    expect(text).toContain('Inventory hot path');
    expect(text).toContain('Extract seam');
  });

  test('renders agent tool result with compact foreground metadata', () => {
    const rows = renderToolResultEvent({
      id: 'call-agent',
      name: 'Agent',
      args: { description: 'Investigate renderer flicker' },
      result: {
        output: 'Found the hot path.',
        agent: 'worker',
        durationMs: 65_000,
        taskId: '1c1ca753-32e1-4030',
        cwd: '/very/long/path',
      },
    }, inlineToBlock);
    const text = rows?.join('\n') ?? '';
    const bodyLines = (rows ?? [])
      .slice(1)
      .map((line) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/^\s*⎿\s*/, '').trim());

    expect(text).toContain('Agent');
    expect(bodyLines).toEqual(['Found the hot path.', 'done · worker · 1m 5s']);
    expect(text).not.toContain('cwd:');
    expect(text).not.toContain('/very/long/path');
    expect(text).not.toContain('taskId:');
    expect(text).not.toContain('task 1c1ca753');
  });

  test('suppresses a background agent placeholder in favor of compact metadata', () => {
    const taskId = '1cb8b805-9ecb-4d12-989e-26d95b59afd4';
    const rows = renderToolResultEvent({
      id: 'call-agent-background',
      name: 'Agent',
      args: { description: 'Investigate renderer flicker' },
      result: {
        output: `(running in background — taskId=${taskId})`,
        agent: 'general-purpose',
        durationMs: 0,
        taskId,
        background: true,
      },
    }, inlineToBlock);
    const text = rows?.join('\n') ?? '';

    expect(text).toContain('background · general-purpose · task 1cb8b805');
    expect(text).not.toContain('0s');
    expect(text).not.toContain('running in background — taskId=');
  });

  test('preserves custom background agent output without duration metadata', () => {
    const rows = renderToolResultEvent({
      id: 'call-agent-background-custom-output',
      name: 'Agent',
      args: { description: 'Investigate renderer flicker' },
      result: {
        output: 'queued with extra note',
        agent: 'general-purpose',
        durationMs: 0,
        taskId: '1cb8b805-9ecb-4d12-989e-26d95b59afd4',
        background: true,
      },
    }, inlineToBlock);
    const text = rows?.join('\n') ?? '';

    expect(text).toContain('queued with extra note');
    expect(text).toContain('background · general-purpose · task 1cb8b805');
    expect(text).not.toContain('0s');
  });

  test.each([
    '(running in background — taskId=1cb8b805-9ecb-4d12-989e-26d95b59afd4\nqueued with extra note)',
    '(running in background — taskId=1cb8b805-9ecb-4d12-989e-26d95b59afd4\r\nqueued with extra note)',
  ])('preserves multiline background output containing a placeholder', (output) => {
    const rows = renderToolResultEvent({
      id: 'call-agent-background-multiline-output',
      name: 'Agent',
      args: { description: 'Investigate renderer flicker' },
      result: {
        output,
        agent: 'general-purpose',
        durationMs: 0,
        taskId: '1cb8b805-9ecb-4d12-989e-26d95b59afd4',
        background: true,
      },
    }, inlineToBlock);
    const text = rows?.join('\n') ?? '';

    expect(text).toContain('running in background — taskId=1cb8b805-9ecb-4d12-989e-26d95b59afd4');
    expect(text).toContain('queued with extra note');
    expect(text).toContain('background · general-purpose · task 1cb8b805');
    expect(text).not.toContain('0s');
  });

  test('preserves a string agent result before its status metadata', () => {
    const rows = renderToolResultEvent({
      id: 'call-agent-string-result',
      name: 'Agent',
      args: { description: 'Investigate renderer flicker' },
      result: 'Fallback agent output.',
    }, inlineToBlock);
    const bodyLines = (rows?.join('\n') ?? '').split('\n').map((line) => line.trim());

    expect(bodyLines.some((line) => line.includes('Fallback agent output.'))).toBe(true);
    expect(bodyLines.filter((line) => line === 'done')).toHaveLength(1);
  });

  test('renders one status line for an empty background agent result', () => {
    const rows = renderToolResultEvent({
      id: 'call-agent-empty-background',
      name: 'Agent',
      args: { description: 'Investigate renderer flicker' },
      result: { output: '', background: true },
    }, inlineToBlock);
    const text = rows?.join('\n') ?? '';
    const bodyLines = text.split('\n').map((line) => line.trim());

    expect(text).toContain('background');
    expect(bodyLines.filter((line) => line.endsWith('background'))).toHaveLength(1);
    expect(text).not.toContain('(no output)');
  });

  test('preserves empty non-Agent result header behavior', () => {
    const rows = renderToolResultVariants({
      id: 'empty-bash-result',
      name: 'Bash',
      args: { command: 'true' },
      result: { output: '' },
    }, { ...inlineToBlock, blockMaxLines: 0 });

    expect(rows?.collapsed[0]).not.toMatch(/— \d+ lines? output/);
  });

  test('exposes expanded variants when a block is truncated', () => {
    const variants = renderToolResultVariants({
      id: 'call-grep',
      name: 'Grep',
      args: { pattern: 'foo', path: '/repo' },
      result: {
        output: ['1', '2', '3', '4', '5', '6'].join('\n'),
      },
    }, richInlineToBlock);
    expect(variants?.expanded).not.toBeNull();
    expect(variants?.collapsed.join('\n')).toContain('press f to expand');
    expect(variants?.expanded?.join('\n')).not.toContain('press f to expand');
  });

  test('legacy mode returns null and leaves caller on fallback path', () => {
    const rows = renderToolCallEvent({
      id: 'call-1',
      name: 'Bash',
      args: { command: 'pwd' },
    }, {
      displayMode: 'legacy',
      blockMaxLines: 20,
    });
    expect(rows).toBeNull();
  });

  test('task-unit fold mode collapses a multi-line body to the foldHint while expanded stays unlimited', () => {
    const call = {
      id: 'fold-task-unit',
      name: 'Bash',
      args: { command: 'ls -la src/session' },
      result: { output: ['total 640', 'drwxr-xr-x@ a', 'drwxr-xr-x@ b', '-rw-r--r--@ c'].join('\n') },
    };
    const variants = renderToolResultVariants(call, {
      ...inlineToBlock,
      blockMaxLines: 8,
      foldMode: 'task-unit',
    });
    const collapsed = variants?.collapsed.join('\n') ?? '';
    const expanded = variants?.expanded?.join('\n') ?? '';

    expect(collapsed).toContain(foldHint('line', 4));
    expect(collapsed).not.toContain('total 640');
    expect(collapsed).not.toContain('drwxr-xr-x@ a');
    expect(expanded).not.toContain('press f to expand');
    expect(expanded).toContain('total 640');
    expect(expanded).toContain('-rw-r--r--@ c');
  });

  test('omitting foldMode keeps the existing line-budget truncation', () => {
    const call = {
      id: 'fold-default-line',
      name: 'Bash',
      args: { command: 'printf' },
      result: { output: ['1', '2', '3', '4', '5', '6'].join('\n') },
    };
    const omitted = renderToolResultVariants(call, inlineToBlock);
    const explicitLine = renderToolResultVariants(call, { ...inlineToBlock, foldMode: 'line' });

    expect(omitted?.collapsed).toEqual(explicitLine?.collapsed);
    expect(omitted?.collapsed.join('\n')).toContain(foldHint('line', 3));
    expect(omitted?.collapsed.join('\n')).toContain('1');
    expect(omitted?.expanded?.join('\n')).not.toContain('press f to expand');
  });
});

describe('tool block foldMode', () => {
  const model = (bodyLines: string[]): ToolRenderModel => ({
    kind: 'Bash',
    status: 'success',
    summary: 'ls -la',
    bodyLines,
  });

  test('task-unit mode with a finite budget folds a multi-line body as one unit', () => {
    const rows = renderToolBlock(model(['alpha-body', 'beta-body', 'gamma-body']), 8, 'task-unit');
    const text = rows.join('\n');
    expect(text).toContain(foldHint('line', 3));
    expect(text).not.toContain('alpha-body');
    expect(text).not.toContain('beta-body');
    expect(text).not.toContain('gamma-body');
  });

  test('task-unit mode emits no fold marker for empty or one-line bodies', () => {
    const empty = renderToolBlock(model([]), 8, 'task-unit').join('\n');
    const oneLine = renderToolBlock(model(['only line']), 8, 'task-unit').join('\n');
    expect(empty).not.toContain('press f to expand');
    expect(oneLine).not.toContain('press f to expand');
    expect(oneLine).toContain('only line');
  });

  test('default foldMode is line and unlimited expanded rendering ignores task-unit', () => {
    const lines = ['a', 'b', 'c', 'd', 'e'];
    const defaulted = renderToolBlock(model(lines), 3);
    const explicit = renderToolBlock(model(lines), 3, 'line');
    const expanded = renderToolBlock(model(lines), Number.POSITIVE_INFINITY, 'task-unit');

    expect(defaulted).toEqual(explicit);
    expect(defaulted.join('\n')).toContain(foldHint('line', 3));
    expect(expanded.join('\n')).not.toContain('press f to expand');
    expect(expanded.join('\n')).toContain('e');
  });

  test('rich expandHint keeps the exact press-f wording; essential/unknown omit only that suffix', () => {
    const lines = ['a', 'b', 'c', 'd', 'e'];
    const rich = renderToolBlock(model(lines), 3, 'line', true).join('\n');
    const essential = renderToolBlock(model(lines), 3, 'line', false).join('\n');
    const unknown = renderToolBlock(model(lines), 3).join('\n');
    const exact = foldHint('line', 3, { expandHint: true });

    expect(rich).toContain(exact);
    expect(rich).toContain('press f to expand');
    expect(essential).toContain(foldHint('line', 3));
    expect(essential).not.toContain('press f');
    expect(essential).toContain('3 more lines folded');
    expect(unknown).toBe(essential);
    expect(unknown).not.toContain('press f');
  });
});

// ⭐⭐⭐ `U-1c` — 접힌 머리글에 **뜻**이 실린다 (대표 §5 회신 = ⓒ · 2026-08-03)
//
// ⛔ RFC 초판은 *"머리글에 요약이 **없다**"* 로 적었으나 **틀렸다** — 합성은 `block.ts` 에 이미 있었고
//   진짜 결손은 ***생산자가 `Edit`·`Write`·`Read` 셋만 채우는 것***이었다(RFC §0a A · 재측정 2026-08-03).
//   ⇒ 이 테스트가 무는 것은 "요약 기능이 있나" 가 아니라 ***"11종에도 닿았나"*** 다.
// ⚠️ 머리글 요약은 **접혔을 때만** 붙는다(`isCollapsed`) — 그래서 본문을 예산보다 길게 준다.
describe('U-1c — 접힌 머리글 요약 커버리지', () => {
  // ⚠️ 머리글 요약은 **접혔을 때만** 붙으므로 예산을 1로 줘서 반드시 접히게 한다
  //   (초판은 기본 예산 4를 써서 본문이 짧은 툴이 안 접혀 거짓 실패를 냈다).
  const collapsedHeader = (name: string, result: unknown, args: Record<string, unknown> = {}): string => {
    const rows = renderToolResultVariants(
      { id: `c-${name}`, name, args, result } as never,
      { ...inlineToBlock, blockMaxLines: 1 },
    );
    return rows?.collapsed?.[0] ?? '';
  };
  const many = (n: number, prefix = 'line'): string => Array.from({ length: n }, (_, i) => `${prefix} ${i}`).join('\n');
  // ⭐ 각 툴의 **실제 결과 스키마**로 준다(무인 리뷰 must-fix) — 공통 `{output: 줄문자열}` 만 주면
  //   *"본문 한 줄 = 한 항목"* 이라는 이 요약의 핵심 가정을 검증하지 못한다.
  const files = (n: number): string => Array.from({ length: n }, (_, i) => `src/mod-${i}.ts`).join('\n');

  test('목록형 — Grep·Glob·ListDir·WebSearch 가 건수를 말한다 (한 줄 = 한 항목)', () => {
    const cases: Array<[string, Record<string, unknown>, unknown]> = [
      ['Grep', { pattern: 'debug', path: 'src', output_mode: 'files_with_matches' }, { output: files(12) }],
      ['Glob', { pattern: 'src/**/*.ts' }, { output: files(12) }],
      ['ListDir', { path: 'src' }, { output: files(12) }],
      ['WebSearch', { query: 'bun test' }, { output: many(12, 'https://example.com/r') }],
    ];
    for (const [name, args, result] of cases) {
      expect(collapsedHeader(name, result, args)).toContain('12 results');
    }
  });

  test('출력형 — Bash·RunShell 은 줄 수, WebFetch 는 fetched, Lsp 는 줄 수', () => {
    expect(collapsedHeader('Bash', { output: many(9) }, { command: 'ls -la' })).toContain('9 lines output');
    expect(collapsedHeader('RunShell', { output: many(9) }, { argv: ['ls', '-la'] })).toContain('9 lines output');
    expect(collapsedHeader('WebFetch', { output: many(9) }, { url: 'https://example.com' })).toContain('9 lines fetched');
    expect(collapsedHeader('Lsp', { output: many(9) }, { file_path: '/tmp/a.ts' })).toContain('9 lines');
  });

  test('Agent 는 돌려준 줄 수를 말한다', () => {
    expect(collapsedHeader('Agent', { output: many(7) }, { description: 'Inspect' })).toContain('8 lines returned');
  });

  test('UpdatePlan 은 완료/전체를 말한다 (실제 result.plan 스키마)', () => {
    const plan = [
      { step: 'a', status: 'completed' },
      { step: 'b', status: 'completed' },
      { step: 'c', status: 'in_progress' },
      { step: 'd', status: 'pending' },
      { step: 'e', status: 'pending' },
    ];
    // ⭐ `output` 을 **주지 않는다** — 이 툴이 `plan` 을 보므로 output 가드 밖이라는 것이 핵심 조건이고,
    //   `output` 을 넣으면 그 조건이 검증되지 않는다(무인 리뷰 must-fix).
    const header = collapsedHeader('UpdatePlan', { plan, state: { steps: plan } }, { plan });
    expect(header).toContain('2/5 done');
  });

  test('단수는 단수로 말한다 (1 result 가 1 results 가 되지 않는다) — 조건부 아님', () => {
    // ⛔ 초판은 `if (header.includes('result'))` 로 감싸 **요약이 아예 없어도 통과**했다(Goodhart).
    //   ⇒ 요약이 **있다**는 것과 **단수**라는 것을 둘 다 무조건 단언한다.
    //   ⚠️ 1줄은 예산 1에서 안 접히므로 2줄을 주고 `2 results` 로 복수를, 별도로 단수를 잰다.
    expect(collapsedHeader('Grep', { output: files(2) }, { pattern: 'x' })).toContain('2 results');
    // 단수 경로 — 예산 0 이면 1줄도 접힌다.
    const one = renderToolResultVariants(
      { id: 'c-one', name: 'Grep', args: { pattern: 'x' }, result: { output: files(1) } } as never,
      { ...inlineToBlock, blockMaxLines: 0 },
    );
    expect(one?.collapsed?.[0] ?? '').toContain('1 result');
    expect(one?.collapsed?.[0] ?? '').not.toContain('1 results');
  });

  test('⛔ 종전 세 종(Edit·Write·Read)은 그대로다 — 넓히면서 깨지 않았다', () => {
    expect(collapsedHeader('Read', { output: many(30) }, { file_path: '/tmp/a.ts' })).toContain('30 lines read');
    // ⭐ `Edit`/`Write` 는 **완전한 `isEditResult` 스키마**(`structuredPatch`·`newContent` 포함)를 줘야
    //   본문이 `edited <path>` / `delta +N / -M` 두 줄이 되어 예산 1에서 접힌다.
    //   ⚠️ 스키마가 불완전하면 일반 경로로 떨어져 한 줄이 되고 **안 접힌다** — 내가 그 프로브로
    //     *"죽은 코드"* 라고 잘못 단정했다(2026-08-03 · PR 코멘트로 철회). 조건부 없이 단언한다.
    for (const kind of ['Edit', 'Write']) {
      const header = collapsedHeader(
        kind,
        {
          edit: {
            ok: true, file_path: '/tmp/a.ts', structuredPatch: [],
            originalContent: 'x', newContent: 'y', linesAdded: 4, linesRemoved: 2,
          },
        },
        { file_path: '/tmp/a.ts' },
      );
      expect(header).toContain('1 file changed (+4 / -2)');
    }
  });

  test('⛔ 모르면 지어내지 않는다 — GetDashboardState 는 요약을 안 붙인다', () => {
    const header = collapsedHeader('GetDashboardState', { output: many(20) });
    expect(header).not.toMatch(/\d+ (lines|results)/);
  });

  test('⛔⭐ 아무것도 없으면 「1건」이라고 지어내지 않는다 (실측으로 잡은 결함)', () => {
    // ⚠️ 실측: 결과가 `{}`·`null`·`{output:''}` 여도 `bodyLines` 는 **빈 줄 1개**라
    //   초판은 머리글에 "1 result" 를 찍었다. 아무것도 없는데 1건이라고 말한 것이다.
    // ⚠️ 예산 1이면 1줄짜리 본문이 **안 접혀** 이 결함이 가려진다 ⇒ 예산 0으로 반드시 접히게 한다.
    const header0 = (name: string, result: unknown): string => {
      const rows = renderToolResultVariants(
        { id: `e-${name}`, name, args: {}, result } as never,
        { ...inlineToBlock, blockMaxLines: 0 },
      );
      return rows?.collapsed?.[0] ?? '';
    };
    for (const name of ['Grep', 'Glob', 'ListDir', 'WebSearch', 'Bash', 'RunShell', 'WebFetch', 'Lsp', 'Agent', 'Read']) {
      for (const result of [{ output: '' }, {}, null]) {
        // 요약은 머리글에 ` — <요약>` 로 붙는다. 접미 위치로 문다(낱말만 물면 인자 렌더가 걸린다).
        expect(header0(name, result)).not.toMatch(/— \d+ (result|line)/);
      }
    }
  });

  test('⛔⭐ 단위가 다르다 — 항목 수는 빈 줄을 빼고, 줄 수는 빈 줄도 센다', () => {
    // ⚠️ 무인 리뷰 must-fix: 초판은 공백 필터를 **모든 툴**에 써서 `a\n\nb` 를 "2 lines" 로
    //   **축소 보고**했다. 줄 수 툴에서 빈 줄은 엄연히 줄이다.
    const mixed = 'a.ts\n\nb.ts';   // 비공백 2 · 전체 3줄 (기대값이 명확한 입력)
    const head = (name: string): string => {
      const rows = renderToolResultVariants(
        { id: `u-${name}`, name, args: {}, result: { output: mixed } } as never,
        { ...inlineToBlock, blockMaxLines: 0 },
      );
      return rows?.collapsed?.[0] ?? '';
    };
    // 항목 수 툴 — 빈 줄은 항목이 아니다.
    for (const name of ['Grep', 'Glob', 'ListDir', 'WebSearch']) {
      expect(head(name)).toContain('2 results');
    }
    // 줄 수 툴 — 빈 줄도 줄이므로 정확히 3이며, Agent는 단일 메타 줄까지 포함해 4이다.
    for (const name of ['Read', 'Bash', 'RunShell', 'WebFetch', 'Lsp']) {
      expect(head(name)).toMatch(/— 3 lines/);
    }
    expect(head('Agent')).toMatch(/— 4 lines/);
  });

  test('⛔ 에러 본문은 요약이 가리지 않는다 (출력 가드가 아니라 error 분기가 막는다)', () => {
    // ⚠️ 초판은 `output` 을 안 줘서 **출력 가드만으로** 통과했다 — `status === 'error'` 분기를
    //   지워도 성공하는 헛도는 테스트였다(무인 리뷰 must-fix).
    //   ⇒ `error` 와 문자열 `output` 을 **함께** 줘서 에러 억제 계약 자체를 문다.
    const header = collapsedHeader(
      'Bash',
      { error: many(20, 'boom'), output: many(20) },
      { command: 'false' },
    );
    // ⭐ 양성 단언도 같이 — 머리글이 아예 안 그려져도 위 부정 단언은 통과한다(무인 리뷰 should-fix).
    expect(header).toContain('Bash');
    expect(header.trim().length).toBeGreaterThan(0);
    expect(header).not.toMatch(/— \d+ lines? output/);
  });
});

describe('kind-unit fold mode — kind-unit reuses the task-unit body fold', () => {
  const readCall = {
    id: 'read-kind',
    name: 'Read',
    args: { file_path: '/tmp/a.ts' },
    result: { output: Array.from({ length: 8 }, (_, i) => `line ${i}`).join('\n') },
  };

  test('kind-unit emits operationKind; line and task-unit omit it', () => {
    const line = renderToolResultVariants(readCall, { ...inlineToBlock, foldMode: 'line' });
    const task = renderToolResultVariants(readCall, { ...inlineToBlock, foldMode: 'task-unit' });
    const kind = renderToolResultVariants(readCall, { ...inlineToBlock, foldMode: 'kind-unit' });
    const unspecified = renderToolResultVariants(readCall, inlineToBlock);

    expect(line?.collapsed).toEqual(unspecified?.collapsed);
    expect(line?.expanded).toEqual(unspecified?.expanded);
    expect(line?.operationKind).toBeUndefined();
    expect(task?.operationKind).toBeUndefined();
    expect(kind?.operationKind).toBe('Read');
    expect(kind?.collapsed).toEqual(task?.collapsed);
    expect(task?.collapsed).not.toEqual(unspecified?.collapsed);
  });
});
