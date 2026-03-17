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
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-7xl px-8 py-8 md:px-12 md:py-10">
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
          Na-ion Materials ML Platform
        </h1>
        <p className="mt-3 text-lg text-slate-500 md:text-xl">
          Uploaded-structure relaxation in one interface.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <button className="rounded-2xl border border-slate-300 px-5 py-3 text-base text-slate-500 md:px-6 md:text-lg">
            Cathode Explorer
          </button>
          <button className="rounded-2xl bg-violet-600 px-5 py-3 text-base font-medium text-white md:px-6 md:text-lg">
            Relax Structure
          </button>
          <button className="rounded-2xl border border-slate-300 px-5 py-3 text-base text-slate-500 md:px-6 md:text-lg">
            Run Generic MD
          </button>
        </div>

        <section className="mt-8 rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm md:p-10">
          <h2 className="text-3xl font-semibold md:text-4xl">Relax Structure</h2>
          <p className="mt-3 text-base text-slate-500 md:text-lg">
            Upload a structure, preview it, choose potential and optimizer, then
            stream the relaxation output live.
          </p>

          <div className="mt-8">
            <label className="inline-flex cursor-pointer items-center rounded-2xl border border-slate-300 px-5 py-3 text-base text-slate-700 hover:bg-slate-50 md:px-6 md:py-4 md:text-lg">
              Upload structure file
              <input
                type="file"
                accept=".cif,.vasp,.poscar"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>

            {file && (
              <p className="mt-3 text-sm text-slate-500 md:text-base">{file.name}</p>
            )}
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 p-5">
              <label className="mb-3 block text-sm text-slate-500 md:text-base">
                ML potential
              </label>
              <select
                value={potential}
                onChange={(e) => setPotential(e.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-lg outline-none"
              >
                <option value="uma">UMA</option>
                <option value="orb">ORB</option>
              </select>
            </div>

            <div className="rounded-3xl border border-slate-200 p-5">
              <label className="mb-3 block text-sm text-slate-500 md:text-base">
                Optimizer
              </label>
              <select
                value={optimizer}
                onChange={(e) => setOptimizer(e.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-lg outline-none"
              >
                <option value="LBFGS">LBFGS</option>
                <option value="BFGS">BFGS</option>
                <option value="FIRE">FIRE</option>
              </select>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 p-5">
              <label className="mb-3 block text-sm text-slate-500 md:text-base">
                Maximum force (eV/A)
              </label>
              <input
                value={fmax}
                onChange={(e) => setFmax(e.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-300 px-4 text-lg outline-none"
              />
            </div>

            <div className="rounded-3xl border border-slate-200 p-5">
              <label className="mb-3 block text-sm text-slate-500 md:text-base">
                Steps
              </label>
              <input
                value={steps}
                onChange={(e) => setSteps(e.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-300 px-4 text-lg outline-none"
              />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-4">
            <button
              onClick={handlePreview}
              className="rounded-2xl border border-slate-300 px-5 py-3 text-base text-slate-700 hover:bg-slate-50 md:px-6 md:py-4 md:text-lg"
            >
              Preview structure
            </button>

            <button
              onClick={handleRelax}
              disabled={running}
              className="rounded-2xl bg-slate-900 px-5 py-3 text-base font-medium text-white disabled:opacity-50 md:px-6 md:py-4 md:text-lg"
            >
              {running ? "Running..." : "Run relaxation"}
            </button>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="rounded-[24px] border border-slate-200">
              <div className="border-b border-slate-200 px-6 py-4">
                <h3 className="text-xl font-semibold md:text-2xl">Structure Preview</h3>
              </div>
              <div className="p-6">
                {!preview ? (
                  <p className="text-base text-slate-500">No preview yet.</p>
                ) : (
                  <>
                    <p className="text-sm text-slate-600 md:text-base">
                      <span className="font-medium text-slate-900">File:</span>{" "}
                      {preview.filename}
                    </p>
                    <p className="mt-2 text-sm text-slate-600 md:text-base">
                      <span className="font-medium text-slate-900">Atoms:</span>{" "}
                      {preview.n_atoms}
                    </p>
                    <textarea
                      readOnly
                      value={preview.cif}
                      className="mt-4 h-72 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-slate-700 outline-none md:h-80"
                    />
                  </>
                )}
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200">
              <div className="border-b border-slate-200 px-6 py-4">
                <h3 className="text-xl font-semibold md:text-2xl">Relaxation Output</h3>
              </div>
              <div className="p-6">
                <div className="h-72 overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-slate-700 md:h-80 md:text-sm">
                  {logs.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>

                {finalEnergy !== null && (
                  <p className="mt-4 text-base text-slate-700">
                    Final energy:{" "}
                    <span className="font-semibold">
                      {finalEnergy.toFixed(6)} eV
                    </span>
                  </p>
                )}

                {resultId && (
                  <div className="mt-4 flex gap-3">
                    <a
                      href={`${API_BASE}/download-relaxed-cif/${resultId}`}
                      className="rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 md:px-5 md:py-3 md:text-base"
                    >
                      Save relaxed CIF
                    </a>
                    <a
                      href={`${API_BASE}/download-relax-traj/${resultId}`}
                      className="rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 md:px-5 md:py-3 md:text-base"
                    >
                      Save trajectory
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}