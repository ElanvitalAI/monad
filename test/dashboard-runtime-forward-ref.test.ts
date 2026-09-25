import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

interface ForwardRefIssue {
  callee: string;
  prop: string;
  ident: string;
  callLine: number;
  declLine: number;
}

const RUNTIME_CALLEE = /^(createDashboard.*Runtime|bootDashboard[A-Z].*|createDashboardClipboardActions)$/;

function collectDashboardRuntimeForwardRefs(path: string): ForwardRefIssue[] {
  const source = readFileSync(path, 'utf8');
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  let showDashboard: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'showDashboard') {
      showDashboard = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!showDashboard?.body) throw new Error('showDashboard() not found');

  const declarations = new Map<string, { line: number; kind: 'function' | 'variable' }>();
  for (const stmt of showDashboard.body.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          declarations.set(decl.name.text, { line: lineOf(decl.name.pos), kind: 'variable' });
        }
      }
      continue;
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      declarations.set(stmt.name.text, { line: lineOf(stmt.name.pos), kind: 'function' });
    }
  }

  const issues: ForwardRefIssue[] = [];
  const inspect = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && RUNTIME_CALLEE.test(node.expression.text)
    ) {
      const callLine = lineOf(node.getStart(sf));
      const [arg0] = node.arguments;
      if (arg0 && ts.isObjectLiteralExpression(arg0)) {
        for (const prop of arg0.properties) {
          if (ts.isShorthandPropertyAssignment(prop)) {
            const ident = prop.name.text;
            const decl = declarations.get(ident);
            if (decl && decl.kind === 'variable' && decl.line > callLine) {
              issues.push({
                callee: node.expression.text,
                prop: ident,
                ident,
                callLine,
                declLine: decl.line,
              });
            }
            continue;
          }
          if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer)) {
            const ident = prop.initializer.text;
            const decl = declarations.get(ident);
            if (decl && decl.kind === 'variable' && decl.line > callLine) {
              issues.push({
                callee: node.expression.text,
                prop: prop.name.getText(sf),
                ident,
                callLine,
                declLine: decl.line,
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(showDashboard.body);
  return issues;
}

describe('dashboard runtime forward-ref guard', () => {
  test('runtime boot calls do not directly capture later const bindings', () => {
    const issues = collectDashboardRuntimeForwardRefs('src/dashboard/index.ts');
    expect(issues).toEqual([]);
  });
});
