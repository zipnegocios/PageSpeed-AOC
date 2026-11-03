import { parseInline } from "@/server/domain/inline-markdown";

/** Texto de Lighthouse con sus enlaces y código, dibujado sin interpretar HTML. */
export function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((p, i) =>
        p.k === "link" ? (
          <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
            {p.text}
          </a>
        ) : p.k === "code" ? (
          <code key={i} className="rounded-sm bg-surface-300 px-1 font-mono text-[0.9em] break-words">{p.v}</code>
        ) : (
          <span key={i}>{p.v}</span>
        ),
      )}
    </>
  );
}
