/**
 * Loopback destinations that must always bypass an injected system proxy.
 * Gateway child processes health-check local skill bridge servers over HTTP
 * (for example web-search on 127.0.0.1); routing those requests through the
 * system proxy can make checks fail and trigger duplicate server startups.
 */
export const LOCAL_NO_PROXY_ENTRIES = ['localhost', '127.0.0.1', '::1'] as const;

/**
 * Merge existing no_proxy/NO_PROXY values with the required loopback entries.
 * Existing entries keep their order and casing; loopback entries are appended
 * once, deduplicated case-insensitively.
 */
export function mergeNoProxyValue(...existingValues: Array<string | undefined>): string {
  const entries: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string): void => {
    const entry = raw.trim();
    if (!entry) {
      return;
    }
    const key = entry.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    entries.push(entry);
  };

  for (const value of existingValues) {
    for (const item of (value ?? '').split(',')) {
      push(item);
    }
  }

  for (const entry of LOCAL_NO_PROXY_ENTRIES) {
    push(entry);
  }

  return entries.join(',');
}
