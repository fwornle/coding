/**
 * `/api/kgbench/*` — the benchmark control surface behind the Performance → Benchmarks
 * sub-tab.
 *
 * Mirrors the shape of the `/api/experiments/*` family in api-routes.js, and mirrors its
 * division of labour exactly:
 *
 *   • Reads are served HERE, in the container, as pure file reads plus pure computation.
 *     Nothing in this file opens a database, spawns a process, or mutates state.
 *   • Writes — launch, cancel, model-probe — are DELEGATED to the host coordinator (:3034),
 *     because a kgbench cell spawns `claude` / `copilot` / `opencode` and those binaries do
 *     not exist in this container. The container has `node`.
 *
 * It lives in its own module rather than being appended to api-routes.js (already 2.4k lines)
 * because the family is self-contained: one registration call, no shared state with the
 * entity/experiment handlers beyond the repo root.
 *
 * THE RUN-STATUS ENDPOINT COMPUTES, IT DOES NOT READ A STATUS FILE. The experiment runner
 * writes progress.json and the API serves it verbatim. kgbench has no equivalent: the
 * supervisor writes a one-line `supervise.status`, and the runner APPENDS one JSON object per
 * completed cell to results.jsonl. Progress is therefore derived — rows completed, by arm and
 * agent, against a total that is itself derived from the run's own recorded axes. Deriving it
 * is the honest option; the alternative was to teach the runner to emit a second progress file
 * whose only consumer is a web page, and to keep the two in sync forever.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

// Terminal `supervise.status` prefixes. The supervisor writes free text after the colon
// ("complete: 384 cells", "failed: pass 'matrix' exited 2 …"), so the prefix is the state.
// `cancelled` is written by the host executor rather than the supervisor — a group-kill never
// reaches the supervisor's own status writes, so without that patch a cancelled run keeps
// whatever the last pass boundary left on disk and reads as live.
const TERMINAL_STATUS_PREFIXES = ['complete', 'failed', 'abandoned', 'cancelled'];

/**
 * kgbench run ids are operator-chosen and descriptive, so they are longer than the 12-char
 * minted experiment ids (`coding-v1-VOID-tool-escape` is a real run on disk). Same charset —
 * that is what makes an id safe as a path segment — with a length bound that fits the
 * project's own naming. Kept in sync with isValidKgbenchRunId in lib/kgbench/kgbench-executor.mjs.
 */
const RUN_ID_RE = /^[A-Za-z0-9._-]{1,48}$/;
function validRunId(id) {
  return typeof id === 'string' && RUN_ID_RE.test(id) && id !== '.' && id !== '..';
}

/**
 * Register the family on an Express app.
 *
 * @param {object} app  the Express app
 * @param {object} deps
 * @param {Function} deps.repoRoot          () => absolute repo root (container: /coding)
 * @param {Function} deps.coordinatorPost   (seamPath, body) => { ok, status, json }
 * @param {object}   [deps.logger]
 */
export function registerKgbenchRoutes(app, { repoRoot, coordinatorPost, logger = console }) {
  const runsRoot = () => path.join(repoRoot(), '.data', 'kgbench', 'runs');
  const runDirOf = (runId) => path.join(runsRoot(), runId);
  // The seam carries a REPO-RELATIVE run_dir: this container's root is /coding, the host's is
  // not, and .data is bind-mounted so the same directory is visible at both roots. An absolute
  // container path would make the host `mkdir '/coding'` and ENOENT — the exact failure the
  // experiment seam hit and documented.
  const seamRunDir = (runId) => path.posix.join('.data', 'kgbench', 'runs', runId);

  const fail = (res, error, err) => {
    logger.error?.(`${error}: ${err?.message ?? err}`);
    return res.status(500).json({ error, message: err?.message ?? String(err) });
  };

  // ── Config: the axes a launch can choose from ────────────────────────────────
  // Served from config/kgbench/ so the launcher's options ARE the harness's options. A
  // hardcoded arm list in the UI would drift the moment an arm is added or disabled, and
  // would show an arm the runner refuses to run.
  app.get('/api/kgbench/config', async (req, res) => {
    try {
      const cfgDir = path.join(repoRoot(), 'config', 'kgbench');
      const armsDoc = JSON.parse(await fs.readFile(path.join(cfgDir, 'arms.json'), 'utf8'));

      // Question sets are the *.json files in config/kgbench/questions/, reported with their
      // question count and class breakdown so the launcher can show what a set costs.
      let sets = [];
      try {
        const files = (await fs.readdir(path.join(cfgDir, 'questions'))).filter((f) => f.endsWith('.json'));
        sets = await Promise.all(files.map(async (f) => {
          const name = f.replace(/\.json$/, '');
          try {
            const doc = JSON.parse(await fs.readFile(path.join(cfgDir, 'questions', f), 'utf8'));
            // Retired questions are excluded, mirroring the runner's own filter
            // (lib/kgbench/arms.mjs:42) EXACTLY — `enabled !== false`, so a question
            // with no `enabled` key still counts. The launcher used to list all 17
            // coding-v1 entries including T2 (retired: its premise was false, because
            // runCypherQuery still exists), which both offered a question the runner
            // would never run and computed the cell-matrix size on 17 while the
            // published report was built on 16. A control surface that disagrees with
            // the runner about what will run is worse than one that shows less.
            const all = Array.isArray(doc) ? doc : (doc.questions ?? []);
            const questions = all.filter((q) => q.enabled !== false);
            const classes = {};
            for (const q of questions) classes[q.cls ?? 'unknown'] = (classes[q.cls ?? 'unknown'] ?? 0) + 1;
            return {
              name,
              questionCount: questions.length,
              classes,
              // id + class + LABEL, never the prompt. The label is a hand-written few-word
              // summary carried in the question file; a launcher that lists bare ids makes an
              // operator open the JSON to know what they are choosing between.
              //
              // The full prompt deliberately does NOT travel: it is the thing the arms are
              // being tested on, and a benchmark control surface has no reason to put it on a
              // screen where it can be read, copied, or pasted into an agent.
              questions: questions.map((q) => ({ id: q.id, cls: q.cls ?? 'unknown', label: q.label ?? null })),
              ids: questions.map((q) => q.id),
            };
          } catch (e) {
            return { name, error: e.message };
          }
        }));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }

      // Arm × agent faithfulness, resolved by the HARNESS's own rule rather than restated
      // here. An arm defined by withholding built-in search (Read without Glob/Grep) cannot
      // be honoured by an agent with no tool allowlist, and the runner SKIPS that cell. The
      // launcher must show that before launch, or the operator picks a 3-agent matrix and
      // silently gets a 1-agent one.
      const { armIsFaithful, KNOWN_AGENTS } = await import('../kgbench/agents.mjs');
      const { loadArms, resolveArm } = await import('../kgbench/arms.mjs');
      const doc = loadArms(repoRoot());
      const arms = [];
      for (const [id, raw] of Object.entries(doc.arms ?? {})) {
        let resolved = null;
        try {
          resolved = resolveArm(doc, id, { repoRoot: repoRoot() });
        } catch {
          // An arm whose backend tools cannot be resolved (backend absent from
          // config/code-graph.json) is listed as unavailable rather than omitted — a missing
          // arm looks like it was never configured, which sends people to the wrong file.
        }
        const agents = {};
        for (const agent of KNOWN_AGENTS) {
          const verdict = resolved ? armIsFaithful(resolved, agent) : { faithful: false, reason: 'arm could not be resolved' };
          agents[agent] = { faithful: !!verdict.faithful, reason: verdict.reason ?? null };
        }
        arms.push({
          id,
          label: raw.label ?? id,
          enabled: raw.enabled !== false,
          backend: raw.backend ?? null,
          allowedTools: resolved?.allowedTools ?? null,
          resolved: !!resolved,
          agents,
        });
      }

      // `mastracode` is in the runner's KNOWN_AGENTS and is NOT offered here. It has an
      // adapter but has never produced a cell in any run on disk, so putting it in a launcher
      // would invite an operator to spend hours discovering that for themselves. The runner's
      // list is left alone — it is the harness's contract, and a CLI `--agents mastracode`
      // still works for whoever wants to be the one who tries it.
      const OFFERED_AGENTS = KNOWN_AGENTS.filter((a) => a !== 'mastracode');

      return res.status(200).json({
        sets,
        arms,
        agents: OFFERED_AGENTS,
        allAgents: KNOWN_AGENTS,
        defaults: armsDoc.defaults ?? {},
      });
    } catch (err) {
      return fail(res, 'kgbench config read failed', err);
    }
  });

  // ── Probed model availability ────────────────────────────────────────────────
  // Serves the CACHE that scripts/llm-model-probe.mjs writes, never a live probe.
  //
  // The distinction matters and is the whole reason this endpoint exists rather than a model
  // dropdown: `providerModels` both over-reports (it advertises claude-opus-4.6 for copilot,
  // which answers 400) and under-reports (it lists no Opus 5, which claude serves). A list
  // taken from the catalog would offer models that fail at cell 1 of a 3-hour matrix. So the
  // launcher offers what was OBSERVED to be served, and marks everything else unverified.
  app.get('/api/kgbench/models', async (req, res) => {
    try {
      const p = path.join(repoRoot(), '.data', 'llm-proxy', 'model-availability.json');
      let cache = null;
      try {
        cache = JSON.parse(await fs.readFile(p, 'utf8'));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      if (!cache) {
        return res.status(200).json({ probedAt: null, verified: [], rejected: [], results: [] });
      }
      const results = Array.isArray(cache.results) ? cache.results : [];
      return res.status(200).json({
        probedAt: cache.probedAt ?? null,
        proxy: cache.proxy ?? null,
        // `verified` is what a provider actually answered with. `exact:false` means the
        // request resolved to a DIFFERENT model than asked for (an alias, or a silent
        // substitution) — surfaced, never flattened, because a substitution that goes
        // unnoticed is how a judge ran on haiku for two runs while run.json said opus.
        verified: results.filter((r) => r.ok).map((r) => ({
          requested: r.requested,
          provider: r.provider,
          served: r.served,
          exact: r.exact !== false,
          stable: r.stable !== false,
        })),
        rejected: results.filter((r) => !r.ok).map((r) => ({
          requested: r.requested, provider: r.provider, error: r.error ?? null,
        })),
        results,
      });
    } catch (err) {
      return fail(res, 'kgbench model availability read failed', err);
    }
  });

  // POST — refresh the probe cache. Delegated: the probe mutates live proxy routing config
  // (it installs a temporary processOverride, the only way to select a model) and targets the
  // proxy on the host's loopback. Minutes, not seconds — probes serialise on a shared key.
  app.post('/api/kgbench/probe-models', async (req, res) => {
    try {
      const { provider, models } = req.body || {};
      const { ok, status, json } = await coordinatorPost('/kgbench/probe-models', { provider, models });
      return res.status(ok ? 200 : (status || 500)).json(json ?? {});
    } catch (err) {
      return fail(res, 'kgbench model probe failed', err);
    }
  });

  // ── Runs ─────────────────────────────────────────────────────────────────────
  // Every run directory with enough to populate a picker: its recorded axes, its cell count,
  // and whether it is live. Cheap: a stat + two small reads per run, and a line count over
  // results.jsonl, which is the only file that can be large.
  app.get('/api/kgbench/runs', async (req, res) => {
    try {
      let entries;
      try {
        entries = await fs.readdir(runsRoot(), { withFileTypes: true });
      } catch (e) {
        if (e.code === 'ENOENT') return res.status(200).json({ runs: [] });
        throw e;
      }
      const runs = [];
      for (const ent of entries) {
        if (!ent.isDirectory() || !validRunId(ent.name)) continue;
        runs.push(await summarizeRun(ent.name));
      }
      // Newest run first, by WHEN IT RAN rather than when its file was last touched.
      // `updatedAt` is the mtime of results.jsonl, which an offline regrade rewrites — a
      // scoring pass over the five oldest runs in the corpus floated them all to the top of
      // this list while claiming to be "latest". Start time is the property the reader means.
      // Runs predating start-time capture fall back to mtime and sort last among equals.
      const when = (r) => r.startedAt ?? r.updatedAt ?? '';
      runs.sort((a, b) => when(b).localeCompare(when(a)) || a.runId.localeCompare(b.runId));
      return res.status(200).json({ runs });
    } catch (err) {
      return fail(res, 'kgbench runs scan failed', err);
    }
  });

  /**
   * One run's headline: recorded axes from run.json, cells completed from results.jsonl,
   * status from supervise.status, liveness from supervise.pid.
   *
   * Liveness is decided the way the supervisor itself decides it — a lock file naming a live
   * process. The pid probe is meaningful here even though this is a container: kgbench's
   * supervisor runs on the HOST, in a different pid namespace, so `process.kill(pid, 0)` from
   * here would test a host pid against container pids and answer nonsense. It is therefore
   * NOT probed here; the mtime of results.jsonl plus the terminal status is what this layer
   * can honestly know, and `/kgbench/cancel` on the host is where real liveness is decided.
   */
  async function summarizeRun(runId) {
    const dir = runDirOf(runId);
    const summary = { runId, set: null, reps: null, commit: null, arms: [], agents: [], models: [], cells: 0, status: null, live: false, updatedAt: null };

    try {
      const meta = JSON.parse(await fs.readFile(path.join(dir, 'run.json'), 'utf8'));
      summary.set = meta.set ?? null;
      summary.reps = meta.reps ?? null;
      summary.commit = meta.commit ?? null;
      summary.arms = (meta.arms ?? []).map((a) => a.id ?? a).filter(Boolean);
      summary.agents = meta.agents ?? [];
      summary.models = meta.models ?? [];
      // First launch when the run was resumed, else the single launch. Reading only
      // `history` reported null for every run written before resume existed —
      // `replication-full` carries a top-level startedAt and was showing as undated.
      summary.startedAt = meta.history?.[0]?.startedAt ?? meta.startedAt ?? null;
    } catch { /* a run dir without run.json is still listed — it may be mid-launch */ }

    try {
      const st = await fs.stat(path.join(dir, 'results.jsonl'));
      summary.updatedAt = new Date(st.mtimeMs).toISOString();
      summary.cells = await countLines(path.join(dir, 'results.jsonl'));
    } catch { /* no results yet */ }

    try {
      summary.status = (await fs.readFile(path.join(dir, 'supervise.status'), 'utf8')).trim();
    } catch { /* never supervised, or launched before the status file existed */ }

    // A lock file that still exists means the supervisor has not run its EXIT trap. That is
    // the best signal available from this side; the host settles it definitively.
    try {
      await fs.access(path.join(dir, 'supervise.pid'));
      summary.live = !isTerminalStatus(summary.status);
    } catch { /* no lock → not running */ }

    return summary;
  }

  // ── Run status: the monitor's 5s poll ────────────────────────────────────────
  // A DERIVED progress object in the same shape the Run monitor already understands:
  // { run_id, overall, done, total, cells[] }. Cells are grouped by arm×agent×model so a
  // cross-agent matrix reads as a grid rather than a list of 384 rows.
  app.get('/api/kgbench/run-status/:runId', async (req, res) => {
    try {
      const { runId } = req.params;
      if (!validRunId(runId)) {
        return res.status(400).json({ error: 'Invalid runId', message: 'runId must match [A-Za-z0-9._-] and be 1–48 chars.' });
      }
      const dir = runDirOf(runId);

      // Read the status FIRST, and unconditionally. It used to be read only after
      // results.jsonl parsed, so a run with no cells yet returned `status: null` — which is
      // exactly the run whose status matters most. A cancelled or refused run that never
      // produced a cell reported as `pending` forever, indistinguishable from one still
      // building its sandbox.
      let status = null;
      try { status = (await fs.readFile(path.join(dir, 'supervise.status'), 'utf8')).trim(); } catch { /* none */ }

      let rows = [];
      try {
        rows = (await fs.readFile(path.join(dir, 'results.jsonl'), 'utf8'))
          .split('\n').filter((l) => l.trim())
          .map((l) => { try { return JSON.parse(l); } catch { return null; } })
          .filter(Boolean);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        // Graceful-empty: a run that has been launched but has not written its first cell is
        // not an error, and returning 404 would make the monitor flash a failure at t=0.
        return res.status(200).json({
          run_id: runId,
          overall: overallFromStatus(status, 0, null),
          done: 0,
          total: null,
          cells: [],
          status,
        });
      }

      let meta = null;
      try { meta = JSON.parse(await fs.readFile(path.join(dir, 'run.json'), 'utf8')); } catch { /* none */ }

      // The expected total: questions × arms × agents × models × reps, taken from the run's
      // OWN recorded axes. Null when they cannot be resolved — a fabricated denominator would
      // render a progress bar that is confidently wrong, which is worse than none.
      const total = expectedTotal(meta);

      // Group into cells the grid can render. Each group is one arm×agent×model combination;
      // its state is the worst outcome seen so far, so a group containing a hard failure does
      // not read as green because later reps passed.
      const groups = new Map();
      for (const r of rows) {
        const key = [r.arm ?? '?', r.agent ?? 'claude', r.model ?? ''].join('|');
        let g = groups.get(key);
        if (!g) {
          g = {
            arm: r.arm ?? '?', agent: r.agent ?? 'claude', model: r.model ?? null,
            done: 0, failed: 0, scored: 0, scoreSum: 0, lastAt: null, questions: new Set(),
          };
          groups.set(key, g);
        }
        g.done += 1;
        g.questions.add(r.id);
        if (r.hard_fail) g.failed += 1;
        if (typeof r.score === 'number') { g.scored += 1; g.scoreSum += r.score; }
        const at = r.ended_at ?? r.at ?? null;
        if (at && (!g.lastAt || at > g.lastAt)) g.lastAt = at;
      }

      const terminal = isTerminalStatus(status);
      const cells = [...groups.values()].map((g) => ({
        arm: g.arm,
        agent: g.agent,
        model: g.model,
        done: g.done,
        questions: g.questions.size,
        failed: g.failed,
        mean_score: g.scored ? g.scoreSum / g.scored : null,
        last_at: g.lastAt,
        // A group's state is about the RUN, not the answers: 'complete' once the supervisor
        // has stopped, 'running' while it has not. Correctness lives in mean_score, which is
        // reported separately and never collapsed into a colour.
        state: terminal ? 'complete' : 'running',
      })).sort((a, b) => a.arm.localeCompare(b.arm) || a.agent.localeCompare(b.agent) || String(a.model).localeCompare(String(b.model)));

      return res.status(200).json({
        run_id: runId,
        overall: overallFromStatus(status, rows.length, total),
        done: rows.length,
        total,
        status,
        set: meta?.set ?? null,
        commit: meta?.commit ?? null,
        cells,
      });
    } catch (err) {
      return fail(res, 'kgbench run status failed', err);
    }
  });

  // Newest run that has not reached a terminal supervise.status, so the Benchmarks tab
  // auto-attaches its monitor to a matrix launched from the CLI or the /kgbench skill — not
  // only to one launched from this tab.
  app.get('/api/kgbench/active-run', async (req, res) => {
    try {
      let entries;
      try {
        entries = await fs.readdir(runsRoot(), { withFileTypes: true });
      } catch (e) {
        if (e.code === 'ENOENT') return res.status(200).json({ runId: null });
        throw e;
      }
      // Three conditions, and all three are needed because each covers a way the other two
      // report a dead run as live:
      //
      //   lock exists    — the supervisor removes supervise.pid on its EXIT trap, so this is
      //                    the only signal that catches EVERY ordinary exit, including the
      //                    ones that never update the status (a group-kill, a bash error).
      //   status not     — catches a finished run whose lock removal raced or whose status
      //   terminal         says complete while the file lingers.
      //   fresh mtime    — catches a SIGKILL, which leaves BOTH the lock and a stale
      //                    `running` status behind and would otherwise pin the monitor to a
      //                    run that ended days ago.
      const STALE_MS = 30 * 60 * 1000;
      const now = Date.now();
      let best = null;
      for (const ent of entries) {
        if (!ent.isDirectory() || !validRunId(ent.name)) continue;
        const dir = runDirOf(ent.name);
        try {
          await fs.access(path.join(dir, 'supervise.pid'));
        } catch {
          continue; // supervisor has exited — its EXIT trap removed the lock
        }
        let status = null;
        try { status = (await fs.readFile(path.join(dir, 'supervise.status'), 'utf8')).trim(); } catch { continue; }
        if (isTerminalStatus(status)) continue;
        let mtimeMs = 0;
        try { mtimeMs = (await fs.stat(path.join(dir, 'results.jsonl'))).mtimeMs; } catch {
          try { mtimeMs = (await fs.stat(path.join(dir, 'supervise.status'))).mtimeMs; } catch { continue; }
        }
        if (now - mtimeMs > STALE_MS) continue;
        if (!best || mtimeMs > best.mtimeMs) best = { runId: ent.name, mtimeMs, status };
      }
      return res.status(200).json(best ? { runId: best.runId, status: best.status } : { runId: null });
    } catch (err) {
      return fail(res, 'kgbench active-run scan failed', err);
    }
  });

  // ── Report ───────────────────────────────────────────────────────────────────
  // The same aggregation the CLI publishes, computed live from a run's rows.
  //
  // It calls lib/kgbench/report.mjs `aggregate()` — the function scripts/kgbench-report.mjs
  // calls — rather than reimplementing any of it. A second implementation of the scoring
  // aggregation would be a second thing to get wrong, and the dashboard disagreeing with the
  // published README about a run's numbers is exactly the class of defect this benchmark
  // spent a week removing.
  app.get('/api/kgbench/report/:runId', async (req, res) => {
    try {
      const { runId } = req.params;
      if (!validRunId(runId)) {
        return res.status(400).json({ error: 'Invalid runId', message: 'runId must match [A-Za-z0-9._-] and be 1–48 chars.' });
      }
      const dir = runDirOf(runId);

      let meta;
      try {
        meta = JSON.parse(await fs.readFile(path.join(dir, 'run.json'), 'utf8'));
      } catch (e) {
        if (e.code === 'ENOENT') return res.status(404).json({ error: 'No such run', message: `no run.json for ${runId}` });
        throw e;
      }

      let raw;
      try {
        raw = await fs.readFile(path.join(dir, 'results.jsonl'), 'utf8');
      } catch (e) {
        if (e.code === 'ENOENT') return res.status(404).json({ error: 'No results', message: `no results.jsonl for ${runId}` });
        throw e;
      }
      const allRows = raw.split('\n').filter((l) => l.trim())
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);

      const { aggregate, buildReportMeta, findDisagreements } = await import('../kgbench/report.mjs');
      const { loadQuestions } = await import('../kgbench/arms.mjs');
      const { questions } = loadQuestions(meta.set, repoRoot());

      // A run's question set is the UNION over every pass, not the last pass's list. Adding
      // reps with `--only A1,A2` rewrites run.json's `questions` to those two, and filtering
      // on it alone drops the other fourteen questions' rows as "retired" — the CLI hit this
      // and the report showed a 2-question benchmark. Same union here, same reason.
      const runQuestionIds = new Set([
        ...(meta.questions ?? []),
        ...(meta.history ?? []).flatMap((h) => h.questions ?? []),
      ]);
      const selected = questions.filter((q) => runQuestionIds.has(q.id));
      const selectedIds = new Set(selected.map((q) => q.id));
      const rows = allRows.filter((r) => selectedIds.has(r.id));
      const retired = [...new Set(allRows.filter((r) => !selectedIds.has(r.id)).map((r) => r.id))];

      const armIds = (meta.arms ?? []).map((a) => a.id ?? a).filter(Boolean);
      const report = aggregate(rows, { arms: armIds, questions: selected });

      return res.status(200).json({
        // The SAME meta and disagreement builders the CLI uses, so a run's live numbers and
        // its published ones can only differ because the data changed — never because two
        // implementations drifted. Several of these fields are derived from the rows rather
        // than the run's stated intent (the served judge model, the per-agent rep count),
        // and each of those exists because the intent-based version was wrong undetected.
        meta: buildReportMeta({ rows, meta, runId, selected, retiredIds: retired }),
        disagreements: findDisagreements(rows),
        ...report,
        // Provenance the CLI report carries too: which rows were excluded and why. A report
        // that silently drops rows is a report you cannot check.
        _source: { runId, rows: rows.length, rowsTotal: allRows.length, retiredQuestions: retired, live: true },
      });
    } catch (err) {
      return fail(res, 'kgbench report failed', err);
    }
  });

  // The PUBLISHED reports under docs/benchmarks/*/report.json — the committed artefacts the
  // README prose is written around. Kept distinct from the live per-run aggregate above: one
  // is what was published, the other is what the data says right now, and conflating them is
  // how a dashboard ends up contradicting a document without either being wrong.
  app.get('/api/kgbench/published', async (req, res) => {
    try {
      const base = path.join(repoRoot(), 'docs', 'benchmarks');
      let entries = [];
      try {
        entries = await fs.readdir(base, { withFileTypes: true });
      } catch (e) {
        if (e.code === 'ENOENT') return res.status(200).json({ reports: [] });
        throw e;
      }
      const reports = [];
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const p = path.join(base, ent.name, 'report.json');
        try {
          const doc = JSON.parse(await fs.readFile(p, 'utf8'));
          reports.push({
            name: ent.name,
            runId: doc?.meta?.runId ?? null,
            set: doc?.meta?.set ?? null,
            questionCount: doc?.meta?.questionCount ?? null,
            reps: doc?.meta?.reps ?? null,
            commit: doc?.meta?.commit ?? null,
            agents: doc?.agents ?? [],
          });
        } catch { /* directory without a report.json — not a published benchmark */ }
      }
      return res.status(200).json({ reports });
    } catch (err) {
      return fail(res, 'kgbench published report scan failed', err);
    }
  });

  app.get('/api/kgbench/published/:name', async (req, res) => {
    try {
      const { name } = req.params;
      // The name becomes a path segment. Same gate as a run id, for the same reason.
      if (!validRunId(name)) {
        return res.status(400).json({ error: 'Invalid name' });
      }
      const p = path.join(repoRoot(), 'docs', 'benchmarks', name, 'report.json');
      try {
        return res.status(200).json(JSON.parse(await fs.readFile(p, 'utf8')));
      } catch (e) {
        if (e.code === 'ENOENT') return res.status(404).json({ error: 'No such published report', message: name });
        throw e;
      }
    } catch (err) {
      return fail(res, 'kgbench published report read failed', err);
    }
  });

  // ── Supervisor log tail ──────────────────────────────────────────────────────
  // Offset-polled tail of supervise.log, so the monitor can show WHY a run is not producing
  // cells. Without it, a preflight refusal (a down MCP backend, a missing agent binary) is
  // indistinguishable in the UI from a slow first cell — the run just sits at 0 forever.
  app.get('/api/kgbench/log/:runId', async (req, res) => {
    try {
      const { runId } = req.params;
      if (!validRunId(runId)) return res.status(400).json({ error: 'Invalid runId' });
      const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
      const p = path.join(runDirOf(runId), 'supervise.log');

      let st;
      try {
        st = await fs.stat(p);
      } catch (e) {
        if (e.code === 'ENOENT') return res.status(200).json({ chunk: '', offset: 0, size: 0 });
        throw e;
      }
      // A shrunk file means the log was rotated or the run relaunched — serve from the start
      // rather than returning a negative-length read.
      const from = offset > st.size ? 0 : offset;
      if (from >= st.size) return res.status(200).json({ chunk: '', offset: st.size, size: st.size });

      // Cap a single response so a first poll against a 20k-line log cannot ship megabytes
      // into the browser; the client polls again from the new offset.
      const MAX = 64 * 1024;
      const length = Math.min(st.size - from, MAX);
      const fh = await fs.open(p, 'r');
      try {
        const buf = Buffer.alloc(length);
        await fh.read(buf, 0, length, from);
        return res.status(200).json({ chunk: buf.toString('utf8'), offset: from + length, size: st.size });
      } finally {
        await fh.close();
      }
    } catch (err) {
      return fail(res, 'kgbench log read failed', err);
    }
  });

  // ── Launch / cancel: delegated to the host ───────────────────────────────────
  app.post('/api/kgbench/run', async (req, res) => {
    try {
      const body = req.body || {};
      const runId = typeof body.run_id === 'string' ? body.run_id.trim() : '';
      if (!validRunId(runId)) {
        return res.status(400).json({
          error: 'Invalid run_id',
          message: 'run_id must match [A-Za-z0-9._-] and be 1–48 characters.',
        });
      }

      // Refuse to resume-by-accident. A run id that already has results is a RESUME (the
      // runner keeps completed cells and continues), which is a legitimate and useful thing
      // to do — but it must be asked for, because typing an existing id and silently
      // appending to someone else's matrix mixes two runs into one results file.
      let exists = false;
      try {
        await fs.access(path.join(runDirOf(runId), 'results.jsonl'));
        exists = true;
      } catch { /* fresh id */ }
      if (exists && body.resume !== true) {
        const summary = await summarizeRun(runId);
        return res.status(409).json({
          error: 'Run exists',
          message: `run_id '${runId}' already has ${summary.cells} recorded cells. Launching would resume it. Re-submit with resume:true to continue that run, or choose a new id.`,
          holder: { kind: 'kgbench', run_id: runId, cells: summary.cells, status: summary.status },
        });
      }

      const { ok, status, json } = await coordinatorPost('/kgbench/run', {
        run_id: runId,
        run_dir: seamRunDir(runId),
        set: body.set,
        reps: body.reps,
        arms: body.arms,
        agents: body.agents,
        models: body.models,
        only: body.only,
        deepen: body.deepen,
        deepen_reps: body.deepen_reps,
        max_restarts: body.max_restarts,
        baseline_token_wait_s: body.baseline_token_wait_s,
      });

      // The host's slot guard has real pid visibility; this container's does not (isolated
      // pid namespace). Map its refusal to a 409 with the holder, so the operator is told
      // WHICH run holds the slot rather than seeing a bare 500.
      if (json && json.slot_busy) {
        return res.status(409).json({
          error: 'Slot busy',
          message: json.message ?? 'A kgbench run is already live.',
          holder: json.holder ?? null,
        });
      }
      if (!ok) {
        return res.status(status || 500).json({
          error: 'Launch failed',
          message: json?.message ?? json?.error ?? `coordinator returned ${status}`,
        });
      }
      return res.status(200).json({ run_id: runId, pid: json?.pid ?? null, run_dir: seamRunDir(runId) });
    } catch (err) {
      return fail(res, 'kgbench launch failed', err);
    }
  });

  app.post('/api/kgbench/run-cancel', async (req, res) => {
    try {
      const runId = typeof req.body?.run_id === 'string' ? req.body.run_id.trim() : '';
      if (!validRunId(runId)) {
        return res.status(400).json({ error: 'Invalid run_id' });
      }
      const { ok, status, json } = await coordinatorPost('/kgbench/cancel', {
        run_id: runId,
        run_dir: seamRunDir(runId),
      });
      if (!ok) {
        return res.status(status || 500).json({
          error: 'Cancel failed',
          message: json?.message ?? json?.error ?? `coordinator returned ${status}`,
        });
      }
      return res.status(200).json({ run_id: runId, ...json });
    } catch (err) {
      return fail(res, 'kgbench cancel failed', err);
    }
  });
}

/**
 * Count newline-delimited records without holding the whole file as one string longer than
 * necessary. results.jsonl for a full matrix is ~600KB, which is fine to read but not fine to
 * read on every poll of every run in a list — so this is used only in the runs list, and the
 * status endpoint (which parses anyway) counts as it goes.
 */
async function countLines(p) {
  const raw = await fs.readFile(p, 'utf8');
  let n = 0;
  for (let i = 0; i < raw.length; i += 1) if (raw.charCodeAt(i) === 10) n += 1;
  // A final line without a trailing newline still counts.
  if (raw.length && raw.charCodeAt(raw.length - 1) !== 10) n += 1;
  return n;
}

function isTerminalStatus(status) {
  if (!status) return false;
  return TERMINAL_STATUS_PREFIXES.some((p) => status.startsWith(p));
}

/**
 * Map the supervisor's status line onto the overall states the monitor renders.
 *
 * `resuming:` is deliberately NOT terminal and NOT an error: the supervisor restarts a pass
 * that died on a SIGNAL, keeping completed cells, and that is the mechanism working. It is
 * surfaced as its own state so an operator can see it happened without reading it as failure.
 */
function overallFromStatus(status, done, total) {
  if (!status) return done > 0 ? 'running' : 'pending';
  if (status.startsWith('complete')) return 'complete';
  if (status.startsWith('failed')) return 'failed';
  if (status.startsWith('abandoned')) return 'abandoned';
  if (status.startsWith('cancelled')) return 'cancelled';
  if (status.startsWith('resuming')) return 'resuming';
  if (total != null && done >= total) return 'complete';
  return 'running';
}

/**
 * The expected cell count from a run's recorded axes: questions × arms × agents × models ×
 * reps. Returns null rather than a guess when the axes are not all recorded — an invented
 * denominator produces a progress bar that is confidently wrong, and a missing one at least
 * reads as unknown.
 *
 * Deliberately does NOT subtract arm×agent combinations the runner will skip as unfaithful.
 * Doing so would need the resolved arms, and being slightly over on the denominator is a
 * visible "384/420" the operator can reason about, whereas a total that silently changed
 * shape between the launcher's preview and the monitor's bar is not.
 */
function expectedTotal(meta) {
  if (!meta) return null;
  const questionIds = new Set([
    ...(meta.questions ?? []),
    ...(meta.history ?? []).flatMap((h) => h.questions ?? []),
  ]);
  const q = questionIds.size;
  const arms = (meta.arms ?? []).length;
  const reps = Number(meta.reps);
  if (!q || !arms || !Number.isFinite(reps) || reps < 1) return null;
  const agents = Math.max(1, (meta.agents ?? []).length || 1);
  const models = Math.max(1, (meta.models ?? []).length || 1);
  return q * arms * agents * models * reps;
}
