import { describe, test, expect } from 'bun:test';
import {
  dialogWidget,
  materializeWidgetSpecs,
  option,
  permissionPromptWidget,
  widgetSpawnInputFromSpec,
  widget,
  type DeclarativeWidgetHostLike,
} from '../../../src/ui/declarative/index.js';

describe('widgetSpawnInputFromSpec', () => {
  test('keeps host-relevant fields only', () => {
    const input = widgetSpawnInputFromSpec(
      widget('log')
        .withId('log-1')
        .withCharacter('Telemetry')
        .withConfig({ lines: ['hello'] })
        .setChromeTitle('Ignored by host')
        .build(),
    );

    expect(input).toEqual({
      type: 'log',
      id: 'log-1',
      character: 'Telemetry',
      config: { lines: ['hello'] },
      meta: {
        declarativeSpec: {
          type: 'log',
          id: 'log-1',
          character: 'Telemetry',
          config: { lines: ['hello'] },
          chrome: { title: 'Ignored by host' },
        },
      },
    });
  });

  test('falls back to chrome title as the runtime character', () => {
    const input = widgetSpawnInputFromSpec(
      widget('markdown')
        .withId('md-1')
        .setChromeTitle('Declarative Note')
        .withConfig({ text: 'hello' })
        .build(),
    );
    expect(input.character).toBe('Declarative Note');
  });
});

describe('materializeWidgetSpecs', () => {
  test('spawns widget tree and returns parent relationships', () => {
    const calls: Array<{ type: string; id?: string; character?: string; parentId?: string }> = [];
    const host: DeclarativeWidgetHostLike = {
      spawn(opts) {
        calls.push({ type: opts.type, id: opts.id, character: opts.character, parentId: opts.meta?.parentId });
        return { id: opts.id ?? `${opts.type}-${calls.length}` };
      },
    };

    const records = materializeWidgetSpecs(host, [
      widget('log')
        .withId('root-log')
        .withCharacter('Telemetry')
        .withChild(widget('list').withId('child-list'))
        .build(),
    ]);

    expect(calls).toEqual([
      { type: 'log', id: 'root-log', character: 'Telemetry', parentId: undefined },
      { type: 'list', id: 'child-list', character: undefined, parentId: 'root-log' },
    ]);
    expect(records).toHaveLength(2);
    expect(records[0]?.widgetId).toBe('root-log');
    expect(records[1]?.parentId).toBe('root-log');
  });

  test('accepts fluent builders directly for spawn input and materialization', () => {
    const host: DeclarativeWidgetHostLike = {
      spawn(opts) {
        return { id: opts.id ?? `${opts.type}-1` };
      },
    };

    const spawnInput = widgetSpawnInputFromSpec(
      permissionPromptWidget('Approval prompt')
        .setChoices([
          option('Allow once', 'allow').setPositive(),
          option('Deny', 'deny'),
        ]),
    );
    expect(spawnInput).toMatchObject({
      type: 'permission-prompt',
      character: 'Approval prompt',
    });

    const records = materializeWidgetSpecs(host, [
      dialogWidget('dialog', 'Approve patch?')
        .withId('approval')
        .setBody('Replace 14 lines')
        .setButtons(['Approve', 'Deny']),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      widgetId: 'approval',
      type: 'dialog',
      spec: {
        type: 'dialog',
        id: 'approval',
      },
    });
  });
});
