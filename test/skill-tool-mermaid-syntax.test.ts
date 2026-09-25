import { describe, expect, test } from 'bun:test';

import {
  buildMermaidSyntaxTool,
  dispatchMermaidSyntax,
  MERMAID_DOMAINS,
} from '../src/skills/tools/mermaid-syntax.js';

describe('buildMermaidSyntaxTool', () => {
  test('schema lists all 9 domains in the enum', () => {
    const t = buildMermaidSyntaxTool();
    const p = t.parameters as {
      properties: { domain: { enum?: string[] } };
      required?: string[];
    };
    expect(p.properties.domain.enum).toEqual([...MERMAID_DOMAINS]);
    expect(p.required).toContain('domain');
  });
});

describe('dispatchMermaidSyntax', () => {
  test('rejects unknown domain with the valid list in the message', async () => {
    await expect(dispatchMermaidSyntax({ domain: 'bogus' }))
      .rejects.toThrow(/flowchart.*sequence.*pie/);
  });

  test('case-insensitive domain match', async () => {
    const r = await dispatchMermaidSyntax({ domain: 'FLOWCHART' });
    expect(r.domain).toBe('flowchart');
  });

  test('flowchart template has frontmatter + classDef palette', async () => {
    const r = await dispatchMermaidSyntax({ domain: 'flowchart' });
    expect(r.template).toContain('flowchart LR');
    expect(r.template).toContain('classDef primary');
    expect(r.template).toContain('config:');
    expect(r.template).toContain('layout: elk');
  });

  test('every domain returns a non-empty template + notes', async () => {
    for (const d of MERMAID_DOMAINS) {
      const r = await dispatchMermaidSyntax({ domain: d });
      expect(r.domain).toBe(d);
      expect(r.template.length).toBeGreaterThan(20);
      expect(r.notes.length).toBeGreaterThan(0);
      expect(r.output).toContain('```mermaid');
      expect(r.output).toContain('## Notes');
    }
  });

  test('sequence template uses sequenceDiagram + has arrow cheatsheet notes', async () => {
    const r = await dispatchMermaidSyntax({ domain: 'sequence' });
    expect(r.template).toContain('sequenceDiagram');
    expect(r.notes.some(n => n.includes('Arrow') || n.includes('->>'))).toBe(true);
  });

  test('gantt template includes dateFormat', async () => {
    const r = await dispatchMermaidSyntax({ domain: 'gantt' });
    expect(r.template).toContain('dateFormat');
    expect(r.notes.some(n => n.includes('YYYY-MM-DD'))).toBe(true);
  });

  test('er template uses erDiagram + cardinality chars', async () => {
    const r = await dispatchMermaidSyntax({ domain: 'er' });
    expect(r.template).toContain('erDiagram');
    expect(r.template).toContain('||--');
  });

  test('state template uses stateDiagram-v2 (not stateDiagram)', async () => {
    const r = await dispatchMermaidSyntax({ domain: 'state' });
    expect(r.template).toContain('stateDiagram-v2');
  });

  test('pie template uses showData', async () => {
    const r = await dispatchMermaidSyntax({ domain: 'pie' });
    expect(r.template).toContain('pie showData');
  });

  test('output prefix carries the domain key so callers can grep', async () => {
    const r = await dispatchMermaidSyntax({ domain: 'mindmap' });
    expect(r.output).toContain('domain=mindmap');
  });
});
