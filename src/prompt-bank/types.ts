export type PromptScope =
  | 'global'
  | 'workspace'
  | 'project'
  | 'session'
  | 'plugin'
  | 'skill'
  | 'workflow'
  | 'device';

export type PromptKind =
  | 'instruction'
  | 'schema'
  | 'tool-policy'
  | 'view-state'
  | 'device-capability'
  | 'workflow-step'
  | 'debug-advice';

export type PromptTargetSlot =
  | 'system'
  | 'context'
  | 'user-prefix'
  | 'tool-hint';

export interface PromptFragment {
  id: string;
  name: string;
  version: number;
  scope: PromptScope;
  owner: string;
  kind: PromptKind;
  targetSlot: PromptTargetSlot;
  priority: number;
  enabled: boolean;
  content: string;
  description?: string;
  tags: string[];
  triggers: Record<string, unknown>;
  constraints: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  useCount: number;
}

export interface CreatePromptFragmentInput {
  id?: string;
  name: string;
  scope: PromptScope;
  owner: string;
  kind: PromptKind;
  targetSlot: PromptTargetSlot;
  content: string;
  version?: number;
  priority?: number;
  enabled?: boolean;
  description?: string;
  tags?: string[];
  triggers?: Record<string, unknown>;
  constraints?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type UpdatePromptFragmentInput = Partial<Omit<
  CreatePromptFragmentInput,
  'id' | 'scope' | 'owner'
>> & {
  scope?: PromptScope;
  owner?: string;
};

export interface PromptSearchQuery {
  query?: string;
  scope?: PromptScope;
  owner?: string;
  kind?: PromptKind;
  targetSlot?: PromptTargetSlot;
  tags?: string[];
  enabled?: boolean;
  limit?: number;
}

export interface PromptBankStore {
  readonly kind: 'sqlite';
  create(input: CreatePromptFragmentInput): PromptFragment;
  update(id: string, patch: UpdatePromptFragmentInput): PromptFragment;
  get(id: string): PromptFragment | null;
  list(query?: PromptSearchQuery): PromptFragment[];
  search(query: PromptSearchQuery): PromptFragment[];
  setEnabled(id: string, enabled: boolean): PromptFragment;
  delete(id: string): void;
  recordUse(ids: readonly string[], usedAt?: string): void;
  recordInjection(input: PromptInjectionLogInput): PromptInjectionLog;
  getInjectionLog(id: string): PromptInjectionLog | null;
  listInjectionLogs(limit?: number): PromptInjectionLog[];
  close?(): void;
}

export interface PromptRuntimeState {
  activeView?: string;
  focusedPane?: string;
  visiblePanes?: string[];
  activePlugins?: string[];
  loadedSkills?: string[];
  loadedWorkflows?: string[];
  onlineResources?: string[];
  intents?: string[];
  debugLevel?: string;
  modelFamily?: string;
  tags?: string[];
}

export interface PromptSelectionOptions {
  budgetTokens?: number;
  limit?: number;
}

export interface PromptRejection {
  id: string;
  reason: string;
}

export interface PromptSelection {
  selected: PromptFragment[];
  rejected: PromptRejection[];
  tokenEstimate: number;
}

export interface PromptInjectionLogInput {
  id?: string;
  sessionId?: string;
  turnId?: string;
  model?: string;
  activeView?: string;
  activePlugin?: string;
  selectedFragmentIds: string[];
  rejected: PromptRejection[];
  tokenEstimate: number;
  slots?: Partial<Record<PromptTargetSlot, string>>;
  metadata?: Record<string, unknown>;
}

export interface PromptInjectionLog {
  id: string;
  sessionId?: string;
  turnId?: string;
  model?: string;
  activeView?: string;
  activePlugin?: string;
  selectedFragmentIds: string[];
  rejected: PromptRejection[];
  tokenEstimate: number;
  slots: Partial<Record<PromptTargetSlot, string>>;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PromptInjectionBuildOptions extends PromptSelectionOptions {
  sessionId?: string;
  turnId?: string;
  model?: string;
  activePlugin?: string;
  includeHeaders?: boolean;
  record?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PromptInjection {
  selection: PromptSelection;
  slots: Partial<Record<PromptTargetSlot, string>>;
  tokenEstimate: number;
  log?: PromptInjectionLog;
}
