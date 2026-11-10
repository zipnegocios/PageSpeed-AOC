"use client";

import { useState } from "react";
import { cx } from "@/lib/ui/cx";

type State = { kind: "idle" } | { kind: "busy" } | { kind: "error"; message: string };

/**
 * Botón de descarga de un PDF que tarda unos segundos en generarse. Descarga con `fetch` para poder decir «Preparando…»
 * mientras llega y avisar si falla; sin JavaScript (o si algo sale mal) sigue siendo un enlace normal a la misma dirección.
 */
export function DownloadButton({ href, label, className }: { href: string; label: string; className?: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (state.kind === "busy") return;
    setState({ kind: "busy" });
    try {
      const res = await fetch(href, { credentials: "same-origin" });
      if (!res.ok) throw new Error(await res.text().catch(() => ""));
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "informe.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState({ kind: "idle" });
    } catch (err) {
      const detail = err instanceof Error && err.message && err.message.length < 140 ? ` ${err.message}` : "";
      setState({ kind: "error", message: `No se pudo generar el informe.${detail} Inténtalo de nuevo en un momento.` });
    }
  }

  const busy = state.kind === "busy";
  return (
    <div className="flex flex-col gap-2">
      <a
        href={href}
        download
        onClick={onClick}
        aria-busy={busy}
        className={cx("press inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-5 text-[17px] font-semibold text-on-primary", busy && "opacity-70", className)}
      >
        {busy ? "Preparando… puede tardar unos segundos" : label}
      </a>
      {state.kind === "error" ? (
        <p role="alert" className="text-[14px] leading-5 text-danger">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
