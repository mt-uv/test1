"use client";

import { useState } from "react";
import CrystalViewer from "./components/CrystalViewer";

const API_BASE =
  process.env.NEXT_PUBLIC_RAILWAY_API_URL || "http://localhost:8000";

type PreviewResponse = {
  filename: string;
  n_atoms: number;
  cif: string;
};

type AppTab = "explorer" | "relax" | "md";
type PotentialOption = "uma" | "orb";

const EXAMPLE_CIF = `data_Si2V1
_symmetry_space_group_name_H-M   'P1'
_cell_length_a   9.295831
_cell_length_b   6.197221
_cell_length_c   10.898132
_cell_angle_alpha   90.000000
_cell_angle_beta    90.000000
_cell_angle_gamma   120.000000
_cell_volume   543.710732
_cell_formula_units_Z   1
loop_
 _atom_site_label
 _atom_site_type_symbol
 _atom_site_fract_x
 _atom_site_fract_y
 _atom_site_fract_z
Na1 Na 0.111111 0.333333 0.750000
Na2 Na 0.222222 0.166667 0.250000
Mn1 Mn 0.000000 0.000000 0.000000
Mn2 Mn 0.000000 0.000000 0.500000
O1 O 0.111111 0.333333 0.401696
O2 O 0.222222 0.166667 0.598304
O3 O 0.222222 0.166667 0.901696
O4 O 0.111111 0.333333 0.098304
Na3 Na 0.111111 0.833333 0.750000
Na4 Na 0.222222 0.666667 0.250000
Mn3 Mn 0.000000 0.500000 0.000000
Mn4 Mn 0.000000 0.500000 0.500000
O5 O 0.111111 0.833333 0.401696
O6 O 0.222222 0.666667 0.598304
O7 O 0.222222 0.666667 0.901696
O8 O 0.111111 0.833333 0.098304
Na5 Na 0.444444 0.333333 0.750000
Na6 Na 0.555556 0.166667 0.250000
Mn5 Mn 0.333333 0.000000 0.000000
Si1 Si 0.333333 0.000000 0.500000
O9 O 0.444444 0.333333 0.401696
O10 O 0.555556 0.166667 0.598304
O11 O 0.555556 0.166667 0.901696
O12 O 0.444444 0.333333 0.098304
Na7 Na 0.444444 0.833333 0.750000
Na8 Na 0.555556 0.666667 0.250000
Mn6 Mn 0.333333 0.500000 0.000000
Si2 Si 0.333333 0.500000 0.500000
O13 O 0.444444 0.833333 0.401696
O14 O 0.555556 0.666667 0.598304
O15 O 0.555556 0.666667 0.901696
O16 O 0.444444 0.833333 0.098304
Na9 Na 0.777778 0.333333 0.750000
Na10 Na 0.888889 0.166667 0.250000
Mn7 Mn 0.666667 0.000000 0.000000
Mn8 Mn 0.666667 0.000000 0.500000
O17 O 0.777778 0.333333 0.401696
O18 O 0.888889 0.166667 0.598304
O19 O 0.888889 0.166667 0.901696
O20 O 0.777778 0.333333 0.098304
Na11 Na 0.777778 0.833333 0.750000
Na12 Na 0.888889 0.666667 0.250000
Mn9 Mn 0.666667 0.500000 0.000000
V1 V 0.666667 0.500000 0.500000
O21 O 0.777778 0.833333 0.401696
O22 O 0.888889 0.666667 0.598304
O23 O 0.888889 0.666667 0.901696
O24 O 0.777778 0.833333 0.098304`;

function Spinner({ label }: { label: string }) {
  return (
    <div className="inline-flex items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-medium text-violet-700 shadow-sm">
      <span className="relative flex h-4 w-4">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-40" />
        <span className="relative inline-flex h-4 w-4 rounded-full bg-violet-500" />
      </span>
      {label}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? "rounded-2xl bg-[linear-gradient(135deg,#7c3aed_0%,#8b5cf6_45%,#6366f1_100%)] px-6 py-3 text-base font-semibold text-white shadow-[0_12px_30px_rgba(124,58,237,0.28)] transition hover:scale-[1.01] md:text-lg"
          : "rounded-2xl border border-slate-200 bg-white/70 px-6 py-3 text-base font-medium text-slate-500 shadow-sm backdrop-blur transition hover:border-slate-300 hover:bg-white md:text-lg"
      }
    >
      {children}
    </button>
  );
}

function InputCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-slate-200/80 bg-white/85 p-5 shadow-sm">
      <label className="mb-3 block text-sm font-medium text-slate-500 md:text-base">
        {label}
      </label>
      {children}
    </div>
  );
}

function SectionCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/85 shadow-sm ${className}`}
    >
      <div className="border-b border-slate-200/80 px-7 py-5">
        <h3 className="text-2xl font-semibold tracking-tight text-slate-950 md:text-3xl">
          {title}
        </h3>
      </div>
      <div className="p-7">{children}</div>
    </div>
  );
}

function ViewerPanel({
  cifText,
  emptyText,
}: {
  cifText: string;
  emptyText: string;
}) {
  if (!cifText) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-12 text-center text-slate-500">
        {emptyText}
      </div>
    );
  }

  return (
    <>
      <div className="rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm">
        <div className="min-h-[520px]">
          <CrystalViewer cifText={cifText} />
        </div>
      </div>

      <details className="mt-5 rounded-2xl border border-slate-200 bg-slate-50">
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-slate-700">
          Show raw CIF
        </summary>
        <div className="px-5 pb-5">
          <textarea
            readOnly
            value={cifText}
            className="mt-2 h-64 w-full rounded-[20px] border border-slate-200 bg-white p-4 font-mono text-[12px] leading-6 text-slate-700 outline-none"
          />
        </div>
      </details>
    </>
  );
}

function AllAtomMSDChart({
  timePs,
  msdBySpecies,
  live,
}: {
  timePs: number[];
  msdBySpecies: Record<string, number[]>;
  live: boolean;
}) {
  const width = 1200;
  const height = 480;
  const padL = 56;
  const padR = 18;
  const padT = 18;
  const padB = 42;

  const species = Object.keys(msdBySpecies);

  const n =
    species.length === 0
      ? timePs.length
      : Math.min(
          timePs.length,
          ...species.map((sp) => msdBySpecies[sp]?.length ?? 0),
          Number.MAX_SAFE_INTEGER
        );

  const xs = timePs.slice(0, n);
  const maxX = Math.max(...xs, 1);

  const allY = species.flatMap((sp) => msdBySpecies[sp].slice(0, n));
  const maxY = Math.max(...allY, 1e-6);

  const xScale = (x: number) => padL + (x / maxX) * (width - padL - padR);
  const yScale = (y: number) =>
    height - padB - (y / maxY) * (height - padT - padB);

  const palette = [
    "#8b5cf6",
    "#10b981",
    "#ec4899",
    "#f59e0b",
    "#0ea5e9",
    "#ef4444",
    "#6366f1",
    "#14b8a6",
  ];

  const xTicks = 5;
  const yTicks = 5;

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-medium text-slate-800">
          Live species-resolved MSD vs time
        </div>
        <div className="text-xs text-slate-500">
          {live ? "Streaming..." : "Complete"}
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
        {Array.from({ length: xTicks + 1 }).map((_, i) => {
          const val = (maxX * i) / xTicks;
          const x = xScale(val);
          return (
            <g key={`x-${i}`}>
              <line
                x1={x}
                y1={padT}
                x2={x}
                y2={height - padB}
                stroke="rgba(148,163,184,0.18)"
                strokeWidth="1"
              />
              <text
                x={x}
                y={height - padB + 18}
                textAnchor="middle"
                fontSize="11"
                fill="#64748b"
              >
                {val.toFixed(2)}
              </text>
            </g>
          );
        })}

        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const val = (maxY * i) / yTicks;
          const y = yScale(val);
          return (
            <g key={`y-${i}`}>
              <line
                x1={padL}
                y1={y}
                x2={width - padR}
                y2={y}
                stroke="rgba(148,163,184,0.18)"
                strokeWidth="1"
              />
              <text
                x={padL - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="#64748b"
              >
                {val.toFixed(2)}
              </text>
            </g>
          );
        })}

        <line
          x1={padL}
          y1={padT}
          x2={padL}
          y2={height - padB}
          stroke="#94a3b8"
          strokeWidth="1.5"
        />
        <line
          x1={padL}
          y1={height - padB}
          x2={width - padR}
          y2={height - padB}
          stroke="#94a3b8"
          strokeWidth="1.5"
        />

        {species.map((sp, idx) => {
          const ys = msdBySpecies[sp].slice(0, n);
          const path =
            ys.length > 0
              ? ys
                  .map(
                    (y, i) =>
                      `${i === 0 ? "M" : "L"} ${xScale(xs[i]).toFixed(2)} ${yScale(y).toFixed(2)}`
                  )
                  .join(" ")
              : "";

          const lastX = xs.length ? xScale(xs[xs.length - 1]) : xScale(0);
          const lastY = ys.length ? yScale(ys[ys.length - 1]) : yScale(0);
          const color = palette[idx % palette.length];

          return (
            <g key={sp}>
              {ys.length > 0 && (
                <>
                  <path d={path} fill="none" stroke={color} strokeWidth="2.5" />
                  <circle
                    cx={lastX}
                    cy={lastY}
                    r={live ? 5 : 4}
                    fill={color}
                    className={live ? "animate-pulse" : ""}
                  />
                </>
              )}
            </g>
          );
        })}

        <text
          x={(padL + width - padR) / 2}
          y={height - 8}
          textAnchor="middle"
          fontSize="12"
          fill="#475569"
        >
          Time (ps)
        </text>

        <text
          x="16"
          y={(padT + height - padB) / 2}
          transform={`rotate(-90 16 ${(padT + height - padB) / 2})`}
          textAnchor="middle"
          fontSize="12"
          fill="#475569"
        >
          MSD (Å²)
        </text>
      </svg>

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
        {species.map((sp, idx) => {
          const color = palette[idx % palette.length];
          return (
            <div key={sp} className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span>{sp}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GenericMDPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [previewCif, setPreviewCif] = useState("");
  const [previewAtomCount, setPreviewAtomCount] = useState<number | null>(null);

  const [potential, setPotential] = useState<PotentialOption>("uma");
  const [temperatureK, setTemperatureK] = useState("800");
  const [timestepFs, setTimestepFs] = useState("1.0");
  const [totalTimePs, setTotalTimePs] = useState("5.0");

  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("No MD run yet.");
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [timePs, setTimePs] = useState<number[]>([]);
  const [msdBySpecies, setMsdBySpecies] = useState<Record<string, number[]>>(
    {}
  );

  const [finalCif, setFinalCif] = useState("");
  const [resultId, setResultId] = useState<string | null>(null);

  async function handleFileChange(f: File | null) {
    if (!f) return;

    setFile(f);
    setPreviewCif("");
    setPreviewAtomCount(null);
    setFinalCif("");
    setResultId(null);
    setTimePs([]);
    setMsdBySpecies({});
    setStage("Uploading structure for preview...");

    try {
      const form = new FormData();
      form.append("file", f);

      const res = await fetch(`${API_BASE}/preview-structure`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const text = await res.text();
        setStage(`Preview failed: ${text}`);
        return;
      }

      const data: PreviewResponse = await res.json();
      setPreviewCif(data.cif || "");
      setPreviewAtomCount(data.n_atoms ?? null);
      setStage(`Preview loaded: ${data.filename || f.name}`);
    } catch (error) {
      setStage(
        `Preview failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  async function runMD() {
    if (!file) {
      setStage("Upload a structure file first.");
      return;
    }

    setLoading(true);
    setStage("Creating MD session...");
    setTimePs([]);
    setMsdBySpecies({});
    setFinalCif("");
    setResultId(null);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("potential", potential);
      form.append("temperature_k", temperatureK);
      form.append("timestep_fs", timestepFs);
      form.append("total_time_ps", totalTimePs);

      const sessionRes = await fetch(`${API_BASE}/md-upload-session`, {
        method: "POST",
        body: form,
      });

      if (!sessionRes.ok) {
        const text = await sessionRes.text();
        setStage(`Failed to create MD session: ${text}`);
        setLoading(false);
        return;
      }

      const { session_id } = await sessionRes.json();
      setSessionId(session_id);

      const es = new EventSource(`${API_BASE}/md-upload-stream/${session_id}`);

      es.addEventListener("meta", (evt) => {
        const data = JSON.parse((evt as MessageEvent).data);
        setStage(`Loaded structure (${data.n_atoms} atoms), starting MD...`);

        if (data.initial_cif) {
          setPreviewCif(data.initial_cif);
        }

        const sp = Array.isArray(data.species) ? data.species : [];
        const empty: Record<string, number[]> = {};
        sp.forEach((s: string) => {
          empty[s] = [];
        });
        setMsdBySpecies(empty);
      });

      es.addEventListener("progress", (evt) => {
        const data = JSON.parse((evt as MessageEvent).data);
        setStage(`Step ${data.step} / ${data.steps}`);
        setTimePs((prev) => [...prev, Number(data.time_ps)]);

        if (data.msd_by_species) {
          setMsdBySpecies((prev) => {
            const next = { ...prev };

            Object.entries(data.msd_by_species).forEach(([sp, value]) => {
              if (!next[sp]) next[sp] = [];
              next[sp] = [...next[sp], Number(value)];
            });

            return next;
          });
        }
      });

      es.addEventListener("result", (evt) => {
        const data = JSON.parse((evt as MessageEvent).data);
        setStage("MD completed");
        setFinalCif(data.final_cif ?? "");
        setResultId(data.result_id ?? null);
      });

      es.addEventListener("cancelled", (evt) => {
        const data = JSON.parse((evt as MessageEvent).data);
        setStage(data.message || "MD cancelled");
      });

      es.addEventListener("done", () => {
        setLoading(false);
        setSessionId(null);
        es.close();
      });

      es.addEventListener("error", () => {
        setStage("MD stream failed.");
        setLoading(false);
        setSessionId(null);
        es.close();
      });
    } catch (error) {
      setStage(
        `Failed to start MD: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      setLoading(false);
      setSessionId(null);
    }
  }

  async function stopMD() {
    if (!sessionId) return;

    try {
      const res = await fetch(`${API_BASE}/stop-upload-md/${sessionId}`, {
        method: "POST",
      });

      if (!res.ok) {
        const text = await res.text();
        setStage(`Failed to stop MD: ${text}`);
      }
    } catch (error) {
      setStage(
        `Failed to stop MD: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  const shownCif = finalCif || previewCif;

  return (
    <section className="relative overflow-hidden rounded-[32px] border border-white/60 bg-white/75 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl md:p-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(124,58,237,0.09),_transparent_22%),radial-gradient(circle_at_bottom_left,_rgba(59,130,246,0.08),_transparent_22%)]" />

      <div className="relative">
        <h2 className="text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
          Run Generic MD
        </h2>

        <p className="mt-4 max-w-4xl text-lg leading-8 text-slate-600 md:text-xl">
          Upload any structure, preview it, choose the ML potential, run NVT
          Langevin MD, and stream live species-resolved MSD.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-8 xl:grid-cols-[520px_minmax(0,1fr)]">
          <SectionCard title="Simulation Setup">
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex cursor-pointer items-center rounded-2xl border border-slate-200 bg-white px-7 py-4 text-lg font-medium text-slate-700 shadow-sm transition hover:border-violet-300 hover:shadow-md">
                Upload structure file
                <input
                  type="file"
                  accept=".cif,.vasp,.poscar,.xyz,.traj"
                  className="hidden"
                  onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                />
              </label>

              {file && (
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  {file.name}
                </div>
              )}

              {previewAtomCount != null && (
                <div className="inline-flex items-center gap-2 rounded-full bg-violet-100 px-4 py-2 text-sm font-medium text-violet-700">
                  <span className="h-2 w-2 rounded-full bg-violet-500" />
                  {previewAtomCount} atoms loaded
                </div>
              )}
            </div>

            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <InputCard label="ML potential">
                <select
                  value={potential}
                  onChange={(e) =>
                    setPotential(e.target.value as PotentialOption)
                  }
                  className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-xl text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                >
                  <option value="uma">UMA</option>
                  <option value="orb">ORB</option>
                </select>
              </InputCard>

              <InputCard label="Temperature (K)">
                <input
                  type="number"
                  value={temperatureK}
                  onChange={(e) => setTemperatureK(e.target.value)}
                  className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-2xl text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                />
              </InputCard>

              <InputCard label="Timestep (fs)">
                <input
                  type="number"
                  step="0.1"
                  value={timestepFs}
                  onChange={(e) => setTimestepFs(e.target.value)}
                  className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-2xl text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                />
              </InputCard>

              <InputCard label="Total time (ps)">
                <input
                  type="number"
                  step="0.1"
                  value={totalTimePs}
                  onChange={(e) => setTotalTimePs(e.target.value)}
                  className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-2xl text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                />
              </InputCard>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                onClick={runMD}
                disabled={!file || loading}
                className="rounded-2xl bg-[linear-gradient(135deg,#0f172a_0%,#111827_100%)] px-7 py-4 text-lg font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.25)] transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Running MD..." : "Run MD"}
              </button>

              <button
                onClick={stopMD}
                disabled={!loading || !sessionId}
                className="rounded-2xl border border-rose-200 bg-rose-50 px-7 py-4 text-lg font-medium text-rose-700 shadow-sm transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Stop MD
              </button>

              {loading && <Spinner label="MD in progress..." />}
            </div>

            <div className="mt-6 rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] p-5 text-sm text-slate-700 shadow-inner">
              {stage}
            </div>
          </SectionCard>

          <SectionCard title="Structure Preview">
            <ViewerPanel cifText={shownCif} emptyText="No preview yet." />
          </SectionCard>
        </div>

        <div className="mt-8">
          <SectionCard title="Live MSD Output">
            <AllAtomMSDChart
              timePs={timePs}
              msdBySpecies={msdBySpecies}
              live={loading}
            />

            {resultId && (
              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  href={`${API_BASE}/download-upload-md-cif/${resultId}`}
                  className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-base font-medium text-slate-700 shadow-sm transition hover:border-violet-300 hover:shadow-md"
                >
                  Download final CIF
                </a>

                <a
                  href={`${API_BASE}/download-upload-md-traj/${resultId}`}
                  className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-base font-medium text-slate-700 shadow-sm transition hover:border-violet-300 hover:shadow-md"
                >
                  Download MD trajectory
                </a>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </section>
  );
}

export default function Page() {
  const [activeTab, setActiveTab] = useState<AppTab>("relax");

  const [file, setFile] = useState<File | null>(null);
  const [potential, setPotential] = useState("uma");
  const [optimizer, setOptimizer] = useState("LBFGS");
  const [fmax, setFmax] = useState("0.05");
  const [steps, setSteps] = useState("300");

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [logs, setLogs] = useState<string[]>(["No output yet."]);
  const [running, setRunning] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [resultId, setResultId] = useState<string | null>(null);
  const [finalEnergy, setFinalEnergy] = useState<number | null>(null);

  async function handlePreview() {
    if (!file) return;

    setPreviewLoading(true);
    setLogs((prev) => [...prev, "Uploading structure for preview..."]);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API_BASE}/preview-structure`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text();
        setLogs((prev) => [...prev, `Preview failed: ${text}`]);
        return;
      }

      const data: PreviewResponse = await res.json();
      setPreview(data);
      setLogs((prev) => [...prev, `Preview loaded: ${data.filename}`]);
    } catch (error) {
      setLogs((prev) => [
        ...prev,
        `Preview failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      ]);
    } finally {
      setPreviewLoading(false);
    }
  }

  function handleUseExample() {
    setFile(null);
    setPreview({
      filename: "example.cif",
      n_atoms: 48,
      cif: EXAMPLE_CIF,
    });
    setLogs(["Loaded example structure."]);
    setResultId(null);
    setFinalEnergy(null);
  }

  async function handleRelax() {
    if (!file && !preview?.cif) return;

    setRunning(true);
    setLogs(["Starting relaxation..."]);
    setResultId(null);
    setFinalEnergy(null);

    try {
      const formData = new FormData();

      if (file) {
        formData.append("file", file);
      } else if (preview?.cif) {
        const blob = new Blob([preview.cif], { type: "text/plain" });
        formData.append("file", blob, preview.filename || "example.cif");
      }

      formData.append("potential", potential);
      formData.append("optimizer", optimizer);
      formData.append("fmax", fmax);
      formData.append("steps", steps);

      const sessionRes = await fetch(`${API_BASE}/relax-upload-session`, {
        method: "POST",
        body: formData,
      });

      if (!sessionRes.ok) {
        const text = await sessionRes.text();
        setLogs((prev) => [...prev, `Could not create session: ${text}`]);
        setRunning(false);
        return;
      }

      const { session_id } = await sessionRes.json();

      const es = new EventSource(`${API_BASE}/relax-upload-stream/${session_id}`);

      es.addEventListener("meta", (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        if (data.initial_energy !== undefined) {
          setLogs((prev) => [
            ...prev,
            `Initial energy = ${Number(data.initial_energy).toFixed(6)} eV`,
          ]);
        }
      });

      es.addEventListener("progress", (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        setLogs((prev) => [...prev, data.log_line]);
      });

      es.addEventListener("result", (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        setLogs((prev) => [
          ...prev,
          `Finished. Final energy = ${data.final_energy.toFixed(6)} eV`,
        ]);
        setFinalEnergy(data.final_energy);
        setResultId(data.result_id);
        setRunning(false);
        es.close();
      });

      es.addEventListener("done", () => {
        setRunning(false);
        es.close();
      });

      es.addEventListener("error", () => {
        setLogs((prev) => [...prev, "Stream error"]);
        setRunning(false);
        es.close();
      });
    } catch (error) {
      setLogs((prev) => [
        ...prev,
        `Relaxation failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      ]);
      setRunning(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(124,58,237,0.10),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.10),_transparent_24%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] text-slate-900">
      <div className="mx-auto max-w-7xl px-6 py-8 md:px-10 md:py-12">
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500 shadow-sm backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-violet-500 shadow-[0_0_12px_rgba(139,92,246,0.9)]" />
            Materials ML
          </div>

          <h1 className="mt-5 max-w-4xl text-5xl font-semibold tracking-tight text-slate-950 md:text-6xl">
            Molecular Simulations with Machine Learning Potentials
          </h1>

          <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600 md:text-2xl md:leading-9">
            Uploaded-structure relaxation and NVT MD in one interface.
          </p>
        </div>

        <div className="mb-8 flex flex-wrap gap-3">
          <TabButton
            active={activeTab === "explorer"}
            onClick={() => setActiveTab("explorer")}
          >
            Cathode Explorer
          </TabButton>

          <TabButton
            active={activeTab === "relax"}
            onClick={() => setActiveTab("relax")}
          >
            Relax Structure
          </TabButton>

          <TabButton
            active={activeTab === "md"}
            onClick={() => setActiveTab("md")}
          >
            Run Generic MD
          </TabButton>
        </div>

        {activeTab === "explorer" && (
          <section className="relative overflow-hidden rounded-[32px] border border-white/60 bg-white/75 p-10 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(124,58,237,0.09),_transparent_22%),radial-gradient(circle_at_bottom_left,_rgba(59,130,246,0.08),_transparent_22%)]" />
            <div className="relative">
              <h2 className="text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
                Cathode Explorer
              </h2>
              <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600 md:text-xl">
                This tab is ready for your explorer interface.
              </p>
            </div>
          </section>
        )}

        {activeTab === "md" && <GenericMDPanel />}

        {activeTab === "relax" && (
          <section className="relative overflow-hidden rounded-[32px] border border-white/60 bg-white/75 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl md:p-10">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(124,58,237,0.09),_transparent_22%),radial-gradient(circle_at_bottom_left,_rgba(59,130,246,0.08),_transparent_22%)]" />

            <div className="relative">
              <h2 className="text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
                Relax Structure
              </h2>

              <p className="mt-4 max-w-4xl text-lg leading-8 text-slate-600 md:text-xl">
                Upload a structure, preview it, choose potential and optimizer,
                then stream the relaxation output live.
              </p>

              <div className="mt-10 grid grid-cols-1 gap-8 xl:grid-cols-[520px_minmax(0,1fr)]">
                <SectionCard title="Relaxation Setup">
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="inline-flex cursor-pointer items-center rounded-2xl border border-slate-200 bg-white px-7 py-4 text-lg font-medium text-slate-700 shadow-sm transition hover:border-violet-300 hover:shadow-md">
                      Upload structure file
                      <input
                        type="file"
                        accept=".cif,.vasp,.poscar"
                        className="hidden"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                      />
                    </label>

                    <button
                      onClick={handleUseExample}
                      className="rounded-2xl border border-violet-200 bg-violet-50 px-7 py-4 text-lg font-medium text-violet-700 shadow-sm transition hover:bg-violet-100"
                    >
                      Use example structure
                    </button>
                  </div>

                  {file && (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      {file.name}
                    </div>
                  )}

                  {!file && preview?.filename === "example.cif" && (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-violet-100 px-4 py-2 text-sm font-medium text-violet-700">
                      <span className="h-2 w-2 rounded-full bg-violet-500" />
                      Example structure loaded
                    </div>
                  )}

                  <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <InputCard label="ML potential">
                      <select
                        value={potential}
                        onChange={(e) => setPotential(e.target.value)}
                        className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-xl text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                      >
                        <option value="uma">UMA</option>
                        <option value="orb">ORB</option>
                      </select>
                    </InputCard>

                    <InputCard label="Optimizer">
                      <select
                        value={optimizer}
                        onChange={(e) => setOptimizer(e.target.value)}
                        className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-xl text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                      >
                        <option value="LBFGS">LBFGS</option>
                        <option value="BFGS">BFGS</option>
                        <option value="FIRE">FIRE</option>
                      </select>
                    </InputCard>

                    <InputCard label="Maximum force (eV/A)">
                      <input
                        value={fmax}
                        onChange={(e) => setFmax(e.target.value)}
                        className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-2xl text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                      />
                    </InputCard>

                    <InputCard label="Steps">
                      <input
                        value={steps}
                        onChange={(e) => setSteps(e.target.value)}
                        className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-2xl text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                      />
                    </InputCard>
                  </div>

                  <div className="mt-8 flex flex-wrap items-center gap-4">
                    <button
                      onClick={handlePreview}
                      disabled={!file || previewLoading}
                      className="rounded-2xl border border-slate-200 bg-white px-7 py-4 text-lg font-medium text-slate-700 shadow-sm transition hover:border-violet-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {previewLoading ? "Previewing..." : "Preview structure"}
                    </button>

                    <button
                      onClick={handleRelax}
                      disabled={running || (!file && !preview?.cif)}
                      className="rounded-2xl bg-[linear-gradient(135deg,#0f172a_0%,#111827_100%)] px-7 py-4 text-lg font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.25)] transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {running ? "Running..." : "Run relaxation"}
                    </button>

                    {previewLoading && <Spinner label="Generating preview..." />}
                    {running && <Spinner label="Relaxation in progress..." />}
                  </div>
                </SectionCard>

                <SectionCard title="Structure Preview">
                  {!preview ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-12 text-center text-slate-500">
                      No preview yet.
                    </div>
                  ) : (
                    <>
                      <div className="mb-5 space-y-2">
                        <p className="text-base text-slate-700">
                          <span className="font-semibold text-slate-950">
                            File:
                          </span>{" "}
                          {preview.filename}
                        </p>
                        <p className="text-base text-slate-700">
                          <span className="font-semibold text-slate-950">
                            Atoms:
                          </span>{" "}
                          {preview.n_atoms}
                        </p>
                      </div>

                      <ViewerPanel
                        cifText={preview.cif}
                        emptyText="No preview yet."
                      />
                    </>
                  )}
                </SectionCard>
              </div>

              <div className="mt-8">
                <SectionCard title="Relaxation Output">
                  <div className="h-[36rem] overflow-auto rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] p-5 font-mono text-[13px] leading-7 text-slate-700 shadow-inner">
                    {logs.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>

                  {finalEnergy !== null && (
                    <p className="mt-6 text-lg text-slate-700">
                      Final energy:{" "}
                      <span className="font-semibold text-slate-950">
                        {finalEnergy.toFixed(6)} eV
                      </span>
                    </p>
                  )}

                  {resultId && (
                    <div className="mt-6 flex flex-wrap gap-3">
                      <a
                        href={`${API_BASE}/download-relaxed-cif/${resultId}`}
                        className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-base font-medium text-slate-700 shadow-sm transition hover:border-violet-300 hover:shadow-md"
                      >
                        Save relaxed CIF
                      </a>
                      <a
                        href={`${API_BASE}/download-relax-traj/${resultId}`}
                        className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-base font-medium text-slate-700 shadow-sm transition hover:border-violet-300 hover:shadow-md"
                      >
                        Save trajectory
                      </a>
                    </div>
                  )}
                </SectionCard>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
