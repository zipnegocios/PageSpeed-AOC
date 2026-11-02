import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainError } from "@/server/domain/errors";
import {
  assertHostAllowed,
  fetchGuarded,
  isHostAllowed,
  isPrivateAddress,
  parseHttpUrl,
} from "@/server/domain/url-guard";

describe("isPrivateAddress", () => {
  it.each([
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "127.255.255.254", "169.254.169.254",
    "172.16.0.1", "172.31.255.255", "192.168.1.1", "192.0.0.5", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "2001:db8::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2002:7f00:1::1",
    "no-es-una-ip", "300.1.1.1", "1.2.3",
  ])("bloquea %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.0.1", "172.32.0.1", "100.63.255.255", "100.128.0.1",
    "169.253.0.1", "192.169.0.1", "198.20.0.1", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8",
  ])("permite %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it("acepta IPv6 entre corchetes", () => {
    expect(isPrivateAddress("[::1]")).toBe(true);
    expect(isPrivateAddress("[2606:4700:4700::1111]")).toBe(false);
  });
});

describe("parseHttpUrl", () => {
  it("acepta http y https", () => {
    expect(parseHttpUrl("https://acme.test/ruta").hostname).toBe("acme.test");
    expect(parseHttpUrl("  http://acme.test ").protocol).toBe("http:");
  });

  it.each(["file:///etc/passwd", "ftp://acme.test", "gopher://x", "javascript:alert(1)", "data:text/html,x", "acme.test", "", "https://user:pass@acme.test"])(
    "rechaza %j",
    (input) => {
      expect(() => parseHttpUrl(input)).toThrow(DomainError);
    },
  );

  it("el parser normaliza formas disfrazadas de IP a su dirección real", () => {
    for (const disguised of ["http://2130706433/", "http://0x7f.1/", "http://017700000001/", "http://127.1/"]) {
      expect(parseHttpUrl(disguised).hostname).toBe("127.0.0.1");
    }
    expect(isPrivateAddress(parseHttpUrl("http://[::1]/").hostname)).toBe(true);
  });
});

describe("hosts permitidos", () => {
  it("compara sin importar mayúsculas ni punto final", () => {
    expect(isHostAllowed("Acme.TEST.", ["acme.test"])).toBe(true);
    expect(isHostAllowed("www.acme.test", ["acme.test"])).toBe(false);
    expect(isHostAllowed("acme.test.evil.com", ["acme.test"])).toBe(false);
    expect(isHostAllowed("evilacme.test", ["acme.test"])).toBe(false);
  });
  it("comodín *.dominio solo cubre subdominios", () => {
    expect(isHostAllowed("blog.acme.test", ["*.acme.test"])).toBe(true);
    expect(isHostAllowed("a.b.acme.test", ["*.acme.test"])).toBe(true);
    expect(isHostAllowed("acme.test", ["*.acme.test"])).toBe(false);
    expect(isHostAllowed("xacme.test", ["*.acme.test"])).toBe(false);
  });
  it("assertHostAllowed lanza FORBIDDEN_HOST", () => {
    expect(() => assertHostAllowed(new URL("https://otro.test"), ["acme.test"])).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN_HOST" }),
    );
  });
});

describe("fetchGuarded", () => {
  let server: Server;
  let base: string;
  const host = "127.0.0.1";
  const allowed = [host];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = req.url ?? "/";
      if (path === "/ok") return void res.writeHead(200, { "content-type": "text/plain" }).end("hola");
      if (path === "/redir-ok") return void res.writeHead(302, { location: "/ok" }).end();
      if (path === "/redir-externo") return void res.writeHead(302, { location: "https://evil.example/x" }).end();
      if (path === "/redir-metadata") return void res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" }).end();
      if (path === "/bucle") return void res.writeHead(302, { location: "/bucle" }).end();
      if (path === "/grande") return void res.writeHead(200).end("x".repeat(2000));
      if (path === "/lento") return; // nunca responde
      res.writeHead(404).end("no");
    });
    await new Promise<void>((r) => server.listen(0, host, r));
    base = `http://${host}:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it("por defecto NO conecta a direcciones privadas, aunque el host esté en la lista", async () => {
    await expect(fetchGuarded(`${base}/ok`, { allowedHosts: allowed })).rejects.toMatchObject({ code: "FORBIDDEN_HOST" });
  });

  it("un nombre que resuelve a loopback también se bloquea al conectar", async () => {
    await expect(fetchGuarded(`http://localhost:18999/`, { allowedHosts: ["localhost"] })).rejects.toMatchObject({
      code: "FORBIDDEN_HOST",
    });
  });

  it("rechaza hosts fuera de la lista antes de abrir ninguna conexión", async () => {
    await expect(fetchGuarded("https://otro.test/", { allowedHosts: ["acme.test"], allowPrivate: true })).rejects.toMatchObject({
      code: "FORBIDDEN_HOST",
    });
  });

  it("con allowPrivate (solo pruebas) lee la respuesta y sigue redirecciones permitidas", async () => {
    const direct = await fetchGuarded(`${base}/ok`, { allowedHosts: allowed, allowPrivate: true });
    expect(direct).toMatchObject({ status: 200, text: "hola" });
    const redirected = await fetchGuarded(`${base}/redir-ok`, { allowedHosts: allowed, allowPrivate: true });
    expect(redirected.text).toBe("hola");
    expect(redirected.finalUrl).toBe(`${base}/ok`);
  });

  it("bloquea redirecciones hacia hosts no permitidos o hacia metadatos de la nube", async () => {
    await expect(fetchGuarded(`${base}/redir-externo`, { allowedHosts: allowed, allowPrivate: true })).rejects.toMatchObject({
      code: "FORBIDDEN_HOST",
    });
    await expect(fetchGuarded(`${base}/redir-metadata`, { allowedHosts: allowed, allowPrivate: true })).rejects.toMatchObject({
      code: "FORBIDDEN_HOST",
    });
  });

  it("corta los bucles de redirección", async () => {
    await expect(fetchGuarded(`${base}/bucle`, { allowedHosts: allowed, allowPrivate: true })).rejects.toMatchObject({
      code: "UPSTREAM",
      message: expect.stringContaining("redirecciones"),
    });
  });

  it("respeta el tamaño máximo y el tiempo de espera", async () => {
    await expect(fetchGuarded(`${base}/grande`, { allowedHosts: allowed, allowPrivate: true, maxBytes: 500 })).rejects.toMatchObject({
      code: "UPSTREAM",
      message: expect.stringContaining("grande"),
    });
    await expect(fetchGuarded(`${base}/lento`, { allowedHosts: allowed, allowPrivate: true, timeoutMs: 150 })).rejects.toMatchObject({
      code: "UPSTREAM",
      message: expect.stringContaining("a tiempo"),
    });
  });

  it("devuelve códigos de error del sitio sin lanzar", async () => {
    const r = await fetchGuarded(`${base}/nada`, { allowedHosts: allowed, allowPrivate: true });
    expect(r.status).toBe(404);
  });
});
