import Link from "next/link";
import { PROFILE_LABEL, formatDate } from "@/lib/audit-format";
import { AgenticFraction } from "@/lib/ui/components/agentic-fraction";
import { Delta } from "@/lib/ui/components/delta";
import { ProfileTabs, type ProfileTab } from "@/lib/ui/components/profile-tabs";
import { Score } from "@/lib/ui/components/score";
import { ScoreRing } from "@/lib/ui/components/score-ring";
import type { LatestScores } from "@/server/services/history";

const RINGS = [
  ["performance", "Rendimiento"],
  ["seo", "SEO"],
  ["accessibility", "Accesibilidad"],
  ["best_practices", "Buenas prácticas"],
] as const;

export type PortalPage = { routeId: string; path: string; mobile: LatestScores | null; desktop: LatestScores | null };

/** Agrupa lo último de cada ruta y dispositivo en una entrada por página (la de inicio primero, luego por ruta). */
export function groupLatestByPage(latest: LatestScores[]): PortalPage[] {
  const map = new Map<string, PortalPage>();
  for (const l of latest) {
    const e = map.get(l.routeId) ?? { routeId: l.routeId, path: l.path, mobile: null, desktop: null };
    e[l.profile] = l;
    map.set(l.routeId, e);
  }
  return [...map.values()].sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : a.path.localeCompare(b.path)));
}

/** La pestaña inicial: el dispositivo con la auditoría más reciente (a igualdad, móvil). */
export const portalDefaultProfile = (p: PortalPage): "mobile" | "desktop" =>
  p.desktop && (!p.mobile || p.desktop.finishedAt > p.mobile.finishedAt) ? "desktop" : "mobile";

/** Una página del sitio del cliente con sus dos dispositivos en pestañas. */
export function PortalPageCard({ page, detailBase }: { page: PortalPage; detailBase: string }) {
  const tabs: ProfileTab[] = (["mobile", "desktop"] as const).map((profile) => {
    const l = page[profile];
    return {
      profile,
      label: PROFILE_LABEL[profile],
      badge: l?.scores.performance !== null && l ? <Score value={l.scores.performance} className="text-[17px]" /> : undefined,
      content: l ? (
        <div className="flex flex-col gap-4">
          <span className="text-[15px] text-ink-muted">Última auditoría: {formatDate(l.finishedAt)}</span>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {RINGS.map(([key, label]) => (
              <div key={key} className="flex flex-col items-start gap-1">
                <dd className="order-1">
                  <ScoreRing value={l.scores[key]} label={label} size={76} />
                </dd>
                <dt className="order-2 text-[13px] leading-4 font-semibold tracking-[0.08em] text-ink-muted uppercase">{label}</dt>
                <dd className="order-3">
                  <Delta change={l.changes[key]} />
                </dd>
              </div>
            ))}
            <div className="flex flex-col items-start gap-1">
              <dd className="order-1 flex min-h-[76px] items-center">
                <AgenticFraction value={l.agentic} className="text-[28px] leading-8" />
              </dd>
              <dt className="order-2 text-[13px] leading-4 font-semibold tracking-[0.08em] text-ink-muted uppercase">Navegación con agentes</dt>
            </div>
          </dl>
          <div>
            <Link href={`${detailBase}/detalle/${l.auditId}`} className="inline-flex min-h-11 items-center font-semibold text-link hover:underline">
              Ver detalle técnico
            </Link>
          </div>
        </div>
      ) : (
        <p className="text-ink-muted">Todavía no hay datos de {PROFILE_LABEL[profile].toLowerCase()} para esta página.</p>
      ),
    };
  });
  return (
    <section aria-label={`Página ${page.path}`} className="glass-flat flex min-w-0 flex-col gap-4 rounded-lg p-4">
      <h3 className="font-mono text-[18px] leading-6 font-semibold break-all text-ink">{page.path}</h3>
      <ProfileTabs label={`Dispositivo de ${page.path}`} defaultProfile={portalDefaultProfile(page)} tabs={tabs} />
    </section>
  );
}
