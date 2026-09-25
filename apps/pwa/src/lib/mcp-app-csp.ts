const DENY_ALL = "'none'";

export interface McpAppCspDomains {
  connectDomains?: readonly unknown[];
  resourceDomains?: readonly unknown[];
}

/**
 * Accepts only bare HTTP(S) origins. Paths, credentials, query strings,
 * fragments, and non-network schemes cannot become CSP sources.
 */
export function normalizeMcpAppOrigins(origins: readonly unknown[] | undefined): string[] {
  if (!origins) return [];

  const normalized = new Set<string>();
  for (const candidate of origins) {
    if (typeof candidate !== 'string') continue;
    try {
      const url = new URL(candidate);
      if (
        (url.protocol !== 'http:' && url.protocol !== 'https:')
        || url.username
        || url.password
        || url.pathname !== '/'
        || url.search
        || url.hash
      ) continue;
      normalized.add(url.origin);
    } catch {
      // Malformed server metadata must not weaken the policy.
    }
  }
  return [...normalized];
}

function sourcesFor(origins: readonly unknown[] | undefined): string {
  const allowed = normalizeMcpAppOrigins(origins);
  return allowed.length > 0 ? allowed.join(' ') : DENY_ALL;
}

/**
 * Builds a deny-by-default CSP for an untrusted MCP App document.
 * Connections and loadable resources use their distinct MCP Apps metadata
 * fields. Inline scripts remain executable in the opaque, scripts-only frame;
 * external scripts are limited to resourceDomains.
 */
export function buildMcpAppCsp({
  connectDomains,
  resourceDomains,
}: McpAppCspDomains = {}): string {
  const connectSources = sourcesFor(connectDomains);
  const resourceSources = sourcesFor(resourceDomains);

  return [
    `default-src ${DENY_ALL}`,
    `connect-src ${connectSources}`,
    `img-src ${resourceSources}`,
    `media-src ${resourceSources}`,
    `style-src ${resourceSources}`,
    `font-src ${resourceSources}`,
    // Single-document MCP Apps commonly include their own scripts. Keep that
    // execution local while external script loads remain resource-allowlisted.
    `script-src 'unsafe-inline' ${resourceSources}`,
    `base-uri ${DENY_ALL}`,
    `form-action ${DENY_ALL}`,
    `navigate-to ${DENY_ALL}`,
  ].join('; ');
}
