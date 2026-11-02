export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-4 py-12 md:px-8">
      <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        M0 · Cimientos
      </p>
      <h1 className="text-[56px] leading-[56px] font-bold text-ink">AOC PageSpeed</h1>
      <p className="text-ink-muted">
        Auditorías Lighthouse para los proyectos de tus clientes. El panel de administración llega
        en el milestone M1.
      </p>
      <div className="flex flex-wrap gap-3">
        <span className="rounded-sm bg-primary px-3 py-1 text-on-primary">Primario</span>
        <span className="rounded-sm bg-primary-subtle px-3 py-1 text-on-primary-subtle">
          Tinte azul
        </span>
        <span className="rounded-sm bg-danger-subtle px-3 py-1 text-on-danger-subtle">
          Alerta abierta
        </span>
      </div>
    </main>
  );
}
