// Read / Edit / Write ToolRuntimes — Phase CE2.
//
// Thin wrappers so the Edit / Write / Read dispatchers are reachable
// through the shared ToolRuntime registry on both `skill` and
// `dashboard` surfaces.

import {
  buildReadTool, buildEditTool, buildWriteTool,
  dispatchRead, dispatchEdit, dispatchWrite,
} from '../code-edit/index.js';
import { publishEditResult } from '../code-edit/events.js';
import type { ToolRuntime } from './types.js';

export const readRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'read',
  spec: buildReadTool(),
  async run(req) {
    const r = await dispatchRead(req);
    return { output: r.output };
  },
};

export const editRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'edit',
  spec: buildEditTool(),
  async run(req) {
    const r = await dispatchEdit(req);
    // Fan the structured patch out so UI subscribers can render a
    // coloured diff block; the LLM only sees the text `output`.
    if (r.edit?.ok === true) publishEditResult(r.edit);
    return { output: r.output };
  },
};

export const writeRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'write',
  spec: buildWriteTool(),
  async run(req) {
    const r = await dispatchWrite(req);
    if (r.edit?.ok === true) publishEditResult(r.edit);
    return { output: r.output };
  },
};

export const ALL_CODE_EDIT_RUNTIMES = [readRuntime, editRuntime, writeRuntime] as const;
