"use client";

import { useState } from "react";
import { Alert } from "@/lib/ui/components/alert";
import { Button } from "@/lib/ui/components/button";
import { cx } from "@/lib/ui/cx";

type Check = { name: "postgres" | "redis" | "r2" | "smtp" | "worker"; ok: boolean; ms: number; error?: string };
type Report = { status: "ok" | "degraded"; checkedAt: string; checks: Check[]; invalidEnv?: string[] };

const LABELS: Record<Check["name"], string> = {
  postgres: "Base de datos (Postgres)",
  redis: "Cola (Redis)",
  r2: "Almacenamiento (Cloudflare R2)",
  smtp: "Correo (SMTP)",
  worker: "Worker de auditorías",
};

export function HealthPanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/health/details", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 401 ? "Tu sesión venció. Vuelve a entrar." : `Respuesta ${res.status}`);
      setReport((await res.json()) as Report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo comprobar el estado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[24px] leading-7 font-semibold text-ink">Estado del sistema</h2>
        <Button variant="secondary" onClick={run} disabled={loading}>
          {loading ? "Comprobando…" : report ? "Comprobar de nuevo" : "Comprobar ahora"}
        </Button>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {report?.invalidEnv?.length ? (
        <Alert tone="danger">Faltan o son inválidas estas variables de entorno: {report.invalidEnv.join(", ")}.</Alert>
      ) : null}
      {report ? (
        <ul className="divide-y divide-border rounded-sm border border-border">
          {report.checks.map((c) => (
            <li key={c.name} className="flex items-center justify-between gap-3 px-3 py-3">
              <span className="text-ink">{LABELS[c.name]}</span>
              <span className="flex items-center gap-3 text-[15px]">
                <span className="text-ink-muted">{c.ms} ms</span>
                <span
                  className={cx(
                    "rounded-sm px-2 py-1 font-semibold",
                    c.ok ? "bg-primary-subtle text-on-primary-subtle" : "bg-danger-subtle text-on-danger-subtle",
                  )}
                >
                  {c.ok ? "Correcto" : `Falla · ${c.error ?? "ERROR"}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-muted">Comprueba que Postgres, Redis, R2 y el correo responden desde el servidor.</p>
      )}
    </div>
  );
}
