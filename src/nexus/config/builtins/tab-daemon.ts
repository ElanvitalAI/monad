// NEXUS · daemon-tab built-in switches (Phase N-3.5 PR φ)
//
// Per-instance overrides for the daemon tab (`elanous serve`). Most users
// only ever have `daemon:1`, so the literal id pattern is fine.
//
// Pushcut webhook switches (D1/D2/D4) are housed here because the
// webhook receiver is a daemon endpoint (the daemon hosts the HTTP
// surface). The binding map (D3) is intentionally NOT a switch — it
// has list/table semantics, so it lives behind the
// `/v1/registry/bindings/pushcut/*` endpoint family from PR τ.

import type { SwitchSpec } from '../types.js';

export const PUSHCUT_WEBHOOK_SECRET_SWITCH_ID = 'tabs.daemon:1.pushcut.webhookSecretRef';
export const PUSHCUT_ENABLED_SWITCH_ID = 'tabs.daemon:1.pushcut.enabled';
export const PUSHCUT_WEBHOOK_PATH_SWITCH_ID = 'tabs.daemon:1.pushcut.webhookPath';

export const DAEMON_SWITCHES: SwitchSpec[] = [
  // Per-instance tools override (overrides global.tools when set)
  {
    id: 'tabs.daemon:1.tools',
    scope: 'tab',
    appliesTo: ['daemon'],
    kind: 'enum',
    label: 'Tool 노출 (per-daemon override)',
    description: '비우면 global.tools 적용. 명시 시 이 daemon 인스턴스만 다른 profile.',
    default: '',
    enumValues: [
      { value: '',         label: '(global.tools 사용)' },
      { value: 'none',     label: 'none' },
      { value: 'readonly', label: 'readonly' },
      { value: 'webterm',  label: 'webterm' },
      { value: 'all',      label: 'all' },
    ],
    hotApplicable: false,
    restartTabs: ['daemon:1'],
    envName: 'ELANOUS_TOOLS',
  },
  {
    id: 'tabs.daemon:1.historyDir',
    scope: 'tab',
    appliesTo: ['daemon'],
    kind: 'path',
    label: 'History 디렉토리 (per-daemon)',
    description: '비우면 global.historyDir 적용. 멀티 daemon 시 인스턴스별 분리.',
    default: '',
    hotApplicable: false,
    restartTabs: ['daemon:1'],
    envName: 'ELANOUS_HISTORY_DIR',
  },

  // ---- Pushcut webhook (WT-N-3 D1/D2/D4 absorbed) ----
  {
    id: PUSHCUT_ENABLED_SWITCH_ID,
    scope: 'tab',
    appliesTo: ['daemon'],
    kind: 'bool',
    label: 'Pushcut webhook receiver',
    description: '/v1/pushcut endpoint 활성화. iPhone Shortcut → daemon 으로 사진/텍스트 incoming.',
    default: false,
    hotApplicable: true, // 보안 incident 시 즉시 disable 가능
  },
  {
    id: PUSHCUT_WEBHOOK_SECRET_SWITCH_ID,
    scope: 'tab',
    appliesTo: ['daemon'],
    kind: 'secret-ref',
    label: 'Pushcut webhook HMAC secret',
    description: 'Pushcut Shortcut 의 X-Signature header 검증용 HMAC secret. PWA secret modal 에서 rotate 가능.',
    default: '',
    hotApplicable: true,
    pwaPreferred: true,
    redactInLogs: true,
    envName: 'ELANOUS_PUSHCUT_WEBHOOK_SECRET',
    legacyEnvName: 'ELANOUS_PUSHCUT_WEBHOOK_SECRET',
  },
  {
    id: PUSHCUT_WEBHOOK_PATH_SWITCH_ID,
    scope: 'tab',
    appliesTo: ['daemon'],
    kind: 'string',
    label: 'Pushcut webhook path',
    description: 'webhook endpoint path. 기본 /v1/pushcut. 충돌/security-by-obscurity 용 override.',
    default: '/v1/pushcut',
    hotApplicable: false,
    restartTabs: ['daemon:1'],
  },
];
