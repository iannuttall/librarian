import { ProxyAgent } from "undici";

export interface ProxyConfig {
  endpoint?: string;
  headlessEndpoint?: string;
}

let cachedAgent: ProxyAgent | null = null;
let cachedEndpoint: string | null = null;

export function getProxyAgent(endpoint: string | undefined): ProxyAgent | undefined {
  if (!endpoint) return undefined;

  if (cachedAgent && cachedEndpoint === endpoint) {
    return cachedAgent;
  }

  try {
    cachedAgent = new ProxyAgent(endpoint);
    cachedEndpoint = endpoint;
    return cachedAgent;
  } catch {
    return undefined;
  }
}

export function buildFetchOptions(
  proxyEndpoint: string | undefined,
  timeoutMs = 20000,
): RequestInit & { dispatcher?: ProxyAgent } {
  const agent = getProxyAgent(proxyEndpoint);
  return {
    signal: AbortSignal.timeout(timeoutMs),
    ...(agent ? { dispatcher: agent } : {}),
  };
}
