// ── File type icons + colors (shared across panes) ──

import { extname } from 'path';
import { C } from '../tui.js';

export function fileColor(name: string): (s: string) => string {
  const ext = extname(name).toLowerCase();
  const base = name.split('/').pop() || '';
  if (base === 'SKILL.md' || base === 'README.md') return C.bold;
  if (base.startsWith('.env')) return C.error;
  switch (ext) {
    case '.md':   return C.highlight;
    case '.ts': case '.tsx': case '.js': case '.jsx': return C.info;
    case '.json': case '.yaml': case '.yml': case '.toml': return C.warning;
    case '.py':   return C.success;
    case '.sh': case '.bash': case '.zsh': return C.accent;
    case '.css': case '.html': case '.svg': return C.highlight;
    case '.sql': case '.graphql': return C.info;
    default: return C.text;
  }
}

export function dirColor(name: string): string {
  return C.accent(name + '/');
}

export function fileIcon(name: string): string {
  const ext = extname(name).toLowerCase();
  const base = name.split('/').pop() || '';
  if (base === 'SKILL.md' || base === 'README.md') return '\u{F0214}';
  if (base.startsWith('.env')) return '\u{F0F5E}';
  switch (ext) {
    case '.md':   return '\u{F0354}';
    case '.ts': case '.tsx': return '\u{F06E6}';
    case '.js': case '.jsx': return '\u{F0C7E}';
    case '.json': return '\u{F0626}';
    case '.py':   return '\u{F0320}';
    case '.sh': case '.bash': case '.zsh': return '\u{F0C6C}';
    case '.yaml': case '.yml': return '\u{F0626}';
    case '.sql':  return '\u{F01BC}';
    case '.css':  return '\u{F031B}';
    case '.html': return '\u{F02D0}';
    case '.svg':  return '\u{F0721}';
    default:      return '\u{F0214}';
  }
}

export function sizeStr(n: number | undefined): string {
  if (n === undefined) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}K`;
  return `${(n / (1024 * 1024)).toFixed(1)}M`;
}
