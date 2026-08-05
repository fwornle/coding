#!/usr/bin/env python3
"""Aggregate results.jsonl -> ranked markdown tables."""
import json, statistics as st
from pathlib import Path
from collections import defaultdict

HERE = Path(__file__).resolve().parent
rows = [json.loads(l) for l in (HERE / "results.jsonl").read_text().splitlines() if l.strip()]
rows = [r for r in rows if not r.get("error")]

def med(xs): return round(st.median(xs), 1) if xs else 0
def mean(xs): return round(st.mean(xs), 3) if xs else 0

# ---- per-arm overall ----
by_arm = defaultdict(list)
for r in rows:
    by_arm[r["arm"]].append(r)

print("## Overall (per arm)\n")
print("| Arm | runs | median tool-calls | median total tokens | median latency (s) | mean cost $ | mean correctness |")
print("|---|--:|--:|--:|--:|--:|--:|")
for arm in ("grep", "graph"):
    rs = by_arm.get(arm, [])
    if not rs: continue
    scores = [r["score"] for r in rs if r.get("score") is not None]
    print(f"| {arm} | {len(rs)} | {med([r['tool_calls'] for r in rs])} | "
          f"{med([r['total_tokens'] for r in rs])} | {med([r['wall_s'] for r in rs])} | "
          f"{mean([r['cost_usd'] for r in rs])} | {mean(scores):.2f} |")

# ---- deltas ----
g = by_arm.get("grep", []); h = by_arm.get("graph", [])
if g and h:
    gt = med([r['total_tokens'] for r in g]); ht = med([r['total_tokens'] for r in h])
    gc = med([r['tool_calls'] for r in g]); hc = med([r['tool_calls'] for r in h])
    print(f"\n**Graph vs grep:** tokens {gt} -> {ht} "
          f"({'%.1fx' % (gt/ht) if ht else 'n/a'} {'fewer' if ht<gt else 'MORE'}); "
          f"tool-calls {gc} -> {hc}.")

# ---- per-query breakdown (median across reps) ----
print("\n## Per query (median across reps)\n")
print("| Query | class | arm | tool-calls | tokens | latency s | score |")
print("|---|---|---|--:|--:|--:|--:|")
by_q = defaultdict(lambda: defaultdict(list))
for r in rows:
    by_q[r["id"]][r["arm"]].append(r)
for qid in sorted(by_q):
    for arm in ("grep", "graph"):
        rs = by_q[qid].get(arm, [])
        if not rs: continue
        scores = [r["score"] for r in rs if r.get("score") is not None]
        print(f"| {qid} | {rs[0]['cls']} | {arm} | {med([r['tool_calls'] for r in rs])} | "
              f"{med([r['total_tokens'] for r in rs])} | {med([r['wall_s'] for r in rs])} | "
              f"{mean(scores):.2f} |")

# ---- correctness by class ----
print("\n## Correctness by query class\n")
print("| class | grep | graph |")
print("|---|--:|--:|")
cls_arm = defaultdict(lambda: defaultdict(list))
for r in rows:
    if r.get("score") is not None:
        cls_arm[r["cls"]][r["arm"]].append(r["score"])
for cls in sorted(cls_arm):
    gg = cls_arm[cls].get("grep", []); hh = cls_arm[cls].get("graph", [])
    print(f"| {cls} | {mean(gg):.2f} | {mean(hh):.2f} |")
