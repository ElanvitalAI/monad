// Wave 8 (2026-05-04) — tool deny filter.
//
// As of Archon-port T1.1 (2026-05-08), the implementation moved to
// `tool-policy.ts` to support both `allow` and `deny` semantics under
// a single `applyToolPolicy()` contract. This file remains as a thin
// re-export so existing import paths (`./tool-runtime/tool-deny.js`)
// continue to resolve unchanged.
//
// New code should import from `./tool-runtime/tool-policy.js` directly
// — both `applyToolPolicy` (full contract) and `filterToolsByDeny`
// (back-compat alias) live there.

export { filterToolsByDeny } from './tool-policy.js';
