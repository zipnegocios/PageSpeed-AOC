import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfileSwitch } from "@/lib/ui/components/profile-switch";
import { ProfileTabs } from "@/lib/ui/components/profile-tabs";
import { SegmentedNav } from "@/lib/ui/components/segmented-nav";

const tabs = [
  { profile: "mobile" as const, label: "Móvil", badge: <b>86</b>, content: <p>contenido móvil</p> },
  { profile: "desktop" as const, label: "Escritorio", badge: <b>92</b>, content: <p>contenido escritorio</p> },
];

describe("ProfileTabs", () => {
  it("renderiza pestañas accesibles y ambos paneles ya en la página", () => {
    const html = renderToStaticMarkup(<ProfileTabs label="Dispositivo de /" defaultProfile="mobile" tabs={tabs} />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Dispositivo de /"');
    expect((html.match(/role="tab"/g) ?? []).length).toBe(2);
    expect((html.match(/role="tabpanel"/g) ?? []).length).toBe(2);
    // los dos contenidos están en el HTML: cambiar de pestaña no pide nada al servidor
    expect(html).toContain("contenido móvil");
    expect(html).toContain("contenido escritorio");
    expect(html).toContain("86");
    expect(html).toContain("92");
  });
  it("abre en el dispositivo pedido: seleccionado, enfocable y con su panel visible; el otro oculto", () => {
    const html = renderToStaticMarkup(<ProfileTabs label="x" defaultProfile="desktop" tabs={tabs} />);
    const mobileTab = /<button[^>]*>(?:(?!<\/button>).)*Móvil/s.exec(html)![0];
    const desktopTab = /<button[^>]*>(?:(?!<\/button>).)*Escritorio/s.exec(html)![0];
    expect(desktopTab).toContain('aria-selected="true"');
    expect(desktopTab).toContain('tabindex="0"');
    expect(mobileTab).toContain('aria-selected="false"');
    expect(mobileTab).toContain('tabindex="-1"');
    const panels = [...html.matchAll(/<div[^>]*role="tabpanel"[^>]*>/g)].map((m) => m[0]);
    expect(panels[0]).toContain("hidden"); // móvil oculto
    expect(panels[1]).not.toContain("hidden"); // escritorio visible
  });
  it("cada pestaña y su panel se apuntan entre sí (aria-controls / aria-labelledby)", () => {
    const html = renderToStaticMarkup(<ProfileTabs label="x" defaultProfile="mobile" tabs={tabs} />);
    const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1]);
    const panelIds = [...html.matchAll(/<div id="([^"]+)" role="tabpanel"/g)].map((m) => m[1]);
    expect(controls).toEqual(panelIds);
    const labelled = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
    const tabIds = [...html.matchAll(/<button id="([^"]+)"/g)].map((m) => m[1]);
    expect(labelled).toEqual(tabIds);
  });
  it("si el dispositivo pedido no existe cae en la primera pestaña", () => {
    const html = renderToStaticMarkup(<ProfileTabs label="x" defaultProfile="desktop" tabs={[tabs[0]!]} />);
    expect(html).toContain('aria-selected="true"');
    expect(html).not.toContain("Escritorio");
  });
});

describe("ProfileSwitch", () => {
  const sib = { mobile: { id: "m1", finishedAt: new Date(), scorePerformance: 86 }, desktop: { id: "d1", finishedAt: new Date(), scorePerformance: 92 } };
  const hrefFor = (id: string) => `/admin/auditorias/${id}?vista=rendimiento`;
  it("el actual marca aria-current y el otro enlaza a la última auditoría de ese dispositivo conservando la pestaña del visor", () => {
    const html = renderToStaticMarkup(<ProfileSwitch current="mobile" currentScore={86} siblings={sib} hrefFor={hrefFor} currentHref="/admin/auditorias/m1?vista=rendimiento" />);
    expect(html).toContain("Móvil 86");
    expect(html).toContain("Escritorio 92");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/admin/auditorias/d1?vista=rendimiento"');
  });
  it("sin auditoría del otro dispositivo, queda atenuado y sin enlace", () => {
    const html = renderToStaticMarkup(<ProfileSwitch current="desktop" currentScore={70} siblings={{ ...sib, mobile: null }} hrefFor={hrefFor} currentHref="/x" />);
    expect(html).toContain("Móvil · sin auditoría");
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain("auditorias/m1");
  });
  it("sin puntuación muestra solo el nombre del dispositivo", () => {
    const html = renderToStaticMarkup(<ProfileSwitch current="mobile" currentScore={null} siblings={{ mobile: null, desktop: null }} hrefFor={hrefFor} currentHref="/x" />);
    expect(html).toContain(">Móvil<");
  });
});

describe("SegmentedNav disabled", () => {
  it("una opción deshabilitada no es un enlace", () => {
    const html = renderToStaticMarkup(<SegmentedNav label="x" items={[{ label: "A", href: "/a", current: true }, { label: "B", href: "/b", current: false, disabled: true }]} />);
    expect(html).toContain('href="/a"');
    expect(html).not.toContain('href="/b"');
    expect(html).toContain('aria-disabled="true"');
  });
});
