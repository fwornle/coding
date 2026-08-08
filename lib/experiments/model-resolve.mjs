// lib/experiments/model-resolve.mjs
//
// ONE place that turns a loose, human model reference — "opus 4.8", "opus-4.8",
// "claude-opus-4.8", "claude-opus-4-8", "Opus 4.8" — into the correct PER-AGENT
// model string. The same underlying model is spelled differently by each agent's
// CLI/catalog, and getting it wrong makes a cell 404/500 and skip:
//
//   claude     → hyphenated Anthropic id           claude-opus-4-8
//   opencode   → rapid-proxy catalog id (dotted)   rapid-proxy/claude-opus-4.8
//   copilot    → copilot catalog id (dotted)       claude-opus-4.8
//   mastracode → dotted (best-effort)              claude-opus-4.8
//
// So the /experiment skill (and any caller) can accept a SINGLE canonical ref
// from the user and let this resolve the three (or four) spellings — no more
// hand-formulating "with hyphen / without / with provider prefix" per agent.
//
// The Anthropic-family model ids are `claude-<family>-<major>-<minor>` (hyphen)
// on the claude CLI + Anthropic API, and `claude-<family>-<major>.<minor>` (dot)
// in the opencode/copilot catalogs. This module is the mirror of the proxy-side
// `hyphenateClaudeVersion` normalizer (rapid-llm-proxy/proxy-bridge/server.mjs):
// the proxy makes a dotted id work on the Anthropic backend; this makes the skill
// emit the id each agent's own launcher expects in the first place.

const FAMILIES = ['opus', 'sonnet', 'haiku'];

/**
 * Parse a loose model reference into { family, major, minor }.
 * Accepts any separator between major/minor (dot or dash) and the family named
 * anywhere in the string. Returns null when no Claude family+version is found
 * (the caller then keeps the raw string — never guess).
 * @param {string} ref
 * @returns {{family:string, major:string, minor:string}|null}
 */
export function parseModelRef(ref) {
  const s = String(ref || '').toLowerCase().trim();
  const family = FAMILIES.find((f) => s.includes(f));
  if (!family) return null;
  const vm = s.match(/(\d+)[.\-](\d+)/); // first <major>.<minor> or <major>-<minor>
  if (vm) return { family, major: vm[1], minor: vm[2] };
  // MAJOR-ONLY versions. The Claude 5 generation is spelled without a minor —
  // `claude-opus-5`, `claude-sonnet-5` — and requiring a minor rejected it outright,
  // so every agent resolved it to null and callers fell back to a raw string that is
  // wrong for opencode (which needs the `rapid-proxy/` prefix). Matched only when the
  // digit is a version-shaped trailing token, so a dated snapshot such as
  // `claude-haiku-4-5-20251001` still takes the pair branch above.
  const major = s.match(/(?:^|[\s\-_])(\d+)(?:$|[\s\-_])/);
  if (!major) return null;
  return { family, major: major[1], minor: null };
}

/** The dotted catalog id (opencode/copilot): claude-opus-4.8, or claude-opus-5 when minor-less */
export function dottedId({ family, major, minor }) {
  return minor == null ? `claude-${family}-${major}` : `claude-${family}-${major}.${minor}`;
}

/** The hyphenated Anthropic/CLI id: claude-opus-4-8, or claude-opus-5 when minor-less */
export function hyphenId({ family, major, minor }) {
  return minor == null ? `claude-${family}-${major}` : `claude-${family}-${major}-${minor}`;
}

/**
 * Resolve a canonical model reference to the model string a given agent expects.
 * @param {'claude'|'opencode'|'copilot'|'mastracode'} agent
 * @param {string} ref  e.g. "opus 4.8"
 * @returns {string|null} the per-agent model string, or null if `ref` names no
 *   recognizable Claude model (caller keeps its own raw value).
 */
export function resolveModelForAgent(agent, ref) {
  const p = parseModelRef(ref);
  if (!p) return null;
  const dotted = dottedId(p);
  const hyphen = hyphenId(p);
  switch (agent) {
    case 'claude': return hyphen;                 // claude CLI --model
    case 'opencode': return `rapid-proxy/${dotted}`; // opencode rapid-proxy catalog
    case 'copilot': return dotted;                // copilot catalog
    case 'mastracode': return dotted;             // best-effort
    default: return dotted;
  }
}

/**
 * Convenience: resolve one canonical ref into the full per-agent map for a set
 * of agents (defaults to all four). Skips agents where the ref is unrecognized.
 * @param {string} ref
 * @param {string[]} [agents]
 * @returns {Record<string,string>}
 */
export function resolveModelForAgents(ref, agents = ['claude', 'copilot', 'opencode', 'mastracode']) {
  const out = {};
  for (const a of agents) {
    const m = resolveModelForAgent(a, ref);
    if (m) out[a] = m;
  }
  return out;
}
