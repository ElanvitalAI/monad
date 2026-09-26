// Service Worker Phase 3 — VAPID keypair management.
//
// VAPID (Voluntary Application Server Identification, RFC 8292) is
// the auth scheme that tells the browser's push service "this push
// came from elanous's server, not a random third party". We need a
// stable P-256 keypair:
//   - Public key → handed to the PWA at subscribe time so the
//                  browser binds the subscription to elanous
//   - Private key → never leaves the daemon · used to sign each push
//
// First boot generates a fresh keypair and stores both halves in
// `~/.elanous/secrets.json` (NEXUS PR μ canonical secret store · 0o600
// already enforced). Subsequent boots load the existing keys so
// already-subscribed PWAs keep working across daemon restarts.
//
// Why store in secrets.json (vs separate file): keeps secret
// surfaces narrow (one file to back up, one auth boundary, one
// future cloud-backend swap point — Phase σ landed Keychain/AWS/
// GCP/1Password backends behind the same interface).

import { generateVAPIDKeys } from 'web-push';
import { debug } from '../debug/log.js';

const VAPID_PUBLIC_SECRET_ID = 'pwa-push-vapid-public';
const VAPID_PRIVATE_SECRET_ID = 'pwa-push-vapid-private';
const SUBJECT_SECRET_ID = 'pwa-push-vapid-subject';

export interface VapidKeyPair {
  publicKey: string;
  privateKey: string;
  /** RFC 8292 §3.2 — `mailto:` or `https://` URL identifying the
   *  push origin. Browser logs it with the subscription so admins
   *  can reach back to us if our pushes misbehave. We don't have a
   *  contact email convention yet, so default to a placeholder
   *  pointing at the canonical github repo. Override via
   *  `ELANOUS_PUSH_VAPID_SUBJECT` env or by writing the secret. */
  subject: string;
}

const DEFAULT_SUBJECT = 'https://github.com/ElanvitalAI/monad';

/** Lazy-loaded singleton — daemon boot path calls this once and
 *  holds the result for the lifetime of the process. */
let cached: VapidKeyPair | null = null;

export async function loadVapidKeyPair(): Promise<VapidKeyPair> {
  if (cached) return cached;
  // Lazy import — avoids pulling NEXUS secret-backend infrastructure
  // during the test suite's collect phase if a test only touches
  // VAPID generation in isolation.
  const { getSecretAsync, setSecretAsync } = await import(
    '../nexus/config/secrets/index.js'
  );

  const publicKey = await getSecretAsync(VAPID_PUBLIC_SECRET_ID);
  const privateKey = await getSecretAsync(VAPID_PRIVATE_SECRET_ID);
  const storedSubject = await getSecretAsync(SUBJECT_SECRET_ID);

  if (publicKey && privateKey) {
    cached = {
      publicKey,
      privateKey,
      subject: storedSubject || process.env['ELANOUS_PUSH_VAPID_SUBJECT'] || DEFAULT_SUBJECT,
    };
    if (debug.enabled) {
      debug.log('webpush.vapid', 'loaded', { hasSubject: !!storedSubject });
    }
    return cached;
  }

  // First boot — generate a fresh keypair. `web-push` uses Node's
  // built-in crypto, so this is deterministic + audit-friendly.
  const fresh = generateVAPIDKeys();
  await setSecretAsync(VAPID_PUBLIC_SECRET_ID, fresh.publicKey);
  await setSecretAsync(VAPID_PRIVATE_SECRET_ID, fresh.privateKey);
  const subject = process.env['ELANOUS_PUSH_VAPID_SUBJECT'] || DEFAULT_SUBJECT;
  cached = { publicKey: fresh.publicKey, privateKey: fresh.privateKey, subject };
  if (debug.enabled) {
    debug.log('webpush.vapid', 'generated', { subject });
  }
  return cached;
}

/** Test seam — drop the cached keypair so next `loadVapidKeyPair()`
 *  call re-reads from the secrets store. Production callers never
 *  invoke this. */
export function _resetVapidCacheForTest(): void {
  cached = null;
}
