import { LanguageSwitch } from "@/lib/ui/components/language-switch";
import { ReportFrame } from "@/lib/ui/components/report-frame";
import { SegmentedNav } from "@/lib/ui/components/segmented-nav";
import { buildCategoryView, buildEvidence, buildSummary, scriptItems, type Lhr } from "@/server/domain/lhr-view";
import type { ReactNode } from "react";
import { Card } from "@/lib/ui/components/card";
import type { DetailsContext } from "./details-block";
import { CategoryPanel, EvidencePanel, SummaryPanel } from "./panels";

export type ViewerSearch = { vista?: string; m?: string; audit?: string; expandir?: string };

const CATEGORY_TABS = [
  { id: "rendimiento", cat: "performance", label: "Rendimiento" },
  { id: "accesibilidad", cat: "accessibility", label: "Accesibilidad" },
  { id: "buenas-practicas", cat: "best-practices", label: "Buenas prácticas" },
  { id: "seo", cat: "seo", label: "SEO" },
  { id: "agentes", cat: "agentic-browsing", label: "Navegación con agentes" },
] as const;

/**
 * Visor completo de una auditoría: pestañas (resumen, una por categoría, evidencias y el informe oficial) con todo
 * lo que muestra PageSpeed Insights. Recibe el resultado ya traducido y, si hace falta, ya redactado para el cliente.
 */
export function AuditViewer({
  lhr,
  locale,
  basePath,
  search,
  evidenceImageSrc,
  reportSrc,
  summaryExtra,
}: {
  lhr: Lhr;
  locale: "es" | "en";
  basePath: string;
  search: ViewerSearch;
  /** URL de la captura de página completa; null si no se puede mostrar (p. ej. rutas con sesión vistas por el cliente). */
  evidenceImageSrc: string | null;
  /** URL del informe oficial de Lighthouse para el marco aislado; null si no se ofrece. */
  reportSrc: string | null;
  /** Contenido propio del llamador que va tras el resumen (datos internos del administrador). */
  summaryExtra?: ReactNode;
}) {
  const summary = buildSummary(lhr, locale);
  const evidence = evidenceImageSrc ? buildEvidence(lhr) : null;
  const available = CATEGORY_TABS.filter((t) => summary.categories.some((c) => c.id === t.cat));
  const tabIds = ["resumen", ...available.map((t) => t.id), ...(evidence ? ["evidencias"] : []), ...(reportSrc ? ["informe"] : [])];
  const vista = tabIds.includes(search.vista ?? "") ? search.vista! : "resumen";
  const expand = search.expandir === "1";

  const hrefFor = (patch: Record<string, string | null>, hash = "") => {
    const q = new URLSearchParams();
    const base: Record<string, string | undefined> = { vista: search.vista, m: search.m, audit: search.audit, expandir: search.expandir };
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) q.set(k, v);
    const qs = q.toString();
    return `${basePath}${qs ? `?${qs}` : ""}${hash}`;
  };
  const tabHref = (id: string) => hrefFor({ vista: id === "resumen" ? null : id, m: null, audit: null, expandir: null });

  const scoreOf = (cat: string) => {
    const c = summary.categories.find((x) => x.id === cat);
    return c ? (c.fraction ? `${c.fraction.passed}/${c.fraction.total}` : c.score !== null ? String(c.score) : "") : "";
  };

  const auditOfNode = new Map<string, string>();
  for (const a of evidence?.audits ?? []) for (const n of a.nodes) if (!auditOfNode.has(n.lhId)) auditOfNode.set(n.lhId, a.id);
  const ctx: DetailsContext = {
    evidenceHref: evidence ? (lhId) => (auditOfNode.has(lhId) ? hrefFor({ vista: "evidencias", audit: auditOfNode.get(lhId)!, m: null, expandir: null }, "#evidencia") : null) : undefined,
  };

  const returnTo = hrefFor({});
  const tab = CATEGORY_TABS.find((t) => t.id === vista);
  const category = tab ? buildCategoryView(lhr, tab.cat, { locale, metric: search.m ?? null }) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <LanguageSwitch locale={locale} returnTo={returnTo} />
        <SegmentedNav
          label="Secciones del informe"
          items={[
            { label: "Resumen", href: tabHref("resumen"), current: vista === "resumen" },
            ...available.map((t) => ({ label: `${t.label}${scoreOf(t.cat) ? ` ${scoreOf(t.cat)}` : ""}`, href: tabHref(t.id), current: vista === t.id })),
            ...(evidence ? [{ label: "Evidencias", href: tabHref("evidencias"), current: vista === "evidencias" }] : []),
            ...(reportSrc ? [{ label: "Informe completo", href: tabHref("informe"), current: vista === "informe" }] : []),
          ]}
        />
      </div>

      {vista === "resumen" ? (
        <>
          <SummaryPanel summary={summary} />
          {summaryExtra}
        </>
      ) : null}

      {category ? (
        <CategoryPanel
          category={category}
          expand={expand}
          metric={category.id === "performance" ? (search.m ?? null) : null}
          hrefFor={(patch) => hrefFor(patch)}
          ctx={ctx}
          scriptMap={category.id === "performance" ? scriptItems(lhr) : undefined}
        />
      ) : null}

      {vista === "evidencias" && evidence && evidenceImageSrc ? (
        <EvidencePanel evidence={evidence} imageSrc={evidenceImageSrc} selected={search.audit ?? null} hrefFor={(audit) => hrefFor({ vista: "evidencias", audit, m: null, expandir: null }, "#evidencia")} />
      ) : null}

      {vista === "informe" && reportSrc ? (
        <Card>
          <ReportFrame src={reportSrc} locale={locale} returnTo={returnTo} title="Informe oficial de Lighthouse" hideLanguage />
        </Card>
      ) : null}
    </div>
  );
}
