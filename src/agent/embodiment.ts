// H5 Phase 1 pre-implementation contracts for embodied agent sessions.
//
// These are intentionally type-only and minimal. They define the seam
// between launch requests, live sessions, and concrete backend adapters
// without forcing the event bus / capture / automation layers to land
// in the same change.

export type AgentLaunchMode =
  | 'auto'
  | 'acp'
  | 'native-sdk'
  | 'pty-direct'
  | 'hybrid';

export type EmbodiedTransportKind =
  | 'pty'
  | 'acp'
  | 'rpc'
  | 'socket'
  | 'api';

export type EmbodiedSessionStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'done'
  | 'error';

export type EmbodiedInterruptSignal =
  | 'ctrl_c'
  | 'terminate'
  | 'kill';

export interface AgentLaunchSpec {
  brand: string;
  mode?: AgentLaunchMode;
  cwd?: string;
  prompt?: string;
  paneId?: string;
  model?: string;
  approvalPolicy?: string;
  sandboxMode?: string;
  extraArgs?: readonly string[];
  env?: Readonly<Record<string, string>>;
}

export interface EmbodiedAgentSession {
  readonly id: string;
  readonly launchSpec: AgentLaunchSpec;
  readonly transports: readonly {
    kind: EmbodiedTransportKind;
    id: string;
    label?: string;
  }[];
  /** H5 P2 · advisory list of channel tags the adapter's transport
   *  observer is known to emit (e.g. ['reasoning', 'tool-call',
   *  'message']). Undefined on sessions whose adapter doesn't
   *  register a channel hook; consumers should treat missing channels
   *  as "raw only". */
  readonly snapshotChannels?: readonly string[];
  state(): {
    status: EmbodiedSessionStatus;
    paneId?: string;
    windowId?: number;
    title?: string;
    startedAt?: number;
    finishedAt?: number;
    lastError?: string;
  };
  send(input: string): Promise<void>;
  interrupt(signal?: EmbodiedInterruptSignal): Promise<void>;
  snapshot(): Promise<string>;
  dispose(): Promise<void>;
}

export interface AgentAdapter {
  readonly id: string;
  supports(spec: AgentLaunchSpec): boolean;
  launch(spec: AgentLaunchSpec): Promise<EmbodiedAgentSession>;
}
