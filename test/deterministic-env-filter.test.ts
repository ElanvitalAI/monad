// Pins the credential-shape filter used by `bun run test:deterministic`.
//
// ⚠️ Why this file exists: the filter's whole job is to be invisible when it
// works. Nothing fails when a key slips through — the run just quietly gets
// the developer's credentials and an "offline unit test" makes a real call.
// The only way that stays fixed is a test that names the shapes.

import { describe, expect, test } from 'bun:test';
import { isCredentialKey } from '../scripts/lib/deterministic-env.js';

describe('deterministic gate · credential filter', () => {
  // Every name here leaked past the first version of the filter, which
  // required a qualifier (`API_KEY` / `ACCESS_TOKEN` / `AUTH_TOKEN`).
  const CREDENTIALS = [
    'GOOGLE_APPLICATION_CREDENTIALS',
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET',
    'APIFY_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'XAI_API_KEY',
    'GEMINI_API_KEY',
    'FIRECRAWL_API_KEY',
    'AWS_PROFILE',
    'AWS_SHARED_CREDENTIALS_FILE',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_ACCESS_KEY_ID',
    'AWS_SESSION_TOKEN',
    'AZURE_TENANT_ID',
    'HF_KEY',
    'DB_PASSWORD',
    'SOME_PRIVATE_KEY',
    // ⚠️ Standard credential variables that end in a HOW-it-is-carried word.
    // An earlier draft listed `AWS_SHARED_CREDENTIALS_FILE` by name and so
    // missed these two, which is what forced the rule to stop enumerating
    // names and start matching "credential word + benign qualifier".
    'AWS_WEB_IDENTITY_TOKEN_FILE',
    'AZURE_FEDERATED_TOKEN_FILE',
    'GOOGLE_APPLICATION_CREDENTIALS_JSON',
    'VAULT_TOKEN_PATH',
    'SOME_API_KEY_ID',
  ];

  // ⚠️ These are the counterexamples an earlier draft of this list quietly
  // omitted while the commit message claimed "over-stripping 0". A blanket
  // provider-prefix rule removes all of them, and then the function stops
  // matching its own name: they are routing/locale CONFIG, not secrets.
  // A test list that avoids its own counterexamples is not evidence.
  const CONFIG_NOT_CREDENTIALS = [
    'AWS_REGION',
    'AWS_DEFAULT_REGION',
    'GOOGLE_CLOUD_PROJECT',
    'OPENAI_BASE_URL',
    'ANTHROPIC_BASE_URL',
    'AZURE_OPENAI_ENDPOINT',
    'GEMINI_MODEL',
    // The qualifier tail must not swallow configuration that merely mentions
    // a credential word. These are budgets and policies, not secrets — they
    // are the boundary that keeps the widened rule from becoming the
    // over-broad prefix rule it replaced.
    'TOKEN_LIMIT',
    'MAX_TOKENS',
    'KEY_ROTATION_DAYS',
    'SECRET_SCAN_ENABLED',
  ];

  // Stripping any of these would break the runner itself rather than isolate
  // it — over-stripping is the safe direction only until it reaches these.
  const MUST_SURVIVE = [
    'PATH', 'HOME', 'TERM', 'SHELL', 'LANG', 'TMPDIR', 'PWD', 'USER',
    'NODE_ENV', 'CI', 'XDG_CONFIG_HOME',
    ...CONFIG_NOT_CREDENTIALS,
  ];

  for (const key of CREDENTIALS) {
    test(`strips ${key}`, () => {
      expect(isCredentialKey(key)).toBe(true);
    });
  }

  for (const key of MUST_SURVIVE) {
    test(`keeps ${key}`, () => {
      expect(isCredentialKey(key)).toBe(false);
    });
  }

  test('matches on shape, so an unknown provider is covered too', () => {
    // The point of shape-matching: a provider nobody has added yet is
    // already handled, which a hardcoded list can never claim.
    expect(isCredentialKey('SOME_FUTURE_VENDOR_API_KEY')).toBe(true);
    expect(isCredentialKey('BRANDNEW_TOKEN')).toBe(true);
    expect(isCredentialKey('WHATEVER_SECRET')).toBe(true);
  });
});
