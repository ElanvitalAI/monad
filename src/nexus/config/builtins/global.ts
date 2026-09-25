// NEXUS · global SwitchRegistry built-ins (Phase N-3 PR μ)

import { DEFAULT_REGISTRY_THEME, THEME_REGISTRY } from '../../../themes/index.js';
import type { SwitchSpec } from '../types.js';

const THEME_NAMES = THEME_REGISTRY.map((theme) => theme.name);

export const GLOBAL_SWITCHES: SwitchSpec[] = [
  {
    id: 'dashboard.theme.active',
    scope: 'global',
    kind: 'enum',
    label: 'Dashboard theme',
    description: 'TUI와 PWA가 공유하는 활성 테마.',
    default: DEFAULT_REGISTRY_THEME.name,
    enumValues: THEME_REGISTRY.map((theme) => ({
      value: theme.name,
      label: theme.name,
      description: theme.isDark ? 'Dark theme' : 'Light theme',
    })),
    validate: (value) =>
      typeof value === 'string' && THEME_NAMES.includes(value)
        ? null : 'must be a registered theme name',
    hotApplicable: true,
    restartTabs: [],
    pwaPreferred: true,
  },
  {
    id: 'global.tools',
    scope: 'global',
    kind: 'enum',
    label: 'Tool 노출 정책',
    description: 'daemon 이 LLM 에 노출하는 도구의 default profile.',
    default: 'webterm',
    enumValues: [
      { value: 'none',     label: 'none',     description: '도구 미노출 (chat 만)' },
      { value: 'readonly', label: 'readonly', description: 'Read · Grep · Glob 등 read-only' },
      { value: 'webterm',  label: 'webterm',  description: 'readonly + web terminal pane' },
      { value: 'all',      label: 'all',      description: '편집 도구 포함 전부' },
    ],
    validate: (v) =>
      typeof v === 'string' && ['none', 'readonly', 'webterm', 'all'].includes(v)
        ? null : 'must be one of none|readonly|webterm|all',
    hotApplicable: false,
    restartTabs: ['daemon:1'],
    envName: 'MONAD_TOOLS',
    legacyEnvName: 'MONAD_TOOLS',
  },
  {
    id: 'global.historyDir',
    scope: 'global',
    kind: 'path',
    label: 'History 디렉토리',
    description: 'daemon 이 chat 세션을 jsonl 로 기록할 위치.',
    default: '',
    hotApplicable: false,
    restartTabs: ['daemon:1'],
    envName: 'MONAD_HISTORY_DIR',
    legacyEnvName: 'MONAD_HISTORY_DIR',
  },
  {
    // PWA mirror prep — webterm 탭의 register 정책. Off (기본) 시 NEXUS
    // 부트가 chat:1 + daemon:1 만 register · webterm:1 placeholder 는
    // 안 뜸. 외부 터미널을 1급 surface 로 두려는 데스크탑 사용자가
    // 다수이므로 default-OFF. `--tools webterm` (LLM tool surface) 은
    // 본 switch 와 무관 — flag 가 켜져도 탭은 안 뜨고 LLM 만 PTY
    // 도구를 driving. On 으로 켜면 detail panel 에서 PTY 출력을
    // 직접 볼 수 있음 (디버그 / PWA mirror 시).
    id: 'global.tabs.registerWebterm',
    scope: 'global',
    kind: 'bool',
    label: 'webterm 탭 자동 register',
    description:
      'NEXUS 부트 시 webterm:1 탭을 register. Off (기본) 시 외부 터미널 권장 — '
      + '`--tools webterm` (LLM tool surface) 은 본 switch 와 무관하게 동작. '
      + 'On 시 detail panel 에서 PTY 출력을 직접 볼 수 있음 (디버그 / PWA mirror).',
    default: false,
    validate: (v) => typeof v === 'boolean' ? null : 'must be boolean',
    hotApplicable: false,
    restartTabs: [],
    envName: 'MONAD_REGISTER_WEBTERM',
    pwaPreferred: true,
  },
  {
    // T5.F — daemon 탭 register 정책. NEXUS 가 SSoT 가 됐으므로 daemon 탭
    // 은 default-OFF. spec 자체는 keep (test fixture / kindRegistry 보존),
    // 사이드바에서만 hide. registerDaemonTab=true 또는 본 switch=true 시
    // 다시 노출 — 디버그 / 구사용자 경로.
    id: 'global.tabs.registerDaemon',
    scope: 'global',
    kind: 'bool',
    label: 'daemon 탭 자동 register',
    description:
      'NEXUS 부트 시 daemon:1 탭을 register. Off (기본) 시 daemon-public-server '
      + '의 자식 탭이 사이드바에 안 뜸. monad serve 가 freeze-deprecated 된 후 '
      + 'NEXUS 가 모든 surface 흡수했으므로 daemon 탭은 더 이상 첫 진입에 필요 없음. '
      + 'On 시 디버그 (구사용자 muscle memory) 또는 grace-window 호환에 유용.',
    default: false,
    validate: (v) => typeof v === 'boolean' ? null : 'must be boolean',
    hotApplicable: false,
    restartTabs: [],
    envName: 'MONAD_REGISTER_DAEMON',
    pwaPreferred: true,
  },
  {
    // PWA mirror PR 4 — first-boot welcome card dismiss flag.
    // TUI chat tab 에서 Esc 로 dismiss 시 dismissWelcome() (chat/welcome.ts)
    // 가 flip 하던 nested user-config field 를 switch 로 expose. PWA 의
    // WelcomeCard 도 같은 toggle 을 PUT /v1/config/switches/:id 로 재사용.
    // TUI / PWA 가 같은 UserConfig SSoT 를 보므로 한 쪽에서 dismiss 시
    // 다른 쪽도 자동 hide.
    id: 'global.nexus.firstBootGuideShown',
    scope: 'global',
    kind: 'bool',
    label: '첫 부팅 환영 카드 dismiss',
    description:
      'TUI / PWA 의 first-boot welcome 카드 표시 여부. 한 번 dismiss '
      + '하면 양쪽 모두 안 보임 (UserConfig SSoT 공유). 다시 보고 싶으면 '
      + 'off 로 toggle.',
    default: false,
    validate: (v) => typeof v === 'boolean' ? null : 'must be boolean',
    hotApplicable: true,
    restartTabs: [],
    pwaPreferred: true,
  },
  {
    id: 'global.shellPath',
    scope: 'global',
    kind: 'path',
    label: 'Shell 경로',
    description: 'webterm/mini-terminal 의 default shell. 비우면 process.env.SHELL.',
    default: '',
    hotApplicable: false,
    restartTabs: [],
    envName: 'SHELL',
  },
  {
    id: 'global.debug.enabled',
    scope: 'global',
    kind: 'bool',
    label: 'Debug log 활성',
    description: 'log/debug-*.log 에 routing/lifecycle decision 기록.',
    default: false,
    validate: (v) => typeof v === 'boolean' ? null : 'must be boolean',
    hotApplicable: true,
    legacyEnvName: 'MONAD_DEBUG',
  },
  {
    id: 'global.debug.daemonMirrorVerbose',
    scope: 'global',
    kind: 'bool',
    label: 'Daemon mirror verbose',
    description: 'mirror 가 모든 daemon 메시지를 stderr 로 echo.',
    default: false,
    hotApplicable: true,
    legacyEnvName: 'MONAD_DAEMON_MIRROR_VERBOSE',
  },
  {
    id: 'global.debug.keymap',
    scope: 'global',
    kind: 'bool',
    label: 'Keymap audit',
    description: 'keybinding decision 을 debug 로 dump.',
    default: false,
    hotApplicable: true,
    legacyEnvName: 'MONAD_DEBUG_KEYMAP',
  },
  {
    id: 'global.debug.callStack',
    scope: 'global',
    kind: 'bool',
    label: 'Call-stack capture',
    description: 'lifecycle 에서 call-stack snapshot 기록.',
    default: false,
    hotApplicable: true,
    legacyEnvName: 'MONAD_DEBUG_CALL_STACK',
  },
  {
    id: 'global.nexus.autoRestartOnConfigChange',
    scope: 'global',
    kind: 'bool',
    label: 'Config 변경 시 자동 restart',
    description: 'hot-applicable=false switch 변경 → restartTabs 자동 발동.',
    default: true,
    hotApplicable: true,
  },
  // NOTE: `global.entry.defaultMode` (N-1 cleanup PR f/g) was removed
  // 2026-07-24. Bare `monad` now always launches the dashboard; the
  // NEXUS daemon's entry is `monad nexus run`. See
  // 내부 문서 `REPORT-tui-observation-methodology-2026-07-24` §12.
  {
    id: 'global.secrets.backend',
    scope: 'global',
    kind: 'enum',
    label: 'Secret backend',
    description: 'token / API key 저장소 백엔드. 변경 시 supervisor 가 다음 spawn 부터 새 backend 사용 (이미 spawned 된 child 는 영향 없음).',
    default: 'file',
    enumValues: [
      { value: 'file',       label: 'Local file', description: '~/.monad/secrets.json (0o600 · 기본)' },
      { value: 'keychain',   label: 'macOS Keychain', description: 'system keychain · macOS only · `security` CLI' },
      { value: 'aws',        label: 'AWS Secrets Manager', description: '@aws-sdk/client-secrets-manager · 인증 = AWS SDK chain' },
      { value: 'gcp',        label: 'GCP Secret Manager', description: '@google-cloud/secret-manager · 인증 = ADC' },
      { value: '1password',  label: '1Password', description: 'op CLI · vault 명시 필요' },
    ],
    validate: (v) =>
      typeof v === 'string' && ['file', 'keychain', 'aws', 'gcp', '1password'].includes(v)
        ? null : 'must be one of file|keychain|aws|gcp|1password',
    hotApplicable: false,
    restartTabs: [],
    pwaPreferred: true,
  },

  // PR υ — per-cloud-backend config (only used when backend selected)
  {
    id: 'global.secrets.aws.region',
    scope: 'global', kind: 'string',
    label: 'AWS region',
    description: 'AWS Secrets Manager region. 비우면 AWS_REGION env 사용.',
    default: '', hotApplicable: false, restartTabs: [], pwaPreferred: false,
  },
  {
    id: 'global.secrets.aws.kmsKeyId',
    scope: 'global', kind: 'string',
    label: 'AWS KMS key',
    description: '신규 secret 의 KMS encryption key (ARN/alias). 비우면 AWS-managed key.',
    default: '', hotApplicable: false, restartTabs: [], pwaPreferred: false,
  },
  {
    id: 'global.secrets.aws.secretPrefix',
    scope: 'global', kind: 'string',
    label: 'AWS secret prefix',
    description: 'NEXUS-managed secret 의 name prefix. IAM policy scoping 용도.',
    default: 'monad/', hotApplicable: false, restartTabs: [], pwaPreferred: false,
  },
  {
    id: 'global.secrets.gcp.projectId',
    scope: 'global', kind: 'string',
    label: 'GCP project id',
    description: 'GCP Secret Manager project. 필수.',
    default: '', hotApplicable: false, restartTabs: [], pwaPreferred: false,
  },
  {
    id: 'global.secrets.gcp.replication',
    scope: 'global', kind: 'enum',
    label: 'GCP replication policy',
    description: '신규 secret 의 replication. automatic = Google 이 region 선택.',
    default: 'automatic',
    enumValues: [
      { value: 'automatic',    label: 'Automatic' },
      { value: 'user-managed', label: 'User-managed (regions 명시 필요)' },
    ],
    hotApplicable: false, restartTabs: [], pwaPreferred: false,
  },
  {
    id: 'global.secrets.1password.vault',
    scope: 'global', kind: 'string',
    label: '1Password vault',
    description: 'op CLI 가 secret 을 저장할 vault 이름. 필수.',
    default: '', hotApplicable: false, restartTabs: [], pwaPreferred: false,
  },
  {
    id: 'global.secrets.1password.account',
    scope: 'global', kind: 'string',
    label: '1Password account',
    description: 'op signin --account 의 shorthand (multi-account 시).',
    default: '', hotApplicable: false, restartTabs: [], pwaPreferred: false,
  },
  {
    // P.3 — first-boot PWA share wizard decision. 3-state via enum:
    //   ask      → wizard re-asks at the next interactive boot.
    //   enabled  → tailscale serve forward live · zero-prompt re-boots.
    //   disabled → local-only · zero-prompt re-boots.
    // Default 'ask' so dogfood users see the wizard once. P.4 adds
    // `monad nexus pwa share enable|disable|status` for mind-change.
    id: 'global.nexus.pwa.shareTailnet',
    scope: 'global',
    kind: 'enum',
    label: 'PWA Tailscale share',
    description:
      'NEXUS 의 PWA / HTTP API 를 tailnet 의 다른 device 에 노출할지 여부. '
      + 'ask=첫 부팅 wizard 가 묻기 · enabled=tailscale serve 활성 (외부 디바이스 가능) · '
      + 'disabled=local-only (자기 머신 브라우저만). `monad nexus pwa share enable|disable|status` 로 변경.',
    default: 'ask',
    enumValues: [
      { value: 'ask',      label: 'ask',      description: '아직 결정 안 됨 — 다음 interactive 부트 시 wizard 가 묻기' },
      { value: 'enabled',  label: 'enabled',  description: 'Tailscale serve 활성 (외부 디바이스 접근 OK)' },
      { value: 'disabled', label: 'disabled', description: 'Local-only (자기 머신 브라우저만)' },
    ],
    validate: (v) =>
      typeof v === 'string' && ['ask', 'enabled', 'disabled'].includes(v)
        ? null : 'must be one of ask|enabled|disabled',
    hotApplicable: false,
    restartTabs: [],
    pwaPreferred: true,
  },
];
