// ── Preview pane — right-side file content viewer ──
// Reads a file from under LOCAL_SKILLS_DIR and renders it with syntax
// coloring + line numbers, truncated to the pane's visible box.

import { readFileSync } from 'fs';
import { extname, join } from 'path';
import { LOCAL_SKILLS_DIR } from '../config.js';
import { C } from '../tui.js';
import { fileColor, fileIcon } from './file-icons.js';
import { colorLine } from './syntax-color.js';

const PREVIEW_EXTS = new Set([
  '.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.json', '.yaml', '.yml', '.toml',
  '.env', '.sh', '.zsh', '.bash', '.css', '.html', '.xml', '.svg', '.py', '.rb',
  '.go', '.rs', '.sql', '.graphql', '.cfg', '.ini', '.conf', '.local', '.properties',
]);

export function canPreview(path: string): boolean {
  const ext = extname(path).toLowerCase();
  const name = path.split('/').pop() || '';
  return PREVIEW_EXTS.has(ext) || name.startsWith('.env') || name === 'Makefile' || name === 'Dockerfile' || name === 'SKILL.md';
}

export function buildFilePreview(skillName: string, filePath: string, maxH: number, maxW: number): string[] {
  const fullPath = join(LOCAL_SKILLS_DIR, skillName, filePath);
  const lines: string[] = [];
  const name = filePath.split('/').pop() || filePath;
  const ext = extname(name).toLowerCase();

  lines.push(`${C.bold(fileIcon(name))} ${fileColor(name)(name)}`);
  lines.push(C.muted(filePath));
  lines.push('');

  if (!canPreview(filePath)) {
    lines.push(C.muted('  (binary file — no preview)'));
    return lines;
  }

  try {
    const content = readFileSync(fullPath, 'utf-8');
    const contentLines = content.split('\n').slice(0, maxH - 4);

    for (let i = 0; i < contentLines.length; i++) {
      const lineNum = C.muted(String(i + 1).padStart(3) + ' │');
      let line = contentLines[i]!;
      if (line.length > maxW - 8) line = line.slice(0, maxW - 9) + '…';
      const colored = colorLine(line, ext);
      lines.push(`${lineNum} ${colored}`);
    }

    if (content.split('\n').length > contentLines.length) {
      lines.push(C.muted(`  ... +${content.split('\n').length - contentLines.length} more lines`));
    }
  } catch {
    lines.push(C.muted('  (unable to read)'));
  }

  return lines.slice(0, maxH);
}
