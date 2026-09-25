import { toolHeader } from '../../render.js';
import type { ToolRenderModel } from './types.js';

export function renderToolInline(model: ToolRenderModel): string[] {
  return [toolHeader(model.kind, model.summary, 'running')];
}
