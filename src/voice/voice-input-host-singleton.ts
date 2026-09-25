// Back-compat shim for the original PWA-specific singleton name.
// New code should import from `daemon-input-host-singleton.ts`.

export type {
  DaemonInputHostHandle as PwaVoiceInputHostHandle,
} from './daemon-input-host-singleton.js';
export {
  getDaemonInputHost as getDaemonVoiceInputHostForPwa,
  setDaemonInputHost as setDaemonVoiceInputHostForPwa,
  setDaemonInputHostForTesting as setDaemonVoiceInputHostForPwaForTesting,
} from './daemon-input-host-singleton.js';
