import { PROFILE_LABEL } from "@/lib/audit-format";
import type { SiblingAudits } from "@/server/services/audits";
import { SegmentedNav } from "./segmented-nav";

/**
 * En la pantalla de una auditoría: pasar al otro dispositivo de la MISMA página ("Móvil 86 | Escritorio 92"). El actual
 * marca aria-current; el otro enlaza a la última auditoría correcta de ese dispositivo; si no existe queda atenuado.
 */
export function ProfileSwitch({
  current,
  currentScore,
  siblings,
  hrefFor,
  currentHref,
}: {
  current: "mobile" | "desktop";
  /** Rendimiento de la auditoría que se está viendo. */
  currentScore: number | null;
  siblings: SiblingAudits;
  /** Dirección de la auditoría `id` (conserva la pestaña del visor, etc.). */
  hrefFor: (auditId: string) => string;
  currentHref: string;
}) {
  const items = (["mobile", "desktop"] as const).map((profile) => {
    const base = PROFILE_LABEL[profile];
    if (profile === current) return { label: currentScore === null ? base : `${base} ${currentScore}`, href: currentHref, current: true, scroll: true };
    const other = siblings[profile];
    if (!other) return { label: `${base} · sin auditoría`, href: "#", current: false, disabled: true };
    return { label: other.scorePerformance === null ? base : `${base} ${other.scorePerformance}`, href: hrefFor(other.id), current: false, scroll: true };
  });
  return <SegmentedNav label="Dispositivo de esta página" items={items} />;
}
