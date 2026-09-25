// NEXUS · pwa-host tab built-in switches (Phase N-3.5 PR φ)

import type { SwitchSpec } from '../types.js';

export const PWA_HOST_SWITCHES: SwitchSpec[] = [
  {
    id: 'tabs.pwa-host:1.port',
    scope: 'tab',
    appliesTo: ['pwa-host'],
    kind: 'number',
    label: 'PWA dev port',
    description: 'Next dev server 가 listen 하는 port. 변경 시 pwa-host 탭 restart.',
    default: 3210,
    validate: (v) => (typeof v === 'number' && v >= 1024 && v <= 65535) ? null : 'port must be 1024-65535',
    hotApplicable: false,
    restartTabs: ['pwa-host:1'],
    envName: 'PORT',
  },
  {
    id: 'tabs.pwa-host:1.host',
    scope: 'tab',
    appliesTo: ['pwa-host'],
    kind: 'string',
    label: 'PWA bind host',
    description: '127.0.0.1 = loopback only. 0.0.0.0 = LAN 노출 (Tailscale 접속).',
    default: '127.0.0.1',
    validate: (v) => (typeof v === 'string' && /^[\w.:-]+$/.test(v)) ? null : 'invalid host',
    hotApplicable: false,
    restartTabs: ['pwa-host:1'],
    envName: 'HOST',
  },
  {
    id: 'tabs.pwa-host:1.healthzPath',
    scope: 'tab',
    appliesTo: ['pwa-host'],
    kind: 'string',
    label: 'Healthz path',
    description: '/healthz endpoint path. supervisor health probe target.',
    default: '/healthz',
    hotApplicable: false,
    restartTabs: ['pwa-host:1'],
  },
  {
    id: 'tabs.pwa-host:1.devCommand',
    scope: 'tab',
    appliesTo: ['pwa-host'],
    kind: 'string',
    label: 'Dev server 명령',
    description: 'pwa-host 탭이 spawn 할 명령. 기본 `bun run dev`.',
    default: 'bun run dev',
    hotApplicable: false,
    restartTabs: ['pwa-host:1'],
  },
];
