import { C, ICONS, termSize } from '../tui.js';
import {
  FIGURES, applyColor, toolHeader, toolResult,
  successLine, warningLine, progressIndicator,
} from '../render.js';
import type { DiffResult } from '../types.js';

interface RunDiffInlineLastSelection {
  skills: string[];
  servers: string[];
  services: string[];
  mode: string;
  ts: string;
}

interface RunDiffInlineSyncState {
  selected: Record<number, Set<string>>;
  cursors: Record<number, number>;
  offsets: Record<number, number>;
  focus: 0 | 1 | 2;
}

interface RunDiffInlinePluginHost {
  active(): { state: unknown } | null;
}

export interface RunDiffInlineDeps {
  chatLines: string[];
  sync: RunDiffInlineSyncState;
  pluginHost: RunDiffInlinePluginHost;
  /** Reset chat scroll to the latest line and redraw. */
  scrollChatToLatestAndDraw: () => void;
  saveLastSelection: (sel: RunDiffInlineLastSelection) => void;
  computeDiff: (skillName: string, server: string, service: string) => Promise<DiffResult>;
  summarizeDiff: (diff: DiffResult) => Promise<string>;
  isAnalyzerAvailable: () => boolean;
}

type RunDiffInline = (
  skills?: string[],
  servers?: string[],
  services?: string[],
) => Promise<void>;

/** Argument-only factory for the dashboard inline diff runner. Does not read `showDashboard` locals. */
export function createRunDiffInline(deps: RunDiffInlineDeps): RunDiffInline {
  const {
    chatLines,
    sync,
    pluginHost,
    scrollChatToLatestAndDraw,
    saveLastSelection,
    computeDiff,
    summarizeDiff,
    isAnalyzerAvailable,
  } = deps;

  return async (
    sk: string[] = [...sync.selected[0]!],
    sv: string[] = [...sync.selected[1]!],
    vc: string[] = [...sync.selected[2]!],
  ) => {
    const total = sk.length * sv.length * vc.length;
    saveLastSelection({ skills: sk, servers: sv, services: vc, mode: 'diff', ts: new Date().toISOString() });

    const diffActive = pluginHost.active();
    if (diffActive) (diffActive.state as any).busy = true;
    chatLines.push('');
    chatLines.push(toolHeader(
      'Diff',
      `${sk.length} skills ${FIGURES.PLAY} ${sv.length} servers \u00D7 ${vc.length} services [${total} targets]`,
      'running',
    ));
    scrollChatToLatestAndDraw();

    let done = 0;
    let totalChanged = 0;
    let totalSame = 0;

    try {
    for (const server of sv) {
      for (const service of vc) {
        for (const skillName of sk) {
          done++;
          const tag = `${C.accent(server)}${C.muted(':')}${C.highlight(service)}${C.muted('/')}${C.text(skillName)}`;
          chatLines.push(`${progressIndicator(`[${done}/${total}]`)} ${tag}`);
          scrollChatToLatestAndDraw();

          try {
            const diff = await computeDiff(skillName, server, service);
            const hasChanges = diff.localOnly.length > 0 || diff.remoteOnly.length > 0 || diff.modified.length > 0;

            if (!hasChanges) {
              // Replace last "..." line
              chatLines[chatLines.length - 1] = `${applyColor(FIGURES.BLACK_CIRCLE, 'success')} ${C.muted(`[${done}/${total}]`)} ${tag} ${successLine('identical')}`;
              totalSame++;
            } else {
              totalChanged++;
              chatLines[chatLines.length - 1] = `${applyColor(FIGURES.BLACK_CIRCLE, 'warning')} ${C.muted(`[${done}/${total}]`)} ${tag} ${warningLine('differs')}`;

              // Show diff details — prioritize SKILL.md and source files over env files
              if (diff.localOnly.length) {
                chatLines.push(`  ${C.success('+')} ${diff.localOnly.length} local-only: ${C.muted(diff.localOnly.slice(0, 5).join(', '))}${diff.localOnly.length > 5 ? C.muted('...') : ''}`);
              }
              if (diff.remoteOnly.length) {
                chatLines.push(`  ${C.error('-')} ${diff.remoteOnly.length} remote-only: ${C.muted(diff.remoteOnly.slice(0, 5).join(', '))}${diff.remoteOnly.length > 5 ? C.muted('...') : ''}`);
              }

              // Show actual source diffs for modified files (SKILL.md and code first, env last)
              if (diff.modified.length) {
                // Sort: SKILL.md first, then source files, then env/config
                const isEnvFile = (p: string) => p.startsWith('.env') || p.endsWith('.config.json') || p.endsWith('.config.ts');
                const sorted = [...diff.modified].sort((a, b) => {
                  const aName = a.path.split('/').pop() || '';
                  const bName = b.path.split('/').pop() || '';
                  if (aName === 'SKILL.md') return -1;
                  if (bName === 'SKILL.md') return 1;
                  if (isEnvFile(aName) && !isEnvFile(bName)) return 1;
                  if (!isEnvFile(aName) && isEnvFile(bName)) return -1;
                  return 0;
                });

                const MAX_DIFF_FILES = 5;
                const MAX_DIFF_LINES = 12;
                for (const f of sorted.slice(0, MAX_DIFF_FILES)) {
                  const fName = f.path.split('/').pop() || f.path;
                  chatLines.push(`  ${C.warning('~')} ${C.bold(fName)} ${C.muted(f.path !== fName ? f.path : '')}`);

                  if (f.diff) {
                    const diffLines = f.diff.split('\n').slice(0, MAX_DIFF_LINES);
                    for (const dl of diffLines) {
                      if (dl.startsWith('---') || dl.startsWith('+++')) {
                        continue; // skip file headers
                      } else if (dl.startsWith('+')) {
                        chatLines.push(`    ${C.success(dl)}`);
                      } else if (dl.startsWith('-')) {
                        chatLines.push(`    ${C.error(dl)}`);
                      } else {
                        chatLines.push(`    ${C.muted(dl)}`);
                      }
                    }
                    if (f.diff.split('\n').length > MAX_DIFF_LINES) {
                      chatLines.push(`    ${C.muted(`... +${f.diff.split('\n').length - MAX_DIFF_LINES} more lines`)}`);
                    }
                  }
                }
                if (sorted.length > MAX_DIFF_FILES) {
                  chatLines.push(`  ${C.muted(`... +${sorted.length - MAX_DIFF_FILES} more files`)}`);
                }
              }

              if (diff.envDeltas.length) {
                chatLines.push(`  ${C.dim(ICONS.env + ' ' + diff.envDeltas.length + ' env delta' + (diff.envDeltas.length > 1 ? 's' : '') + ' (hidden)')}`);
              }

              // Provider-agnostic comprehensive analysis for ANY diff (not just env deltas)
              if (isAnalyzerAvailable()) {
                chatLines.push(`  ${C.muted(ICONS.brain + ' analyzing...')}`);
                scrollChatToLatestAndDraw();
                try {
                  const summary = await summarizeDiff(diff);
                  if (summary) {
                    chatLines[chatLines.length - 1] = `  ${C.info(ICONS.brain)} analysis:`;
                    // Render each bullet on its own line with word-wrap
                    const { cols: wrapW } = termSize();
                    const maxLineW = wrapW - 8; // indent margin
                    for (const rawLine of summary.split('\n').filter(Boolean)) {
                      const line = rawLine.trim();
                      if (!line) continue;
                      const isBullet = line.startsWith('\u2022') || line.startsWith('-') || line.startsWith('*');
                      const prefix = isBullet ? `    ${C.info('\u2022')} ` : '      ';
                      const text = isBullet ? line.replace(/^[\u2022\-\*]\s*/, '') : line;
                      // Word wrap
                      if (text.length <= maxLineW) {
                        chatLines.push(`${prefix}${C.text(text)}`);
                      } else {
                        let remaining = text;
                        let first = true;
                        while (remaining.length > 0) {
                          const chunk = remaining.slice(0, maxLineW);
                          const breakAt = remaining.length > maxLineW ? chunk.lastIndexOf(' ') : -1;
                          const end = breakAt > maxLineW * 0.3 ? breakAt : maxLineW;
                          chatLines.push(`${first ? prefix : '      '}${C.text(remaining.slice(0, end))}`);
                          remaining = remaining.slice(end).trimStart();
                          first = false;
                        }
                      }
                    }
                  } else {
                    chatLines.pop();
                  }
                } catch {
                  chatLines[chatLines.length - 1] = `  ${C.warning(ICONS.brain + ' Grok analysis failed')}`;
                }
              }
            }
          } catch (err: any) {
            chatLines[chatLines.length - 1] = `${C.muted(`[${done}/${total}]`)} ${tag} ${C.error(ICONS.cross + ' ' + (err.message || err))}`;
          }

          scrollChatToLatestAndDraw();
        }
      }
    }

    // Summary
    chatLines.push('');
    chatLines.push(toolHeader(
      'Diff',
      `${total} checked`,
      totalChanged > 0 ? 'success' : 'success',
    ));
    chatLines.push(toolResult(
      successLine(`${totalSame} identical`)
      + (totalChanged ? '  ' + warningLine(`${totalChanged} differ`) : ''),
    ));

    } finally {
      if (diffActive) (diffActive.state as any).busy = false;
    }

    // Stay in sync mode after diff — user can pick new targets. Esc/q to leave.
    sync.selected[0]!.clear();
    sync.selected[1]!.clear();
    sync.cursors[0] = sync.cursors[1] = sync.cursors[2] = 0;
    sync.offsets[0] = sync.offsets[1] = sync.offsets[2] = 0;
    sync.focus = 0;
    chatLines.push(C.muted('(sync mode — pick new targets, Esc/q to exit)'));
    scrollChatToLatestAndDraw();
  };
}
