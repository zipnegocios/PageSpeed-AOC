/** El trabajo superó el tiempo máximo permitido. */
export class AuditTimeoutError extends Error {
  constructor(ms: number) {
    super(`La auditoría superó el tiempo máximo (${Math.round(ms / 1000)} s).`);
    this.name = "AuditTimeoutError";
  }
}

/** Lighthouse terminó, pero reportó un error de ejecución (`runtimeError`). */
export class LighthouseRuntimeError extends Error {
  constructor(
    public readonly lhCode: string,
    message: string,
  ) {
    super(message || lhCode);
    this.name = "LighthouseRuntimeError";
  }
}

/** Fallo al lanzar o hablar con Chromium. */
export class ChromeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChromeError";
  }
}
