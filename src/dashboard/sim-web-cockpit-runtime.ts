import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { getBrowserCdpAvailability, type BrowserCdpAvailability } from '../browser-cdp/availability.js';
import {
  defaultControlSignalObserver,
  type ControlSignalObserver,
} from '../input/control-signal-observer.js';
import type { SimulationScenario } from '../sim/catalog.js';

export interface DashboardSimWebCockpitRuntimeDeps {
  listScenarios: () => readonly SimulationScenario[];
  openTarget: (urlOrPath: string) => Promise<void> | void;
  getBrowserCdpAvailability?: () => BrowserCdpAvailability;
  getControlSignalObserver?: () => ControlSignalObserver;
  tmpDir?: string;
  now?: () => number;
}

export interface DashboardSimWebCockpitOpenResult {
  path: string;
  scenarioCount: number;
  signalCount: number;
  browserAvailable: boolean;
}

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildScenarioCards(scenarios: readonly SimulationScenario[]): string {
  return scenarios.map((scenario) => `
    <article class="card scenario">
      <div class="row">
        <span class="badge">${escapeHtml(scenario.badge)}</span>
        <span class="family">${escapeHtml(scenario.family)}</span>
      </div>
      <h3>${escapeHtml(scenario.label)}</h3>
      <p>${escapeHtml(scenario.summary)}</p>
      <div class="meta">id: ${escapeHtml(scenario.id)}</div>
      <div class="meta">targets: ${escapeHtml(scenario.targets.join(' · '))}</div>
      <div class="meta">inject: ${escapeHtml(scenario.injectKind)} · observe: ${escapeHtml(scenario.primaryObserveSurface)}</div>
      <div class="meta">flow:</div>
      <ul>
        ${scenario.flow.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}
      </ul>
    </article>
  `).join('');
}

function buildSignalCards(observer: ControlSignalObserver): string {
  const latest = observer.list().slice(-8).reverse();
  if (latest.length === 0) {
    return `<article class="card empty">No local control signals observed yet.</article>`;
  }
  return latest.map((signal) => `
    <article class="card signal">
      <div class="row">
        <strong>${escapeHtml(signal.kind)}</strong>
        <span class="urgency">${escapeHtml(signal.urgency)}</span>
      </div>
      <div class="meta">${escapeHtml(signal.createdAt)}</div>
      <div class="meta">surface=${escapeHtml(signal.scope?.surface ?? '-')} · channel=${escapeHtml(signal.scope?.channel ?? '-')}</div>
      <pre>${escapeHtml(JSON.stringify(signal.payload ?? {}, null, 2))}</pre>
    </article>
  `).join('');
}

function buildCountsPills(observer: ControlSignalObserver): string {
  const counts = observer.countsByKind();
  const entries = Object.entries(counts);
  if (entries.length === 0) return '<span class="pill">signals 0</span>';
  return entries
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([kind, count]) => `<span class="pill">${escapeHtml(kind)} ${escapeHtml(String(count))}</span>`)
    .join('');
}

function buildHtml(
  scenarios: readonly SimulationScenario[],
  observer: ControlSignalObserver,
  availability: BrowserCdpAvailability,
): string {
  const browserTone = availability.available ? 'ok' : 'warn';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>elanous sim cockpit</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b0d10;
      --surface: #15181c;
      --surface2: #1c2024;
      --border: #2a2e33;
      --fg: #f0eee6;
      --muted: #8a8a82;
      --accent: #c4a160;
      --ok: #4a8a55;
      --warn: #d39b52;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: radial-gradient(circle at top, #1a1f24 0%, #0b0d10 55%);
      color: var(--fg);
      font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    }
    header, main { max-width: 1360px; margin: 0 auto; }
    header { padding: 20px 24px 12px; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    .lede { color: var(--muted); line-height: 1.45; max-width: 900px; }
    .grid {
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr) 340px;
      gap: 16px;
      padding: 16px 24px 28px;
      align-items: start;
    }
    .panel, .card {
      background: rgba(21, 24, 28, 0.94);
      border: 1px solid var(--border);
      border-radius: 16px;
      box-shadow: 0 12px 28px rgba(0,0,0,0.18);
    }
    .panel { padding: 16px; }
    .panel h2 { margin: 0 0 12px; font-size: 15px; }
    .stack { display: flex; flex-direction: column; gap: 12px; }
    .rail-item {
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface2);
      font-size: 13px;
      color: var(--fg);
    }
    .rail-item small { display: block; color: var(--muted); margin-top: 4px; }
    .cards { display: flex; flex-direction: column; gap: 12px; }
    .card { padding: 14px 15px; }
    .card h3 { margin: 8px 0 6px; font-size: 16px; }
    .card p { margin: 0 0 8px; color: var(--muted); line-height: 1.45; }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .badge, .pill, .family, .urgency {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }
    .badge { color: var(--accent); }
    .status-pill.${browserTone} { color: ${availability.available ? 'var(--ok)' : 'var(--warn)'}; }
    .meta { color: var(--muted); font-size: 12px; margin-top: 4px; }
    ul { margin: 8px 0 0 18px; padding: 0; color: var(--fg); }
    li { margin: 4px 0; }
    pre {
      margin: 8px 0 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 12px;
      color: #ece6d7;
    }
    .note { color: var(--muted); font-size: 13px; line-height: 1.5; }
    @media (max-width: 1100px) {
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Simulator + Diagnose Cockpit</h1>
    <div class="lede">
      Local quick-test mode. This page is generated directly by the dashboard process on one machine.
      No daemon transport is required for this path. Production mode will later move the same catalog,
      probe, and control-line model onto daemon HTTP + WebSocket.
    </div>
  </header>
  <main class="grid">
    <section class="panel stack">
      <h2>Catalog</h2>
      <div class="rail-item">Simulation scenarios<small>${escapeHtml(String(scenarios.length))} scenarios available</small></div>
      <div class="rail-item">Control line<small>Local observer timeline + counts</small></div>
      <div class="rail-item">Embodied surfaces<small>Browser/CDP optional · local-only probe here</small></div>
      <div class="rail-item">Transport split<small>Quick test = local file · production = daemon HTTP/WS</small></div>
    </section>
    <section class="panel">
      <h2>Scenario launcher map</h2>
      <div class="cards">${buildScenarioCards(scenarios)}</div>
    </section>
    <section class="panel stack">
      <h2>Diagnose</h2>
      <article class="card">
        <div class="row">
          <strong>Browser/CDP</strong>
          <span class="pill status-pill ${browserTone}">${escapeHtml(availability.reason)}</span>
        </div>
        <div class="meta">${escapeHtml(availability.note)}</div>
        ${availability.binary ? `<div class="meta">binary: ${escapeHtml(availability.binary)}</div>` : ''}
      </article>
      <article class="card">
        <div class="row">
          <strong>Control signals</strong>
        </div>
        <div class="row">${buildCountsPills(observer)}</div>
        <div class="meta">Latest local timeline entries are shown below.</div>
      </article>
      <div class="cards">${buildSignalCards(observer)}</div>
      <article class="card">
        <strong>Mode split</strong>
        <div class="note">
          Quick test: dashboard writes this HTML and opens it locally.<br />
          Production: daemon core exposes the same catalog, run history, and probes over HTTP + WebSocket.
        </div>
      </article>
    </section>
  </main>
</body>
</html>`;
}

export async function openDashboardLocalSimulationWebCockpit(
  deps: DashboardSimWebCockpitRuntimeDeps,
): Promise<DashboardSimWebCockpitOpenResult> {
  const scenarios = deps.listScenarios();
  const observer = deps.getControlSignalObserver?.() ?? defaultControlSignalObserver();
  const availability = deps.getBrowserCdpAvailability?.() ?? getBrowserCdpAvailability();
  const html = buildHtml(scenarios, observer, availability);
  const outDir = mkdtempSync(path.join(deps.tmpDir ?? tmpdir(), 'elanous-sim-web-'));
  const outPath = path.join(outDir, `index-${deps.now?.() ?? Date.now()}.html`);
  writeFileSync(outPath, html);
  await deps.openTarget(outPath);
  return {
    path: outPath,
    scenarioCount: scenarios.length,
    signalCount: observer.list().length,
    browserAvailable: availability.available,
  };
}
