export type Inline = { k: "text"; v: string } | { k: "code"; v: string } | { k: "link"; text: string; url: string };

const TOKEN = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|`([^`]+)`/g;

/**
 * Las descripciones de Lighthouse traen enlaces `[texto](https://…)` y código `` `así` ``. Se trocean en partes
 * simples para dibujarlas sin interpretar HTML: solo se aceptan enlaces http(s).
 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ k: "text", v: text.slice(last, at) });
    if (m[3] !== undefined) out.push({ k: "code", v: m[3] });
    else out.push({ k: "link", text: m[1]!, url: m[2]! });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ k: "text", v: text.slice(last) });
  return out;
}

/** Acorta un texto largo por el medio, conservando el principio y el final (útil en URLs). */
export function middleTruncate(text: string, max = 64): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.6);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}
