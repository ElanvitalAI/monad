// Slash command: /usage
//
// Screen does not compute. It prints the same structured report the
// `monad usage` command produces.

import { collectUnifiedUsage, formatUnifiedUsage, type UnifiedUsageDeps } from '../../budget/unified-usage.js';
import type { SlashExecuteRequest, SlashExecuteResult } from './dashboard-slash.js';

export interface UsageSlashResult extends SlashExecuteResult {
  ok: boolean;
  logLines: string[];
}

export async function executeUsageSlash(
  req: SlashExecuteRequest,
  deps: UnifiedUsageDeps = {},
): Promise<UsageSlashResult | null> {
  if (req.name !== 'usage' && req.name !== 'remaining') return null;
  const report = await collectUnifiedUsage(deps);
  return {
    ok: true,
    name: req.name,
    args: req.args,
    logLines: formatUnifiedUsage(report).split('\n').filter((line) => line.length > 0),
  };
}
