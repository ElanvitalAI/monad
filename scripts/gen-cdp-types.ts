// Auto-generate TypeScript bindings for Chrome DevTools Protocol.
//
// Reads `devtools-protocol/json/{browser,js}_protocol.json` and emits
// `src/browser-cdp/generated.d.ts` with one namespace per domain
// plus method → params/result and event → payload maps.
//
// Run: `bun run scripts/gen-cdp-types.ts`
//   or `bun run gen:cdp`
//
// Deterministic: output sorted by domain/symbol name so diffs track
// upstream spec changes cleanly.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');
const OUT_PATH = resolve(REPO_ROOT, 'src/browser-cdp/generated.d.ts');

// ─── Types mirroring the CDP JSON schema (relaxed) ──────────────

type CdpBase =
  | 'string' | 'integer' | 'number' | 'boolean'
  | 'object' | 'array' | 'any' | 'binary';

interface CdpFieldBase {
  name: string;
  description?: string;
  optional?: boolean;
  experimental?: boolean;
  deprecated?: boolean;
}

interface CdpField extends CdpFieldBase {
  type?: CdpBase;
  $ref?: string;
  enum?: string[];
  items?: CdpRefOrType;
  properties?: CdpField[];
}

type CdpRefOrType = {
  type?: CdpBase;
  $ref?: string;
  enum?: string[];
  items?: CdpRefOrType;
  properties?: CdpField[];
};

interface CdpType extends CdpRefOrType {
  id: string;
  description?: string;
  experimental?: boolean;
  deprecated?: boolean;
}

interface CdpCommand extends CdpFieldBase {
  parameters?: CdpField[];
  returns?: CdpField[];
  redirect?: string;
}

interface CdpEvent extends CdpFieldBase {
  parameters?: CdpField[];
}

interface CdpDomain {
  domain: string;
  description?: string;
  dependencies?: string[];
  experimental?: boolean;
  deprecated?: boolean;
  types?: CdpType[];
  commands?: CdpCommand[];
  events?: CdpEvent[];
}

interface CdpProtocol {
  version: { major: string; minor: string };
  domains: CdpDomain[];
}

// ─── Naming helpers ─────────────────────────────────────────────

function upperFirst(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function paramsInterface(cmd: string): string {
  return `${upperFirst(cmd)}Request`;
}

function resultInterface(cmd: string): string {
  return `${upperFirst(cmd)}Response`;
}

function eventInterface(evt: string): string {
  return `${upperFirst(evt)}Event`;
}

// ─── TypeScript rendering ───────────────────────────────────────

function tsPrimitive(t: CdpBase | undefined): string {
  switch (t) {
    case 'string': return 'string';
    case 'integer':
    case 'number':  return 'number';
    case 'boolean': return 'boolean';
    case 'object':  return 'Record<string, unknown>';
    case 'array':   return 'unknown[]';
    case 'binary':  return 'string'; // CDP encodes binary as base64 string
    case 'any':
    case undefined:
    default:        return 'unknown';
  }
}

function renderRef(ref: string, currentDomain: string): string {
  // Cross-domain reference: "DOM.NodeId"
  if (ref.includes('.')) {
    const [domain, type] = ref.split('.');
    return `${domain}.${type}`;
  }
  // Same-domain reference — fully-qualify so the map section works
  // from outside the namespace.
  return `${currentDomain}.${ref}`;
}

function renderTypeExpr(f: CdpRefOrType, currentDomain: string): string {
  if (f.$ref) return renderRef(f.$ref, currentDomain);
  if (f.enum && f.enum.length > 0) {
    return f.enum.map((e) => JSON.stringify(e)).join(' | ');
  }
  if (f.type === 'array') {
    if (f.items) {
      const inner = renderTypeExpr(f.items, currentDomain);
      return `${inner}[]`;
    }
    return 'unknown[]';
  }
  if (f.type === 'object' && f.properties && f.properties.length > 0) {
    // Inline object literal.
    const props = f.properties.map((p) => renderField(p, currentDomain)).join(' ');
    return `{ ${props} }`;
  }
  return tsPrimitive(f.type);
}

function renderField(f: CdpField, currentDomain: string): string {
  const name = /^[A-Za-z_$][\w$]*$/.test(f.name) ? f.name : JSON.stringify(f.name);
  const opt = f.optional ? '?' : '';
  const type = renderTypeExpr(f, currentDomain);
  return `${name}${opt}: ${type};`;
}

function renderJsDoc(desc: string | undefined, ...flags: Array<string | undefined>): string {
  const parts: string[] = [];
  if (desc) {
    const clean = desc.replace(/\*\//g, '*\\/').split('\n');
    parts.push(...clean);
  }
  for (const flag of flags) if (flag) parts.push(`@${flag}`);
  if (parts.length === 0) return '';
  if (parts.length === 1) return `  /** ${parts[0]} */\n`;
  const body = parts.map((p) => `   * ${p}`).join('\n');
  return `  /**\n${body}\n   */\n`;
}

function renderType(t: CdpType, currentDomain: string): string {
  const flags: string[] = [];
  if (t.experimental) flags.push('experimental');
  if (t.deprecated)   flags.push('deprecated');
  const doc = renderJsDoc(t.description, ...flags);

  // Enum → string literal union alias.
  if (t.enum && t.enum.length > 0) {
    const u = t.enum.map((e) => JSON.stringify(e)).join(' | ');
    return `${doc}  export type ${t.id} = ${u};\n`;
  }

  // Object with properties → interface.
  if (t.type === 'object' && t.properties && t.properties.length > 0) {
    const body = t.properties.map((p) => '    ' + renderField(p, currentDomain)).join('\n');
    return `${doc}  export interface ${t.id} {\n${body}\n  }\n`;
  }

  // Array alias.
  if (t.type === 'array') {
    const inner = t.items ? renderTypeExpr(t.items, currentDomain) : 'unknown';
    return `${doc}  export type ${t.id} = ${inner}[];\n`;
  }

  // Primitive alias.
  return `${doc}  export type ${t.id} = ${tsPrimitive(t.type)};\n`;
}

function renderInterfaceFromFields(name: string, fields: CdpField[] | undefined, currentDomain: string, doc = ''): string {
  if (!fields || fields.length === 0) {
    return `${doc}  export interface ${name} {}\n`;
  }
  const body = fields.map((f) => '    ' + renderField(f, currentDomain)).join('\n');
  return `${doc}  export interface ${name} {\n${body}\n  }\n`;
}

function renderCommand(c: CdpCommand, currentDomain: string): string {
  if (c.redirect) {
    // Redirected commands resolve to another domain — skip to avoid
    // duplicate symbols. Consumers pick them up via the target domain.
    return '';
  }
  const flags: string[] = [];
  if (c.experimental) flags.push('experimental');
  if (c.deprecated)   flags.push('deprecated');
  const doc = renderJsDoc(c.description, ...flags);
  const paramsIface = renderInterfaceFromFields(paramsInterface(c.name), c.parameters, currentDomain, doc);
  const resultIface = renderInterfaceFromFields(resultInterface(c.name), c.returns, currentDomain);
  return paramsIface + resultIface;
}

function renderEvent(e: CdpEvent, currentDomain: string): string {
  const flags: string[] = [];
  if (e.experimental) flags.push('experimental');
  if (e.deprecated)   flags.push('deprecated');
  const doc = renderJsDoc(e.description, ...flags);
  return renderInterfaceFromFields(eventInterface(e.name), e.parameters, currentDomain, doc);
}

function renderDomain(d: CdpDomain): string {
  const flags: string[] = [];
  if (d.experimental) flags.push('experimental');
  if (d.deprecated)   flags.push('deprecated');
  const headerDoc = d.description || d.experimental || d.deprecated
    ? `/**\n * ${d.description ?? d.domain}\n${flags.map((f) => ` * @${f}`).join('\n')}${flags.length > 0 ? '\n' : ''} */\n`
    : '';
  const parts: string[] = [headerDoc, `export namespace ${d.domain} {\n`];

  const types = [...(d.types ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  for (const t of types) parts.push(renderType(t, d.domain));

  const commands = [...(d.commands ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  for (const c of commands) parts.push(renderCommand(c, d.domain));

  const events = [...(d.events ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  for (const e of events) parts.push(renderEvent(e, d.domain));

  parts.push('}\n');
  return parts.join('');
}

// ─── Method + event maps ────────────────────────────────────────

function renderCommandsMap(domains: CdpDomain[]): string {
  const lines: string[] = ['export interface CdpCommands {'];
  const pairs: Array<{ method: string; params: string; result: string }> = [];
  for (const d of domains) {
    for (const c of d.commands ?? []) {
      if (c.redirect) continue;
      const method = `${d.domain}.${c.name}`;
      pairs.push({
        method,
        params: `${d.domain}.${paramsInterface(c.name)}`,
        result: `${d.domain}.${resultInterface(c.name)}`,
      });
    }
  }
  pairs.sort((a, b) => a.method.localeCompare(b.method));
  for (const p of pairs) {
    lines.push(`  ${JSON.stringify(p.method)}: { params: ${p.params}; result: ${p.result} };`);
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

function renderEventsMap(domains: CdpDomain[]): string {
  const lines: string[] = ['export interface CdpEvents {'];
  const pairs: Array<{ method: string; payload: string }> = [];
  for (const d of domains) {
    for (const e of d.events ?? []) {
      pairs.push({ method: `${d.domain}.${e.name}`, payload: `${d.domain}.${eventInterface(e.name)}` });
    }
  }
  pairs.sort((a, b) => a.method.localeCompare(b.method));
  for (const p of pairs) {
    lines.push(`  ${JSON.stringify(p.method)}: ${p.payload};`);
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

// ─── Entry ──────────────────────────────────────────────────────

function loadSpec(path: string): CdpProtocol {
  const raw = readFileSync(resolve(REPO_ROOT, path), 'utf8');
  return JSON.parse(raw) as CdpProtocol;
}

function main() {
  const browser = loadSpec('node_modules/devtools-protocol/json/browser_protocol.json');
  const js      = loadSpec('node_modules/devtools-protocol/json/js_protocol.json');

  const domains = [...browser.domains, ...js.domains]
    .sort((a, b) => a.domain.localeCompare(b.domain));

  const version = `${browser.version.major}.${browser.version.minor}`;

  const header = [
    '// ⚠️  AUTO-GENERATED — do not edit by hand.',
    `// Source: devtools-protocol v${version}`,
    '// Regenerate: `bun run scripts/gen-cdp-types.ts`',
    '',
    '/* eslint-disable */',
    '',
  ].join('\n');

  const body = domains.map(renderDomain).join('\n');

  const maps = '\n' + renderCommandsMap(domains) + '\n' + renderEventsMap(domains) + '\n';

  const helpers = [
    'export type CdpMethodName = keyof CdpCommands;',
    'export type CdpMethodParams<M extends CdpMethodName> = CdpCommands[M][\'params\'];',
    'export type CdpMethodResult<M extends CdpMethodName> = CdpCommands[M][\'result\'];',
    '',
    'export type CdpEventName = keyof CdpEvents;',
    'export type CdpEventPayload<E extends CdpEventName> = CdpEvents[E];',
    '',
  ].join('\n');

  const out = header + body + maps + helpers;

  writeFileSync(OUT_PATH, out);
  const commandCount = domains.reduce((acc, d) => acc + (d.commands?.filter((c) => !c.redirect).length ?? 0), 0);
  const eventCount   = domains.reduce((acc, d) => acc + (d.events?.length ?? 0), 0);
  const typeCount    = domains.reduce((acc, d) => acc + (d.types?.length ?? 0), 0);
  console.log(
    `generated ${OUT_PATH}\n` +
    `  domains: ${domains.length}\n` +
    `  commands: ${commandCount}\n` +
    `  events: ${eventCount}\n` +
    `  types: ${typeCount}\n` +
    `  spec version: ${version}`,
  );
}

main();
