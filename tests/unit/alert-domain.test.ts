import { describe, expect, it } from "vitest";
import {
  REMINDER_INTERVAL_MS,
  decideFailureOnFailure,
  decideFailureOnSuccess,
  decideThreshold,
  notifyKind,
} from "@/server/domain/alert-state-machine";
import { alertWhatsappMessage, buildWhatsappLink, normalizePhone } from "@/server/notify/whatsapp-link";
import { buildDigestEmail, digestType, type DigestItem } from "@/server/notify/templates";

describe("decideThreshold", () => {
  it.each([
    // score, min, enabled, hasOpen, esperado
    [75, 80, true, false, "open"],
    [75, 80, true, true, "keep"],
    [80, 80, true, false, "none"], // igual al mínimo: cumple
    [80, 80, true, true, "resolve"],
    [95, 80, true, true, "resolve"],
    [95, 80, true, false, "none"],
    [0, 80, true, false, "open"],
    [null, 80, true, false, "none"],
    [null, 80, true, true, "keep"],
    [10, 80, false, false, "none"],
    [10, 80, false, true, "resolve"],
  ] as const)("score %s, mínimo %s, activo %s, abierta %s → %s", (score, minScore, enabled, hasOpen, expected) => {
    expect(decideThreshold({ score, minScore, enabled, hasOpen })).toBe(expected);
  });
});

describe("fallos de auditoría", () => {
  it("abre al primer fallo definitivo, mantiene en los siguientes y resuelve con un éxito", () => {
    expect(decideFailureOnFailure(false)).toBe("open");
    expect(decideFailureOnFailure(true)).toBe("keep");
    expect(decideFailureOnSuccess(true)).toBe("resolve");
    expect(decideFailureOnSuccess(false)).toBe("none");
  });
});

describe("notifyKind", () => {
  const now = new Date("2026-03-10T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  it("avisa lo nuevo, espera 7 días y luego recuerda", () => {
    expect(notifyKind({ lastNotifiedAt: null }, now)).toBe("new");
    expect(notifyKind({ lastNotifiedAt: ago(60_000) }, now)).toBeNull();
    expect(notifyKind({ lastNotifiedAt: ago(REMINDER_INTERVAL_MS - 1) }, now)).toBeNull();
    expect(notifyKind({ lastNotifiedAt: ago(REMINDER_INTERVAL_MS) }, now)).toBe("reminder");
    expect(notifyKind({ lastNotifiedAt: ago(30 * 86_400_000) }, now)).toBe("reminder");
  });
  it("respeta un intervalo distinto", () => {
    expect(notifyKind({ lastNotifiedAt: ago(2000) }, now, 1000)).toBe("reminder");
  });
});

describe("WhatsApp", () => {
  it.each([
    ["+57 300 123 4567", "573001234567"],
    ["0057 300-123-4567", "573001234567"],
    ["(300) 123 4567", "3001234567"],
    ["123", null],
    ["", null],
    [null, null],
    ["1".repeat(16), null],
  ])("normalizePhone(%j) → %j", (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it("arma el enlace con el mensaje codificado", () => {
    const link = buildWhatsappLink("+57 300 123 4567", "Hola & adiós\n¿ok?")!;
    expect(link.startsWith("https://wa.me/573001234567?text=")).toBe(true);
    expect(decodeURIComponent(link.split("?text=")[1]!)).toBe("Hola & adiós\n¿ok?");
    expect(buildWhatsappLink("abc", "x")).toBeNull();
  });

  it("el mensaje nombra al contacto y al proyecto, y resume lo que sobra", () => {
    const alerts = Array.from({ length: 7 }, (_, i) => ({ routePath: `/p${i}`, label: "SEO 60" }));
    const msg = alertWhatsappMessage({ contactName: " Ana ", projectName: "Tienda", alerts, total: 7 });
    expect(msg).toContain("Hola Ana,");
    expect(msg).toContain("*Tienda*");
    expect(msg).toContain("• /p0: SEO 60");
    expect(msg).not.toContain("/p5");
    expect(msg).toContain("y 2 más");
    expect(alertWhatsappMessage({ projectName: "T", alerts: [] })).toMatch(/^Hola, /);
  });
});

describe("correo de alertas", () => {
  const base: DigestItem = {
    kind: "threshold",
    status: "new",
    routePath: "/",
    profile: "mobile",
    metric: "seo",
    value: 69,
    threshold: 90,
    errorCode: null,
    openedAt: new Date("2026-03-01T10:00:00Z"),
    reminderCount: 0,
    auditId: "11111111-1111-4111-8111-111111111111",
  };
  const input = (items: DigestItem[]) => ({
    projectName: "Tienda <b>",
    clientName: "ACME",
    projectUrl: "https://app.test/admin/proyectos/p1",
    auditsBase: "https://app.test/admin/auditorias",
    items,
    now: new Date("2026-03-10T00:00:00Z"),
  });

  it("clasifica el correo por su contenido", () => {
    expect(digestType([base])).toBe("initial");
    expect(digestType([{ ...base, kind: "audit_failure", metric: null }])).toBe("failure");
    expect(digestType([{ ...base, status: "reminder" }])).toBe("reminder");
    expect(digestType([{ ...base, status: "reminder" }, base])).toBe("initial");
  });

  it("agrupa en un solo correo, con enlaces y el texto escapado", () => {
    const mail = buildDigestEmail(
      input([
        base,
        { ...base, metric: "performance", value: 60, threshold: 80 },
        { ...base, kind: "audit_failure", metric: null, errorCode: "TIMEOUT", value: null, threshold: null },
        { ...base, status: "reminder", routePath: "/blog", reminderCount: 1 },
      ]),
    );
    expect(mail.type).toBe("initial");
    expect(mail.subject).toContain("Tienda <b>");
    expect(mail.text).toContain("SEO 69 (mínimo 90)");
    expect(mail.text).toContain("Rendimiento 60 (mínimo 80)");
    expect(mail.text).toContain("la auditoría falla (TIMEOUT)");
    expect(mail.text).toContain("recordatorio n.º 2");
    expect(mail.text).toContain("https://app.test/admin/proyectos/p1");
    expect(mail.html).toContain("Tienda &lt;b&gt;");
    expect(mail.html).not.toContain("Tienda <b>");
    expect(mail.html).toContain("/admin/auditorias/11111111-1111-4111-8111-111111111111");
  });

  it("el asunto distingue singular, recordatorio y fallo", () => {
    expect(buildDigestEmail(input([base])).subject).toMatch(/^Alerta en /);
    expect(buildDigestEmail(input([{ ...base, status: "reminder" }])).subject).toMatch(/^Recordatorio: .* 1 alerta abierta$/);
    expect(buildDigestEmail(input([{ ...base, kind: "audit_failure", metric: null }])).subject).toMatch(/^Falla de auditoría/);
  });
});
