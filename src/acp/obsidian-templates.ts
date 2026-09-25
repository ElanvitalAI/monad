// PLAN-ipad-notes-obsidian-typora §5 Phase O3·3 (2026-05-17) —
// Vault Templates folder enumeration.
//
// Obsidian convention: `<vault>/Templates/*.md` (or `_templates/`, or
// the user-configured Templates path in `.obsidian/templates.json`).
// MVP cut handles the canonical `Templates/` folder only; custom paths
// can land in a follow-up once the iPad UI surfaces a folder picker.
//
// The endpoint is read-only — it never writes back. Selecting a template
// in the iPad Toolbar Today menu reads the template content via the
// existing `monad/fs/read` path then chains a `notes-save` with that
// markdown, so this helper stays focused on enumeration.

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export interface TemplateEntry {
  /** Display name (filename without `.md` extension). */
  name: string;
  /** Vault-relative path (e.g. `Templates/Daily.md`). */
  relPath: string;
}

export interface TemplatesResult {
  templates: TemplateEntry[];
  /** Resolution source: the folder name that actually returned entries.
   *  Empty when no Templates folder exists in the vault. */
  folder?: string;
  error?: string;
}

export interface FindTemplatesOpts {
  vaultRoot: string;
  /** Override the folder names to probe (test seam). Default tries
   *  `Templates`, `_templates`, `templates` in that order. */
  folderCandidates?: string[];
}

const DEFAULT_FOLDERS = ['Templates', '_templates', 'templates'];

export async function findTemplates(opts: FindTemplatesOpts): Promise<TemplatesResult> {
  const candidates = opts.folderCandidates ?? DEFAULT_FOLDERS;
  for (const folder of candidates) {
    const full = join(opts.vaultRoot, folder);
    if (!existsSync(full)) continue;
    try {
      const entries = await readdir(full, { withFileTypes: true });
      const templates: TemplateEntry[] = entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
        .map((e) => ({
          name: e.name.replace(/\.md$/i, ''),
          relPath: `${folder}/${e.name}`,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { templates, folder };
    } catch (e) {
      return {
        templates: [],
        folder,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
  return { templates: [] };
}
