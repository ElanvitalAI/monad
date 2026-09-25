import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/** TypeScript AST의 Identifier만 재귀 수집한다. 문서 린트와 stale 판정이 같은 자를 쓴다. */
export function sourceIdentifierInventory(dir: string, identifiers: Set<string> = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceIdentifierInventory(full, identifiers);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    const source = ts.createSourceFile(full, readFileSync(full, 'utf-8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) identifiers.add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return identifiers;
}

/** Markdown 단일 inline-code 안의 JavaScript 식별자 후보를 수집한다. */
export function inlineCodeIdentifiers(text: string): Set<string> {
  const identifiers = new Set<string>();
  for (const match of text.matchAll(/`([A-Za-z_$][A-Za-z0-9_$]*)`/g)) identifiers.add(match[1]!);
  return identifiers;
}
