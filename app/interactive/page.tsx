"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  Connection,
  Edge as RFEdge,
  Node as RFNode,
  Position,
  Handle,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import styles from "./interactive.module.css";

type Config = {
  window?: number;
  require_same_side?: boolean;
  weights?: Record<string, number>;
  unmatched_penalty?: number;
  hard_limits?: { dx?: number; clock?: number; cost?: number };
};

const PRESETS: Record<"Strict" | "Balanced" | "Lenient", Partial<Config>> = {
  Strict: {
    window: 3.5,
    weights: { dist: 1.2, clock: 0.35, depth: 0.07, size: 0.03 },
    unmatched_penalty: 25,
    hard_limits: { dx: 3.5, clock: 2.0, cost: 10 },
  },
  Balanced: {
    window: 5,
    weights: { dist: 1.0, clock: 0.3, depth: 0.05, size: 0.02 },
    unmatched_penalty: 20,
    hard_limits: { dx: 5, clock: 3, cost: 12 },
  },
  Lenient: {
    window: 7,
    weights: { dist: 0.8, clock: 0.25, depth: 0.04, size: 0.015 },
    unmatched_penalty: 12,
    hard_limits: { dx: 7, clock: 4, cost: 18 },
  },
};

function InputNode() {
  return (
    <div className={styles.nodeCard}>
      <Handle type="source" position={Position.Right} className={`${styles.handle} ${styles.handleSource}`} />
      <div className={styles.nodeTitle}>Input</div>
      <div className={styles.nodeHint}>Dataset entry</div>
    </div>
  );
}

function GateNode({ data }: any) {
  return (
    <div className={styles.nodeCard}>
      <Handle type="target" position={Position.Left} className={`${styles.handle} ${styles.handleTarget}`} />
      <Handle type="source" position={Position.Right} className={`${styles.handle} ${styles.handleSource}`} />
      <div className={styles.nodeTitle}>Gate</div>
      <div className={styles.field}>
        <label>Window (ft): {data.window.toFixed(1)}</label>
        <input
          className={styles.slider}
          type="range"
          min={1}
          max={15}
          step={0.5}
          value={data.window}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => data.onChangeWindow(parseFloat(e.target.value))}
        />
      </div>
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={data.requireSame}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => data.onChangeSame(e.target.checked)}
        />
        Require same side
      </label>
    </div>
  );
}

function UnmatchedNode({ data }: any) {
  return (
    <div className={styles.nodeCard}>
      <Handle type="target" position={Position.Left} className={`${styles.handle} ${styles.handleTarget}`} />
      <Handle type="source" position={Position.Right} className={`${styles.handle} ${styles.handleSource}`} />
      <div className={styles.nodeTitle}>Unmatched Penalty</div>
      <label className={styles.field}>Penalty: {data.penalty.toFixed(1)}</label>
      <input
        className={styles.slider}
        type="range"
        min={5}
        max={50}
        step={1}
        value={data.penalty}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => data.onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

function LimitsNode({ data }: any) {
  return (
    <div className={styles.nodeCard}>
      <Handle type="target" position={Position.Left} className={`${styles.handle} ${styles.handleTarget}`} />
      <Handle type="source" position={Position.Right} className={`${styles.handle} ${styles.handleSource}`} />
      <div className={styles.nodeTitle}>Hard Limits</div>
      {["dx", "clock", "cost"].map((k: string) => (
        <div key={k} className={styles.field}>
          <label>
            {k}: {data[k].toFixed(1)}
          </label>
          <input
            className={styles.slider}
            type="range"
            min={k === "cost" ? 5 : 0.5}
            max={k === "cost" ? 25 : 10}
            step={0.1}
            value={data[k]}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => data.onChange(k, parseFloat(e.target.value))}
          />
        </div>
      ))}
    </div>
  );
}

function EvaluateNode({ data }: any) {
  return (
    <div className={styles.nodeCard}>
      <Handle type="target" position={Position.Left} className={`${styles.handle} ${styles.handleTarget}`} />
      <Handle type="target" position={Position.Top} id="eval-top" className={`${styles.handle} ${styles.handleTarget}`} />
      <Handle type="target" position={Position.Bottom} id="eval-bottom" className={`${styles.handle} ${styles.handleTarget}`} />
      <div className={styles.nodeTitle}>Evaluate</div>
      <div className={styles.nodeHint}>Runs /api/evaluate with current config.</div>
      <button className={styles.button} onClick={data.onEvaluate}>
        Run
      </button>
    </div>
  );
}

const nodeTypes = {
  inputNode: InputNode,
  gateNode: GateNode,
  unmatchedNode: UnmatchedNode,
  limitsNode: LimitsNode,
  evaluateNode: EvaluateNode,
};

function Graph() {
  const [config, setConfig] = useState<Config>({
    window: 5,
    require_same_side: false,
    weights: { dist: 1.0, clock: 0.3, depth: 0.05, size: 0.02 },
    unmatched_penalty: 20,
    hard_limits: { dx: 5, clock: 3, cost: 12 },
  });
  const [warning, setWarning] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [preset, setPreset] = useState<"Strict" | "Balanced" | "Lenient">("Balanced");

  const configRef = useRef(config);
  React.useEffect(() => {
    configRef.current = config;
  }, [config]);

  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode[]>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge[]>([]);
  const { project } = useReactFlow();
  const [usedIds, setUsedIds] = useState<Set<string>>(new Set());

  const isValidGraph = useCallback(() => {
    const edgeSet = new Set(edges.map((e) => `${e.source}->${e.target}`));
    const hasEvaluate = nodes.some((n) => n.id === "evaluate");
    const hasInputGate = edgeSet.has("input->gate");
    const hasToEvaluate = edges.some((e) => e.target === "evaluate");
    return hasEvaluate && hasInputGate && hasToEvaluate;
  }, [edges, nodes]);

  const onConnect = useCallback(
    (params: RFEdge | Connection) =>
      setEdges((eds) => addEdge({ ...params, type: "smoothstep", animated: true }, eds)),
    [setEdges]
  );

  const evaluate = useCallback(async () => {
    if (!isValidGraph()) {
      setWarning("Add Evaluate from the library, connect Input → Gate → Evaluate, then run.");
      setStatus(null);
      return;
    }
    setWarning(null);
    setStatus("Running…");
    setLoading(true);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configRef.current),
      });
      if (!res.ok) throw new Error(await res.text());
      await res.json();
      setStatus("Evaluation succeeded");
    } catch (e: any) {
      setWarning(e.message || "Evaluation failed");
      setStatus("Evaluation failed");
    } finally {
      setLoading(false);
    }
  }, [isValidGraph]);

  const applyPreset = (name: "Strict" | "Balanced" | "Lenient") => {
    setPreset(name);
    const p = PRESETS[name];
    setConfig((c) => ({
      ...c,
      ...p,
      weights: { ...(c.weights || {}), ...(p.weights || {}) },
      hard_limits: { ...(c.hard_limits || {}), ...(p.hard_limits || {}) },
    }));
    setNodes((nds) =>
      nds.map((n) => {
        const data = n.data as any;
        if (n.id === "gate") {
          return { ...n, data: { ...data, window: p.window ?? data.window, requireSame: data.requireSame } };
        }
        if (n.id === "limits") {
          return {
            ...n,
            data: {
              ...data,
              dx: p.hard_limits?.dx ?? data.dx,
              clock: p.hard_limits?.clock ?? data.clock,
              cost: p.hard_limits?.cost ?? data.cost,
            },
          };
        }
        if (n.id === "unmatched") {
          return { ...n, data: { ...data, penalty: p.unmatched_penalty ?? data.penalty } };
        }
        return n;
      })
    );
  };

  const library = useMemo(
    () => [
      {
        id: "input",
        title: "Input",
        desc: "Dataset entry",
        type: "inputNode",
        unique: true,
        data: {},
      },
      {
        id: "gate",
        title: "Gate",
        desc: "Window + side filter",
        type: "gateNode",
        unique: true,
        data: {
          window: config.window ?? 5,
          requireSame: config.require_same_side ?? false,
          onChangeWindow: (v: number) => {
            setConfig((c) => ({ ...c, window: v }));
            setNodes((nds) =>
              nds.map((n) =>
                n.id === "gate" ? { ...n, data: { ...n.data, window: v } } : n
              )
            );
          },
          onChangeSame: (v: boolean) => {
            setConfig((c) => ({ ...c, require_same_side: v }));
            setNodes((nds) =>
              nds.map((n) =>
                n.id === "gate" ? { ...n, data: { ...n.data, requireSame: v } } : n
              )
            );
          },
        },
      },
      {
        id: "limits",
        title: "Limits",
        desc: "dx / clock / cost caps",
        type: "limitsNode",
        unique: true,
        data: {
          dx: config.hard_limits?.dx ?? 5,
          clock: config.hard_limits?.clock ?? 3,
          cost: config.hard_limits?.cost ?? 12,
          onChange: (k: string, v: number) => {
            setConfig((c) => ({ ...c, hard_limits: { ...(c.hard_limits || {}), [k]: v } }));
            setNodes((nds) =>
              nds.map((n) =>
                n.id === "limits" ? { ...n, data: { ...n.data, [k]: v } } : n
              )
            );
          },
        },
      },
      {
        id: "unmatched",
        title: "Unmatched",
        desc: "Penalty control",
        type: "unmatchedNode",
        unique: true,
        data: {
          penalty: config.unmatched_penalty ?? 20,
          onChange: (v: number) => {
            setConfig((c) => ({ ...c, unmatched_penalty: v }));
            setNodes((nds) =>
              nds.map((n) =>
                n.id === "unmatched" ? { ...n, data: { ...n.data, penalty: v } } : n
              )
            );
          },
        },
      },
      {
        id: "evaluate",
        title: "Evaluate",
        desc: "Run the graph",
        type: "evaluateNode",
        unique: true,
        data: {
          onEvaluate: () => evaluate(),
        },
      },
    ],
    [config, evaluate, setNodes]
  );

  const addFromLibrary = (itemId: string, position?: { x: number; y: number }) => {
    const item = library.find((i) => i.id === itemId);
    if (!item) return;
    if (item.unique && (usedIds.has(item.id) || nodes.some((n) => n.id === item.id))) {
      setWarning(`${item.title} is already on the board.`);
      return;
    }
    const nextIndex = nodes.length;
    const baseY = position?.y ?? 40 + (nextIndex % 3) * 120;
    const baseX = position?.x ?? -200 + Math.floor(nextIndex / 3) * 220;
    setNodes((nds) => [
      ...nds,
      {
        id: item.id,
        type: item.type as any,
        position: { x: baseX, y: baseY },
        data: item.data,
      } as RFNode,
    ]);
    setUsedIds((prev) => new Set(prev).add(item.id));
  };

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const id = event.dataTransfer.getData("application/node-id");
      if (!id) return;
      const bounds = (event.target as HTMLDivElement).getBoundingClientRect();
      const position = project({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      addFromLibrary(id, position);
    },
    [addFromLibrary, project]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  return (
    <div className={styles.scene}>
      <div className={styles.aurora} />
      <div className={styles.grid} />
      <div className={styles.snowBack} />
      <div className={styles.snowFront} />
      <div className={styles.treeline} />
      <div className={styles.snowDrift} />

      <header className={styles.header}>
        <div className={styles.brand}>
          <div>
            <div className={styles.title}>Penguin Node Lab</div>
            <div className={styles.subtitle}>Drag nodes into Evaluate for a snowy test run.</div>
          </div>
        </div>
        <div className={styles.controls}>
          <label className={styles.label}>Preset</label>
          <select className={styles.select} value={preset} onChange={(e) => applyPreset(e.target.value as any)}>
            <option value="Strict">Strict</option>
            <option value="Balanced">Balanced</option>
            <option value="Lenient">Lenient</option>
          </select>
          {loading && <span className={`${styles.chip} ${styles.chipRunning}`}>Evaluating…</span>}
          {status && !loading && (
            <span
              className={`${styles.chip} ${
                status === "Evaluation succeeded" ? styles.chipSuccess : status === "Evaluation failed" ? styles.chipWarn : ""
              }`}
            >
              {status}
            </span>
          )}
          {warning && <span className={`${styles.chip} ${styles.chipWarn}`}>Check connections</span>}
        </div>
      </header>

      <div className={styles.flowWrap}>
        <ReactFlow
          className={styles.flow}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          defaultEdgeOptions={{ type: "smoothstep", animated: true, style: { stroke: "#bce1ff", strokeWidth: 2 } }}
          connectionLineStyle={{ stroke: "#bce1ff", strokeWidth: 2 }}
          panOnScroll
          selectionOnDrag
          onDrop={onDrop}
          onDragOver={onDragOver}
        >
          <Background gap={22} size={1} color="rgba(255,255,255,0.18)" />
        </ReactFlow>
        <img src="/penguin.png" alt="Penguin guide" className={styles.penguin} />
        <div className={styles.bubble}>
          <div className={styles.bubbleTitle}>Penguin tip</div>
          <div className={styles.bubbleText}>
            Drag the frosted handles into Evaluate, then tap Run. Stay frosty!
          </div>
        </div>
      </div>

      <div className={styles.libraryBar}>
        <div className={styles.libraryTitle}>
          <span>Snowy Library</span>
          <span className={styles.muted}>Pick which nodes to place on the board.</span>
        </div>
        <div className={styles.libraryCards}>
          {library.map((item) => {
            const used = usedIds.has(item.id) || nodes.some((n) => n.id === item.id);
            return (
              <div
                key={item.id}
                className={`${styles.libraryCard} ${used ? styles.libraryCardDisabled : ""}`}
                draggable={!used}
                onDragStart={(e) => {
                  if (used) return;
                  e.dataTransfer.setData("application/node-id", item.id);
                }}
                onClick={() => {
                  if (!used) addFromLibrary(item.id);
                }}
              >
                <div className={styles.libraryName}>{item.title}</div>
                <div className={styles.libraryDesc}>{item.desc}</div>
                <button className={styles.libraryCTA} disabled={used}>
                  {used ? "Already placed" : "Add to board"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function InteractivePage() {
  return (
    <ReactFlowProvider>
      <Graph />
    </ReactFlowProvider>
  );
}
