export type RunControlSource = 'prefix' | 'flag' | 'config' | 'default';

export interface RunControlDefinition<T> {
  readonly key: string;
  readonly describe: string;
  readonly parse: (value: string) => T | undefined;
  readonly default: T;
}

function parseGraph(value: string): boolean | undefined {
  if (value === 'on') return true;
  if (value === 'off') return false;
  return undefined;
}

export const RUN_CONTROLS = {
  // ⛔⭐ 기본값이 «두 자리»에 있다 — 여기와 `src/user-config.ts` 의 TOOLS_DEFAULTS.
  //   🩸 2026-09-10: user-config 만 true 로 뒤집었더니 `resolveGraphAuthority({})` 가
  //      «여전히 false» 를 냈고, 그 판의 시험 34개는 «전부 초록»이었다.
  //      ⇒ 「한 자리를 고쳤다」와 「그 경로가 바뀌었다」는 다른 값이다.
  //   🔎 반증: bun -e "…resolveGraphAuthority({})…" 가 enabled:true · source:'default' 를 내나
  graph: { key: 'graph', describe: 'graph authority (on|off)', parse: parseGraph, default: true },
} as const satisfies Readonly<Record<string, RunControlDefinition<unknown>>>;

export type RunControlKey = keyof typeof RUN_CONTROLS;
export type RunControls = Partial<Record<RunControlKey, unknown>>;

export interface RunControlRejection {
  readonly key: string;
  readonly value: string;
  readonly reason: 'unknown-key' | 'invalid-value';
}

export function parseRunControlPrefix(text: string): {
  readonly controls: RunControls;
  readonly rejections: readonly RunControlRejection[];
} {
  const controls: RunControls = {};
  const rejections: RunControlRejection[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^제어:\s*([^=\s]+)\s*=\s*(\S+)\s*$/.exec(line);
    if (!match) break;
    const [, key, value] = match;
    const definition = RUN_CONTROLS[key as RunControlKey];
    if (!definition) {
      rejections.push({ key, value, reason: 'unknown-key' });
      continue;
    }
    const parsed = definition.parse(value);
    if (parsed === undefined) {
      rejections.push({ key, value, reason: 'invalid-value' });
      continue;
    }
    controls[key as RunControlKey] = parsed;
  }
  return { controls, rejections };
}

export function parseRunControlValue(key: RunControlKey, value: string): unknown | undefined {
  return RUN_CONTROLS[key].parse(value);
}

export function resolveRunControl(key: RunControlKey, sources: {
  readonly prefix?: RunControls;
  readonly flag?: RunControls;
  readonly config?: RunControls;
}): { readonly value: unknown; readonly source: RunControlSource } {
  const definition = RUN_CONTROLS[key];
  for (const source of ['prefix', 'flag', 'config'] as const) {
    const value = sources[source]?.[key];
    if (value !== undefined) return { value, source };
  }
  return { value: definition.default, source: 'default' };
}
