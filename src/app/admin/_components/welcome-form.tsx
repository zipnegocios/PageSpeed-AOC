"use client";

import { useState } from "react";
import type { ActionState } from "@/lib/actions";
import { ActionForm } from "@/lib/ui/components/action-form";
import { CheckboxField, Field, SelectField, TextareaField } from "@/lib/ui/components/field";
import { ccAddresses, CcParseError, greetingNames, parseCcContacts, PROJECT_KIND_LABEL, TECH_SUGGESTIONS } from "@/server/domain/client-welcome";

export type WelcomeProject = {
  id: string;
  name: string;
  site: string;
  kind: "site" | "shop" | "app";
  techLabel: string;
  includesServer: boolean;
};

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  projects: WelcomeProject[];
  contactName: string | null;
  contactEmail: string;
  initialCc: string;
};

/** Formulario de la bienvenida: lo que se pide se guarda y se rellena solo en los envíos siguientes. */
export function WelcomeForm({ action, projects, contactName, contactEmail, initialCc }: Props) {
  const [projectId, setProjectId] = useState(projects[0]!.id);
  const first = projects[0]!;
  const [kind, setKind] = useState(first.kind);
  const [tech, setTech] = useState(first.techLabel);
  const [server, setServer] = useState(first.includesServer);
  const [cc, setCc] = useState(initialCc);
  const [test, setTest] = useState(false);

  function pickProject(id: string) {
    setProjectId(id);
    const p = projects.find((x) => x.id === id);
    if (p) {
      setKind(p.kind);
      setTech(p.techLabel);
      setServer(p.includesServer);
    }
  }

  let summary: string;
  try {
    const contacts = parseCcContacts(cc, [contactEmail]);
    const names = greetingNames(contactName, contacts);
    const copy = ccAddresses(contacts, contactEmail);
    summary = `Para: ${contactEmail}${copy.length > 0 ? ` · Copia: ${copy.join(", ")}` : ""}. Saludo: «${
      names.length === 0 || names.length > 3 ? "Hola equipo de [cliente]" : `Hola ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`}`
    },».`;
  } catch (err) {
    summary = err instanceof CcParseError ? err.message : "Revisa la lista de personas en copia.";
  }

  return (
    <ActionForm action={action} submitLabel={test ? "Enviarme una prueba" : "Enviar bienvenida"} pendingLabel="Enviando…" variant={test ? "secondary" : "primary"}>
      <SelectField label="Proyecto del que habla el correo" id="projectId" value={projectId} onChange={(e) => pickProject(e.target.value)}>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.site}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField label="Qué es" id="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          {(["site", "shop", "app"] as const).map((k) => (
            <option key={k} value={k}>
              {PROJECT_KIND_LABEL[k][0]!.toUpperCase() + PROJECT_KIND_LABEL[k].slice(1)}
            </option>
          ))}
        </SelectField>
        <Field
          label="Tecnología"
          id="techLabel"
          list="tech-suggestions"
          required
          maxLength={60}
          autoComplete="off"
          value={tech}
          onChange={(e) => setTech(e.target.value)}
          placeholder="WordPress, Shopify, Next.js…"
          hint="Escribe cualquiera: el correo es el mismo para todas."
        />
      </div>
      <datalist id="tech-suggestions">
        {TECH_SUGGESTIONS.map((t) => (
          <option key={t.label} value={t.label} />
        ))}
      </datalist>
      <CheckboxField
        label="Mi plan incluye supervisar el servidor, los servicios y las APIs"
        id="includesServer"
        checked={server}
        onChange={(e) => setServer(e.target.checked)}
        hint="Si no lo marcas, el correo no menciona el servidor."
      />
      <TextareaField
        label="Personas en copia (opcional)"
        id="ccText"
        rows={3}
        value={cc}
        onChange={(e) => setCc(e.target.value)}
        placeholder={"Luis Vega <luis@empresa.com>\nMaría Soto <maria@empresa.com>"}
        hint="Una persona por línea. Si alguien comparte tu dirección de contacto (o la de otra persona), escríbela igual con su nombre: se nombran las dos en el saludo y el correo llega una sola vez. Se guarda para los próximos correos."
      />
      <p className="text-[15px] leading-5 text-ink-muted">{summary}</p>
      <CheckboxField
        label="Enviarme solo una prueba"
        id="test"
        checked={test}
        onChange={(e) => setTest(e.target.checked)}
        hint="Llega a tu correo de administrador con estos mismos datos. No se envía al cliente ni se guarda nada."
      />
    </ActionForm>
  );
}
