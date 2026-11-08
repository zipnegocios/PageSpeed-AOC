import { PageTitle } from "@/lib/ui/components/page-title";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Iniciar sesión · AOC PageSpeed",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  if (await getSession()) redirect("/admin");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">AOC PageSpeed</p>
        <PageTitle>Iniciar sesión</PageTitle>
      </header>
      <section className="hud hud-brackets relative rounded-lg p-4 md:p-6">
        <LoginForm />
      </section>
    </main>
  );
}
