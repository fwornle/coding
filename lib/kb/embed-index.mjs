/**
 * Keep the vector index in step with knowledge that did not originate here.
 *
 * Embeddings are made on WRITE: a writer publishes `embedding:new` and the
 * listener upserts the point. Knowledge that arrives by git — a teammate's
 * push merged at hydrate or by `/api/kb/reload` — was never written on this
 * machine, so it never reached Qdrant, and injection (Qdrant is its only live
 * source) could not find it: a simulated teammate's agent answered UNKNOWN
 * about an insight its own store held (T8).
 *
 * So obs-api runs the existing backfill (`dist/embedding/backfill.js`) after
 * startup and after a reload that changed the graph. It is idempotent over
 * (content_hash, preview_version): a pass over an up-to-date index embeds
 * nothing. Debounced, because it reads the exports, which are themselves
 * written on a debounce after the change; one pass at a time, and a trigger
 * during a pass runs one more after it.
 */

import fs from 'node:fs';
import { spawn as nodeSpawn } from 'node:child_process';

/**
 * @param {{script: string, delayMs?: number, spawn?: Function, log?: (m: string) => void,
 *          env?: object, args?: string[]}} opts
 */
export function createIndexScheduler(opts) {
  const { script, delayMs = 60_000, spawn = nodeSpawn, env = process.env, args = [] } = opts;
  const log = opts.log || ((m) => process.stderr.write(`${m}\n`));
  let timer = null;
  let running = false;
  let again = false;
  const reasons = new Set();

  function run() {
    timer = null;
    if (running) { again = true; return; }
    if (!fs.existsSync(script)) {
      log(`[embed-index] skipped: ${script} not built`);
      reasons.clear();
      return;
    }
    running = true;
    const why = [...reasons].join(', ');
    reasons.clear();
    const started = Date.now();
    let tail = '';
    let child;
    try {
      child = spawn(process.execPath, [script, ...args], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      running = false;
      log(`[embed-index] spawn failed: ${err.message}`);
      return;
    }
    child.stderr?.on('data', (d) => { tail = (tail + d).slice(-2000); });
    const done = (status) => {
      running = false;
      // fastembed's native runtime can abort while the process tears down
      // after a fatal error (SIGABRT), so name the error line, not just the code.
      const detail = tail.match(/Total: .*$/m)?.[0] || tail.match(/Fatal error: .*$/m)?.[0] || '';
      log(`[embed-index] ${why}: exit ${status} in ${Math.round((Date.now() - started) / 1000)}s ${detail}`.trim());
      if (again) { again = false; schedule('changed during the last pass'); }
    };
    child.on('error', (err) => { tail += err.message; done('error'); });
    child.on('exit', (code, signal) => done(code ?? signal));
  }

  function schedule(reason) {
    reasons.add(reason);
    if (running) { again = true; return; }
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delayMs);
    timer.unref?.();
  }

  return {
    schedule,
    get running() { return running; },
    get pending() { return Boolean(timer) || again; },
  };
}
