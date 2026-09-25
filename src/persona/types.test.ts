import { describe, expect, test } from 'bun:test';
import type { PersonaProfile } from './types.js';

describe('PersonaProfile browser residence', () => {
  test('keeps browserPort on the persona profile rather than a separate entity', () => {
    const profile: PersonaProfile = {
      personaId: 'remote',
      displayName: 'Remote',
      browserPort: 9333,
    };

    expect(profile.browserPort).toBe(9333);
  });
});
