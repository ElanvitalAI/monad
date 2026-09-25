export type UXControlIntent =
  | {
      kind: 'open-surface';
      surface: string;
      target?: string;
    }
  | {
      kind: 'focus-surface';
      surface: string;
      target?: string;
    }
  | {
      kind: 'close-surface';
      surface: string;
      target?: string;
    }
  | {
      kind: 'announce';
      channel: string;
      message: string;
    }
  | {
      kind: 'request-clarify';
      channel: string;
      prompt: string;
    }
  | {
      kind: 'expose-tool';
      toolName: string;
      scope: string;
    }
  | {
      kind: 'withdraw-tool';
      toolName: string;
      scope: string;
    }
  | {
      kind: 'reroute-turn';
      reason: string;
      destination: string;
    };
