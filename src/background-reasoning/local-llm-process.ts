// Y2 local-llm slot abstraction · logical worker over local-manager.
// Cf. ROADMAP-background-reasoning §5.2 (2-slot allocation) + §6 Y2.
// Slot owns nodeId+modelId+role; caller injects the LLM runner so Y3/Y4
// agents stay decoupled from local-manager probe internals.

export type SlotRole = 'patcher' | 'thinker';
export type SlotState = 'free' | 'assigned' | 'busy' | 'paused';

export interface LocalSlotAssignment {
  nodeId: string;
  modelId: string;
  baseUrl: string;
  role: SlotRole;
}

export interface LocalLLMTask<TIn, TOut> {
  /** Slot role this task is meant for. Slot rejects mismatched roles. */
  role: SlotRole;
  input: TIn;
  run: (input: TIn, assignment: LocalSlotAssignment) => Promise<TOut>;
}

export class LocalLLMProcess {
  private state: SlotState = 'free';
  private assignment: LocalSlotAssignment | null = null;
  private readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  slotId(): string {
    return this.id;
  }

  status(): SlotState {
    return this.state;
  }

  role(): SlotRole | null {
    return this.assignment?.role ?? null;
  }

  current(): LocalSlotAssignment | null {
    return this.assignment ? { ...this.assignment } : null;
  }

  assign(a: LocalSlotAssignment): void {
    if (this.state === 'busy') {
      throw new Error(`slot ${this.id} busy; cannot reassign`);
    }
    this.assignment = a;
    this.state = 'assigned';
  }

  release(): void {
    if (this.state === 'busy') {
      throw new Error(`slot ${this.id} busy; cannot release mid-task`);
    }
    this.assignment = null;
    this.state = 'free';
  }

  pause(): void {
    if (this.state === 'busy') return;
    this.state = 'paused';
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = this.assignment ? 'assigned' : 'free';
  }

  async run<TIn, TOut>(task: LocalLLMTask<TIn, TOut>): Promise<TOut> {
    if (!this.assignment) throw new Error(`slot ${this.id} not assigned`);
    if (this.assignment.role !== task.role) {
      throw new Error(`slot ${this.id} role=${this.assignment.role} ≠ task ${task.role}`);
    }
    if (this.state === 'paused') throw new Error(`slot ${this.id} paused`);
    if (this.state === 'busy') throw new Error(`slot ${this.id} busy`);
    this.state = 'busy';
    try {
      return await task.run(task.input, this.assignment);
    } finally {
      this.state = this.assignment ? 'assigned' : 'free';
    }
  }
}

export interface LocalLLMPoolOpts {
  size: number;
}

export class LocalLLMPool {
  private readonly slots: LocalLLMProcess[];

  constructor(opts: LocalLLMPoolOpts) {
    if (opts.size < 1) throw new Error('pool size must be >= 1');
    this.slots = Array.from({ length: opts.size }, (_, i) => new LocalLLMProcess(`slot-${i}`));
  }

  all(): readonly LocalLLMProcess[] {
    return this.slots;
  }

  findFree(): LocalLLMProcess | null {
    return this.slots.find((s) => s.status() === 'free') ?? null;
  }

  findByRole(role: SlotRole): LocalLLMProcess | null {
    return this.slots.find((s) => s.role() === role) ?? null;
  }

  busyCount(): number {
    return this.slots.filter((s) => s.status() === 'busy').length;
  }

  pauseAll(): void {
    for (const s of this.slots) s.pause();
  }

  resumeAll(): void {
    for (const s of this.slots) s.resume();
  }
}
