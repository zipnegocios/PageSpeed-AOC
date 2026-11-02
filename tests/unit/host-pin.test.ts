import { describe, expect, it } from "vitest";
import { resolvePinnedHost } from "@/worker/host-pin";

const resolver = (map: Record<string, Array<{ address: string; family: number }>>) => async (host: string) => {
  const found = map[host];
  if (!found) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
  return found;
};

describe("resolvePinnedHost", () => {
  it("devuelve la IP pública validada para fijarla en Chromium, prefiriendo IPv4", async () => {
    const r = await resolvePinnedHost("https://www.acme.test/x", {
      resolver: resolver({ "www.acme.test": [{ address: "2606:4700::1", family: 6 }, { address: "93.184.216.34", family: 4 }] }),
    });
    expect(r).toEqual({ host: "www.acme.test", ip: "93.184.216.34" });
  });

  it("bloquea hosts que resuelven a direcciones privadas, aunque haya una pública mezclada", async () => {
    for (const address of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "192.168.1.1", "::1", "fd00::1"]) {
      await expect(
        resolvePinnedHost("https://acme.test/", { resolver: resolver({ "acme.test": [{ address: "93.184.216.34", family: 4 }, { address, family: address.includes(":") ? 6 : 4 }] }) }),
      ).rejects.toMatchObject({ code: "FORBIDDEN_HOST" });
    }
  });

  it("bloquea IPs literales privadas y no fija nada en las públicas", async () => {
    await expect(resolvePinnedHost("http://127.0.0.1:3000/")).rejects.toMatchObject({ code: "FORBIDDEN_HOST" });
    await expect(resolvePinnedHost("http://[::1]/")).rejects.toMatchObject({ code: "FORBIDDEN_HOST" });
    await expect(resolvePinnedHost("http://8.8.8.8/")).resolves.toBeUndefined();
  });

  it("allowPrivate (solo pruebas) permite direcciones privadas", async () => {
    await expect(resolvePinnedHost("http://127.0.0.1:3000/", { allowPrivate: true })).resolves.toBeUndefined();
    await expect(
      resolvePinnedHost("http://local.test/", { allowPrivate: true, resolver: resolver({ "local.test": [{ address: "127.0.0.1", family: 4 }] }) }),
    ).resolves.toEqual({ host: "local.test", ip: "127.0.0.1" });
  });

  it("un host que no existe se informa como error del sitio, no como bloqueo", async () => {
    await expect(resolvePinnedHost("https://no-existe.test/", { resolver: resolver({}) })).rejects.toMatchObject({ code: "UPSTREAM" });
    await expect(resolvePinnedHost("https://vacio.test/", { resolver: resolver({ "vacio.test": [] }) })).rejects.toMatchObject({ code: "UPSTREAM" });
  });
});
