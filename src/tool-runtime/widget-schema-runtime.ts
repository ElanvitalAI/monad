// ── GetWidgetSchema tool runtime — Presentation P3 ──
//
// Surfaces the declarative WidgetSchemaRegistry to the LLM. The tool
// takes a `type` name and returns the corresponding JSONSchema (or
// the permissive fallback when no schema is registered). Also
// supports `listTypes: true` to enumerate every registered widget.
//
// Read-only · side-effect free · safe across every tool surface (skill
// / dashboard / plugin / mcp). No approval required.

import {
  getWidgetSchema,
  hasWidgetSchema,
  listWidgetSchemas,
  type WidgetSchemaEntry,
} from '../ui/declarative/schema.js';
import { ensureBuiltinDeclarativeViewSchemasRegistered } from '../ui/declarative/builtin-view-schemas.js';
import { registerToolRuntime } from './registry.js';
import type { ToolRuntime } from './types.js';

type Args = { type?: string; listTypes?: boolean };
type Out = { output: string };

interface Payload {
  readonly type?: string;
  readonly found?: boolean;
  readonly schema?: WidgetSchemaEntry;
  readonly types?: readonly WidgetSchemaEntry[];
  readonly error?: string;
}

function buildPayload(req: Args): Payload {
  ensureBuiltinDeclarativeViewSchemasRegistered();
  if (req.listTypes) {
    return { types: listWidgetSchemas() };
  }
  const typeName = typeof req.type === 'string' ? req.type.trim() : '';
  if (!typeName) {
    return {
      error: 'GetWidgetSchema: provide `type: <widgetType>` or `listTypes: true`',
    };
  }
  const entry = getWidgetSchema(typeName);
  return {
    type: typeName,
    found: hasWidgetSchema(typeName),
    schema: entry,
  };
}

export function createGetWidgetSchemaRuntime(): ToolRuntime<Args, Out> {
  return {
    id: 'ui_get_widget_schema',
    spec: {
      name: 'GetWidgetSchema',
      description:
        'Return the JSONSchema + description for a registered widget type, or enumerate every registered type when `listTypes: true`. Read-only · no side effects.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'Widget type name (e.g. "log", "list", "hello-text"). Required unless listTypes is true.',
          },
          listTypes: {
            type: 'boolean',
            description: 'When true, ignore `type` and return every registered schema.',
          },
        },
        additionalProperties: false,
      },
    },
    async run(req) {
      const payload = buildPayload(req ?? {});
      return { output: JSON.stringify(payload) };
    },
  };
}

let registered = false;

/** Idempotent registration — dashboard calls once at boot. */
export function registerWidgetSchemaRuntime(): void {
  if (registered) return;
  registerToolRuntime(createGetWidgetSchemaRuntime());
  registered = true;
}

/** Test-only · reset so the next registerWidgetSchemaRuntime() call
 *  re-installs cleanly. Callers must also reset the shared registry
 *  via `_resetToolRuntimeRegistryForTest`. */
export function __resetWidgetSchemaRuntimeForTest(): void {
  registered = false;
}
