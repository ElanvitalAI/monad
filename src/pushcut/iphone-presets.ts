// iPhone preset helpers — BI-P4.
//
// Sugar over the Pushcut client for the specific flows the plan
// calls out:
//
//   • openUrlOnSafari(url) — open a link in Safari via
//     Pushcut execute(openUrl).
//   • triggerCamera({mode?, callbackUrl?}) — run an iOS Shortcut
//     named 'elanous-camera' that takes a photo and POSTs to
//     callbackUrl (the user wires the Shortcut themselves; see
//     HANDOFF for the template description).
//   • triggerLocationPreset(name) — fire a notification whose
//     iOS-side Shortcut reads the iPhone's current location
//     (Location Services permission required in Pushcut + the
//     Shortcut) and POSTs a preset-matching configuration back.
//   • notifyAgentResult({title, text, actions}) — the concrete
//     "agent is done, here's a link, tap to open on iPhone" flow.
//
// Everything here delegates to the Pushcut client. When Pushcut
// isn't configured each helper returns {ok:false} cleanly so
// callers can fall back to a different surface.

import type { PushcutClient, PushcutNotificationAction, PushcutSendResult } from './client.js';

export interface AgentResultPayload {
  title: string;
  summary?: string;
  /** Primary action URL — opens in Safari when the user taps the
   *  notification body (not a button). */
  url?: string;
  /** Extra buttons, rendered under the notification body. */
  extraActions?: PushcutNotificationAction[];
  /** Device override (default = client's configured default). */
  devices?: string[];
  /** Optional image preview (Pushcut renders inline). */
  image?: string;
}

export interface IPhonePresetFns {
  openUrlOnSafari(url: string, opts?: { notificationName?: string }): Promise<PushcutSendResult>;
  triggerCamera(opts?: {
    /** Named iOS Shortcut to invoke. Default 'elanous-camera'. */
    shortcut?: string;
    /** Input passed to the Shortcut (e.g. camera mode). */
    input?: string;
  }): Promise<PushcutSendResult>;
  triggerLocationPreset(name: string, opts?: {
    /** Override the named Shortcut (default 'elanous-location-<name>'). */
    shortcut?: string;
    input?: string;
  }): Promise<PushcutSendResult>;
  notifyAgentResult(payload: AgentResultPayload, opts?: {
    notificationName?: string;
  }): Promise<PushcutSendResult>;
}

export interface IPhonePresetsDeps {
  client: PushcutClient;
  /** Default notification name used by openUrlOnSafari and
   *  notifyAgentResult. The user must pre-register this in Pushcut. */
  openUrlNotificationName?: string;
  agentResultNotificationName?: string;
}

export const DEFAULT_OPEN_URL_NOTIFICATION = 'elanous-open-url';
export const DEFAULT_AGENT_RESULT_NOTIFICATION = 'monad-agent-result';
export const DEFAULT_CAMERA_SHORTCUT = 'elanous-camera';

export function createIPhonePresets(deps: IPhonePresetsDeps): IPhonePresetFns {
  const { client } = deps;
  const openUrlName = deps.openUrlNotificationName ?? DEFAULT_OPEN_URL_NOTIFICATION;
  const agentResultName = deps.agentResultNotificationName ?? DEFAULT_AGENT_RESULT_NOTIFICATION;

  return {
    async openUrlOnSafari(url, opts) {
      if (!url) return { ok: false, reason: 'missing-url' };
      const direct = await client.execute('openUrl', { url });
      if (direct.ok) return direct;
      // Fallback: fire a notification whose body-tap opens the URL
      // in Safari. Works even without the /execute endpoint in older
      // Pushcut API plans.
      return client.notify(opts?.notificationName ?? openUrlName, {
        title: 'Open link',
        text: url,
        actions: [{ name: 'Open', url }],
      });
    },
    async triggerCamera(opts) {
      return client.execute('runShortcut', {
        shortcut: opts?.shortcut ?? DEFAULT_CAMERA_SHORTCUT,
        input: opts?.input,
      });
    },
    async triggerLocationPreset(name, opts) {
      const shortcut = opts?.shortcut ?? `elanous-location-${name}`;
      return client.execute('runShortcut', {
        shortcut,
        input: opts?.input ?? name,
      });
    },
    async notifyAgentResult(payload, opts) {
      const actions: PushcutNotificationAction[] = [];
      if (payload.url) actions.push({ name: 'Open', url: payload.url });
      if (payload.extraActions) actions.push(...payload.extraActions);
      return client.notify(opts?.notificationName ?? agentResultName, {
        title: payload.title,
        text: payload.summary,
        image: payload.image,
        actions: actions.length > 0 ? actions : undefined,
        devices: payload.devices,
      });
    },
  };
}
