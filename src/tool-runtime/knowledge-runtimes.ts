// ── PFC-S4.2 + S4.3: Knowledge ToolRuntime wrappers ──

import {
  buildKnowledgeQueryTool,
  dispatchKnowledgeQuery,
  type KnowledgeQueryToolInput,
  type KnowledgeQueryToolResult,
} from '../knowledge/tools/knowledge-query.js';
import {
  buildKnowledgeWriteTool,
  dispatchKnowledgeWrite,
  type KnowledgeWriteToolInput,
  type KnowledgeWriteToolResult,
} from '../knowledge/tools/knowledge-write.js';
import type { ToolRuntime } from './types.js';

export const knowledgeQueryRuntime: ToolRuntime<KnowledgeQueryToolInput, KnowledgeQueryToolResult> = {
  id: 'knowledge_query',
  spec: buildKnowledgeQueryTool(),
  async run(req) { return dispatchKnowledgeQuery(req); },
};

export const knowledgeWriteRuntime: ToolRuntime<KnowledgeWriteToolInput, KnowledgeWriteToolResult> = {
  id: 'knowledge_write',
  spec: buildKnowledgeWriteTool(),
  async run(req) { return dispatchKnowledgeWrite(req); },
};

export const ALL_KNOWLEDGE_RUNTIMES = [
  knowledgeQueryRuntime,
  knowledgeWriteRuntime,
] as const;
