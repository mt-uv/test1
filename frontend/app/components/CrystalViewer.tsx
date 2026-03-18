"use client";

import { useEffect, useRef } from "react";
import("3dmol");

type Props = {
  cifText?: string;
  className?: string;
};

export default function CrystalViewer({ cifText, className = "" }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);

  useEffect(() => {
    let mounted = true;

    async function renderViewer() {
      if (!containerRef.current || !cifText) return;

      const $3Dmol = await import("3dmol");
      if (!mounted || !containerRef.current) return;

      containerRef.current.innerHTML = "";

      const viewer = $3Dmol.createViewer(containerRef.current, {
        backgroundColor: "white",
        antialias: true,
      });

      viewerRef.current = viewer;

      try {
        // CIF examples in the docs use addModel(data) directly for CIF input.
        viewer.addModel(cifText);
        viewer.setStyle({}, {
          sphere: { scale: 0.28, colorscheme: "Jmol" },
          stick: { radius: 0.12, colorscheme: "Jmol" },
        });

        // Unit-cell visualization is supported with addUnitCell().
        viewer.addUnitCell();

        viewer.zoomTo();
        viewer.render();
      } catch (err) {
        console.error("Failed to render CIF in 3Dmol:", err);
      }
    }

    renderViewer();

    function handleResize() {
      if (viewerRef.current) {
        viewerRef.current.resize();
        viewerRef.current.render();
      }
    }

    window.addEventListener("resize", handleResize);
    return () => {
      mounted = false;
      window.removeEventListener("resize", handleResize);
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [cifText]);

  if (!cifText) {
    return (
      <div
        className={`flex h-[360px] items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50 text-slate-500 ${className}`}
      >
        No 3D preview yet.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`h-[360px] w-full overflow-hidden rounded-[24px] border border-slate-200 bg-white ${className}`}
    />
  );
}
