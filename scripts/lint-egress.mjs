#!/usr/bin/env node
/**
 * lint-egress.mjs — T4 egress lockdown CI lint.
 *
 * Guards against Family B regressions (in-process SDK clients that bypass the
 * rapid-llm-proxy chokepoint on :12435). See CLAUDE.md + docs on the two
 * egress families. Enforced rules:
 *
 *   1. Direct provider client constructions (`new OpenAI(` / `new Anthropic(` /
 *      `new Groq(` / ...) must set a `baseURL` in their constructor options
 *      (proxy or local endpoint). Constructions without one go straight to the
 *      provider cloud and fail the lint unless allowlisted.
 *
 *   2. `new LLMService(` (in-process provider selection from @rapid/llm-proxy)
 *      is ratcheted: only the allowlisted legacy call sites may construct it.
 *      New code must call the proxy daemon (`POST :12435/api/complete`) or the
 *      llm-with-process wrapper instead.
 *
 * Allowlist: config/egress-lint-allowlist.json — every entry needs a reason,
 * and additions are reviewable in the diff. That file is the override
 * mechanism; there is no env-var escape hatch by design.
 *
 * Scans the parent repo plus every initialized submodule (git-tracked and
 * untracked-but-not-ignored source files). No npm-installed dependencies, so
 * it runs in CI straight after checkout.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Logger } from "../lib/knowledge-api/utils/logging.js";

const logger = new Logger({ timestamp: false, colors: false });

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowlistPath = path.join(repoRoot, "config", "egress-lint-allowlist.json");

const PROVIDER_PACKAGES = [
  "openai",
  "@anthropic-ai/sdk",
  "@anthropic-ai/bedrock-sdk",
  "@anthropic-ai/vertex-sdk",
  "groq-sdk",
  "@google/generative-ai",
  "@mistralai/mistralai",
  "cohere-ai",
];

const PROVIDER_CLASSES = [
  "OpenAI",
  "AzureOpenAI",
  "Anthropic",
  "AnthropicBedrock",
  "AnthropicVertex",
  "Groq",
  "GoogleGenerativeAI",
  "Mistral",
  "CohereClient",
  "CohereClientV2",
];

const SOURCE_GLOBS = ["*.ts", "*.js", "*.mjs", "*.cjs"];
const EXCLUDED_SEGMENTS = new Set(["node_modules", "dist", "build", "coverage", ".git"]);

const providerImportRe = new RegExp(
  `(?:from\\s+|require\\s*\\(\\s*)['"](?:${PROVIDER_PACKAGES.map((p) => p.replace(/[/@.-]/g, "\\$&")).join("|")})(?:/|['"])`
);
const providerCtorRe = new RegExp(`new\\s+(${PROVIDER_CLASSES.join("|")})\\s*\\(`, "g");
const llmServiceCtorRe = /new\s+LLMService\s*\(/g;
const baseUrlRe = /base_?url/i;

function loadAllowlist() {
  if (!existsSync(allowlistPath)) {
    logger.error(`egress-lint: missing allowlist file ${allowlistPath}`);
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(allowlistPath, "utf8"));
  return {
    providerClients: raw.providerClients ?? [],
    llmService: raw.llmService ?? [],
  };
}

function gitListFiles(root) {
  const args = [
    "-C",
    root,
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    ...SOURCE_GLOBS,
    ...SOURCE_GLOBS.map((g) => `**/${g}`),
  ];
  const out = execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\n").filter(Boolean);
}

function discoverRoots() {
  // Parent repo plus every submodule that is actually initialized on disk.
  const roots = [{ prefix: "", dir: repoRoot }];
  const gitmodules = path.join(repoRoot, ".gitmodules");
  if (existsSync(gitmodules)) {
    const paths = [...readFileSync(gitmodules, "utf8").matchAll(/^\s*path\s*=\s*(.+)$/gm)].map((m) => m[1].trim());
    for (const sub of paths) {
      const dir = path.join(repoRoot, sub);
      if (existsSync(path.join(dir, ".git"))) {
        roots.push({ prefix: `${sub}/`, dir });
      } else {
        logger.warn(`egress-lint: submodule not initialized, not scanned: ${sub}`);
      }
    }
  }
  return roots;
}

function isExcluded(relPath) {
  if (relPath === "scripts/lint-egress.mjs") return true; // rule text matches its own patterns
  return relPath.split("/").some((seg) => EXCLUDED_SEGMENTS.has(seg)) || relPath.endsWith(".d.ts");
}

/** Extract the balanced-paren argument span starting at the `(` of the match. */
function ctorArgSpan(content, openParenIdx) {
  let depth = 0;
  const end = Math.min(content.length, openParenIdx + 4000);
  for (let i = openParenIdx; i < end; i++) {
    const c = content[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return content.slice(openParenIdx, i + 1);
    }
  }
  return content.slice(openParenIdx, end);
}

function lineOf(content, idx) {
  return content.slice(0, idx).split("\n").length;
}

const allowlist = loadAllowlist();
const roots = discoverRoots();
const violations = [];
const allowUsage = new Map(); // allowlist key -> count of hits absorbed

let filesScanned = 0;
const subPrefixes = roots.map((r) => r.prefix).filter(Boolean);

for (const { prefix, dir } of roots) {
  for (const rel of gitListFiles(dir)) {
    const relPath = prefix + rel;
    if (isExcluded(relPath)) continue;
    // In the parent listing, skip anything under a submodule path (git reports
    // the submodule itself as one entry, but untracked files can still appear).
    if (!prefix && subPrefixes.some((p) => relPath.startsWith(p))) continue;

    let content;
    try {
      content = readFileSync(path.join(dir, rel), "utf8");
    } catch {
      continue; // deleted-but-listed, broken symlink, etc.
    }
    filesScanned++;

    // Rule 1: provider client constructions require a baseURL.
    if (providerImportRe.test(content)) {
      for (const m of content.matchAll(providerCtorRe)) {
        const argSpan = ctorArgSpan(content, m.index + m[0].length - 1);
        if (baseUrlRe.test(argSpan)) continue; // routed via explicit base URL
        const entry = allowlist.providerClients.find((e) => e.file === relPath);
        const line = lineOf(content, m.index);
        if (entry) {
          const used = (allowUsage.get(relPath) ?? 0) + 1;
          allowUsage.set(relPath, used);
          if (used > (entry.maxUnguarded ?? 1)) {
            violations.push({
              file: relPath,
              line,
              rule: "provider-client-no-baseurl",
              detail: `new ${m[1]}( without baseURL exceeds allowlisted maxUnguarded=${entry.maxUnguarded ?? 1}`,
            });
          }
        } else {
          violations.push({
            file: relPath,
            line,
            rule: "provider-client-no-baseurl",
            detail: `new ${m[1]}( without a baseURL goes direct to the provider cloud, bypassing the :12435 proxy`,
          });
        }
      }
    }

    // Rule 2: LLMService construction ratchet.
    if (content.includes("LLMService")) {
      for (const m of content.matchAll(llmServiceCtorRe)) {
        const entry = allowlist.llmService.find((e) => e.file === relPath);
        const line = lineOf(content, m.index);
        if (!entry) {
          violations.push({
            file: relPath,
            line,
            rule: "llmservice-outside-allowlist",
            detail:
              "new LLMService( does in-process provider selection (Family B). Use POST :12435/api/complete or the llm-with-process wrapper.",
          });
        } else {
          const key = `llmservice:${relPath}`;
          const used = (allowUsage.get(key) ?? 0) + 1;
          allowUsage.set(key, used);
          if (used > (entry.maxCount ?? 1)) {
            violations.push({
              file: relPath,
              line,
              rule: "llmservice-outside-allowlist",
              detail: `new LLMService( exceeds allowlisted maxCount=${entry.maxCount ?? 1}`,
            });
          }
        }
      }
    }
  }
}

// Stale allowlist entries (only for roots we actually scanned) — warn, don't
// fail, so a submodule skipped in CI can't turn its entries into false failures.
const scannedRootOf = (file) => subPrefixes.find((p) => file.startsWith(p)) ?? "";
for (const entry of allowlist.providerClients) {
  if (roots.some((r) => r.prefix === scannedRootOf(entry.file)) && !allowUsage.has(entry.file)) {
    logger.warn(`egress-lint: stale allowlist entry (no matching hit): ${entry.file}`);
  }
}
for (const entry of allowlist.llmService) {
  if (roots.some((r) => r.prefix === scannedRootOf(entry.file)) && !allowUsage.has(`llmservice:${entry.file}`)) {
    logger.warn(`egress-lint: stale allowlist entry (no matching hit): ${entry.file}`);
  }
}

logger.info(
  `egress-lint: scanned ${filesScanned} files across ${roots.length} root(s): ${roots.map((r) => r.prefix || ".").join(", ")}`
);

if (violations.length) {
  logger.error(`egress-lint: ${violations.length} violation(s):`);
  for (const v of violations) {
    logger.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.detail}`);
  }
  logger.error(
    "Fix: route through the rapid-llm-proxy (:12435) — set baseURL from LLM_CLI_PROXY_URL, or call POST /api/complete."
  );
  logger.error(
    "Legitimate exception: add an entry with a reason to config/egress-lint-allowlist.json (reviewed in the diff)."
  );
  process.exit(1);
}

logger.info("egress-lint: OK — no unguarded provider-cloud egress found.");
