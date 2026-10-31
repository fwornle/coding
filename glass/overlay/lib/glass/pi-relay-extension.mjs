// lib/glass/pi-relay-extension.mjs — the pi extension `glass pi` loads (`pi -e`) when
// pi has providers on plain HTTP (a local model server, another tool's proxy).
//
// Plain-HTTP traffic never passes HTTPS_PROXY, so glass cannot intercept it. pi
// reads its providers from ~/.pi/agent/models.json, which glass never edits;
// instead this extension, for the run only, points each such provider's base URL
// at the daemon's /relay/<token>/<provider> (GLASS_PI_RELAYS, set by wiring.mjs),
// which forwards to the original URL and measures the call. pi keeps the
// provider's models, key and headers from models.json.
//
// Outside `glass pi` GLASS_PI_RELAYS is unset and the extension does nothing.

/** @param {{ registerProvider: (id: string, config: { baseUrl: string }) => void }} pi */
export default function glassPiRelays(pi, env = process.env) {
  let relays = {};
  try { relays = JSON.parse(env.GLASS_PI_RELAYS || '{}'); } catch { return; }
  if (!relays || typeof relays !== 'object') return;
  for (const [id, baseUrl] of Object.entries(relays)) {
    if (typeof baseUrl === 'string') pi.registerProvider(id, { baseUrl });
  }
}
