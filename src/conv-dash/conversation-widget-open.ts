import type { EmbodiedAgentSession } from '../agent/embodiment.js';
import type { WidgetHitDescriptor } from '../display/types.js';

export interface ConversationWidgetSessionEntry {
  readonly session: EmbodiedAgentSession;
  readonly paneId?: string;
  readonly windowId?: number;
}

export function findConversationSessionEntry(
  entries: readonly ConversationWidgetSessionEntry[],
  sessionId: string,
): ConversationWidgetSessionEntry | undefined {
  return entries.find((entry) => entry.session.id === sessionId);
}

export function conversationModalWidgetId(sessionId: string): string {
  return `conv-widget:${sessionId.replace(/[^a-zA-Z0-9:_-]/g, '-')}`;
}

export function conversationModalTitle(
  session: EmbodiedAgentSession,
): string {
  const state = session.state();
  const title = state.title?.trim();
  if (title) return `Conversation · ${title}`;
  return `Conversation · ${displayConversationBrand(session.launchSpec.brand)} · ${session.id}`;
}

export function conversationHoverHudLabel(
  hit: Extract<WidgetHitDescriptor, { kind: 'conversation-message' }>,
): string {
  const channel = hit.channel ? ` · ${hit.channel}` : '';
  return `conversation ${hit.role}${channel} · ${hit.messageId}`;
}

export function displayConversationBrand(brand: string): string {
  return brand === 'codex-app-server' ? 'codex' : brand;
}
