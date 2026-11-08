import Link from "next/link";
import { BrandMark } from "@/lib/ui/components/brand-mark";
import { PageTitle } from "@/lib/ui/components/page-title";
import { pageTitle } from "@/lib/brand";

export const metadata = { title: pageTitle("No encontrado"), robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-12">
      <BrandMark className="size-16" />
      <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Error 404</p>
      <PageTitle>No encontramos esta página</PageTitle>
      <p className="text-ink-muted">El enlace puede estar mal escrito o el elemento ya no existe.</p>
      <Link href="/admin" className="text-[17px] font-semibold text-link hover:underline">
        Volver al panel
      </Link>
    </main>
  );
}
