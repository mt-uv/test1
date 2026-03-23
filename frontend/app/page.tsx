"use client";

import { useEffect, useRef, useState } from "react";
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

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function IconSpark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
      <path
        d="M12 2L14.3 9.7L22 12L14.3 14.3L12 22L9.7 14.3L2 12L9.7 9.7L12 2Z"
        className="fill-current"
      />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path
        d="M12 16V4M12 4L7.5 8.5M12 4L16.5 8.5M5 19H19"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconStructure() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <circle cx="6" cy="12" r="2.3" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="7" r="2.3" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="17" r="2.3" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M8 11L16 8M8 13L16 16"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none">
      <path d="M8 6.5V17.5L17 12L8 6.5Z" className="fill-current" />
    </svg>
  );
}

function IconStop() {
  return (
    <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none">
      <rect x="7" y="7" width="10" height="10" rx="2" className="fill-current" />
    </svg>
  );
}

function IconPulse() {
  return (
    <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none">
      <path
        d="M3 12H7L9.3 7L13.2 17L15.6 12H21"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconRelax() {
  return (
    <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none">
      <path
        d="M7 17C10 17 12 14.5 12 12C12 9.5 14 7 17 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M14.5 5H17.5V8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconExplorer() {
  return (
    <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none">
      <path
        d="M14.5 9.5L9.5 14.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M10.6 8.3C12.8 6.1 16.4 6.1 18.6 8.3C20.8 10.5 20.8 14.1 18.6 16.3C16.4 18.5 12.8 18.5 10.6 16.3C8.4 14.1 8.4 10.5 10.6 8.3Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M6 18L8.5 15.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-violet-200/80 bg-violet-50/90 px-3.5 py-2 text-xs font-semibold text-violet-700 shadow-sm backdrop-blur">
      <span className="relative flex h-3.5 w-3.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-40" />
        <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-violet-500" />
      </span>
      {label}
    </div>
  );
}

function StatusBadge({
  tone = "default",
  children,
  live = false,
}: {
  tone?: "default" | "violet" | "emerald" | "rose" | "slate";
  children: React.ReactNode;
  live?: boolean;
}) {
  const styles = {
    default: "border-slate-200 bg-white text-slate-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    slate: "border-slate-200 bg-slate-100 text-slate-700",
  };

  const dot = {
    default: "bg-slate-400",
    violet: "bg-violet-500",
    emerald: "bg-emerald-500",
    rose: "bg-rose-500",
    slate: "bg-slate-500",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm",
        styles[tone]
      )}
    >
      <span
        className={cn(
          "h-2.5 w-2.5 rounded-full",
          dot[tone],
          live && "animate-pulse"
        )}
      />
      {children}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group inline-flex items-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-semibold transition-all duration-200 md:text-base",
        active
          ? "bg-[linear-gradient(135deg,#7c3aed_0%,#8b5cf6_45%,#6366f1_100%)] text-white shadow-[0_14px_36px_rgba(124,58,237,0.30)]"
          : "border border-slate-200/80 bg-white/75 text-slate-600 shadow-sm backdrop-blur hover:-translate-y-[1px] hover:border-slate-300 hover:bg-white"
      )}
    >
      <span className={cn(active ? "text-white" : "text-slate-500")}>{icon}</span>
      {children}
    </button>
  );
}

function InputCard({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[22px] border border-slate-200/80 bg-white/90 p-4 shadow-sm transition hover:shadow-md">
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          {label}
        </label>
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
  rightSlot,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[30px] border border-white/70 bg-white/80 shadow-[0_12px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl",
        className
      )}
    >
      <div className="border-b border-slate-200/70 px-6 py-5 md:px-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-slate-950 md:text-3xl">
              {title}
            </h3>
            {subtitle && (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">
                {subtitle}
              </p>
            )}
          </div>
          {rightSlot && <div className="shrink-0">{rightSlot}</div>}
        </div>
      </div>
      <div className="p-6 md:p-7">{children}</div>
    </div>
  );
}

function EmptyState({
  title,
  text,
  icon,
}: {
  title: string;
  text: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-[26px] border border-dashed border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#f8fafc_100%)] px-6 py-14 text-center shadow-inner">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-violet-600 shadow-sm">
        {icon || <IconStructure />}
      </div>
      <h4 className="mt-4 text-lg font-semibold text-slate-900">{title}</h4>
      <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-slate-500">
        {text}
      </p>
    </div>
  );
}

function UploadCard({
  title,
  subtitle,
  onFile,
  accept,
  buttonLabel,
}: {
  title: string;
  subtitle: string;
  onFile: (f: File | null) => void;
  accept: string;
  buttonLabel: string;
}) {
  return (
    <label className="group flex cursor-pointer flex-col rounded-[24px] border border-dashed border-slate-300 bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.95)_100%)] p-5 shadow-sm transition hover:-translate-y-[1px] hover:border-violet-300 hover:shadow-md">
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] || null)}
      />
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-700 transition group-hover:bg-violet-100">
          <IconUpload />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-slate-900">{title}</div>
          <div className="mt-1 text-sm leading-6 text-slate-500">{subtitle}</div>
          <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition group-hover:translate-y-[-1px]">
            <IconUpload />
            {buttonLabel}
          </div>
        </div>
      </div>
    </label>
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
      <EmptyState
        title="No structure to display"
        text={emptyText}
        icon={<IconStructure />}
      />
    );
  }

  return (
    <>
      <div className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-white p-3 shadow-sm">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top,rgba(124,58,237,0.12),transparent_55%)]" />
        <div className="min-h-[520px] rounded-[20px] bg-white">
          <CrystalViewer cifText={cifText} />
        </div>
      </div>

      <details className="mt-5 overflow-hidden rounded-[22px] border border-slate-200 bg-slate-50/90">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-slate-700 transition hover:bg-white">
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

function LiveLog({
  logs,
  title = "Live Output",
}: {
  logs: string[];
  title?: string;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [logs]);

  return (
    <div className="overflow-hidden rounded-[26px] border border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] shadow-inner">
      <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
        <div className="text-sm font-semibold text-slate-800">{title}</div>
        <StatusBadge tone="slate">Streaming console</StatusBadge>
      </div>
      <div className="h-[36rem] overflow-auto p-5 font-mono text-[13px] leading-7 text-slate-700">
        {logs.map((line, i) => (
          <div key={i} className="break-words">
            {line}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
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
  const height = 500;
  const padL = 58;
  const padR = 20;
  const padT = 22;
  const padB = 48;

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
    <div className="overflow-hidden rounded-[26px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fafaff_100%)] shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 px-5 py-4">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            Species-resolved MSD vs time
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Streaming mean-squared displacement during NVT MD
          </div>
        </div>
        <StatusBadge tone={live ? "violet" : "emerald"} live={live}>
          {live ? "Streaming live" : "Run complete"}
        </StatusBadge>
      </div>

      <div className="p-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
            <defs>
              <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(139,92,246,0.12)" />
                <stop offset="100%" stopColor="rgba(139,92,246,0)" />
              </linearGradient>
            </defs>

            <rect
              x={padL}
              y={padT}
              width={width - padL - padR}
              height={height - padT - padB}
              fill="url(#chartGlow)"
              rx="16"
            />

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
                    y={height - padB + 20}
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
                      <path
                        d={path}
                        fill="none"
                        stroke={color}
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <circle
                        cx={lastX}
                        cy={lastY}
                        r={live ? 5.5 : 4.5}
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
              y={height - 10}
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
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-600">
          {species.map((sp, idx) => {
            const color = palette[idx % palette.length];
            return (
              <div
                key={sp}
                className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-sm"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="font-medium">{sp}</span>
              </div>
            );
          })}
          {species.length === 0 && (
            <div className="text-sm text-slate-500">No MSD stream yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function MolecularDynamicsPanel() {
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

  function handleUseExampleMD() {
    setFile(null);
    setPreviewCif(EXAMPLE_CIF);
    setPreviewAtomCount(48);
    setFinalCif("");
    setResultId(null);
    setTimePs([]);
    setMsdBySpecies({});
    setStage("Loaded example structure.");
  }

  async function runMD() {
    if (!file && !previewCif) {
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

      if (file) {
        form.append("file", file);
      } else {
        const blob = new Blob([previewCif], { type: "text/plain" });
        form.append("file", blob, "example.cif");
      }

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
    <section className="relative overflow-hidden rounded-[36px] border border-white/70 bg-white/75 p-6 shadow-[0_20px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl md:p-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(124,58,237,0.10),_transparent_22%),radial-gradient(circle_at_bottom_left,_rgba(59,130,246,0.08),_transparent_22%)]" />

      <div className="relative">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-200/70 bg-violet-50/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 shadow-sm">
              <IconPulse />
              Molecular Dynamics
            </div>

            <h2 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
              Run Molecular Dynamics
            </h2>

            <p className="mt-4 max-w-4xl text-lg leading-8 text-slate-600 md:text-xl">
              Upload any structure, choose the ML potential, run NVT Langevin MD,
              and watch species-resolved MSD stream live as the simulation evolves.
            </p>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-8 xl:grid-cols-[540px_minmax(0,1fr)]">
          <SectionCard
            title="Simulation Setup"
            subtitle="Prepare a structure, choose MD settings, and launch a live run."
            rightSlot={
              <StatusBadge tone={loading ? "violet" : "slate"} live={loading}>
                {loading ? "MD active" : "Idle"}
              </StatusBadge>
            }
          >
            <div className="grid grid-cols-1 gap-4">
              <UploadCard
                title="Upload a structure file"
                subtitle="Supports .cif, .vasp, .poscar, .xyz, and .traj for molecular dynamics."
                onFile={handleFileChange}
                accept=".cif,.vasp,.poscar,.xyz,.traj"
                buttonLabel="Choose file"
              />

              <button
                onClick={handleUseExampleMD}
                className="flex items-center justify-between rounded-[24px] border border-violet-200 bg-[linear-gradient(180deg,#faf5ff_0%,#f5f3ff_100%)] p-5 text-left shadow-sm transition hover:-translate-y-[1px] hover:bg-violet-50 hover:shadow-md"
              >
                <div>
                  <div className="text-base font-semibold text-violet-900">
                    Use example structure
                  </div>
                  <div className="mt-1 text-sm leading-6 text-violet-700/80">
                    Load a ready-to-run demo crystal to test the MD flow.
                  </div>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-violet-700 shadow-sm">
                  <IconSpark />
                </div>
              </button>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {file && (
                <StatusBadge tone="emerald">
                  File loaded: {file.name}
                </StatusBadge>
              )}

              {!file && previewCif === EXAMPLE_CIF && (
                <StatusBadge tone="violet">Example structure loaded</StatusBadge>
              )}

              {previewAtomCount != null && (
                <StatusBadge tone="violet">{previewAtomCount} atoms</StatusBadge>
              )}
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <InputCard label="ML potential">
                <select
                  value={potential}
                  onChange={(e) =>
                    setPotential(e.target.value as PotentialOption)
                  }
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                >
                  <option value="uma">UMA</option>
                  <option value="orb">ORB</option>
                </select>
              </InputCard>

              <InputCard label="Temperature" hint="Kelvin">
                <input
                  type="number"
                  value={temperatureK}
                  onChange={(e) => setTemperatureK(e.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                />
              </InputCard>

              <InputCard label="Timestep" hint="fs">
                <input
                  type="number"
                  step="0.1"
                  value={timestepFs}
                  onChange={(e) => setTimestepFs(e.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                />
              </InputCard>

              <InputCard label="Total time" hint="ps">
                <input
                  type="number"
                  step="0.1"
                  value={totalTimePs}
                  onChange={(e) => setTotalTimePs(e.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                />
              </InputCard>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button
                onClick={runMD}
                disabled={(!file && !previewCif) || loading}
                className="inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#0f172a_0%,#111827_100%)] px-5 py-3 text-base font-semibold text-white shadow-[0_14px_34px_rgba(15,23,42,0.25)] transition hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <IconPlay />
                {loading ? "Running MD..." : "Run molecular dynamics"}
              </button>

              <button
                onClick={stopMD}
                disabled={!loading || !sessionId}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-5 py-3 text-base font-semibold text-rose-700 shadow-sm transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <IconStop />
                Stop MD
              </button>

              {loading && <Spinner label="MD in progress..." />}
            </div>

            <div className="mt-6 overflow-hidden rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#fcfcff_0%,#f5f7fb_100%)] shadow-inner">
              <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">
                  Run status
                </div>
                <StatusBadge tone={loading ? "violet" : "slate"} live={loading}>
                  {loading ? "Streaming events" : "Waiting"}
                </StatusBadge>
              </div>
              <div className="px-4 py-4 text-sm leading-7 text-slate-700">
                {stage}
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Structure Preview"
            subtitle="Inspect the input or final structure directly in the viewer."
            rightSlot={
              shownCif ? (
                <StatusBadge tone="emerald">
                  {finalCif ? "Final structure" : "Initial structure"}
                </StatusBadge>
              ) : undefined
            }
          >
            <ViewerPanel
              cifText={shownCif}
              emptyText="Upload or load a structure to see it here."
            />
          </SectionCard>
        </div>

        <div className="mt-8">
          <SectionCard
            title="Live MSD Output"
            subtitle="Track species-wise displacement over time while the simulation runs."
          >
            <AllAtomMSDChart
              timePs={timePs}
              msdBySpecies={msdBySpecies}
              live={loading}
            />

            {resultId && (
              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  href={`${API_BASE}/download-upload-md-cif/${resultId}`}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-base font-semibold text-slate-700 shadow-sm transition hover:-translate-y-[1px] hover:border-violet-300 hover:shadow-md"
                >
                  Download final CIF
                </a>

                <a
                  href={`${API_BASE}/download-upload-md-traj/${resultId}`}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-base font-semibold text-slate-700 shadow-sm transition hover:-translate-y-[1px] hover:border-violet-300 hover:shadow-md"
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
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_48%,#f8fafc_100%)] text-slate-900">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-120px] top-[-80px] h-[360px] w-[360px] rounded-full bg-violet-300/20 blur-3xl" />
        <div className="absolute right-[-80px] top-[120px] h-[300px] w-[300px] rounded-full bg-sky-300/20 blur-3xl" />
        <div className="absolute bottom-[-120px] left-[20%] h-[320px] w-[320px] rounded-full bg-fuchsia-200/20 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 py-8 md:px-10 md:py-12">
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/75 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm backdrop-blur">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-violet-700">
              <IconSpark />
            </span>
            Materials ML Studio
          </div>

          <div className="mt-6">
            <h1 className="max-w-5xl text-5xl font-semibold tracking-tight text-slate-950 md:text-6xl">
              CrystallAIne
            </h1>

            <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600 md:text-2xl md:leading-9">
              Molecular Simulations with Machine Learning Potentials
            </p>
          </div>
        </div>

        <div className="mb-8 flex flex-wrap gap-3">
          <TabButton
            active={activeTab === "explorer"}
            onClick={() => setActiveTab("explorer")}
            icon={<IconExplorer />}
          >
            Cathode Explorer
          </TabButton>

          <TabButton
            active={activeTab === "relax"}
            onClick={() => setActiveTab("relax")}
            icon={<IconRelax />}
          >
            Relax Structure
          </TabButton>

          <TabButton
            active={activeTab === "md"}
            onClick={() => setActiveTab("md")}
            icon={<IconPulse />}
          >
            Run Molecular Dynamics
          </TabButton>
        </div>

        {activeTab === "explorer" && (
          <section className="relative overflow-hidden rounded-[36px] border border-white/70 bg-white/75 p-8 shadow-[0_20px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl md:p-10">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(124,58,237,0.10),_transparent_22%),radial-gradient(circle_at_bottom_left,_rgba(59,130,246,0.08),_transparent_22%)]" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 shadow-sm">
                <IconExplorer />
                Explorer
              </div>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
                Cathode Explorer
              </h2>
              <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600 md:text-xl">
                This area is ready for a richer explorer experience — filters,
                composition search, phase metadata, and structure cards would fit
                beautifully here.
              </p>

              <div className="mt-8">
                <EmptyState
                  title="Explorer UI placeholder"
                  text="You can turn this into a searchable materials gallery with crystal previews, chemistry filters, and quick property stats."
                  icon={<IconExplorer />}
                />
              </div>
            </div>
          </section>
        )}

        {activeTab === "md" && <MolecularDynamicsPanel />}

        {activeTab === "relax" && (
          <section className="relative overflow-hidden rounded-[36px] border border-white/70 bg-white/75 p-6 shadow-[0_20px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl md:p-10">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(124,58,237,0.10),_transparent_22%),radial-gradient(circle_at_bottom_left,_rgba(59,130,246,0.08),_transparent_22%)]" />

            <div className="relative">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-violet-200/70 bg-violet-50/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 shadow-sm">
                    <IconRelax />
                    Structure Optimization
                  </div>

                  <h2 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
                    Relax Structure
                  </h2>

                  <p className="mt-4 max-w-4xl text-lg leading-8 text-slate-600 md:text-xl">
                    Upload a structure, preview it, choose the potential and
                    optimizer, then stream the relaxation output in real time.
                  </p>
                </div>
              </div>

              <div className="mt-10 grid grid-cols-1 gap-8 xl:grid-cols-[540px_minmax(0,1fr)]">
                <SectionCard
                  title="Relaxation Setup"
                  subtitle="Load a structure, configure the optimizer, and launch a streamed relaxation run."
                  rightSlot={
                    <StatusBadge tone={running ? "violet" : "slate"} live={running}>
                      {running ? "Relaxation active" : "Idle"}
                    </StatusBadge>
                  }
                >
                  <div className="grid grid-cols-1 gap-4">
                    <UploadCard
                      title="Upload a structure file"
                      subtitle="Supports .cif, .vasp, and .poscar for relaxation."
                      onFile={setFile}
                      accept=".cif,.vasp,.poscar"
                      buttonLabel="Choose file"
                    />

                    <button
                      onClick={handleUseExample}
                      className="flex items-center justify-between rounded-[24px] border border-violet-200 bg-[linear-gradient(180deg,#faf5ff_0%,#f5f3ff_100%)] p-5 text-left shadow-sm transition hover:-translate-y-[1px] hover:bg-violet-50 hover:shadow-md"
                    >
                      <div>
                        <div className="text-base font-semibold text-violet-900">
                          Use example structure
                        </div>
                        <div className="mt-1 text-sm leading-6 text-violet-700/80">
                          Load a prefilled CIF and jump directly into testing.
                        </div>
                      </div>
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-violet-700 shadow-sm">
                        <IconSpark />
                      </div>
                    </button>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    {file && (
                      <StatusBadge tone="emerald">
                        Selected file: {file.name}
                      </StatusBadge>
                    )}

                    {!file && preview?.filename === "example.cif" && (
                      <StatusBadge tone="violet">
                        Example structure loaded
                      </StatusBadge>
                    )}

                    {preview?.n_atoms != null && (
                      <StatusBadge tone="violet">
                        {preview.n_atoms} atoms
                      </StatusBadge>
                    )}
                  </div>

                  <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <InputCard label="ML potential">
                      <select
                        value={potential}
                        onChange={(e) => setPotential(e.target.value)}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                      >
                        <option value="uma">UMA</option>
                        <option value="orb">ORB</option>
                      </select>
                    </InputCard>

                    <InputCard label="Optimizer">
                      <select
                        value={optimizer}
                        onChange={(e) => setOptimizer(e.target.value)}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                      >
                        <option value="LBFGS">LBFGS</option>
                        <option value="BFGS">BFGS</option>
                        <option value="FIRE">FIRE</option>
                      </select>
                    </InputCard>

                    <InputCard label="Maximum force" hint="eV/A">
                      <input
                        value={fmax}
                        onChange={(e) => setFmax(e.target.value)}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                      />
                    </InputCard>

                    <InputCard label="Steps">
                      <input
                        value={steps}
                        onChange={(e) => setSteps(e.target.value)}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
                      />
                    </InputCard>
                  </div>

                  <div className="mt-7 flex flex-wrap items-center gap-3">
                    <button
                      onClick={handlePreview}
                      disabled={!file || previewLoading}
                      className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-base font-semibold text-slate-700 shadow-sm transition hover:-translate-y-[1px] hover:border-violet-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {previewLoading ? "Previewing..." : "Preview structure"}
                    </button>

                    <button
                      onClick={handleRelax}
                      disabled={running || (!file && !preview?.cif)}
                      className="inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#0f172a_0%,#111827_100%)] px-5 py-3 text-base font-semibold text-white shadow-[0_14px_34px_rgba(15,23,42,0.25)] transition hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <IconPlay />
                      {running ? "Running..." : "Run relaxation"}
                    </button>

                    {previewLoading && <Spinner label="Generating preview..." />}
                    {running && <Spinner label="Relaxation in progress..." />}
                  </div>
                </SectionCard>

                <SectionCard
                  title="Structure Preview"
                  subtitle="Inspect the current structure before or after relaxation."
                  rightSlot={
                    preview ? (
                      <StatusBadge tone="emerald">
                        {preview.filename}
                      </StatusBadge>
                    ) : undefined
                  }
                >
                  {!preview ? (
                    <EmptyState
                      title="No preview yet"
                      text="Upload a structure or use the example to visualize it here."
                      icon={<IconStructure />}
                    />
                  ) : (
                    <>
                      <div className="mb-5 flex flex-wrap gap-2">
                        <StatusBadge tone="slate">
                          File: {preview.filename}
                        </StatusBadge>
                        <StatusBadge tone="violet">
                          Atoms: {preview.n_atoms}
                        </StatusBadge>
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
                <SectionCard
                  title="Relaxation Output"
                  subtitle="Live optimization logs and downloadable results."
                >
                  <LiveLog logs={logs} title="Relaxation stream" />

                  {finalEnergy !== null && (
                    <div className="mt-6">
                      <StatusBadge tone="emerald">
                        Final energy: {finalEnergy.toFixed(6)} eV
                      </StatusBadge>
                    </div>
                  )}

                  {resultId && (
                    <div className="mt-6 flex flex-wrap gap-3">
                      <a
                        href={`${API_BASE}/download-relaxed-cif/${resultId}`}
                        className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-base font-semibold text-slate-700 shadow-sm transition hover:-translate-y-[1px] hover:border-violet-300 hover:shadow-md"
                      >
                        Save relaxed CIF
                      </a>
                      <a
                        href={`${API_BASE}/download-relax-traj/${resultId}`}
                        className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-base font-semibold text-slate-700 shadow-sm transition hover:-translate-y-[1px] hover:border-violet-300 hover:shadow-md"
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
