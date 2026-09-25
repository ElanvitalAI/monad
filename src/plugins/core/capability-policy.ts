import type { ExecutionSurfaceSpec } from '../../display/index.js';
import type { PluginCapability, PluginSource } from './manifest.js';

export type CapabilityDecision =
  | { ok: true }
  | { ok: false; reason: string };

export interface CapabilityPolicyContext {
  pluginId: string;
  source: PluginSource;
  capabilities: PluginCapability[];
  workspaceTrusted?: boolean;
  userTrusted?: boolean;
}

export class PluginCapabilityPolicy {
  constructor(private readonly defaults: { userTrusted?: boolean; workspaceTrusted?: boolean } = {}) {}

  canReadFile(ctx: CapabilityPolicyContext, path: string): CapabilityDecision {
    const trust = this.checkTrust(ctx);
    if (!trust.ok) return trust;
    if (ctx.source === 'builtin') return { ok: true };
    return fileCapabilityDecision(ctx, 'fs:read', path);
  }

  canWriteFile(ctx: CapabilityPolicyContext, path: string): CapabilityDecision {
    const trust = this.checkTrust(ctx);
    if (!trust.ok) return trust;
    if (ctx.source === 'builtin') return { ok: true };
    return fileCapabilityDecision(ctx, 'fs:write', path);
  }

  canNetwork(ctx: CapabilityPolicyContext, url: string): CapabilityDecision {
    const trust = this.checkTrust(ctx);
    if (!trust.ok) return trust;
    if (ctx.source === 'builtin') return { ok: true };
    const host = safeHost(url);
    if (!host) return deny(ctx.pluginId, `invalid network URL: ${url}`);
    const grants = ctx.capabilities.filter(isNetworkCapability);
    if (grants.length === 0) return deny(ctx.pluginId, 'network access requires capability "network"');
    if (grants.some(grant => networkGrantAllows(grant, host))) return { ok: true };
    return deny(ctx.pluginId, `network host "${host}" is not allowed by plugin capabilities`);
  }

  canClipboard(ctx: CapabilityPolicyContext, mode: 'read' | 'write'): CapabilityDecision {
    const trust = this.checkTrust(ctx);
    if (!trust.ok) return trust;
    if (ctx.source === 'builtin') return { ok: true };
    const grants = ctx.capabilities.filter(cap =>
      cap.kind === 'clipboard'
      || cap.kind === `clipboard:${mode}`
    );
    if (grants.length > 0) return { ok: true };
    return deny(ctx.pluginId, `clipboard ${mode} requires capability "clipboard:${mode}"`);
  }

  canSpawnProcess(ctx: CapabilityPolicyContext, spec: ExecutionSurfaceSpec): CapabilityDecision {
    const trust = this.checkTrust(ctx);
    if (!trust.ok) return trust;

    if (ctx.source === 'builtin') return { ok: true };

    const command = requestedCommand(spec);
    const grants = ctx.capabilities.filter(isProcessCapability);
    if (grants.length === 0) {
      return deny(ctx.pluginId, `process execution requires capability "process:spawn"`);
    }

    if (!command) return { ok: true };
    if (grants.some(grant => processGrantAllows(grant, command))) return { ok: true };

    return deny(ctx.pluginId, `process command "${command}" is not allowed by plugin capabilities`);
  }

  private checkTrust(ctx: CapabilityPolicyContext): CapabilityDecision {
    if (ctx.source === 'workspace' && !(ctx.workspaceTrusted ?? this.defaults.workspaceTrusted ?? false)) {
      return deny(ctx.pluginId, 'workspace plugin is not trusted');
    }
    if (ctx.source === 'user' && !(ctx.userTrusted ?? this.defaults.userTrusted ?? true)) {
      return deny(ctx.pluginId, 'user plugin is not trusted');
    }
    return { ok: true };
  }
}

export function assertCapability(decision: CapabilityDecision): void {
  if (!decision.ok) throw new Error(decision.reason);
}

export function requestedCommand(spec: ExecutionSurfaceSpec): string | null {
  const raw = spec.command?.trim() || spec.shell?.trim() || '';
  if (!raw) return null;
  const match = raw.match(/^"([^"]+)"|'([^']+)'|(\S+)/);
  const first = match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
  if (!first) return null;
  const parts = first.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? first;
}

function isProcessCapability(cap: PluginCapability): boolean {
  return cap.kind === 'process:spawn' || cap.kind === 'process:exec';
}

function fileCapabilityDecision(ctx: CapabilityPolicyContext, kind: 'fs:read' | 'fs:write', path: string): CapabilityDecision {
  const grants = ctx.capabilities.filter(cap => cap.kind === kind);
  if (grants.length === 0) return deny(ctx.pluginId, `${kind} requires capability "${kind}"`);
  if (grants.some(grant => fileGrantAllows(grant, path))) return { ok: true };
  return deny(ctx.pluginId, `file path is not allowed by plugin capabilities: ${path}`);
}

function fileGrantAllows(cap: PluginCapability, path: string): boolean {
  const roots = 'roots' in cap && Array.isArray(cap.roots) ? cap.roots : [];
  if (roots.length === 0) return true;
  return roots.some(root => {
    if (typeof root !== 'string' || !root) return false;
    return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);
  });
}

function isNetworkCapability(cap: PluginCapability): boolean {
  return cap.kind === 'network' || cap.kind === 'network:fetch';
}

function networkGrantAllows(cap: PluginCapability, host: string): boolean {
  const hosts = 'hosts' in cap && Array.isArray(cap.hosts)
    ? cap.hosts
    : 'host' in cap && typeof cap.host === 'string'
      ? [cap.host]
      : [];
  if (hosts.length === 0) return true;
  return hosts.some(item => item === '*' || item === host);
}

function safeHost(url: string): string | null {
  try { return new URL(url).host; }
  catch { return null; }
}

function processGrantAllows(cap: PluginCapability, command: string): boolean {
  const commands = processCapabilityCommands(cap);
  if (commands.length === 0) return true;
  return commands.includes(command) || commands.includes('*');
}

function processCapabilityCommands(cap: PluginCapability): string[] {
  const raw = 'commands' in cap ? cap.commands : 'command' in cap ? [cap.command] : [];
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim());
}

function deny(pluginId: string, reason: string): CapabilityDecision {
  return { ok: false, reason: `plugin "${pluginId}": ${reason}` };
}
