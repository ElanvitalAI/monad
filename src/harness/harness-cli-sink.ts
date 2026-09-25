import type { Command } from 'commander';

export function installHarnessCliSinkHook(
  harnessCmd: Command,
  registerSink: (surface: string) => Promise<void>,
  resolveSurface: () => Promise<string>,
): void {
  harnessCmd.hook('preAction', async () => {
    try {
      await registerSink(await resolveSurface());
    } catch { /* fail-open — observability wiring must not prevent harness execution */ }
  });
}
