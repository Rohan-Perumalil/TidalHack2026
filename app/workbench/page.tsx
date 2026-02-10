"use client";

import { useMemo, useState } from "react";

type Config = {
  window?: number;
  require_same_side?: boolean;
  weights?: { dist?: number; clock?: number; depth?: number; size?: number };
  penalties?: { side?: number; type?: number };
  unmatched_penalty?: number;
  hard_limits?: { dx?: number; clock?: number; cost?: number };
};

type Kpis = {
  coverage: number;
  plausibility: number;
  stability: number;
  matched: number;
  unmatched_2015: number;
  unmatched_2022: number;
};

export default function WorkbenchPage() {
  const [config, setConfig] = useState<Config>({
    window: 5,
    require_same_side: false,
    weights: { dist: 1.0, clock: 0.3, depth: 0.05, size: 0.02 },
    penalties: { side: 5, type: 2 },
    unmatched_penalty: 20,
    hard_limits: { dx: 5, clock: 3, cost: 12 },
  });
  const [loading, setLoading] = useState(false);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [artifacts, setArtifacts] = useState<{ matches_path?: string; families_path?: string; segment_risk_path?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nodeList = useMemo(
    () => [
      { key: "window", label: "Distance Window (ft)", value: config.window },
      { key: "require_same_side", label: "Require Same Side", value: config.require_same_side },
      { key: "weights", label: "Weights", value: config.weights },
      { key: "penalties", label: "Penalties", value: config.penalties },
      { key: "unmatched_penalty", label: "Unmatched Penalty", value: config.unmatched_penalty },
      { key: "hard_limits", label: "Hard Limits", value: config.hard_limits },
    ],
    [config]
  );

  const updateConfig = (patch: Partial<Config>) => {
    setConfig((c) => ({ ...c, ...patch }));
  };

  const updateNested = <K extends keyof Config>(key: K, patch: any) => {
    setConfig((c) => ({ ...c, [key]: { ...(c[key] as any), ...patch } }));
  };

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await res.json();
      setKpis(data.kpis);
      setArtifacts({
        matches_path: data.matches_path,
        families_path: data.families_path,
        segment_risk_path: data.segment_risk_path,
      });
    } catch (e: any) {
      setError(e.message || "Evaluation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "24px", background: "#0c1d3a", minHeight: "100vh", color: "#e8f5ff" }}>
      <h1 style={{ marginBottom: 12 }}>Node Workbench</h1>
      <p style={{ opacity: 0.8, marginBottom: 20 }}>Connect configuration nodes, compile to JSON, and evaluate matching.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 20 }}>
        <div className="card">
          <label>Distance Window (ft)</label>
          <input
            type="number"
            step="0.1"
            value={config.window ?? 5}
            onChange={(e) => updateConfig({ window: parseFloat(e.target.value) })}
          />
        </div>
        <div className="card">
          <label>Require Same Side</label>
          <input
            type="checkbox"
            checked={config.require_same_side ?? false}
            onChange={(e) => updateConfig({ require_same_side: e.target.checked })}
          />{" "}
          <span>{config.require_same_side ? "Yes" : "No"}</span>
        </div>
        <div className="card">
          <label>Weights</label>
          {["dist", "clock", "depth", "size"].map((k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span style={{ width: 70 }}>{k}</span>
              <input
                type="number"
                step="0.01"
                value={(config.weights as any)?.[k] ?? 0}
                onChange={(e) => updateNested("weights", { [k]: parseFloat(e.target.value) })}
              />
            </div>
          ))}
        </div>
        <div className="card">
          <label>Penalties</label>
          {["side", "type"].map((k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span style={{ width: 70 }}>{k}</span>
              <input
                type="number"
                step="0.1"
                value={(config.penalties as any)?.[k] ?? 0}
                onChange={(e) => updateNested("penalties", { [k]: parseFloat(e.target.value) })}
              />
            </div>
          ))}
        </div>
        <div className="card">
          <label>Unmatched Penalty</label>
          <input
            type="number"
            step="1"
            value={config.unmatched_penalty ?? 20}
            onChange={(e) => updateConfig({ unmatched_penalty: parseFloat(e.target.value) })}
          />
        </div>
        <div className="card">
          <label>Hard Limits</label>
          {["dx", "clock", "cost"].map((k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span style={{ width: 70 }}>{k}</span>
              <input
                type="number"
                step="0.1"
                value={(config.hard_limits as any)?.[k] ?? 0}
                onChange={(e) => updateNested("hard_limits", { [k]: parseFloat(e.target.value) })}
              />
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <button onClick={run} disabled={loading} style={{ padding: "10px 16px", borderRadius: 8, background: "#4fb0ff", border: "none", color: "#0c1d3a", fontWeight: 700, cursor: "pointer" }}>
          {loading ? "Evaluating..." : "Evaluate graph"}
        </button>
        {error && <span style={{ color: "#ffb3b3", marginLeft: 12 }}>{error}</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        <div className="card">
          <h3>Compiled JSON</h3>
          <pre style={{ maxHeight: 260, overflow: "auto" }}>{JSON.stringify(config, null, 2)}</pre>
        </div>
        <div className="card">
          <h3>KPIs</h3>
          {kpis ? (
            <ul>
              <li>Coverage: {(kpis.coverage * 100).toFixed(1)}%</li>
              <li>Plausibility: {(kpis.plausibility * 100).toFixed(1)}%</li>
              <li>Stability: {(kpis.stability * 100).toFixed(1)}%</li>
              <li>Matched: {kpis.matched}</li>
              <li>Unmatched 2015: {kpis.unmatched_2015}</li>
              <li>Unmatched 2022: {kpis.unmatched_2022}</li>
            </ul>
          ) : (
            <p style={{ opacity: 0.7 }}>Run evaluate to see KPIs</p>
          )}
        </div>
        <div className="card">
          <h3>Artifacts</h3>
          {artifacts ? (
            <ul>
              <li><a href={artifacts.matches_path || "#"}>matches.csv</a></li>
              <li><a href={artifacts.families_path || "#"}>families.csv</a></li>
              <li><a href={artifacts.segment_risk_path || "#"}>segment_risk.csv</a></li>
            </ul>
          ) : (
            <p style={{ opacity: 0.7 }}>Will appear after evaluate</p>
          )}
        </div>
      </div>
    </div>
  );
}
