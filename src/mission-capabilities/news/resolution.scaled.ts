import { Database, type Database as SqliteDatabase } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { SIGNALS_DB_PATH, openSignalsDb } from '../../domains/breaking-signals.js';
import { ensureDigTables, nextDiggable, pickSearchPlan, type DigItem, type SearchPlan } from '../../domains/dig-engine.js';
import type { CapabilityProbeResult, CapabilityProvider } from '../registry.js';

type ProbeResult = CapabilityProbeResult;
type OpenDb = () => SqliteDatabase;
type EnsureTables = typeof ensureDigTables;
type NextItem = typeof nextDiggable;
type PickPlan = typeof pickSearchPlan;

export interface NewsPlan { item: DigItem; plan: SearchPlan }

export function readNewsPlans(db: SqliteDatabase): NewsPlan[] {
  const item = nextDiggable(db);
  return item === null ? [] : [{ item, plan: pickSearchPlan(item) }];
}

export function readConfiguredNewsPlans(): NewsPlan[] {
  if (!existsSync(SIGNALS_DB_PATH)) return [];
  const db = new Database(SIGNALS_DB_PATH, { readonly: true });
  try { return readNewsPlans(db); } catch { return []; } finally { db.close(); }
}

function missingSignalsStore(): ProbeResult {
  return { ok: false, reason: 'The news signals store is unavailable or does not contain the dig queue schema.', repairHint: { paths: ['src/domains/dig-engine.ts'], what: 'Run the news-signal ingest or dig queue setup before requesting resolution-scaled investigation.' } };
}

function probeConfiguredScaledResolution(): ProbeResult {
  if (!existsSync(SIGNALS_DB_PATH)) return missingSignalsStore();
  const db = new Database(SIGNALS_DB_PATH, { readonly: true });
  try { return probeScaledResolution(() => db, undefined, nextDiggable, pickSearchPlan); } catch { return missingSignalsStore(); }
}

export function probeScaledResolution(openDb: OpenDb = openSignalsDb, ensureTables: EnsureTables | undefined = ensureDigTables, nextItem: NextItem = nextDiggable, pickPlan: PickPlan = pickSearchPlan): ProbeResult {
  const db = openDb();
  try {
    ensureTables?.(db);
    const item = nextItem(db);
    if (item === null) return { ok: false, reason: 'No queued news signal is available for resolution-scaled investigation.', repairHint: { paths: ['src/domains/dig-engine.ts'], what: 'Queue a diggable news signal so its search plan can be evaluated.' } };
    pickPlan(item);
    return { ok: true };
  } finally { db.close(); }
}

export function createScaledResolutionProvider(openDb: OpenDb = openSignalsDb, ensureTables: EnsureTables = ensureDigTables, nextItem: NextItem = nextDiggable, pickPlan: PickPlan = pickSearchPlan): CapabilityProvider {
  const injected = openDb !== openSignalsDb || ensureTables !== ensureDigTables || nextItem !== nextDiggable || pickPlan !== pickSearchPlan;
  return { id: 'news.resolution.scaled', async probe(): Promise<ProbeResult> { return injected ? probeScaledResolution(openDb, ensureTables, nextItem, pickPlan) : probeConfiguredScaledResolution(); } };
}

export default createScaledResolutionProvider();
