/** Esqueleto mientras llega el contenido de una pestaña: el marco (barras) ya está en pantalla. */
export default function PortalProjectLoading() {
  return (
    <div role="status" aria-label="Cargando" className="flex animate-pulse flex-col gap-5">
      <div className="h-10 w-48 rounded-md bg-surface-300" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-36 rounded-lg bg-surface-300" />
        ))}
      </div>
      <div className="h-40 rounded-lg bg-surface-300" />
    </div>
  );
}
