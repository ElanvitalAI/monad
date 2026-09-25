import { hasWidgetSchema, registerWidgetSchema } from './schema.js';
import { builtinDeclarativeViewDefinitions } from './builtin-view-catalog.js';

export function ensureBuiltinDeclarativeViewSchemasRegistered(): void {
  for (const entry of builtinDeclarativeViewDefinitions) {
    if (hasWidgetSchema(entry.type)) continue;
    registerWidgetSchema({
      type: entry.type,
      description: entry.description,
      configSchema: entry.configSchema,
    });
  }
}
