const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = '3000';

export const STORAGE_KEYS = {
  serverUrl: 'd2_server_url',
  serverPort: 'd2_server_port',
} as const;

/**
 * Builds a safe HTTP(S) base URL from the address entered in the connection
 * screen.  It accepts an IP, a hostname, or a complete https:// address.
 */
export function resolveServerBaseUrl(hostInput?: string | null, portInput?: string | null): string {
  const rawHost = (hostInput || DEFAULT_HOST).trim();
  const rawPort = (portInput || DEFAULT_PORT).trim();
  const hasProtocol = /^https?:\/\//i.test(rawHost);
  const candidate = hasProtocol ? rawHost : `http://${rawHost}`;

  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('invalid protocol');
    // A port in the address itself has priority. This makes links such as
    // https://discord.example.com work without requiring the user to clear
    // the separate port field.
    if (!url.port && rawPort && /^\d{1,5}$/.test(rawPort)) url.port = rawPort;
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
  }
}

export function getStoredServerBaseUrl(): string {
  try {
    return resolveServerBaseUrl(
      localStorage.getItem(STORAGE_KEYS.serverUrl),
      localStorage.getItem(STORAGE_KEYS.serverPort)
    );
  } catch {
    return `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
  }
}
