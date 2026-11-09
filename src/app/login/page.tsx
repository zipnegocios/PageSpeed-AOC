import { BrandMark, SpeedTrail } from "@/lib/ui/components/brand-mark";
import { CopyrightLine } from "@/lib/ui/components/copyright-line";
import { PageTitle } from "@/lib/ui/components/page-title";
import { pageTitle } from "@/lib/brand";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/safe-next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: pageTitle("Iniciar sesión"),
  robots: { index: false, follow: false },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await getSession()) redirect(next ?? "/admin");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <header className="flex flex-col gap-4">
        <div className="flex items-center">
          <SpeedTrail className="-mr-3 hidden sm:block" />
          <BrandMark className="size-24" />
        </div>
        <PageTitle>Iniciar sesión</PageTitle>
      </header>
      <section className="hud hud-brackets relative rounded-lg p-4 md:p-6">
        <LoginForm next={next} />
      </section>
      <CopyrightLine />
    </main>
  );
}
