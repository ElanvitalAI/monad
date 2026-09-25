// F-B4 — YAML → Scenario parser with tolerant error reporting.
//
// Raw YAML → `ScenarioParseResult`. Three independent stages:
//   1. syntax — `yaml.parseDocument` produces a Document even when
//      the source has errors; they surface via `doc.errors`.
//   2. schema — walk the document node-by-node, validating each
//      field against the `Scenario` type. Invalid steps drop from
//      `validSteps` but the rest of the scenario survives.
//   3. reference — check `componentId` / `modalId` references against
//      `setup.mount` ids. Unresolved references downgrade to
//      warnings so preview layers can still render what's valid.
//
// Design goals (F-B5 consumers):
//   • Partial output — preview must draw what *parsed* even if the
//     trailing lines are mid-keystroke garbage.
//   • line:col accuracy — editor gutter markers need 1-indexed
//     positions pointing at the offending node, not the start of
//     the document.
//   • No throw — caller always gets back a structured result.

import {
  parseDocument,
  LineCounter,
  isMap,
  isSeq,
  isScalar,
  type Document,
  type Node,
  type YAMLMap,
  type YAMLSeq,
  type Scalar,
} from 'yaml';

import type {
  Scenario,
  ScenarioStep,
  ScenarioSetup,
  MountSpec,
  ClickStep,
  ClickTarget,
  KeyStep,
  ExpectStep,
  ExpectTarget,
  ThemeStep,
  ContextKeyStep,
  DismissStep,
  WaitStep,
} from './types.js';

// ── Public types ────────────────────────────────────────────────

export interface ScenarioParseResult {
  /** Partial scenario restored from what parsed cleanly. `null` only
   *  when the root isn't a YAML mapping at all. */
  scenario: Partial<Scenario> | null;
  /** Steps that individually passed schema validation. Reference
   *  errors don't exclude a step from this list — they show up in
   *  `warnings`. F-B5 preview executes only these. */
  validSteps: ScenarioStep[];
  /** All syntax + schema + reference errors. Ordered by line. */
  errors: ParseError[];
  /** Non-fatal issues — unresolved references, deprecated fields. */
  warnings: ParseWarning[];
}

export interface ParseError {
  line: number;       // 1-indexed
  col: number;        // 1-indexed
  path: string;       // dotted + [idx] path, e.g. 'steps[2].target.kind'
  message: string;
  severity: 'syntax' | 'schema' | 'reference';
}

export interface ParseWarning {
  line: number;
  col: number;
  path: string;
  message: string;
}

// ── Entry point ─────────────────────────────────────────────────

export function parseScenarioYaml(source: string): ScenarioParseResult {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const lc = new LineCounter();

  let doc: Document.Parsed;
  try {
    doc = parseDocument(source, { lineCounter: lc, prettyErrors: false });
  } catch (e) {
    errors.push({
      line: 1, col: 1, path: '', severity: 'syntax',
      message: `parseDocument threw: ${(e as Error).message}`,
    });
    return { scenario: null, validSteps: [], errors, warnings };
  }

  for (const err of doc.errors) {
    const pos = posFromOffset(err.pos?.[0] ?? 0, lc);
    errors.push({
      line: pos.line, col: pos.col, path: '', severity: 'syntax',
      message: err.message,
    });
  }

  const root = doc.contents;
  if (root === null || root === undefined) {
    // Empty document — common while user is typing. Not an error;
    // just nothing to parse yet.
    return { scenario: null, validSteps: [], errors, warnings };
  }
  if (!isMap(root)) {
    const pos = nodePos(root as Node, lc);
    errors.push({
      line: pos.line, col: pos.col, path: '', severity: 'schema',
      message: 'scenario root must be a mapping (id/title/steps/...)',
    });
    return { scenario: null, validSteps: [], errors, warnings };
  }

  const ctx: Ctx = { lc, errors, warnings };
  const scenario = parseScenarioMap(root, ctx);
  const validSteps = (scenario.steps ?? []) as ScenarioStep[];

  checkReferences(scenario, ctx);

  errors.sort(byLine);
  warnings.sort(byLine);
  return { scenario, validSteps, errors, warnings };
}

// ── Internal helpers ────────────────────────────────────────────

interface Ctx {
  lc: LineCounter;
  errors: ParseError[];
  warnings: ParseWarning[];
}

function parseScenarioMap(m: YAMLMap, ctx: Ctx): Partial<Scenario> {
  const out: Partial<Scenario> = {};

  const id = requireString(m, 'id', ctx);
  if (id !== undefined) out.id = id;

  const title = requireString(m, 'title', ctx);
  if (title !== undefined) out.title = title;

  const description = optionalString(m, 'description', ctx);
  if (description !== undefined) out.description = description;

  const tags = optionalStringArray(m, 'tags', ctx);
  if (tags !== undefined) out.tags = tags;

  const setupNode = m.get('setup', true) as Node | undefined;
  if (setupNode !== undefined) {
    if (isMap(setupNode)) {
      out.setup = parseSetup(setupNode, ctx);
    } else {
      pushSchema(ctx, setupNode, 'setup', 'setup must be a mapping');
    }
  }

  const stepsNode = m.get('steps', true) as Node | undefined;
  if (stepsNode === undefined) {
    // Missing steps → partial draft, not an error. F-B5 editor
    // should still show the id/title while the user is typing.
  } else if (!isSeq(stepsNode)) {
    pushSchema(ctx, stepsNode, 'steps', 'steps must be a sequence');
  } else {
    out.steps = parseSteps(stepsNode, ctx);
  }

  return out;
}

function parseSetup(m: YAMLMap, ctx: Ctx): ScenarioSetup {
  const setup: ScenarioSetup = {};

  const theme = optionalString(m, 'theme', ctx, 'setup.theme');
  if (theme !== undefined) setup.theme = theme;

  const mountNode = m.get('mount', true) as Node | undefined;
  if (mountNode !== undefined) {
    if (!isSeq(mountNode)) {
      pushSchema(ctx, mountNode, 'setup.mount', 'setup.mount must be a sequence');
    } else {
      const mounts: MountSpec[] = [];
      mountNode.items.forEach((item, i) => {
        const path = `setup.mount[${i}]`;
        if (!isMap(item)) {
          pushSchema(ctx, item as Node, path, 'mount entry must be a mapping');
          return;
        }
        const mount = parseMount(item, path, ctx);
        if (mount) mounts.push(mount);
      });
      if (mounts.length > 0) setup.mount = mounts;
    }
  }

  const ckNode = m.get('contextKeys', true) as Node | undefined;
  if (ckNode !== undefined) {
    if (!isMap(ckNode)) {
      pushSchema(ctx, ckNode, 'setup.contextKeys', 'setup.contextKeys must be a mapping');
    } else {
      const obj: Record<string, unknown> = {};
      for (const pair of ckNode.items) {
        const k = scalarValue(pair.key as Node);
        if (typeof k === 'string') obj[k] = scalarValue(pair.value as Node);
      }
      setup.contextKeys = obj as ScenarioSetup['contextKeys'];
    }
  }

  return setup;
}

const MOUNT_KINDS = new Set(['dialog', 'button', 'select', 'text', 'custom']);

function parseMount(m: YAMLMap, path: string, ctx: Ctx): MountSpec | null {
  const id = requireString(m, 'id', ctx, `${path}.id`);
  const kindRaw = requireString(m, 'kind', ctx, `${path}.kind`);
  const propsNode = m.get('props', true) as Node | undefined;

  if (id === undefined || kindRaw === undefined) return null;
  if (!MOUNT_KINDS.has(kindRaw)) {
    pushSchema(ctx, m.get('kind', true) as Node, `${path}.kind`,
      `unknown mount kind '${kindRaw}' (expected: ${[...MOUNT_KINDS].join(', ')})`);
    return null;
  }
  if (propsNode === undefined) {
    pushSchema(ctx, m, `${path}.props`, `mount '${id}' missing props`);
    return null;
  }
  if (!isMap(propsNode)) {
    pushSchema(ctx, propsNode, `${path}.props`, 'props must be a mapping');
    return null;
  }

  const props = toPlain(propsNode) as Record<string, unknown>;
  const layoutNode = m.get('layout', true) as Node | undefined;
  const layout = layoutNode !== undefined && isMap(layoutNode)
    ? (toPlain(layoutNode) as MountSpec['layout'])
    : undefined;

  return { id, kind: kindRaw as MountSpec['kind'], props, layout } as MountSpec;
}

const STEP_ACTIONS = new Set([
  'click', 'key', 'expect', 'theme', 'set-context-key', 'dismiss', 'wait',
]);

function parseSteps(seq: YAMLSeq, ctx: Ctx): ScenarioStep[] {
  const out: ScenarioStep[] = [];
  seq.items.forEach((item, i) => {
    const path = `steps[${i}]`;
    if (!isMap(item)) {
      pushSchema(ctx, item as Node, path, 'step must be a mapping');
      return;
    }
    const step = parseStep(item, path, ctx);
    if (step) out.push(step);
  });
  return out;
}

function parseStep(m: YAMLMap, path: string, ctx: Ctx): ScenarioStep | null {
  const action = requireString(m, 'action', ctx, `${path}.action`);
  if (action === undefined) return null;
  if (!STEP_ACTIONS.has(action)) {
    pushSchema(ctx, m.get('action', true) as Node, `${path}.action`,
      `unknown step action '${action}' (expected: ${[...STEP_ACTIONS].join(', ')})`);
    return null;
  }

  switch (action) {
    case 'click':           return parseClickStep(m, path, ctx);
    case 'key':             return parseKeyStep(m, path, ctx);
    case 'expect':          return parseExpectStep(m, path, ctx);
    case 'theme':           return parseThemeStep(m, path, ctx);
    case 'set-context-key': return parseContextKeyStep(m, path, ctx);
    case 'dismiss':         return parseDismissStep(m, path, ctx);
    case 'wait':            return parseWaitStep(m, path, ctx);
  }
  return null;
}

function parseClickStep(m: YAMLMap, path: string, ctx: Ctx): ClickStep | null {
  const targetNode = m.get('target', true) as Node | undefined;
  if (targetNode === undefined || !isMap(targetNode)) {
    pushSchema(ctx, targetNode ?? m, `${path}.target`, 'click step requires target mapping');
    return null;
  }
  const target = parseClickTarget(targetNode, `${path}.target`, ctx);
  if (!target) return null;

  const button = optionalString(m, 'button', ctx, `${path}.button`);
  const validButton = button === undefined || button === 'left' || button === 'right' || button === 'double';
  if (!validButton) {
    pushSchema(ctx, m.get('button', true) as Node, `${path}.button`,
      `button must be one of 'left' | 'right' | 'double' (got '${button}')`);
    return null;
  }

  return button
    ? { action: 'click', target, button: button as ClickStep['button'] }
    : { action: 'click', target };
}

const CLICK_TARGET_KINDS = new Set(['component', 'hit', 'coords']);

function parseClickTarget(m: YAMLMap, path: string, ctx: Ctx): ClickTarget | null {
  const kind = requireString(m, 'kind', ctx, `${path}.kind`);
  if (kind === undefined) return null;
  if (!CLICK_TARGET_KINDS.has(kind)) {
    pushSchema(ctx, m.get('kind', true) as Node, `${path}.kind`,
      `unknown click target kind '${kind}' (expected: ${[...CLICK_TARGET_KINDS].join(', ')})`);
    return null;
  }
  if (kind === 'component') {
    const componentId = requireString(m, 'componentId', ctx, `${path}.componentId`);
    if (componentId === undefined) return null;
    const subId = optionalString(m, 'subId', ctx, `${path}.subId`);
    return subId !== undefined
      ? { kind: 'component', componentId, subId }
      : { kind: 'component', componentId };
  }
  if (kind === 'hit') {
    const hitNode = m.get('hitTarget', true) as Node | undefined;
    if (hitNode === undefined || !isMap(hitNode)) {
      pushSchema(ctx, hitNode ?? m, `${path}.hitTarget`, 'hit target requires hitTarget mapping');
      return null;
    }
    return { kind: 'hit', hitTarget: toPlain(hitNode) as ClickTarget extends { kind: 'hit'; hitTarget: infer H } ? H : never };
  }
  // coords
  const row = requireNumber(m, 'row', ctx, `${path}.row`);
  const col = requireNumber(m, 'col', ctx, `${path}.col`);
  if (row === undefined || col === undefined) return null;
  return { kind: 'coords', row, col };
}

function parseKeyStep(m: YAMLMap, path: string, ctx: Ctx): KeyStep | null {
  const eventNode = m.get('event', true) as Node | undefined;
  if (eventNode === undefined || !isMap(eventNode)) {
    pushSchema(ctx, eventNode ?? m, `${path}.event`, 'key step requires event mapping');
    return null;
  }
  const event = toPlain(eventNode) as KeyStep['event'];
  return { action: 'key', event };
}

const EXPECT_TARGET_KINDS = new Set([
  'context-key', 'modal-mounted', 'modal-dismissed', 'modal-stack-length',
  'last-clicked', 'render-contains', 'no-unexpected-error',
]);

function parseExpectStep(m: YAMLMap, path: string, ctx: Ctx): ExpectStep | null {
  const targetNode = m.get('target', true) as Node | undefined;
  if (targetNode === undefined || !isMap(targetNode)) {
    pushSchema(ctx, targetNode ?? m, `${path}.target`, 'expect step requires target mapping');
    return null;
  }
  const target = parseExpectTarget(targetNode, `${path}.target`, ctx);
  if (!target) return null;
  const message = optionalString(m, 'message', ctx, `${path}.message`);
  return message !== undefined
    ? { action: 'expect', target, message }
    : { action: 'expect', target };
}

function parseExpectTarget(m: YAMLMap, path: string, ctx: Ctx): ExpectTarget | null {
  const kind = requireString(m, 'kind', ctx, `${path}.kind`);
  if (kind === undefined) return null;
  if (!EXPECT_TARGET_KINDS.has(kind)) {
    pushSchema(ctx, m.get('kind', true) as Node, `${path}.kind`,
      `unknown expect target kind '${kind}' (expected: ${[...EXPECT_TARGET_KINDS].join(', ')})`);
    return null;
  }
  switch (kind) {
    case 'context-key': {
      const key = requireString(m, 'key', ctx, `${path}.key`);
      if (key === undefined) return null;
      const value = scalarValue(m.get('value', true) as Node | undefined);
      return { kind: 'context-key', key: key as ExpectTarget extends { kind: 'context-key'; key: infer K } ? K : never, value };
    }
    case 'modal-mounted':
    case 'modal-dismissed': {
      const id = requireString(m, 'id', ctx, `${path}.id`);
      if (id === undefined) return null;
      return { kind, id } as ExpectTarget;
    }
    case 'modal-stack-length': {
      const length = requireNumber(m, 'length', ctx, `${path}.length`);
      if (length === undefined) return null;
      return { kind: 'modal-stack-length', length };
    }
    case 'last-clicked': {
      const componentId = requireString(m, 'componentId', ctx, `${path}.componentId`);
      if (componentId === undefined) return null;
      return { kind: 'last-clicked', componentId };
    }
    case 'render-contains': {
      const substring = requireString(m, 'substring', ctx, `${path}.substring`);
      if (substring === undefined) return null;
      return { kind: 'render-contains', substring };
    }
    case 'no-unexpected-error':
      return { kind: 'no-unexpected-error' };
  }
  return null;
}

function parseThemeStep(m: YAMLMap, path: string, ctx: Ctx): ThemeStep | null {
  const name = requireString(m, 'name', ctx, `${path}.name`);
  if (name === undefined) return null;
  return { action: 'theme', name };
}

function parseContextKeyStep(m: YAMLMap, path: string, ctx: Ctx): ContextKeyStep | null {
  const key = requireString(m, 'key', ctx, `${path}.key`);
  if (key === undefined) return null;
  const value = scalarValue(m.get('value', true) as Node | undefined);
  return { action: 'set-context-key', key: key as ContextKeyStep['key'], value };
}

function parseDismissStep(m: YAMLMap, path: string, ctx: Ctx): DismissStep {
  const modalId = optionalString(m, 'modalId', ctx, `${path}.modalId`);
  return modalId !== undefined ? { action: 'dismiss', modalId } : { action: 'dismiss' };
}

function parseWaitStep(m: YAMLMap, path: string, ctx: Ctx): WaitStep | null {
  const ms = requireNumber(m, 'ms', ctx, `${path}.ms`);
  if (ms === undefined) return null;
  return { action: 'wait', ms };
}

// ── Reference checking ──────────────────────────────────────────

function checkReferences(scenario: Partial<Scenario>, ctx: Ctx): void {
  const mountIds = new Set<string>(
    (scenario.setup?.mount ?? []).map(m => m.id),
  );
  const steps = scenario.steps ?? [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const path = `steps[${i}]`;
    if (s.action === 'click' && s.target.kind === 'component') {
      const baseId = s.target.componentId.split(':')[0]!;
      if (!mountIds.has(baseId)) {
        ctx.warnings.push({
          line: 1, col: 1, path: `${path}.target.componentId`,
          message: `click references unmounted component '${s.target.componentId}' (no mount with id '${baseId}')`,
        });
      }
    }
    if (s.action === 'dismiss' && s.modalId && !mountIds.has(s.modalId)) {
      ctx.warnings.push({
        line: 1, col: 1, path: `${path}.modalId`,
        message: `dismiss references unmounted modal '${s.modalId}'`,
      });
    }
    if (s.action === 'expect') {
      if ((s.target.kind === 'modal-mounted' || s.target.kind === 'modal-dismissed')
          && !mountIds.has(s.target.id)) {
        ctx.warnings.push({
          line: 1, col: 1, path: `${path}.target.id`,
          message: `expect references unmounted modal '${s.target.id}'`,
        });
      }
      if (s.target.kind === 'last-clicked') {
        const baseId = s.target.componentId.split(':')[0]!;
        if (!mountIds.has(baseId)) {
          ctx.warnings.push({
            line: 1, col: 1, path: `${path}.target.componentId`,
            message: `expect last-clicked references unmounted '${s.target.componentId}'`,
          });
        }
      }
    }
  }
}

// ── Scalar / node helpers ───────────────────────────────────────

function requireString(m: YAMLMap, key: string, ctx: Ctx, path?: string): string | undefined {
  const pathStr = path ?? key;
  const node = m.get(key, true) as Node | undefined;
  if (node === undefined) {
    pushSchema(ctx, m, pathStr, `missing required field '${key}'`);
    return undefined;
  }
  const v = scalarValue(node);
  if (typeof v !== 'string') {
    pushSchema(ctx, node, pathStr, `'${key}' must be a string (got ${typeOf(v)})`);
    return undefined;
  }
  return v;
}

function optionalString(m: YAMLMap, key: string, ctx: Ctx, path?: string): string | undefined {
  const node = m.get(key, true) as Node | undefined;
  if (node === undefined) return undefined;
  const v = scalarValue(node);
  if (typeof v !== 'string') {
    pushSchema(ctx, node, path ?? key, `'${key}' must be a string (got ${typeOf(v)})`);
    return undefined;
  }
  return v;
}

function requireNumber(m: YAMLMap, key: string, ctx: Ctx, path: string): number | undefined {
  const node = m.get(key, true) as Node | undefined;
  if (node === undefined) {
    pushSchema(ctx, m, path, `missing required field '${key}'`);
    return undefined;
  }
  const v = scalarValue(node);
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    pushSchema(ctx, node, path, `'${key}' must be a number (got ${typeOf(v)})`);
    return undefined;
  }
  return v;
}

function optionalStringArray(m: YAMLMap, key: string, ctx: Ctx): string[] | undefined {
  const node = m.get(key, true) as Node | undefined;
  if (node === undefined) return undefined;
  if (!isSeq(node)) {
    pushSchema(ctx, node, key, `'${key}' must be a sequence of strings`);
    return undefined;
  }
  const out: string[] = [];
  node.items.forEach((item, i) => {
    const v = scalarValue(item as Node);
    if (typeof v !== 'string') {
      pushSchema(ctx, item as Node, `${key}[${i}]`, `'${key}[${i}]' must be a string`);
      return;
    }
    out.push(v);
  });
  return out;
}

function scalarValue(node: Node | undefined): unknown {
  if (node === undefined || node === null) return undefined;
  if (isScalar(node)) return (node as Scalar).value;
  return toPlain(node);
}

function toPlain(node: Node): unknown {
  if (isScalar(node)) return (node as Scalar).value;
  if (isMap(node)) {
    const o: Record<string, unknown> = {};
    for (const pair of node.items) {
      const k = scalarValue(pair.key as Node);
      if (typeof k === 'string') o[k] = toPlain(pair.value as Node);
    }
    return o;
  }
  if (isSeq(node)) {
    return node.items.map(i => toPlain(i as Node));
  }
  return undefined;
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function nodePos(node: Node | undefined, lc: LineCounter): { line: number; col: number } {
  const range = (node as Node & { range?: [number, number, number] })?.range;
  if (!range) return { line: 1, col: 1 };
  return posFromOffset(range[0], lc);
}

function posFromOffset(offset: number, lc: LineCounter): { line: number; col: number } {
  const lp = lc.linePos(offset);
  return { line: lp.line, col: lp.col };
}

function pushSchema(ctx: Ctx, node: Node | undefined, path: string, message: string): void {
  const pos = nodePos(node, ctx.lc);
  ctx.errors.push({ line: pos.line, col: pos.col, path, severity: 'schema', message });
}

function byLine(a: { line: number; col: number }, b: { line: number; col: number }): number {
  if (a.line !== b.line) return a.line - b.line;
  return a.col - b.col;
}
