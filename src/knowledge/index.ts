// ── PFC-S4.2 + S4.3: knowledge module barrel ──

export type {
  KnowledgeKind,
  KnowledgeNote,
  KnowledgeQueryInput,
  KnowledgeQueryResult,
  KnowledgeWriteInput,
  KnowledgeWriteResult,
} from './types.js';

export { knowledgeQuery } from './query.js';
export { knowledgeWrite } from './write.js';

export {
  buildKnowledgeQueryTool,
  dispatchKnowledgeQuery,
} from './tools/knowledge-query.js';
export type {
  KnowledgeQueryToolInput,
  KnowledgeQueryToolResult,
} from './tools/knowledge-query.js';

export {
  buildKnowledgeWriteTool,
  dispatchKnowledgeWrite,
} from './tools/knowledge-write.js';
export type {
  KnowledgeWriteToolInput,
  KnowledgeWriteToolResult,
} from './tools/knowledge-write.js';
