// ── VW-term-infra Phase 3a — LayoutSpec JSON serializer ──
//
// Pure JSON ↔ LayoutSpec conversion. Validation is strict — any
// structural deviation from the declared shape throws
// LayoutSpecValidationError with the path that failed so the user can
// locate the offending node in a hand-edited preset.
//
// Notes:
//   - `toJson(spec)` is a straight JSON.stringify; kept as a symmetric
//     helper so downstream save paths read cleanly.
//   - `fromJson(raw)` runs the full validator; it never trusts the
//     input shape. Legal root kinds: leaf / split / tabs / float.
//   - Numerical sanity: split `sizes` sums to ≈ 1.0 (tolerate ±1e-6),
//     `size` on leaf children is optional (renderers fall back to even
//     distribution if absent), tab indices are clamped to [0,n-1].
//
// See: 내부 문서 `PLAN-session-vw-term-infra-p3-p5` §3.5

import type { PaneRef } from '../../panes/types.js';
import {
  LAYOUT_SPEC_VERSION,
  LayoutSpecValidationError,
  type LayoutSpec,
  type LayoutSpecNode,
} from './types.js';

export function toJson(spec: LayoutSpec, pretty = false): string {
  return pretty ? JSON.stringify(spec, null, 2) : JSON.stringify(spec);
}

export function fromJson(raw: string): LayoutSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new LayoutSpecValidationError(
      `invalid JSON: ${String(err)}`,
      '$',
    );
  }
  return validateSpec(parsed, '$');
}

export function validateSpec(input: unknown, path: string): LayoutSpec {
  if (!isRecord(input)) {
    throw new LayoutSpecValidationError('root is not an object', path);
  }
  const version = input.version;
  if (version !== LAYOUT_SPEC_VERSION) {
    throw new LayoutSpecValidationError(
      `unsupported version ${String(version)} (expected ${LAYOUT_SPEC_VERSION})`,
      `${path}.version`,
    );
  }
  const windowId = input.windowId;
  if (typeof windowId !== 'string' || windowId.length === 0) {
    throw new LayoutSpecValidationError('windowId must be a non-empty string', `${path}.windowId`);
  }
  const createdAt = input.createdAt;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) {
    throw new LayoutSpecValidationError('createdAt must be a finite number', `${path}.createdAt`);
  }
  const label = input.label;
  if (label !== undefined && typeof label !== 'string') {
    throw new LayoutSpecValidationError('label, when set, must be a string', `${path}.label`);
  }
  const root = validateNode(input.root, `${path}.root`);
  return {
    version: LAYOUT_SPEC_VERSION,
    windowId,
    createdAt,
    ...(label !== undefined ? { label } : {}),
    root,
  };
}

function validateNode(input: unknown, path: string): LayoutSpecNode {
  if (!isRecord(input)) {
    throw new LayoutSpecValidationError('node is not an object', path);
  }
  const kind = input.kind;
  switch (kind) {
    case 'leaf': {
      const paneRef = validatePaneRef(input.paneRef, `${path}.paneRef`);
      const size = input.size;
      if (size !== undefined) {
        if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
          throw new LayoutSpecValidationError('leaf.size must be a non-negative number', `${path}.size`);
        }
        return { kind: 'leaf', paneRef, size };
      }
      return { kind: 'leaf', paneRef };
    }
    case 'split': {
      const axis = input.axis;
      if (axis !== 'row' && axis !== 'col') {
        throw new LayoutSpecValidationError(`axis must be 'row' or 'col' (got ${String(axis)})`, `${path}.axis`);
      }
      const children = input.children;
      if (!Array.isArray(children) || children.length < 2) {
        throw new LayoutSpecValidationError('split.children must have ≥ 2 entries', `${path}.children`);
      }
      const sizes = input.sizes;
      if (!Array.isArray(sizes) || sizes.length !== children.length) {
        throw new LayoutSpecValidationError(
          'split.sizes length must equal split.children length',
          `${path}.sizes`,
        );
      }
      for (let i = 0; i < sizes.length; i++) {
        const s = sizes[i];
        if (typeof s !== 'number' || !Number.isFinite(s) || s <= 0) {
          throw new LayoutSpecValidationError(
            `sizes[${i}] must be a positive number`,
            `${path}.sizes[${i}]`,
          );
        }
      }
      const sum = (sizes as number[]).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 1e-6) {
        throw new LayoutSpecValidationError(
          `sizes must sum to ~1.0 (got ${sum})`,
          `${path}.sizes`,
        );
      }
      const validated = children.map((c, i) => validateNode(c, `${path}.children[${i}]`));
      return { kind: 'split', axis, children: validated, sizes: sizes as number[] };
    }
    case 'tabs': {
      const panes = input.panes;
      if (!Array.isArray(panes) || panes.length < 1) {
        throw new LayoutSpecValidationError('tabs.panes must have ≥ 1 entry', `${path}.panes`);
      }
      const validatedPanes = panes.map((p, i) => validatePaneRef(p, `${path}.panes[${i}]`));
      const active = input.active;
      if (typeof active !== 'number' || !Number.isInteger(active) || active < 0 || active >= validatedPanes.length) {
        throw new LayoutSpecValidationError(
          `active must be an integer in [0, ${validatedPanes.length - 1}]`,
          `${path}.active`,
        );
      }
      return { kind: 'tabs', active, panes: validatedPanes };
    }
    case 'float': {
      const pane = validatePaneRef(input.pane, `${path}.pane`);
      const rect = input.rect;
      if (!isRecord(rect)) {
        throw new LayoutSpecValidationError('float.rect must be an object', `${path}.rect`);
      }
      const { row, col, width, height } = rect as Record<string, unknown>;
      if (
        typeof row !== 'number' || typeof col !== 'number'
        || typeof width !== 'number' || typeof height !== 'number'
        || width <= 0 || height <= 0
      ) {
        throw new LayoutSpecValidationError(
          'float.rect must have numeric row/col + positive width/height',
          `${path}.rect`,
        );
      }
      return { kind: 'float', pane, rect: { row, col, width, height } };
    }
    default:
      throw new LayoutSpecValidationError(
        `unknown node kind ${String(kind)}`,
        `${path}.kind`,
      );
  }
}

function validatePaneRef(input: unknown, path: string): PaneRef {
  if (!isRecord(input)) {
    throw new LayoutSpecValidationError('paneRef must be an object', path);
  }
  const { windowId, paneId, runnerLabel } = input as Record<string, unknown>;
  if (typeof windowId !== 'string' || windowId.length === 0) {
    throw new LayoutSpecValidationError('paneRef.windowId required', `${path}.windowId`);
  }
  if (typeof paneId !== 'string' || paneId.length === 0) {
    throw new LayoutSpecValidationError('paneRef.paneId required', `${path}.paneId`);
  }
  if (runnerLabel !== undefined && typeof runnerLabel !== 'string') {
    throw new LayoutSpecValidationError(
      'paneRef.runnerLabel must be a string if set',
      `${path}.runnerLabel`,
    );
  }
  return {
    windowId,
    paneId,
    ...(runnerLabel !== undefined ? { runnerLabel } : {}),
  };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
