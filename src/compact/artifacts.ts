// MEMORY.md maintenance for /compact — Phase WF6.
//
// Each /compact appends a dated entry to the project's MEMORY.md
// under a ### Recent work heading, creating the section the first
// time. MEMORY.md lives at the repo root (or cwd if not a repo).
// Header + body are plain markdown so a human can skim + prune.

import { promises as fsp } from 'fs';
import { join } from 'path';
import { getSessionCwd } from '../session/working-dir.js';

const MEMORY_FILENAME = 'MEMORY.md';
const RECENT_WORK_HEADER = '### Recent work';

export async function appendCompactToMemory(
  summary: string,
  opts: { cwd?: string } = {},
): Promise<{ path: string; appended: boolean }> {
  // WD7 — MEMORY.md lives at the active session's project root.
  const cwd = opts.cwd ?? getSessionCwd();
  const path = join(cwd, MEMORY_FILENAME);
  const dateLine = new Date().toISOString().slice(0, 10);
  const entry = [
    '',
    RECENT_WORK_HEADER,
    '',
    `**${dateLine}**`,
    '',
    summary.trim(),
    '',
  ].join('\n');

  let existing = '';
  try {
    existing = await fsp.readFile(path, 'utf-8');
  } catch {
    existing = '';
  }

  if (existing.includes(RECENT_WORK_HEADER)) {
    // Append a new dated block under the existing heading. We put
    // the newer entries at the top of the section so the most
    // recent is the first thing read.
    const header = RECENT_WORK_HEADER;
    const idx = existing.indexOf(header);
    const before = existing.slice(0, idx + header.length);
    const after = existing.slice(idx + header.length);
    const newEntry = `\n\n**${dateLine}**\n\n${summary.trim()}\n`;
    await fsp.writeFile(path, before + newEntry + after, 'utf-8');
    return { path, appended: true };
  }

  // No section yet — append at the end.
  const next = existing.endsWith('\n') ? existing + entry : existing + '\n' + entry;
  await fsp.writeFile(path, next, 'utf-8');
  return { path, appended: true };
}
