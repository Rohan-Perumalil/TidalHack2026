"""
Post-processing: defect families, growth metrics, segment risk, KPIs.
Uses outputs from matcher.py (out/matches.csv + canonical tables).
Writes:
  - out/families.csv
  - out/segment_risk.csv
  - out/kpis.json
"""

from __future__ import annotations

import csv
import json
import math
from collections import defaultdict
from typing import Dict, List

import os
import json
from matcher import run_matching, load_csv, Anomaly, stability_overlap

OUT_DIR = "out"


def build_families(summary) -> List[Dict]:
    matches = summary["matches_list"]
    a_map = summary["a_map"]
    b_map = summary["b_map"]
    fams = []
    fam_id = 0
    for m in matches:
        a = a_map[m["anomaly_id_2015"]]
        b = b_map[m["anomaly_id_2022"]]
        depth_growth = None
        if a.depth_pct is not None and b.depth_pct is not None:
            depth_growth = b.depth_pct - a.depth_pct
        growth_rate = depth_growth / 7.0 if depth_growth is not None else None  # years between 2015 and 2022
        fams.append(
            {
                "defect_family_id": fam_id,
                "anomaly_id_2015": a.row_id,
                "anomaly_id_2022": b.row_id,
                "pos_2015": a.pos_ft,
                "pos_2022": b.pos_ft,
                "dx": m["dx"],
                "clock_2015": a.clock_hr,
                "clock_2022": b.clock_hr,
                "depth_2015": a.depth_pct,
                "depth_2022": b.depth_pct,
                "depth_growth": depth_growth,
                "depth_growth_rate_per_year": growth_rate,
                "len_2015": a.len_in,
                "len_2022": b.len_in,
                "wid_2015": a.wid_in,
                "wid_2022": b.wid_in,
                "side_2015": a.side,
                "side_2022": b.side,
                "type_2015": a.type,
                "type_2022": b.type,
                "cost": m["cost"],
            }
        )
        fam_id += 1
    return fams


def segment_risk(fams: List[Dict], bin_size: float = 500.0) -> List[Dict]:
    bins = defaultdict(lambda: {"count": 0, "max_depth": -math.inf, "max_growth": -math.inf})
    for f in fams:
        pos = f["pos_2022"] if f["pos_2022"] is not None else f["pos_2015"]
        if pos is None:
            continue
        key = math.floor(pos / bin_size) * bin_size
        bins[key]["count"] += 1
        if f["depth_2022"] is not None:
            bins[key]["max_depth"] = max(bins[key]["max_depth"], f["depth_2022"])
        if f["depth_growth"] is not None:
            bins[key]["max_growth"] = max(bins[key]["max_growth"], f["depth_growth"])
    out = []
    for k, v in bins.items():
        max_depth = v["max_depth"] if v["max_depth"] != -math.inf else None
        max_growth = v["max_growth"] if v["max_growth"] != -math.inf else None
        score = 0.0
        if max_depth is not None:
            score += 0.7 * max_depth
        if max_growth is not None:
            score += 0.3 * max_growth
        out.append(
            {
                "segment_start_ft": k,
                "segment_end_ft": k + bin_size,
                "families": v["count"],
                "max_depth_pct": max_depth,
                "max_growth_pct": max_growth,
                "risk_score": score,
            }
        )
    out.sort(key=lambda x: x["risk_score"] if x["risk_score"] is not None else -math.inf, reverse=True)
    return out


def write_csv(path: str, rows: List[Dict]):
    if not rows:
        return
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        for r in rows:
            w.writerow(r)


def kpis(base_summary, base_matches, probe_matches):
    n15 = len(base_summary["a_map"])
    n22 = len(base_summary["b_map"])
    coverage = len(base_matches) / min(n15, n22) if min(n15, n22) else 0.0
    plausibility = len(base_matches) / len(base_summary["matches_list"]) if base_summary["matches_list"] else 1.0
    stability = stability_overlap(base_matches, probe_matches)
    return {
        "coverage": coverage,
        "plausibility": plausibility,
        "stability": stability,
        "matched": len(base_matches),
        "unmatched_2015": base_summary["unmatched_2015"],
        "unmatched_2022": base_summary["unmatched_2022"],
    }


def evaluate(config=None):
    base_summary = run_matching(config)
    fams = build_families(base_summary)
    segs = segment_risk(fams, bin_size=500.0)

    # stability probe: slight window perturbation
    probe_summary = run_matching(
        {**(config or {}), "window": base_summary["config"]["window"] * 1.05}
    )
    stab = stability_overlap(base_summary["matches_list"], probe_summary["matches_list"])

    kpi = kpis(base_summary, base_summary["matches_list"], probe_summary["matches_list"])
    kpi["stability"] = stab

    # write artifacts
    write_csv(f"{OUT_DIR}/families.csv", fams)
    write_csv(f"{OUT_DIR}/segment_risk.csv", segs)
    with open(f"{OUT_DIR}/kpis.json", "w") as f:
        json.dump(kpi, f, indent=2)

    return {
        "matches": base_summary["matches_list"],
        "families": fams,
        "segment_risk": segs,
        "kpis": kpi,
    }


def main():
    # allow JSON config via env (from API)
    cfg = None
    if os.environ.get("CONFIG_JSON"):
        try:
            cfg = json.loads(os.environ["CONFIG_JSON"])
        except Exception:
            cfg = None
    result = evaluate(cfg)
    print("families:", len(result["families"]))
    print("segment bins:", len(result["segment_risk"]))
    print("kpis:", result["kpis"])


if __name__ == "__main__":
    main()
