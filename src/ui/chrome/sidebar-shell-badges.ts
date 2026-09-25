import { paintPair, pair } from '../../theme/tokens.js';

export type SidebarShellBadgeTone =
  | 'active'
  | 'draft'
  | 'new'
  | 'count'
  | 'live'
  | 'wait'
  | 'done'
  | 'err'
  | 'stop'
  | 'srv'
  | 'muted';

export interface SidebarShellBadgeSpec {
  label: string;
  tone?: SidebarShellBadgeTone;
}

export function renderSidebarShellBadge(
  badge: SidebarShellBadgeSpec,
  focused: boolean,
  isActive: boolean,
): string {
  const label = ` ${badge.label} `;
  const color = resolveBadgeColor(badge.tone ?? 'muted', focused, isActive);
  return color(label);
}

function resolveBadgeColor(
  tone: SidebarShellBadgeTone,
  focused: boolean,
  isActive: boolean,
): (text: string) => string {
  if (!focused && isActive) return paintPair(pair('#5b556e', { bg: '#ece7f8', bold: true }));
  switch (tone) {
    case 'active': return paintPair(pair('#38586f', { bg: '#dceff8', bold: true }));
    case 'draft': return paintPair(pair('#5d4a85', { bg: '#ebe3fb', bold: true }));
    case 'new': return paintPair(pair('#744739', { bg: '#f8e4dc', bold: true }));
    case 'count': return paintPair(pair('#38586f', { bg: '#dceff8', bold: true }));
    case 'live': return paintPair(pair('#345b44', { bg: '#dff2e7', bold: true }));
    case 'wait': return paintPair(pair('#6f5430', { bg: '#f8edd6', bold: true }));
    case 'done': return paintPair(pair('#345b44', { bg: '#dff2e7', bold: true }));
    case 'err': return paintPair(pair('#7a4252', { bg: '#f7dfe7', bold: true }));
    case 'stop': return paintPair(pair('#5f5a53', { bg: '#ece8e2' }));
    case 'srv': return paintPair(pair('#42577a', { bg: '#e0e8f6', bold: true }));
    case 'muted':
    default:
      return paintPair(pair('#5f5a53', { bg: '#ece8e2' }));
  }
}
