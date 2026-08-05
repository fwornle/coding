#!/usr/bin/env python3
"""Graphify-vs-grep benchmark harness (Phase 1).

Two forced arms over a fixed query set on the coding repo:
  - grep : plain agentic grep (Glob/Grep/Read), no graph
  - graph: Graphify MCP tools + Read, no Grep/Glob

Each (arm, query, rep) is a fresh `claude -p` headless run. We measure
tokens (input incl. cache + output), tool-call count, wall latency, cost,
and correctness (deterministic graders + one LLM judge for the arch query).

Usage:
  python3 bench.py --reps 1 --only L1,S1,A1      # pilot
  python3 bench.py --reps 3                       # full
Results append to results.jsonl (one record per run).
"""
import json, os, re, subprocess, sys, time, argparse, statistics
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Repo root: docs/benchmarks/graphify-vs-grep/ -> up 3. Override with KGBENCH_REPO
# when running the harness against a checkout elsewhere.
REPO = Path(os.environ.get("KGBENCH_REPO", HERE.parents[2]))
MODEL = os.environ.get("KGBENCH_MODEL", "claude-sonnet-5")
GRAPHIFY_MCP = str(HERE / "mcp_graphify_only.json")
RESULTS = HERE / "results.jsonl"
RUN_TIMEOUT = int(os.environ.get("KGBENCH_TIMEOUT", "300"))

# graphify-only MCP config (written here so the harness is self-contained)
Path(GRAPHIFY_MCP).write_text(json.dumps(
    {"mcpServers": {"graphify": {"type": "http", "url": "http://localhost:3851/mcp"}}}))

ARMS = {
    "grep": {
        "allowedTools": "Glob,Grep,Read",
        "mcp": '{"mcpServers":{}}',
    },
    "graph": {
        "allowedTools": ("Read,mcp__graphify__query_graph,mcp__graphify__get_node,"
                          "mcp__graphify__get_neighbors,mcp__graphify__shortest_path,"
                          "mcp__graphify__graph_stats,mcp__graphify__god_nodes"),
        "mcp": GRAPHIFY_MCP,
    },
}


def run_claude(prompt, arm):
    """Run one headless claude -p; return (metrics_dict, answer_text)."""
    cfg = ARMS[arm]
    cmd = [
        "claude", "-p", prompt,
        "--model", MODEL,
        "--output-format", "stream-json", "--verbose",
        "--allowedTools", cfg["allowedTools"],
        "--strict-mcp-config", "--mcp-config", cfg["mcp"],
        "--dangerously-skip-permissions",
    ]
    t0 = time.time()
    try:
        p = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, timeout=RUN_TIMEOUT)
    except subprocess.TimeoutExpired:
        return {"error": "timeout", "wall_s": round(time.time() - t0, 1)}, ""
    wall = round(time.time() - t0, 1)
    tool_calls, tools, final = 0, [], None
    for line in p.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except Exception:
            continue
        if e.get("type") == "assistant":
            for b in e.get("message", {}).get("content", []):
                if isinstance(b, dict) and b.get("type") == "tool_use":
                    tool_calls += 1
                    tools.append(b.get("name"))
        elif e.get("type") == "result":
            final = e
    if not final:
        return {"error": "no_result", "wall_s": wall, "stderr": p.stderr[-300:]}, ""
    u = final.get("usage", {})
    in_tok = (u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
              + u.get("cache_read_input_tokens", 0))
    out_tok = u.get("output_tokens", 0)
    m = {
        "tool_calls": tool_calls, "tools": tools,
        "in_tokens": in_tok, "out_tokens": out_tok, "total_tokens": in_tok + out_tok,
        "cost_usd": final.get("total_cost_usd"), "num_turns": final.get("num_turns"),
        "duration_ms": final.get("duration_ms"), "wall_s": wall,
        "is_error": final.get("is_error"),
    }
    return m, str(final.get("result", "")).strip()


# ---- graders (return score in [0,1] + detail) ----
def grade_path(ans, gt):
    a = ans.lower()
    if gt.lower() in a:
        return 1.0, "exact-path"
    if Path(gt).name.lower() in a:
        return 0.5, "basename-only"
    return 0.0, "miss"

def grade_contains(ans, gts):
    a = ans.lower()
    hit = sum(1 for g in gts if g.lower() in a)
    return hit / len(gts), f"{hit}/{len(gts)}"

def grade_regex(ans, pats):
    hit = sum(1 for p in pats if re.search(p, ans))
    return hit / len(pats), f"{hit}/{len(pats)}"

def grade_set(ans, gts):
    a = ans.lower()
    found = [g for g in gts if g.lower() in a or Path(g).name.lower() in a]
    recall = len(found) / len(gts)
    # precision proxy: count distinct repo-relative-ish paths mentioned
    mentioned = set(re.findall(r"[\w./-]+\.\w+", ans.lower()))
    extras = [m for m in mentioned if m.endswith((".py", ".js", ".ts"))
              and not any(Path(g).name.lower() in m for g in gts)]
    prec = len(found) / (len(found) + len(extras)) if (found or extras) else 0.0
    f1 = (2 * recall * prec / (recall + prec)) if (recall + prec) else 0.0
    return f1, f"recall={recall:.2f} prec~{prec:.2f} extras={len(extras)}"

def grade_llm(ans, rubric):
    judge_prompt = (
        "You are grading a factual answer against a rubric. Output ONLY a JSON object "
        '{"score": <0.0|0.5|1.0>, "why": "<short>"}.\n\n'
        f"RUBRIC:\n{rubric}\n\nANSWER TO GRADE:\n{ans}\n"
    )
    cmd = ["claude", "-p", judge_prompt, "--model", MODEL, "--output-format", "json",
           "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}']
    try:
        p = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, timeout=120)
        d = json.loads(p.stdout)
        txt = str(d.get("result", ""))
        mobj = re.search(r"\{.*\}", txt, re.S)
        j = json.loads(mobj.group(0))
        return float(j.get("score", 0)), j.get("why", "")[:120]
    except Exception as ex:
        return None, f"judge-error: {ex}"

def grade(ans, g):
    t = g["type"]
    if t == "path":   return grade_path(ans, g["gt"])
    if t == "contains": return grade_contains(ans, g["gt"])
    if t == "regex":  return grade_regex(ans, g["gt"])
    if t == "set":    return grade_set(ans, g["gt"])
    if t == "llm":    return grade_llm(ans, g["rubric"])
    return None, "unknown-grader"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reps", type=int, default=1)
    ap.add_argument("--only", default="", help="comma-separated query ids")
    ap.add_argument("--arms", default="grep,graph")
    args = ap.parse_args()

    queries = json.loads((HERE / "queries.json").read_text())
    if args.only:
        want = set(args.only.split(","))
        queries = [q for q in queries if q["id"] in want]
    arms = args.arms.split(",")

    total = len(queries) * len(arms) * args.reps
    n = 0
    with open(RESULTS, "a") as out:
        for q in queries:
            for arm in arms:
                for rep in range(args.reps):
                    n += 1
                    print(f"[{n}/{total}] {q['id']:>3} {arm:<5} rep{rep} ... ", end="", flush=True)
                    m, ans = run_claude(q["prompt"], arm)
                    if m.get("error"):
                        print(f"ERROR {m['error']}")
                        rec = {"id": q["id"], "cls": q["cls"], "arm": arm, "rep": rep, **m}
                        out.write(json.dumps(rec) + "\n"); out.flush(); continue
                    score, detail = grade(ans, q["grader"])
                    rec = {"id": q["id"], "cls": q["cls"], "arm": arm, "rep": rep,
                           "score": score, "grade_detail": detail, "answer": ans[:300], **m}
                    out.write(json.dumps(rec) + "\n"); out.flush()
                    sc = f"{score:.2f}" if score is not None else "??"
                    print(f"score={sc} tools={m['tool_calls']} tok={m['total_tokens']} "
                          f"{m['wall_s']}s ${m['cost_usd']:.3f}")


if __name__ == "__main__":
    main()
