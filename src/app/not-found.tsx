import Link from "next/link";

export const metadata = { title: "No encontrado · AOC PageSpeed", robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-12">
      <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Error 404</p>
      <h1 className="text-[32px] leading-9 font-bold text-ink">No encontramos esta página</h1>
      <p className="text-ink-muted">El enlace puede estar mal escrito o el elemento ya no existe.</p>
      <Link href="/admin" className="text-[17px] font-semibold text-link hover:underline">
        Volver al panel
      </Link>
    </main>
  );
}
