"use client";

import { useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_RAILWAY_API_URL || "http://localhost:8000";

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [potential, setPotential] = useState("uma");
  const [optimizer, setOptimizer] = useState("LBFGS");
  const [fmax, setFmax] = useState("0.05");
  const [steps, setSteps] = useState("300");

  const [preview, setPreview] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>(["No output yet."]);
  const [running, setRunning] = useState(false);
  const [resultId, setResultId] = useState<string | null>(null);
  const [finalEnergy, setFinalEnergy] = useState<number | null>(null);

  async function handlePreview() {
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`${API_BASE}/preview-structure`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    setPreview(data);
  }

  async function handleRelax() {
    if (!file) return;

    setRunning(true);
    setLogs(["Starting relaxation..."]);
    setResultId(null);
    setFinalEnergy(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("potential", potential);
    formData.append("optimizer", optimizer);
    formData.append("fmax", fmax);
    formData.append("steps", steps);

    const sessionRes = await fetch(`${API_BASE}/relax-upload-session`, {
      method: "POST",
      body: formData,
    });

    const { session_id } = await sessionRes.json();

    const es = new EventSource(`${API_BASE}/relax-upload-stream/${session_id}`);

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

    es.onerror = () => {
      setLogs((prev) => [...prev, "Stream error"]);
      setRunning(false);
      es.close();
    };
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(124,58,237,0.10),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.10),_transparent_24%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] text-slate-900">
      <div className="mx-auto max-w-7xl px-6 py-8 md:px-10 md:py-12">
        {/* Top bar */}
        <div className="mb-10 flex items-center justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500 shadow-sm backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-violet-500 shadow-[0_0_12px_rgba(139,92,246,0.9)]" />
              Materials ML
            </div>
            <h1 className="mt-5 max-w-4xl text-5xl font-semibold tracking-tight text-slate-950 md:text-6xl">
              Na-ion Materials ML Platform
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600 md:text-2xl md:leading-9">
              Uploaded-structure relaxation in one interface.
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-8 flex flex-wrap gap-3">
          <button className="rounded-2xl border border-slate-200 bg-white/70 px-6 py-3 text-base font-medium text-slate-500 shadow-sm backdrop-blur transition hover:border-slate-300 hover:bg-white md:text-lg">
            Cathode Explorer
          </button>
          <button className="rounded-2xl bg-[linear-gradient(135deg,#7c3aed_0%,#8b5cf6_45%,#6366f1_100%)] px-6 py-3 text-base font-semibold text-white shadow-[0_12px_30px_rgba(124,58,237,0.28)] transition hover:scale-[1.01] md:text-lg">
            Relax Structure
          </button>
          <button className="rounded-2xl border border-slate-200 bg-white/70 px-6 py-3 text-base font-medium text-slate-500 shadow-sm backdrop-blur transition hover:border-slate-300 hover:bg-white md:text-lg">
            Run Generic MD
          </button>
        </div>

        {/* Main Card */}
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

            {/* Upload */}
            <div className="mt-10">
              <label className="inline-flex cursor-pointer items-center rounded-2xl border border-slate-200 bg-white px-7 py-4 text-lg font-medium text-slate-700 shadow-sm transition hover:border-violet-300 hover:shadow-md">
                Upload structure file
                <input
                  type="file"
                  accept=".cif,.vasp,.poscar"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </label>

              {file && (
                <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  {file.name}
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="mt-10 grid grid-cols-1 gap-5 xl:grid-cols-2">
              <div className="rounded-[28px] border border-slate-200/80 bg-white/80 p-6 shadow-sm">
                <label className="mb-4 block text-base font-medium text-slate-500">
                  ML potential
                </label>
                <select
                  value={potential}
                  onChange={(e) => setPotential(e.target.value)}
                  className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-xl text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                >
                  <option value="uma">UMA</option>
                  <option value="orb">ORB</option>
                </select>
              </div>

              <div className="rounded-[28px] border border-slate-200/80 bg-white/80 p-6 shadow-sm">
                <label className="mb-4 block text-base font-medium text-slate-500">
                  Optimizer
                </label>
                <select
                  value={optimizer}
                  onChange={(e) => setOptimizer(e.target.value)}
                  className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-xl text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                >
                  <option value="LBFGS">LBFGS</option>
                  <option value="BFGS">BFGS</option>
                  <option value="FIRE">FIRE</option>
                </select>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
              <div className="rounded-[28px] border border-slate-200/80 bg-white/80 p-6 shadow-sm">
                <label className="mb-4 block text-base font-medium text-slate-500">
                  Maximum force (eV/A)
                </label>
                <input
                  value={fmax}
                  onChange={(e) => setFmax(e.target.value)}
                  className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-2xl text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                />
              </div>

              <div className="rounded-[28px] border border-slate-200/80 bg-white/80 p-6 shadow-sm">
                <label className="mb-4 block text-base font-medium text-slate-500">
                  Steps
                </label>
                <input
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                  className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-2xl text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                />
              </div>
            </div>

            {/* Buttons */}
            <div className="mt-8 flex flex-wrap gap-4">
              <button
                onClick={handlePreview}
                className="rounded-2xl border border-slate-200 bg-white px-7 py-4 text-lg font-medium text-slate-700 shadow-sm transition hover:border-violet-300 hover:shadow-md"
              >
                Preview structure
              </button>

              <button
                onClick={handleRelax}
                disabled={running}
                className="rounded-2xl bg-[linear-gradient(135deg,#0f172a_0%,#111827_100%)] px-7 py-4 text-lg font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.25)] transition hover:translate-y-[-1px] disabled:opacity-50"
              >
                {running ? "Running..." : "Run relaxation"}
              </button>
            </div>

            {/* Panels */}
            <div className="mt-10 grid grid-cols-1 gap-6 2xl:grid-cols-2">
              {/* Preview panel */}
              <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/85 shadow-sm">
                <div className="border-b border-slate-200/80 px-7 py-5">
                  <h3 className="text-2xl font-semibold tracking-tight text-slate-950 md:text-3xl">
                    Structure Preview
                  </h3>
                </div>

                <div className="p-7">
                  {!preview ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-10 text-center text-slate-500">
                      No preview yet.
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <p className="text-base text-slate-700">
                          <span className="font-semibold text-slate-950">File:</span>{" "}
                          {preview.filename}
                        </p>
                        <p className="text-base text-slate-700">
                          <span className="font-semibold text-slate-950">Atoms:</span>{" "}
                          {preview.n_atoms}
                        </p>
                      </div>

                      <textarea
                        readOnly
                        value={preview.cif}
                        className="mt-5 h-80 w-full rounded-[24px] border border-slate-200 bg-slate-50 p-5 font-mono text-[13px] leading-6 text-slate-700 outline-none"
                      />
                    </>
                  )}
                </div>
              </div>

              {/* Output panel */}
              <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/85 shadow-sm">
                <div className="border-b border-slate-200/80 px-7 py-5">
                  <h3 className="text-2xl font-semibold tracking-tight text-slate-950 md:text-3xl">
                    Relaxation Output
                  </h3>
                </div>

                <div className="p-7">
                  <div className="h-80 overflow-auto rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] p-5 font-mono text-[13px] leading-7 text-slate-700 shadow-inner">
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
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
