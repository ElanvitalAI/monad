// T4.D — ConnectTokenCard contract test.

import { describe, expect, test } from 'bun:test';

import { ConnectTokenCard } from './ConnectTokenCard';

describe('ConnectTokenCard — T4.D', () => {
  test('exports a ConnectTokenCard component', () => {
    expect(typeof ConnectTokenCard).toBe('function');
  });
});
