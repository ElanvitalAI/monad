// F3 enforcement (Federation invariant from REQUIREMENTS §5):
//   "A modal that captures input must also paint, and a modal that
//    paints must declare its bounds. No invisible modals, no
//    painting non-modals."
//
// Audit (2026-05-03) confirmed F3 is primarily a TYPE-LEVEL
// invariant in monad-agent:
//
//   ModalSurface (modal-stack.ts:47-169) requires:
//     - kind: 'modal'         (literal)
//     - bounds: ModalBounds   (non-optional)
//     - paint(): string       (non-optional method)
//
//   DisplaySurface (types.ts:402-441) base does NOT declare paint
//   or bounds — they live ONLY on ModalSurface. So a non-modal
//   surface (kind: 'pane', 'overlay', etc.) cannot paint by type.
//
//   isModalSurface (modal-stack.ts:172) runtime guard checks all
//   three (kind === 'modal', typeof paint === 'function',
//   bounds !== undefined). Cast-bypass routes (e.g. `as ModalSurface`
//   on a malformed object) get rejected here at runtime.
//
// This guard is NOT redundant with the type system: it pins the
// CONTRACT itself. A future refactor that hoists `paint` to the
// base DisplaySurface, or that flips `bounds`/`paint` to optional
// on ModalSurface, would silently relax F3 — TypeScript would
// continue compiling but invisible modals or painting panes would
// become representable. This guard fails such a relaxation by
// reading the source of `modal-stack.ts` + `types.ts` and asserting
// the canonical shape, plus three behavioral cases pinning the
// runtime guard semantics.
//
// Decision: GO (small value, ~150 LOC test). Considered NO-GO since
// type-level is already enforcing — but the source-pattern guard
// adds protection against contract relaxation at zero production
// cost. Audit-driven scope kept minimal.
//
// PLAN ref: 내부 문서 `PLAN-substrate-rebuild-2026-05-03` §7
// REQUIREMENTS ref: 내부 문서 `REQUIREMENTS-substrate-occam-2026-05-03` §5 F3

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

import { isModalSurface } from '../src/display/modal-stack.js';
import type { DisplaySurface } from '../src/display/types.js';

const ROOT = process.cwd();
const MODAL_STACK_PATH = join(ROOT, 'src/display/modal-stack.ts');
const TYPES_PATH = join(ROOT, 'src/display/types.ts');

function extractInterfaceBody(source: string, name: string): string | null {
  // Match `export interface name extends ... {` or `export interface name {`
  const re = new RegExp(`export\\s+interface\\s+${name}(\\s+extends\\s+[^{]+)?\\s*\\{`);
  const m = re.exec(source);
  if (!m) return null;
  const start = m.index + m[0].length - 1; // pointer at '{'
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

describe('F3 federation guard · modal capture ⇒ paint + bounds; no painting non-modals', () => {
  test('structural · ModalSurface interface declares `paint(): string` as required (non-optional)', () => {
    const source = readFileSync(MODAL_STACK_PATH, 'utf8');
    const body = extractInterfaceBody(source, 'ModalSurface');
    expect(body).not.toBeNull();
    // Must contain `paint(): string` — note absence of `?` between
    // identifier and parens. `paint?(): string` would be optional and
    // is the regression we want to catch.
    if (!/\bpaint\s*\(\s*\)\s*:\s*string\b/.test(body!)) {
      throw new Error(
        `F3 violation: ModalSurface.paint must be declared as `
        + `\`paint(): string\` (non-optional). Found body slice did not match.`,
      );
    }
    // Negative: there must NOT be a `paint?(` declaration anywhere
    // inside the ModalSurface interface body.
    if (/\bpaint\s*\?\s*\(/.test(body!)) {
      throw new Error(
        `F3 violation: ModalSurface declares paint as OPTIONAL (\`paint?()\`). `
        + `Modal capture without paint produces invisible modals — see §5 F3.`,
      );
    }
  });

  test('structural · ModalSurface interface declares `bounds: ModalBounds` as required (non-optional)', () => {
    const source = readFileSync(MODAL_STACK_PATH, 'utf8');
    const body = extractInterfaceBody(source, 'ModalSurface');
    expect(body).not.toBeNull();
    if (!/\bbounds\s*:\s*ModalBounds\b/.test(body!)) {
      throw new Error(
        `F3 violation: ModalSurface.bounds must be declared as `
        + `\`bounds: ModalBounds\` (non-optional).`,
      );
    }
    // Reject `bounds?: ModalBounds` (optional bounds means a modal
    // that paints might not declare where).
    if (/\bbounds\s*\?\s*:\s*ModalBounds\b/.test(body!)) {
      throw new Error(
        `F3 violation: ModalSurface declares bounds as OPTIONAL. `
        + `Modal that paints must declare bounds — see §5 F3.`,
      );
    }
  });

  test('structural · DisplaySurface base interface does NOT declare paint or bounds', () => {
    // F3's "no painting non-modals" — base DisplaySurface must not
    // expose paint/bounds, otherwise pane/overlay surfaces could
    // paint without becoming modal. A regression that hoists either
    // field to the base relaxes F3 silently.
    const source = readFileSync(TYPES_PATH, 'utf8');
    const body = extractInterfaceBody(source, 'DisplaySurface');
    expect(body).not.toBeNull();
    if (/\bpaint\s*\??\s*\(/.test(body!)) {
      throw new Error(
        `F3 violation: DisplaySurface base interface declares paint(). `
        + `Paint must live ONLY on ModalSurface so non-modals cannot paint.`,
      );
    }
    if (/\bbounds\s*\??\s*:\s*ModalBounds\b/.test(body!)) {
      throw new Error(
        `F3 violation: DisplaySurface base interface declares bounds: ModalBounds. `
        + `Bounds must live ONLY on ModalSurface.`,
      );
    }
  });

  test('structural · isModalSurface runtime guard checks ALL three contract fields', () => {
    // The runtime guard is the cast-bypass safety net. It must
    // verify kind === 'modal' AND paint is callable AND bounds is
    // present. A guard that only checks kind would let
    // `as ModalSurface` casts on malformed objects through.
    const source = readFileSync(MODAL_STACK_PATH, 'utf8');
    const fnStart = source.indexOf('export function isModalSurface(');
    expect(fnStart).toBeGreaterThan(0);
    // Read the next ~600 chars to cover the function body.
    const slice = source.slice(fnStart, fnStart + 600);
    const checksKind = /\bkind\s*===\s*['"]modal['"]/.test(slice);
    // `typeof <expr involving paint> === 'function'`. Anchor on
    // `typeof` + `.paint` somewhere on the same line, then
    // `=== 'function'` later. Liberal to accept either bare
    // `surface.paint` or cast forms like `(s as ModalSurface).paint`.
    const checksPaint = /typeof[\s\S]*?\bpaint\b[\s\S]*?===\s*['"]function['"]/.test(slice);
    const checksBounds = /\bbounds\s*!==\s*undefined\b/.test(slice);
    const missing: string[] = [];
    if (!checksKind) missing.push('kind === "modal"');
    if (!checksPaint) missing.push('typeof paint === "function"');
    if (!checksBounds) missing.push('bounds !== undefined');
    if (missing.length > 0) {
      throw new Error(
        `F3 violation: isModalSurface runtime guard missing checks:\n  - ${missing.join('\n  - ')}\n\n`
        + `All three are needed to reject cast-bypass (\`as ModalSurface\` on malformed objects).`,
      );
    }
    expect(missing).toEqual([]);
  });

  test('behavioral · isModalSurface rejects an object missing paint', () => {
    // Cast-bypass simulation: build a DisplaySurface-shaped object
    // with kind='modal' + bounds but no paint. The runtime guard
    // must reject it. A regression that drops the paint check would
    // let invisible modals pass.
    const malformed = {
      id: 'f3-no-paint',
      kind: 'modal',
      owner: 'dashboard',
      focus: 'owns',
      priority: 100,
      bounds: { row: 1, col: 1, width: 5, height: 5 },
      render: () => [],
      // paint intentionally omitted
    } as unknown as DisplaySurface;
    expect(isModalSurface(malformed)).toBe(false);
  });

  test('behavioral · isModalSurface rejects an object missing bounds', () => {
    const malformed = {
      id: 'f3-no-bounds',
      kind: 'modal',
      owner: 'dashboard',
      focus: 'owns',
      priority: 100,
      render: () => [],
      paint: () => '',
      // bounds intentionally omitted
    } as unknown as DisplaySurface;
    expect(isModalSurface(malformed)).toBe(false);
  });

  test('behavioral · isModalSurface accepts a properly-shaped ModalSurface', () => {
    // Positive sanity: kind + paint + bounds → guard returns true.
    const wellFormed = {
      id: 'f3-ok',
      kind: 'modal',
      owner: 'dashboard',
      focus: 'owns',
      priority: 100,
      bounds: { row: 1, col: 1, width: 5, height: 5 },
      render: () => [],
      paint: () => '',
    } as unknown as DisplaySurface;
    expect(isModalSurface(wellFormed)).toBe(true);
  });

  test('behavioral · isModalSurface rejects a non-modal kind even with paint+bounds', () => {
    // F3 second clause: "no painting non-modals". A pane-kind
    // surface that for some reason carries paint+bounds (e.g. via
    // type assertion abuse) must not be classified as modal.
    const wrongKind = {
      id: 'f3-pane-paints',
      kind: 'pane',
      owner: 'dashboard',
      focus: 'owns',
      priority: 100,
      bounds: { row: 1, col: 1, width: 5, height: 5 },
      render: () => [],
      paint: () => '',
    } as unknown as DisplaySurface;
    expect(isModalSurface(wrongKind)).toBe(false);
  });
});
