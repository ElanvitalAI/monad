/**
 * Markdown render config contract — `MARKDOWN_REMARK_PLUGINS` export
 * shape lock. ChatMessage / AgentResponseSheet / CollapsibleCodeBlock
 * 모두 본 상수로 ReactMarkdown 을 wire 하므로 plugin set 변동 시 즉시
 * surface.
 */

import { describe, expect, it } from 'bun:test';
import remarkGfm from 'remark-gfm';

import { MARKDOWN_REMARK_PLUGINS } from './markdown-render';

describe('MARKDOWN_REMARK_PLUGINS', () => {
  it('exports an array (consumed as ReactMarkdown remarkPlugins prop)', () => {
    expect(Array.isArray(MARKDOWN_REMARK_PLUGINS)).toBe(true);
  });

  it('contains remark-gfm — table / strikethrough / autolink / task list 지원', () => {
    expect(MARKDOWN_REMARK_PLUGINS).toContain(remarkGfm);
  });

  it('is non-empty (consumer ReactMarkdown 이 빈 array 도 받지만 의도적 shape)', () => {
    expect(MARKDOWN_REMARK_PLUGINS.length).toBeGreaterThan(0);
  });
});
