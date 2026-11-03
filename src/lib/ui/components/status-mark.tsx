import type { AuditStatus } from "@/server/domain/lhr-view";

const WORD: Record<string, string> = { pass: "bueno", average: "mejorable", fail: "deficiente", error: "con error", informative: "informativo", notApplicable: "no aplica", manual: "revisión manual" };

/** Marca de estado de una auditoría: forma + palabra (para lectores de pantalla); el color solo refuerza. */
export function StatusMark({ status, className = "size-4" }: { status: AuditStatus | "pass" | "average" | "fail"; className?: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, className: `${className} shrink-0` };
  const tone = status === "pass" ? "text-ok" : status === "average" ? "text-warning" : status === "fail" || status === "error" ? "text-danger" : "text-ink-muted";
  return (
    <span className={`relative inline-flex ${tone}`} title={WORD[status]}>
      {status === "pass" ? (
        <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16 9.5" /></svg>
      ) : status === "average" ? (
        <svg {...common}><path d="M12 4 21 20H3L12 4Z" /><path d="M12 10v4M12 17.2v.1" /></svg>
      ) : status === "fail" || status === "error" ? (
        <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></svg>
      ) : (
        <svg {...common}><circle cx="12" cy="12" r="9" /></svg>
      )}
      <span className="sr-only">{WORD[status]}</span>
    </span>
  );
}
