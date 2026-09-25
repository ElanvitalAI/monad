/** Counts direct Bun test declarations without running them. */
export function countTestDeclarations(source: string): number {
  return (source.match(/^\s*(?:test|it)(?:\.(?:only|skip|todo|if|skipIf|todoIf))?\s*\(/gm) ?? []).length;
}
