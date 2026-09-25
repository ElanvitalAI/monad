import { describe, expect, test } from 'bun:test';
import { builtinDeclarativeViewDefinitions } from '../../../src/ui/declarative/builtin-view-catalog.js';
import { hasDeclarativeViewFactory } from '../../../src/ui/declarative/view-runtime.js';
import { ensureBuiltinDeclarativeViewSchemasRegistered } from '../../../src/ui/declarative/builtin-view-schemas.js';
import { hasWidgetSchema } from '../../../src/ui/declarative/schema.js';

describe('builtin declarative view catalog', () => {
  test('keeps runtime factories and schema coverage aligned', () => {
    ensureBuiltinDeclarativeViewSchemasRegistered();
    const types = builtinDeclarativeViewDefinitions.map((entry) => entry.type);
    expect(types.length).toBeGreaterThanOrEqual(7);
    expect(types).toContain('intake-review');
    for (const type of types) {
      expect(hasDeclarativeViewFactory(type)).toBe(true);
      expect(hasWidgetSchema(type)).toBe(true);
    }
  });
});
