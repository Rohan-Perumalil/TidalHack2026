import { NextResponse } from "next/server";
import { spawnSync } from "child_process";
import path from "path";

// Lightweight API handler: accepts JSON config, runs analytics.py, returns outputs.
// Note: This will execute Python synchronously; in production you'd want a job queue or cached computations.

export async function POST(req: Request) {
  const config = await req.json().catch(() => ({}));
  const projectRoot = process.cwd();
  const script = path.join(projectRoot, "analytics.py");

  // Pass config via environment variable CONFIG_JSON to avoid parsing args.
  const env = { ...process.env, CONFIG_JSON: JSON.stringify(config) };
  const result = spawnSync("python3", [script], { env, encoding: "utf-8" });

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }
  if (result.status !== 0) {
    return NextResponse.json({ error: result.stderr || "Evaluation failed" }, { status: 500 });
  }

  // Read the artifacts written by analytics.py
  try {
    const matches = require(path.join(projectRoot, "out", "matches.csv"));
  } catch (e) {
    // ignore; we'll return only KPIs
  }
  const kpis = require(path.join(projectRoot, "out", "kpis.json"));
  const familiesCsv = path.join(projectRoot, "out", "families.csv");
  const segmentsCsv = path.join(projectRoot, "out", "segment_risk.csv");

  return NextResponse.json({
    kpis,
    families_path: familiesCsv,
    segment_risk_path: segmentsCsv,
    matches_path: path.join(projectRoot, "out", "matches.csv"),
  });
}
