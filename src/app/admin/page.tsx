import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/session";
import { Button } from "@/lib/ui/components/button";
import { logoutAction } from "./actions";

export const metadata: Metadata = {
  title: "Panel · AOC PageSpeed",
  robots: { index: false, follow: false },
};

export default async function AdminHome() {
  const session = await verifySession();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 px-4 py-8 md:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">AOC PageSpeed</p>
          <h1 className="text-[32px] leading-9 font-bold text-ink">Panel de administración</h1>
        </div>
        <form action={logoutAction} className="flex items-center gap-3">
          <span className="text-[15px] text-ink-muted">{session.email}</span>
          <Button type="submit" variant="secondary">
            Salir
          </Button>
        </form>
      </header>
      <section className="rounded-md border border-border bg-surface-200 p-4 md:p-6">
        <h2 className="text-[24px] leading-7 font-semibold text-ink">Sesión iniciada</h2>
        <p className="mt-2 text-ink-muted">
          El acceso de administrador funciona. Aquí irán los clientes, proyectos y umbrales en las
          próximas entregas.
        </p>
      </section>
    </main>
  );
}
