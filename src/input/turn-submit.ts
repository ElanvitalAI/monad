import { debug, withAmbientSessionScope } from '../debug/log.js';
import { getActiveSessionId } from '../session/index.js';
import type { InputSourceRef } from './input-source-kind.js';
import type { SubmitTurnIntent } from './input-intent.js';

interface SessionAttributedTurnSubmit {
  sessionId?: string;
}

export interface PlainTurnSubmit extends SessionAttributedTurnSubmit {
  intent: SubmitTurnIntent & {
    route: 'plain';
  };
  source: InputSourceRef;
  text: string;
  target: {
    kind: 'plain';
  };
}

export interface StickyAcpTurnSubmit extends SessionAttributedTurnSubmit {
  intent: SubmitTurnIntent & {
    route: 'sticky-acp';
    backend: string;
  };
  source: InputSourceRef;
  text: string;
  target: {
    kind: 'sticky-acp';
    backend: string;
  };
}

export interface DaemonPromptTurnSubmit extends SessionAttributedTurnSubmit {
  intent: SubmitTurnIntent & {
    route: 'daemon-prompt';
  };
  source: InputSourceRef;
  text: string;
  target: {
    kind: 'daemon-prompt';
  };
}

export interface DaemonSessionTurnSubmit extends SessionAttributedTurnSubmit {
  intent: SubmitTurnIntent & {
    route: 'daemon-session';
  };
  source: InputSourceRef;
  text: string;
  target: {
    kind: 'daemon-session';
  };
}

export type TurnSubmit =
  | PlainTurnSubmit
  | StickyAcpTurnSubmit
  | DaemonPromptTurnSubmit
  | DaemonSessionTurnSubmit;

function sessionAttributes(sessionId: string | null): SessionAttributedTurnSubmit {
  return sessionId ? { sessionId } : {};
}

function logSubmitCreate(sessionId: string | null, event: 'create' | 'create.error', data: Record<string, unknown>): void {
  if (!debug.enabled) return;
  const log = () => debug.log('input.submit', event, data, event === 'create.error' ? { level: 'error' } : undefined);
  if (sessionId) {
    withAmbientSessionScope(sessionId, log);
  } else {
    log();
  }
}

export function createTurnSubmitFromIntent(
  intent: SubmitTurnIntent,
): TurnSubmit {
  const textBytes = Buffer.byteLength(intent.text, 'utf8');
  const sessionId = intent.sessionId ?? getActiveSessionId();
  const session = sessionAttributes(sessionId);
  if (intent.route === 'daemon-session') {
    const submit = {
      intent: {
        kind: 'submit-turn',
        source: intent.source,
        text: intent.text,
        route: 'daemon-session',
      },
      source: intent.source,
      text: intent.text,
      target: {
        kind: 'daemon-session',
      },
      ...session,
    } satisfies TurnSubmit;
    logSubmitCreate(sessionId, 'create', {
      route: intent.route,
      targetKind: submit.target.kind,
      sourceKind: intent.source.kind,
      textBytes,
    });
    return submit;
  }
  if (intent.route === 'daemon-prompt') {
    const submit = {
      intent: {
        kind: 'submit-turn',
        source: intent.source,
        text: intent.text,
        route: 'daemon-prompt',
      },
      source: intent.source,
      text: intent.text,
      target: {
        kind: 'daemon-prompt',
      },
      ...session,
    } satisfies TurnSubmit;
    logSubmitCreate(sessionId, 'create', {
      route: intent.route,
      targetKind: submit.target.kind,
      sourceKind: intent.source.kind,
      textBytes,
    });
    return submit;
  }
  if (intent.route === 'sticky-acp') {
    const backend = intent.backend;
    if (!backend) {
      logSubmitCreate(sessionId, 'create.error', {
        route: intent.route,
        sourceKind: intent.source.kind,
        reason: 'missing-backend',
        textBytes,
      });
      throw new Error('sticky-acp submit intent requires backend');
    }
    const submit = {
      intent: {
        kind: 'submit-turn',
        source: intent.source,
        text: intent.text,
        route: 'sticky-acp',
        backend,
      },
      source: intent.source,
      text: intent.text,
      target: {
        kind: 'sticky-acp',
        backend,
      },
      ...session,
    } satisfies TurnSubmit;
    logSubmitCreate(sessionId, 'create', {
      route: intent.route,
      targetKind: submit.target.kind,
      sourceKind: intent.source.kind,
      backend,
      textBytes,
    });
    return submit;
  }

  const submit = {
    intent: {
      kind: 'submit-turn',
      source: intent.source,
      text: intent.text,
      route: 'plain',
    },
    source: intent.source,
    text: intent.text,
    target: {
      kind: 'plain',
    },
    ...session,
  } satisfies TurnSubmit;
  logSubmitCreate(sessionId, 'create', {
    route: intent.route,
    targetKind: submit.target.kind,
    sourceKind: intent.source.kind,
    textBytes,
  });
  return submit;
}

export function isPlainTurnSubmit(
  submit: TurnSubmit,
): submit is PlainTurnSubmit {
  return submit.target.kind === 'plain';
}

export function isStickyAcpTurnSubmit(
  submit: TurnSubmit,
): submit is StickyAcpTurnSubmit {
  return submit.target.kind === 'sticky-acp';
}

export function isDaemonPromptTurnSubmit(
  submit: TurnSubmit,
): submit is DaemonPromptTurnSubmit {
  return submit.target.kind === 'daemon-prompt';
}

export function isDaemonSessionTurnSubmit(
  submit: TurnSubmit,
): submit is DaemonSessionTurnSubmit {
  return submit.target.kind === 'daemon-session';
}
