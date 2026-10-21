// Bound both the headers and body read; a stalled source must not occupy a
// worker forever. Never send browser cookies to third-party source APIs.
export const REQUEST_TIMEOUT = 12000;

async function request(url, type) {
  const response = await fetch(url, {
    headers: { accept: type === "json" ? "application/json" : "text/html" },
    credentials: "omit",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return type === "json" ? response.json() : response.text();
}

export function getJson(url) { return request(url, "json"); }
export function getText(url) { return request(url, "text"); }
