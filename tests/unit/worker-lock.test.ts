import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lockOverrides, lockedVersions } from "../../scripts/worker-lock.mjs";

const SAMPLE = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      bullmq:
        specifier: ^6.5.3
        version: 6.5.3

packages:

  '@aws-sdk/credential-provider-sso@3.973.24':
    resolution: {integrity: sha512-aaa}
    engines: {node: '>=20.0.0'}

  bullmq@6.5.3:
    resolution: {integrity: sha512-bbb}

  semver@6.3.1:
    resolution: {integrity: sha512-ccc}

  semver@7.8.0:
    resolution: {integrity: sha512-ddd}

  '@scope/pkg@1.0.0-beta.2':
    resolution: {integrity: sha512-eee}

snapshots:

  '@aws-sdk/credential-provider-sso@3.973.24':
    dependencies:
      zod: 4.0.0

  react-dom@19.3.1(react@19.3.1):
    dependencies:
      react: 19.3.1
`;

describe("versiones fijadas por el lockfile", () => {
  it("lee nombre y versión de la sección packages, con y sin alcance, y con prerrelease", () => {
    const v = lockedVersions(SAMPLE);
    expect([...v.get("@aws-sdk/credential-provider-sso")!]).toEqual(["3.973.24"]);
    expect([...v.get("bullmq")!]).toEqual(["6.5.3"]);
    expect([...v.get("@scope/pkg")!]).toEqual(["1.0.0-beta.2"]);
    expect([...v.get("semver")!].sort()).toEqual(["6.3.1", "7.8.0"]);
  });

  it("no lee la sección snapshots ni los importadores", () => {
    const v = lockedVersions(SAMPLE);
    expect(v.has("react-dom")).toBe(false);
    expect(v.has("zod")).toBe(false);
    expect(v.size).toBe(4);
  });

  it("fija solo lo que tiene una única versión y omite los directos", () => {
    expect(lockOverrides(SAMPLE, ["bullmq"])).toEqual({ "@aws-sdk/credential-provider-sso": "3.973.24", "@scope/pkg": "1.0.0-beta.2" });
    // Los paquetes con dos mayores quedan libres para que cada dependiente use el suyo.
    expect(Object.keys(lockOverrides(SAMPLE, []))).not.toContain("semver");
  });

  it("el resultado es estable: mismo orden siempre", () => {
    expect(Object.keys(lockOverrides(SAMPLE, []))).toEqual(["@aws-sdk/credential-provider-sso", "@scope/pkg", "bullmq"]);
  });

  it("sin lockfile legible no inventa nada", () => {
    expect(lockOverrides("", [])).toEqual({});
    expect(lockOverrides("lockfileVersion: '9.0'\n", [])).toEqual({});
  });

  it("con el lockfile real del repositorio: cientos de paquetes, versiones exactas y las de AWS fijadas", () => {
    const text = readFileSync("pnpm-lock.yaml", "utf8");
    const overrides = lockOverrides(text, []);
    expect(Object.keys(overrides).length).toBeGreaterThan(300);
    for (const version of Object.values(overrides)) expect(version).toMatch(/^\d+\.\d+\.\d+/);
    // La que rompió el despliegue: se fija a lo que se probó, no a lo último que publique el proveedor.
    expect(overrides["@aws-sdk/credential-provider-sso"]).toMatch(/^3\.973\.\d+$/);
    expect(overrides["@aws-sdk/credential-provider-node"]).toMatch(/^3\.972\.\d+$/);
  });
});
