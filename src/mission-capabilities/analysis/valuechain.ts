import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { knowledgeDbPath } from '../../domains/knowledge.js';
import { collectSemisView } from '../../domains/kg-semis.js';
import type { CapabilityProbeResult, CapabilityProvider } from '../registry.js';

type ProbeResult = CapabilityProbeResult;

export function hasValuechainView(view: ReturnType<typeof collectSemisView>): view is NonNullable<ReturnType<typeof collectSemisView>> {
  return view !== null;
}

function collectConfiguredValuechain(): ReturnType<typeof collectSemisView> {
  const path = knowledgeDbPath();
  if (!existsSync(path)) return null;
  const db = new Database(path, { readonly: true });
  try {
    return collectSemisView({ db });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function probeValuechain(collectView: typeof collectSemisView = collectSemisView): ProbeResult {
  if (hasValuechainView(collectView())) return { ok: true };

  return {
    ok: false,
    reason: 'The semiconductor knowledge graph is unavailable.',
    repairHint: {
      paths: ['src/domains/kg-semis.ts'],
      what: 'Populate the semiconductor knowledge graph with chain and relationship data.',
    },
  };
}

export function createValuechainProvider(collectView: typeof collectSemisView = collectSemisView): CapabilityProvider {
  return {
    id: 'analysis.valuechain',
    async probe(): Promise<ProbeResult> {
      return probeValuechain(collectView === collectSemisView ? collectConfiguredValuechain : collectView);
    },
  };
}

export default createValuechainProvider();
