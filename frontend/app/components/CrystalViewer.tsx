"use client";

import { useEffect, useRef } from "react";

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

      const container = containerRef.current;
      container.innerHTML = "";

      const viewer = $3Dmol.createViewer(container, {
        backgroundColor: "white",
        antialias: true,
      });

      viewerRef.current = viewer;

      try {
        viewer.addModel(cifText, "cif");
        viewer.setStyle(
          {},
          {
            sphere: { scale: 0.28, colorscheme: "Jmol" },
            stick: { radius: 0.12, colorscheme: "Jmol" },
          }
        );
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
        viewerRef.current.zoomTo();
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
        className={`relative flex h-[360px] w-full items-center justify-center overflow-hidden rounded-[20px] border border-dashed border-slate-200 bg-slate-50 text-slate-500 ${className}`}
      >
        No 3D preview yet.
      </div>
    );
  }

  return (
    <div className={`relative h-[360px] w-full overflow-hidden rounded-[20px] bg-white ${className}`}>
      <div
        ref={containerRef}
        className="relative h-full w-full overflow-hidden rounded-[20px]"
        style={{ position: "relative" }}
      />
    </div>
  );
}
