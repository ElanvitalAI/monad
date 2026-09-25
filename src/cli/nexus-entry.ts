export interface NexusDefaultArgvOpts {
  rawArgs: readonly string[];
}

export function rewriteBareNexusToStatus(opts: NexusDefaultArgvOpts): string[] {
  if (opts.rawArgs.length === 1 && opts.rawArgs[0] === 'nexus') {
    return ['nexus', 'status'];
  }
  return opts.rawArgs.slice();
}

export interface ImplicitBgDecisionOpts {
  tools?: string;
  bg?: boolean;
  headless?: boolean;
  status?: boolean;
  stop?: boolean;
  tui?: boolean;
}

export function shouldImplicitBgLaunch(opts: ImplicitBgDecisionOpts): boolean {
  return Boolean(opts.tools)
    && !opts.bg
    && !opts.headless
    && !opts.status
    && !opts.stop
    && !opts.tui;
}
