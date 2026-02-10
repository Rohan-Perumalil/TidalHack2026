"""
Candidate generation + Hungarian matching for ILI anomalies.

Uses canonical tables produced by matching_engine.py (expected in ./out/).
Configurable window, penalties, and thresholds.
Outputs: matches.csv, unmatched_2015.csv, unmatched_2022.csv (in ./out).
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from typing import Dict, List, Tuple, Optional, Set

OUT_DIR = "out"


@dataclass
class Anomaly:
    row_id: int
    year: str
    pos_ft: float
    clock_hr: Optional[float]
    side: Optional[str]
    depth_pct: Optional[float]
    len_in: Optional[float]
    wid_in: Optional[float]
    type: Optional[str]


def load_csv(path: str) -> List[Anomaly]:
    rows = []
    with open(path, newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            rows.append(
                Anomaly(
                    row_id=int(row["row_id"]),
                    year=row.get("year", ""),
                    pos_ft=float(row["pos_ft"]),
                    clock_hr=float(row["clock_hr"]) if row["clock_hr"] else None,
                    side=row["side"] or None,
                    depth_pct=float(row["depth_pct"]) if row["depth_pct"] else None,
                    len_in=float(row["len_in"]) if row["len_in"] else None,
                    wid_in=float(row["wid_in"]) if row["wid_in"] else None,
                    type=row["type"] or None,
                )
            )
    return rows


def clock_diff(a: Optional[float], b: Optional[float]) -> Optional[float]:
    if a is None or b is None:
        return None
    d = abs(a - b)
    return min(d, 12 - d)


def type_norm(t: Optional[str]) -> str:
    return t.strip().lower() if t else ""


def generate_candidates(
    a_rows: List[Anomaly],
    b_rows: List[Anomaly],
    window: float,
    require_same_side: bool,
) -> List[Tuple[int, int, float, Optional[float], float]]:
    edges = []
    b_sorted = sorted(b_rows, key=lambda x: x.pos_ft)
    nB = len(b_sorted)
    j = 0
    for r in a_rows:
        pos = r.pos_ft
        while j < nB and b_sorted[j].pos_ft < pos - window:
            j += 1
        k = j
        while k < nB and b_sorted[k].pos_ft <= pos + window:
            r2 = b_sorted[k]
            if require_same_side and r.side and r2.side and r.side != r2.side:
                k += 1
                continue
            dx = abs(pos - r2.pos_ft)
            dc = clock_diff(r.clock_hr, r2.clock_hr)
            edges.append((r.row_id, r2.row_id, dx, dc, 0.0))  # cost filled later
            k += 1
    return edges


def compute_costs(
    edges: List[Tuple[int, int, float, Optional[float], float]],
    a_map: Dict[int, Anomaly],
    b_map: Dict[int, Anomaly],
    weights: Dict[str, float],
    penalties: Dict[str, float],
) -> List[Tuple[int, int, float, Optional[float], float]]:
    out = []
    for a_id, b_id, dx, dc, _ in edges:
        a = a_map[a_id]
        b = b_map[b_id]
        cost = weights["dist"] * dx
        if dc is not None:
            cost += weights["clock"] * dc
        if a.depth_pct is not None and b.depth_pct is not None:
            cost += weights["depth"] * abs(a.depth_pct - b.depth_pct)
        if a.len_in is not None and b.len_in is not None:
            cost += weights["size"] * abs(a.len_in - b.len_in)
        if a.wid_in is not None and b.wid_in is not None:
            cost += weights["size"] * abs(a.wid_in - b.wid_in)
        if a.side and b.side and a.side != b.side:
            cost += penalties["side"]
        if a.type and b.type and type_norm(a.type) != type_norm(b.type):
            cost += penalties["type"]
        out.append((a_id, b_id, dx, dc, cost))
    return out


# Hungarian algorithm (O(n^3))
def hungarian(cost_matrix: List[List[float]]) -> List[int]:
    n = len(cost_matrix)
    u = [0.0] * (n + 1)
    v = [0.0] * (n + 1)
    p = [0] * (n + 1)
    way = [0] * (n + 1)
    for i in range(1, n + 1):
        p[0] = i
        j0 = 0
        minv = [float("inf")] * (n + 1)
        used = [False] * (n + 1)
        while True:
            used[j0] = True
            i0 = p[j0]
            delta = float("inf")
            j1 = 0
            for j in range(1, n + 1):
                if not used[j]:
                    cur = cost_matrix[i0 - 1][j - 1] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j] = cur
                        way[j] = j0
                    if minv[j] < delta:
                        delta = minv[j]
                        j1 = j
            for j in range(n + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
            if j0 == 0:
                break
    assignment = [-1] * n
    for j in range(1, n + 1):
        if p[j] != 0:
            assignment[p[j] - 1] = j - 1
    return assignment


def stability_overlap(base_matches, probe_matches):
    base_pairs = {(m["anomaly_id_2015"], m["anomaly_id_2022"]) for m in base_matches}
    probe_pairs = {(m["anomaly_id_2015"], m["anomaly_id_2022"]) for m in probe_matches}
    if not base_pairs and not probe_pairs:
        return 1.0
    if not base_pairs or not probe_pairs:
        return 0.0
    return len(base_pairs & probe_pairs) / len(base_pairs | probe_pairs)


def build_assignment(a_ids: List[int], b_ids: List[int], edges, cfg):
    nA, nB = len(a_ids), len(b_ids)
    size = nA + nB if nA + nB else max(nA, nB)
    big_m = cfg["BIG_M"]
    cost_matrix = [[big_m] * size for _ in range(size)]
    edge_map = {(a, b): (dx, dc, c) for a, b, dx, dc, c in edges}
    for ri, a_id in enumerate(a_ids):
        for cj, b_id in enumerate(b_ids):
            if (a_id, b_id) in edge_map:
                cost_matrix[ri][cj] = edge_map[(a_id, b_id)][2]
        # unmatched penalty column
        for cj in range(nB, size):
            cost_matrix[ri][cj] = cfg["unmatched_penalty"]
    for ri in range(nA, size):
        for cj in range(nB):
            cost_matrix[ri][cj] = cfg["unmatched_penalty"]
        for cj in range(nB, size):
            cost_matrix[ri][cj] = 0.0
    assignment = hungarian(cost_matrix)
    return assignment, edge_map, size


def run_matching(config=None):
    cfg = {
        "window": 5.0,
        "require_same_side": False,
        "weights": {"dist": 1.0, "clock": 0.3, "depth": 0.05, "size": 0.02},
        "penalties": {"side": 5.0, "type": 2.0},
        "unmatched_penalty": 20.0,
        "BIG_M": 1e9,
        "hard_limits": {"dx": 5.0, "clock": 3.0, "cost": 12.0},
    }
    if config:
        for k, v in config.items():
            if k in ("weights", "penalties", "hard_limits") and isinstance(v, dict):
                cfg[k] = {**cfg[k], **v}
            else:
                cfg[k] = v

    a_rows = load_csv(f"{OUT_DIR}/canonical_2015.csv")
    b_rows = load_csv(f"{OUT_DIR}/canonical_2022.csv")
    a_map = {r.row_id: r for r in a_rows}
    b_map = {r.row_id: r for r in b_rows}

    edges_raw = generate_candidates(a_rows, b_rows, cfg["window"], cfg["require_same_side"])
    edges = compute_costs(edges_raw, a_map, b_map, cfg["weights"], cfg["penalties"])

    # Build components to keep matrices small
    parent: Dict[Tuple[str, int], Tuple[str, int]] = {}

    def find(x):
        parent.setdefault(x, x)
        if parent[x] != x:
            parent[x] = find(parent[x])
        return parent[x]

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for a_id, b_id, _, _, _ in edges:
        union(("a", a_id), ("b", b_id))

    comp: Dict[Tuple[str, int], Dict[str, Set[int]]] = {}
    for a_id, b_id, dx, dc, c in edges:
        root = find(("a", a_id))
        comp.setdefault(root, {"a": set(), "b": set(), "edges": []})
        comp[root]["a"].add(a_id)
        comp[root]["b"].add(b_id)
        comp[root]["edges"].append((a_id, b_id, dx, dc, c))

    # add isolated nodes
    for r in a_rows:
        node = ("a", r.row_id)
        if node not in parent:
            parent[node] = node
            comp[node] = {"a": {r.row_id}, "b": set(), "edges": []}
    for r in b_rows:
        node = ("b", r.row_id)
        if node not in parent:
            parent[node] = node
            comp[node] = {"a": set(), "b": {r.row_id}, "edges": []}

    matches = []
    unmatched_2015 = []
    matched_2022 = set()

    for cdata in comp.values():
        a_ids = sorted(list(cdata["a"]))
        b_ids = sorted(list(cdata["b"]))
        if not a_ids and not b_ids:
            continue
        assignment, edge_map, _ = build_assignment(a_ids, b_ids, cdata["edges"], cfg)
        for ri, a_id in enumerate(a_ids):
            col = assignment[ri]
            if col < len(b_ids):
                b_id = b_ids[col]
                dx, dc, cost = edge_map.get((a_id, b_id), (math.inf, None, cfg["BIG_M"]))
                if dx > cfg["hard_limits"]["dx"] or (dc is not None and dc > cfg["hard_limits"]["clock"]) or cost > cfg["hard_limits"]["cost"]:
                    unmatched_2015.append(a_id)
                else:
                    matches.append({"anomaly_id_2015": a_id, "anomaly_id_2022": b_id, "dx": dx, "dclock": dc, "cost": cost})
                    matched_2022.add(b_id)
            else:
                unmatched_2015.append(a_id)

    all_2022 = set(b_map.keys())
    unmatched_2022 = sorted(list(all_2022 - matched_2022))

    # write outputs
    with open(f"{OUT_DIR}/matches.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["anomaly_id_2015", "anomaly_id_2022", "dx", "dclock", "cost"])
        w.writeheader()
        for m in matches:
            w.writerow(m)
    with open(f"{OUT_DIR}/unmatched_2015.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["anomaly_id_2015"])
        for i in unmatched_2015:
            w.writerow([i])
    with open(f"{OUT_DIR}/unmatched_2022.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["anomaly_id_2022"])
        for j in unmatched_2022:
            w.writerow([j])

    summary = {
        "matches": len(matches),
        "unmatched_2015": len(unmatched_2015),
        "unmatched_2022": len(unmatched_2022),
        "config": cfg,
        "matches_list": matches,
        "unmatched_2015_list": unmatched_2015,
        "unmatched_2022_list": unmatched_2022,
        "a_map": a_map,
        "b_map": b_map,
    }
    return summary


if __name__ == "__main__":
    summary = run_matching()
    print("Summary:", summary)
