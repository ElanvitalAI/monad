const PTY_QUERY_KEY = 'pty';

export function termPtySelectionHref(currentHref: string, terminalId: string): string | null {
  const url = new URL(currentHref);
  if (url.searchParams.get(PTY_QUERY_KEY) === terminalId) return null;
  url.searchParams.set(PTY_QUERY_KEY, terminalId);
  return `${url.pathname}${url.search}${url.hash}`;
}
