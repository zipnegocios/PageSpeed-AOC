/**
 * Limitador de intentos fallidos en memoria. Suficiente para un único proceso web (el despliegue
 * actual); si algún día hay varias réplicas, hay que moverlo a Redis.
 */
export class AttemptLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly options: { max: number; windowMs: number; now?: () => number },
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.options.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length === 0) this.hits.delete(key);
    else this.hits.set(key, list);
    return list;
  }

  isBlocked(key: string): boolean {
    return this.recent(key).length >= this.options.max;
  }

  /** Segundos hasta que se libere el intento más antiguo (0 si no está bloqueado). */
  retryAfterSeconds(key: string): number {
    const list = this.recent(key);
    if (list.length < this.options.max) return 0;
    const oldest = list[0] ?? this.now();
    return Math.max(1, Math.ceil((oldest + this.options.windowMs - this.now()) / 1000));
  }

  recordFailure(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.hits.set(key, list);
    // Evita crecer sin límite ante un barrido de claves distintas.
    if (this.hits.size > 10_000) {
      for (const k of this.hits.keys()) this.recent(k);
    }
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}
