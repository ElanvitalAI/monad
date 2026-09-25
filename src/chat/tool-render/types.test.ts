import { describe, expect, test } from 'bun:test';

import type { ToolRenderModel, ToolRenderResultVariants } from './types.js';

describe('tool-render kind-unit contract fields', () => {
  test('operationKind is optional on the model and result variants', () => {
    const model: ToolRenderModel = {
      kind: 'Read',
      status: 'success',
      summary: 'Read a.ts',
      bodyLines: ['ok'],
    };
    const variants: ToolRenderResultVariants = {
      collapsed: ['c'],
      expanded: ['e'],
    };
    expect(model.operationKind).toBeUndefined();
    expect(variants.operationKind).toBeUndefined();

    const kindUnitModel: ToolRenderModel = { ...model, operationKind: 'Read' };
    const kindUnitVariants: ToolRenderResultVariants = { ...variants, operationKind: 'Read' };
    expect(kindUnitModel.operationKind).toBe('Read');
    expect(kindUnitVariants.operationKind).toBe('Read');
  });
});
