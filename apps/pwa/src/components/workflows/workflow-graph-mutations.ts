// Archon-port T2B Phase 2 (2026-05-08) — pure graph→YAML mutations.
//
// Phase 1 (read-only viewer) lived entirely in
// `workflow-graph-layout.ts`. Phase 2 layers an editable surface on
// top: when the user drags a connection, drops a new node from the
// palette, or deletes a selected node, we mutate the
// `WorkflowDefinitionLike` and serialize it back to YAML for the
// `WorkflowsPanel` textarea / save path.
//
// Everything in this file is pure — no React, no DOM. The component
// shell just calls these helpers and threads results through state.

import { stringify, parse } from 'yaml';
import type { WorkflowDefinitionLike, NodeVariant } from './workflow-graph-layout';
import { classifyNodeVariant } from './workflow-graph-layout';

/** ROADMAP Tier 1 W2 (2026-05-11) — patch shape accepted by `editNode`.
 *  Only fields the caller actually wants to change are present; absent
 *  fields are preserved. Setting a value to `null` (vs `undefined`)
 *  signals "delete this key" (e.g. clear `when`, drop `depends_on`). */
export interface NodeEditPatch {
  /** Rename — affects every `depends_on` referencing the node. */
  id?: string;
  /** Gating expression (e.g. `"$prev.output == 'ok'"`). null deletes. */
  when?: string | null;
  /** Ordered upstream dependencies. Empty array deletes the key. */
  depends_on?: string[];
  /** Variant payload — exactly one of these should be supplied when
   *  changing variant content. The helper writes only the keys you
   *  pass, preserving everything else (including the existing variant
   *  field if you don't override it). */
  bash?: string;
  prompt?: string;
  skill?: string;
  arguments?: string;
  cft?: string;
  config?: Record<string, unknown>;
  approval?: {
    message: string;
    capture_response?: boolean;
    delivery?: 'modal' | 'terminal' | 'telegram' | 'discord' | 'pushcut' | 'all';
  };
}

/** Default scaffold for each variant when the user adds a new node
 *  via the palette. Picks values that pass `validateWorkflow` so the
 *  validation badge stays green right after insertion. */
function scaffoldForVariant(variant: NodeVariant, id: string): Record<string, unknown> {
  switch (variant) {
    case 'prompt':
      return { id, prompt: 'Describe the desired behaviour…' };
    case 'bash':
      return { id, bash: 'echo todo' };
    case 'skill':
      return { id, skill: 'omni-digest', arguments: '$ARGUMENTS' };
    case 'cft':
      return { id, cft: 'pdca', config: { goal: 'TBD', phase: 'plan' } };
    case 'approval':
      return { id, approval: { message: 'Continue?' } };
    case 'if':
      // Node-catalog N1.1 (2026-05-11) — boolean branch scaffold.
      return { id, if: { condition: "$ARGUMENTS == 'yes'" } };
    case 'switch':
      // Node-catalog N1.2 (2026-05-11) — N-way branch scaffold.
      return { id, switch: { value: '$ARGUMENTS', cases: ['a', 'b'] } };
    case 'iteration':
      // Node-catalog N1.3 (2026-05-11) — sequential loop scaffold.
      return { id, iteration: { items: '["a","b","c"]', body: 'echo $index $item' } };
    case 'classify':
      // Node-catalog N2.1 (2026-05-11) — LLM classification scaffold.
      return {
        id,
        classify: { input: '$ARGUMENTS', classes: ['question', 'command', 'other'] },
      };
    case 'extract':
      // Node-catalog N2.2 (2026-05-11) — LLM extraction scaffold.
      return {
        id,
        extract: {
          input: '$ARGUMENTS',
          schema: { name: 'person name', date: 'ISO date if present' },
        },
      };
    case 'set':
      // Node-catalog N3.1 (2026-05-11) — Set scaffold.
      return { id, set: { fields: { greeting: 'Hello $ARGUMENTS' } } };
    case 'filter':
      // Node-catalog N3.2 (2026-05-11) — Filter scaffold.
      return { id, filter: { items: '["a","b","c"]', condition: "$item != 'b'" } };
    case 'template':
      // Node-catalog N3.3 (2026-05-11) — Template scaffold.
      return {
        id,
        template: { template: 'Hello {{ARGUMENTS}}!' },
      };
    case 'http':
      // Node-catalog N4.3 (2026-05-11) — HTTP request scaffold.
      return {
        id,
        http: {
          method: 'GET',
          url: 'https://api.example.com/items',
          headers: { Accept: 'application/json' },
        },
      };
    case 'scheduleTrigger':
      // Node-catalog N4.1 (2026-05-11) — Schedule trigger scaffold.
      return { id, scheduleTrigger: { type: 'interval', interval: 3600000 } };
    case 'webhookTrigger':
      // Node-catalog N4.2 (2026-05-11) — Webhook trigger scaffold.
      return { id, webhookTrigger: { method: 'POST', path: '/hooks/example' } };
    case 'discordTrigger':
      // Node-catalog N4.4 (2026-05-11) — Discord trigger scaffold.
      return { id, discordTrigger: { kind: 'message' } };
    case 'telegramTrigger':
      // Node-catalog N4.5 (2026-05-11) — Telegram trigger scaffold.
      return { id, telegramTrigger: { kind: 'message' } };
    case 'manualTrigger':
      // Surface-unification §B6 (2026-05-11 · n8n port) — Manual trigger.
      return { id, manualTrigger: { description: 'Run manually' } };
    case 'chatTrigger':
      // Surface-unification §B7 (2026-05-11 · n8n ChatTrigger v1 port).
      return { id, chatTrigger: { path: '/chat', sessionMode: 'stateless', streaming: false } };
    case 'unknown':
    default:
      return { id, bash: 'echo placeholder' };
  }
}

/** Generate a fresh, kebab-cased node id that doesn't collide with
 *  anything already in the definition. Form: `<variant>-<n>` where
 *  `n` is the smallest positive integer that's free. */
export function nextFreeNodeId(
  def: WorkflowDefinitionLike,
  variant: NodeVariant,
): string {
  const taken = new Set((def.nodes ?? []).map((n) => n.id));
  const stem = variant === 'unknown' ? 'node' : variant;
  for (let i = 1; i < 10_000; i += 1) {
    const id = `${stem}-${i}`;
    if (!taken.has(id)) return id;
  }
  return `${stem}-${Date.now()}`;
}

/** Append a new node of the given variant. Returns a new definition;
 *  inputs are not mutated. */
export function addNode(
  def: WorkflowDefinitionLike,
  variant: NodeVariant,
  opts?: { id?: string },
): WorkflowDefinitionLike {
  const id = opts?.id ?? nextFreeNodeId(def, variant);
  const node = scaffoldForVariant(variant, id);
  return {
    ...def,
    nodes: [...(def.nodes ?? []), node as WorkflowDefinitionLike['nodes'][number]],
  };
}

/** Remove a node by id. Also strips the id from every other node's
 *  `depends_on` array (and drops the array entirely if it becomes
 *  empty) so the resulting definition is referentially clean. */
export function deleteNode(
  def: WorkflowDefinitionLike,
  id: string,
): WorkflowDefinitionLike {
  const remaining = (def.nodes ?? []).filter((n) => n.id !== id);
  const cleaned = remaining.map((n) => {
    const deps = Array.isArray(n.depends_on) ? n.depends_on.filter((d) => d !== id) : undefined;
    if (deps === undefined) return n;
    if (deps.length === 0) {
      const { depends_on: _stripped, ...rest } = n;
      return rest as WorkflowDefinitionLike['nodes'][number];
    }
    return { ...n, depends_on: deps };
  });
  return { ...def, nodes: cleaned };
}

/** Add `target.depends_on += [source]` (idempotent — a duplicate
 *  edge is a no-op). Returns a new definition. */
export function addEdge(
  def: WorkflowDefinitionLike,
  source: string,
  target: string,
): WorkflowDefinitionLike {
  if (source === target) return def;
  const nodes = (def.nodes ?? []).map((n) => {
    if (n.id !== target) return n;
    const deps = Array.isArray(n.depends_on) ? [...n.depends_on] : [];
    if (deps.includes(source)) return n;
    deps.push(source);
    return { ...n, depends_on: deps };
  });
  return { ...def, nodes };
}

/** Remove `source` from `target.depends_on` (drops the array if it
 *  becomes empty). Idempotent: removing a non-existent edge is a
 *  no-op. */
export function removeEdge(
  def: WorkflowDefinitionLike,
  source: string,
  target: string,
): WorkflowDefinitionLike {
  const nodes = (def.nodes ?? []).map((n) => {
    if (n.id !== target) return n;
    if (!Array.isArray(n.depends_on)) return n;
    const deps = n.depends_on.filter((d) => d !== source);
    if (deps.length === n.depends_on.length) return n;
    if (deps.length === 0) {
      const { depends_on: _s, ...rest } = n;
      return rest as WorkflowDefinitionLike['nodes'][number];
    }
    return { ...n, depends_on: deps };
  });
  return { ...def, nodes };
}

/** Rename a node. Updates the node's id AND every `depends_on`
 *  reference. No-op if `to` already exists. */
export function renameNode(
  def: WorkflowDefinitionLike,
  from: string,
  to: string,
): WorkflowDefinitionLike {
  if (from === to) return def;
  const taken = new Set((def.nodes ?? []).map((n) => n.id));
  if (taken.has(to)) return def;
  const nodes = (def.nodes ?? []).map((n) => {
    let next = n;
    if (n.id === from) next = { ...next, id: to };
    if (Array.isArray(next.depends_on)) {
      next = { ...next, depends_on: next.depends_on.map((d) => (d === from ? to : d)) };
    }
    return next;
  });
  return { ...def, nodes };
}

/** ROADMAP Tier 1 W2 (2026-05-11) — patch a node's variant-specific
 *  fields and metadata in place. Returns a new definition. Handles:
 *
 *  - **id rename** via the existing `renameNode` helper (so depends_on
 *    references update transitively).
 *  - **null-as-delete** semantics for `when` and empty `depends_on[]`
 *    so the resulting YAML stays tight (no empty arrays / null fields
 *    cluttering the round-trip).
 *  - **variant switch** when the patch carries a variant key that
 *    differs from the current one. We strip the old variant field +
 *    its sidecars (e.g. `arguments` for skill, `config` for cft) so
 *    the validator doesn't see a mixed-variant node.
 *
 *  No-op when the node id isn't found. */
export function editNode(
  def: WorkflowDefinitionLike,
  id: string,
  patch: NodeEditPatch,
): WorkflowDefinitionLike {
  const existing = (def.nodes ?? []).find((n) => n.id === id);
  if (!existing) return def;

  // Handle rename first so subsequent edits land on the renamed node.
  let working: WorkflowDefinitionLike = def;
  let workingId = id;
  if (patch.id && patch.id !== id) {
    working = renameNode(def, id, patch.id);
    // If renameNode bailed (target already taken), keep the original id
    // and silently skip the rename portion of the patch.
    if (working === def) {
      workingId = id;
    } else {
      workingId = patch.id;
    }
  }

  const nodes = (working.nodes ?? []).map((n) => {
    if (n.id !== workingId) return n;
    const next: Record<string, unknown> = { ...n };

    // Variant switch: strip old variant key + sidecars when caller
    // supplies a different variant payload key.
    const currentVariant = classifyNodeVariant(n);
    const incomingVariantKey = (['bash', 'prompt', 'skill', 'cft', 'approval'] as const).find(
      (k) => patch[k] !== undefined,
    );
    if (incomingVariantKey && incomingVariantKey !== currentVariant && currentVariant !== 'unknown') {
      delete next[currentVariant];
      if (currentVariant === 'skill') delete next['arguments'];
      if (currentVariant === 'cft') delete next['config'];
    }

    // Apply variant fields (any patch key undefined is ignored).
    if (patch.bash !== undefined) next['bash'] = patch.bash;
    if (patch.prompt !== undefined) next['prompt'] = patch.prompt;
    if (patch.skill !== undefined) next['skill'] = patch.skill;
    if (patch.arguments !== undefined) next['arguments'] = patch.arguments;
    if (patch.cft !== undefined) next['cft'] = patch.cft;
    if (patch.config !== undefined) next['config'] = patch.config;
    if (patch.approval !== undefined) next['approval'] = patch.approval;

    // `when`: null deletes, string sets.
    if (patch.when === null) delete next['when'];
    else if (typeof patch.when === 'string') next['when'] = patch.when;

    // `depends_on`: empty array deletes, non-empty sets.
    if (patch.depends_on !== undefined) {
      if (patch.depends_on.length === 0) delete next['depends_on'];
      else next['depends_on'] = [...patch.depends_on];
    }

    return next as WorkflowDefinitionLike['nodes'][number];
  });

  return { ...working, nodes };
}

/** ROADMAP Tier 1 W3 (2026-05-11) — persist a node's graph position
 *  to `def._meta.layout.{nodeId}: {x, y}`. The daemon validator
 *  ignores `_meta` so this round-trips cleanly through Save → load.
 *  Returns a new definition; inputs are not mutated.
 *
 *  Removes the entry when the node id no longer exists (e.g. caller
 *  also deleted the node) so stale layout data doesn't accumulate
 *  across rename / delete operations. */
export function setNodePosition(
  def: WorkflowDefinitionLike,
  id: string,
  pos: { x: number; y: number },
): WorkflowDefinitionLike {
  const existing = (def.nodes ?? []).find((n) => n.id === id);
  if (!existing) return def;
  const meta =
    def['_meta'] && typeof def['_meta'] === 'object'
      ? { ...(def['_meta'] as Record<string, unknown>) }
      : {};
  const layout =
    meta['layout'] && typeof meta['layout'] === 'object'
      ? { ...(meta['layout'] as Record<string, { x: number; y: number }>) }
      : {};
  // Garbage-collect entries whose nodes no longer exist (rename/delete
  // upstream removed them from `def.nodes` but left the layout entry).
  const liveIds = new Set((def.nodes ?? []).map((n) => n.id));
  for (const key of Object.keys(layout)) {
    if (!liveIds.has(key)) delete layout[key];
  }
  layout[id] = { x: Math.round(pos.x), y: Math.round(pos.y) };
  meta['layout'] = layout;
  return { ...def, _meta: meta };
}

/** Tier E4.1 (2026-05-11) — clear `_meta.layout` so the next render
 *  pass falls back to dagre auto-layout. Used by the Tidy-up button +
 *  Shift+Alt+T shortcut. Returns a new definition; if `_meta` ends up
 *  empty after stripping `layout` we drop it entirely so the YAML
 *  round-trip stays tight. */
export function clearLayout(def: WorkflowDefinitionLike): WorkflowDefinitionLike {
  if (!def['_meta'] || typeof def['_meta'] !== 'object') return def;
  const meta = { ...(def['_meta'] as Record<string, unknown>) };
  if (!('layout' in meta)) return def;
  delete meta['layout'];
  if (Object.keys(meta).length === 0) {
    const { _meta: _stripped, ...rest } = def;
    return rest as WorkflowDefinitionLike;
  }
  return { ...def, _meta: meta };
}

/** Tier E3.2 (2026-05-11) — duplicate an existing node. Picks the
 *  next free id of the same variant (e.g. `bash-3` → `bash-4`) and
 *  copies all variant + metadata fields verbatim, dropping
 *  `depends_on` so the new node lands free-standing rather than wired
 *  into the original's upstream. No-op when `id` doesn't exist. */
export function duplicateNode(
  def: WorkflowDefinitionLike,
  id: string,
): WorkflowDefinitionLike {
  const original = (def.nodes ?? []).find((n) => n.id === id);
  if (!original) return def;
  const variant = classifyNodeVariant(original);
  const fresh = nextFreeNodeId(def, variant);
  const { id: _origId, depends_on: _deps, ...rest } = original;
  const next = { ...(rest as Record<string, unknown>), id: fresh } as WorkflowDefinitionLike['nodes'][number];
  return { ...def, nodes: [...(def.nodes ?? []), next] };
}

/** Round-trip a definition through `yaml.stringify`. Keeps the
 *  serialization stable (sorted top-level keys with `name` /
 *  `description` first) so save → reload doesn't churn diffs. */
export function definitionToYaml(def: WorkflowDefinitionLike): string {
  const ordered: Record<string, unknown> = {};
  if (typeof def.name === 'string') ordered.name = def.name;
  if (typeof def.description === 'string') ordered.description = def.description;
  for (const key of Object.keys(def)) {
    if (key === 'name' || key === 'description' || key === 'nodes') continue;
    ordered[key] = (def as Record<string, unknown>)[key];
  }
  ordered.nodes = def.nodes ?? [];
  return stringify(ordered, { lineWidth: 0, defaultStringType: 'PLAIN', singleQuote: false });
}

/** Convenience: parse YAML string → definition, returning null on
 *  failure or shape mismatch. */
export function safeParseWorkflowYaml(yaml: string): WorkflowDefinitionLike | null {
  try {
    const parsed = parse(yaml);
    if (!parsed || typeof parsed !== 'object') return null;
    const d = parsed as WorkflowDefinitionLike;
    if (!Array.isArray(d.nodes)) return null;
    return d;
  } catch {
    return null;
  }
}
