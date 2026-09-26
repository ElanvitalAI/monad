// Credential-shape filter and deterministic child environment helpers for test entry points.
//
// ⚠️ Lives in its own module with NO spawn side effects on purpose. `scripts/
// test-deterministic.ts` spawns `bun test` at import time, so a test that
// imported it to reach this function would recursively launch the suite.
// Splitting the pure predicate out is what makes it testable at all — and an
// untested credential filter rots silently, which is the failure mode that
// matters here: it keeps reporting success while letting a key through.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** True when the variable name has the SHAPE of a credential.
 *
 *  Matching on shape rather than on a list of known names is deliberate. The
 *  first version required a qualifier (`API_KEY`, `ACCESS_TOKEN`,
 *  `AUTH_TOKEN`), so a bare `APIFY_TOKEN`, a `GOOGLE_APPLICATION_CREDENTIALS`,
 *  or an `AZURE_CLIENT_ID` passed straight through while the wrapper claimed
 *  to have removed inherited credentials. A filter narrower than its own claim
 *  is worse than no filter, because callers stop checking.
 *
 *  ⚠️ But "over-stripping is safe" is NOT a licence to remove whatever shares a
 *  prefix with a provider. A blanket `^(AWS|GOOGLE|OPENAI)_` rule also takes
 *  `AWS_REGION`, `GOOGLE_CLOUD_PROJECT`, and `OPENAI_BASE_URL`, which are
 *  routing and locale configuration, not secrets — and then the function no
 *  longer does what its name says. That is the same defect as the too-narrow
 *  version it replaced: the behaviour and the claim diverge, just in the other
 *  direction. Every rule here matches a name that IS a credential. */
export function isCredentialKey(key: string): boolean {
  const k = key.toUpperCase();
  return (
    // A credential word, optionally followed only by BENIGN QUALIFIERS.
    //
    // ⚠️ The qualifier tail is the whole point. Chasing individual names is a
    // losing game — `AWS_SHARED_CREDENTIALS_FILE` was listed while
    // `AWS_WEB_IDENTITY_TOKEN_FILE` and `AZURE_FEDERATED_TOKEN_FILE` were not,
    // and the next standard variable would have been missed the same way.
    // Real credential names end in a credential word or in a word that merely
    // says HOW it is carried (`…_TOKEN_FILE`, `…_KEY_ID`, `…_CREDENTIALS_JSON`).
    //
    // The qualifier set is kept deliberately small so this does not become the
    // over-broad rule it replaced: `TOKEN_LIMIT` and `KEY_ROTATION_DAYS` are
    // configuration and must survive, and they do.
    /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CREDENTIALS|COOKIE|PROFILE)(?:_(?:FILE|PATH|ID|NAME|JSON|B64|BASE64))*$/.test(k)
    // Auth principals that contain no credential word at all.
    || /(?:^|_)(?:CLIENT_ID|CLIENT_SECRET|TENANT_ID)$/.test(k)
  );
}

export interface DeterministicChildEnvironment {
  env: NodeJS.ProcessEnv;
  root: string;
  cleanup: () => void;
}

export interface DeterministicChildEnvironmentDeps {
  env?: NodeJS.ProcessEnv;
  tmpdir?: () => string;
  mkdtempSync?: (prefix: string) => string;
  rmSync?: (path: string, options: { recursive: true; force: true }) => void;
}

export function prepareDeterministicChildEnvironment(
  prefix = 'elanous-deterministic-test-',
  deps: DeterministicChildEnvironmentDeps = {},
): DeterministicChildEnvironment {
  const sourceEnv = deps.env ?? process.env;
  const makeTemp = deps.mkdtempSync ?? mkdtempSync;
  const remove = deps.rmSync ?? rmSync;
  const root = makeTemp(join((deps.tmpdir ?? tmpdir)(), prefix));
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    remove(root, { recursive: true, force: true });
    cleaned = true;
  };
  try {
    const env = Object.fromEntries(
      Object.entries(sourceEnv).filter(([key]) => !isCredentialKey(key)),
    ) as NodeJS.ProcessEnv;
    env.HOME = root;
    env.XDG_CONFIG_HOME = join(root, '.config');
    env.ELANOUS_STATE_DIR = join(root, 'state');
    env.ELANOUS_CONFIG_DIR = join(root, 'config');
    return { env, root, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
