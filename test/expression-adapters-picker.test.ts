import { describe, expect, test } from 'bun:test';
import {
  searchItemsToPickerSpec,
  pickerSpecToSearchItems,
  describeForScreenReader,
  type PickerSearchItem,
} from '../src/expression/index.js';

describe('expression/adapters/picker · searchItemsToPickerSpec', () => {
  test('basic conversion preserves label + payload', () => {
    const items: PickerSearchItem[] = [
      { label: 'Apple', payload: 'a' },
      { label: 'Banana', payload: 'b' },
    ];
    const spec = searchItemsToPickerSpec(items);
    expect(spec.kind).toBe('picker');
    expect(spec.items.length).toBe(2);
    expect(spec.items[0]).toEqual({ id: 'a', label: 'Apple' });
    expect(spec.items[1]).toEqual({ id: 'b', label: 'Banana' });
  });

  test('strips ANSI from labels', () => {
    const items: PickerSearchItem[] = [
      { label: '\x1b[31mApple\x1b[39m', payload: 'a' },
      { label: '\x1b[1m\x1b[38;2;100;200;100mBanana\x1b[39m\x1b[22m', payload: 'b' },
    ];
    const spec = searchItemsToPickerSpec(items);
    expect(spec.items[0]!.label).toBe('Apple');
    expect(spec.items[1]!.label).toBe('Banana');
  });

  test('preserves description + hint when present', () => {
    const items: PickerSearchItem[] = [
      { label: 'Apple', payload: 'a', description: 'A round red fruit.', hint: 'popular' },
    ];
    const spec = searchItemsToPickerSpec(items);
    expect(spec.items[0]!.description).toBe('A round red fruit.');
    expect(spec.items[0]!.hint).toBe('popular');
  });

  test('opts.title / query / cursor / multi flow into spec', () => {
    const spec = searchItemsToPickerSpec(
      [{ label: 'X', payload: 'x' }],
      { id: 'demo', title: 'Choose', query: 'a', cursor: 2, multi: true },
    );
    expect(spec.id).toBe('demo');
    expect(spec.title).toBe('Choose');
    expect(spec.query).toBe('a');
    expect(spec.cursor).toBe(2);
    expect(spec.multi).toBe(true);
  });

  test('default id when not specified', () => {
    const spec = searchItemsToPickerSpec([{ label: 'X', payload: 'x' }]);
    expect(spec.id).toBe('adapted');
  });

  test('empty input → empty items array (still valid PickerSpec)', () => {
    const spec = searchItemsToPickerSpec([]);
    expect(spec.kind).toBe('picker');
    expect(spec.items).toEqual([]);
  });

  test('omits unset optional fields (no key=undefined leakage)', () => {
    const spec = searchItemsToPickerSpec([{ label: 'X', payload: 'x' }]);
    expect('title' in spec).toBe(false);
    expect('query' in spec).toBe(false);
    expect('cursor' in spec).toBe(false);
    expect('multi' in spec).toBe(false);
    expect('description' in spec.items[0]!).toBe(false);
  });
});

describe('expression/adapters/picker · pickerSpecToSearchItems', () => {
  test('round-trip preserves data after a forward conversion', () => {
    const original: PickerSearchItem[] = [
      { label: 'Apple', payload: 'a', description: 'Red', hint: 'popular' },
      { label: 'Banana', payload: 'b' },
    ];
    const spec = searchItemsToPickerSpec(original);
    const round = pickerSpecToSearchItems(spec);
    expect(round).toEqual([
      { label: 'Apple', payload: 'a', description: 'Red', hint: 'popular' },
      { label: 'Banana', payload: 'b' },
    ]);
  });

  test('handles empty PickerSpec', () => {
    const spec = searchItemsToPickerSpec([]);
    expect(pickerSpecToSearchItems(spec)).toEqual([]);
  });

  test('omits undefined fields', () => {
    const spec = searchItemsToPickerSpec([{ label: 'X', payload: 'x' }]);
    const round = pickerSpecToSearchItems(spec);
    expect('description' in round[0]!).toBe(false);
    expect('hint' in round[0]!).toBe(false);
  });
});

describe('expression/adapters/picker · downstream a11y integration', () => {
  test('adapted spec works with describeForScreenReader (en)', () => {
    const spec = searchItemsToPickerSpec(
      [
        { label: 'GPT-5.4', payload: 'gpt' },
        { label: 'Claude Opus 4.7', payload: 'opus' },
        { label: 'Grok 4', payload: 'grok' },
      ],
      { title: 'Provider' },
    );
    const utterance = describeForScreenReader(spec, { locale: 'en' });
    expect(utterance).toBe('Provider. Choose one of 3 options.');
  });

  test('adapted spec works with describeForScreenReader (ko)', () => {
    const spec = searchItemsToPickerSpec(
      [{ label: 'A', payload: 'a' }, { label: 'B', payload: 'b' }],
      { title: '선택' },
    );
    const utterance = describeForScreenReader(spec, { locale: 'ko' });
    expect(utterance).toBe('선택. 2개 옵션 중 하나를 선택하세요.');
  });

  test('ANSI-laden labels strip cleanly before SR utterance', () => {
    // A elanous picker host typically pre-paints labels with chalk.
    // describeForScreenReader doesn't know about ANSI; the adapter
    // hands it pure text.
    const spec = searchItemsToPickerSpec(
      [
        { label: '\x1b[1mGPT-5.4\x1b[22m', payload: 'gpt' },
        { label: '\x1b[34mClaude\x1b[39m', payload: 'opus' },
      ],
      { title: 'Model' },
    );
    const utterance = describeForScreenReader(spec, { locale: 'en' });
    expect(utterance).not.toContain('\x1b[');
    expect(utterance).toContain('Choose one of 2 options');
  });
});
