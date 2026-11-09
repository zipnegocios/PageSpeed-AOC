import { describe, expect, it } from "vitest";
import { parseServiceAccountEnv } from "@/server/seo/google-auth";

const key = { type: "service_account", client_email: "pagespeed@demo.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n" };
const json = JSON.stringify(key);
const pretty = JSON.stringify(key, null, 2);
const expected = { client_email: key.client_email, private_key: key.private_key };

describe("cuenta de servicio desde una variable de entorno", () => {
  it("acepta el JSON en una línea, con formato o entre comillas", () => {
    expect(parseServiceAccountEnv(json)).toEqual(expected);
    expect(parseServiceAccountEnv(pretty)).toEqual(expected);
    expect(parseServiceAccountEnv(`  ${json}\n`)).toEqual(expected);
    expect(parseServiceAccountEnv(`'${json}'`)).toEqual(expected);
  });

  it("acepta ese JSON codificado en base64, con espacios o saltos alrededor", () => {
    const b64 = Buffer.from(pretty).toString("base64");
    expect(parseServiceAccountEnv(b64)).toEqual(expected);
    expect(parseServiceAccountEnv(`\n${b64}\n`)).toEqual(expected);
    expect(parseServiceAccountEnv(`"${b64}"`)).toEqual(expected);
  });

  it("rechaza una clave de API y cualquier otro valor con un mensaje claro", () => {
    expect(() => parseServiceAccountEnv("AIzaSyEjemploDeUnaClaveDeApi1234567890abcd")).toThrow(/ni ese JSON codificado en base64/);
    expect(() => parseServiceAccountEnv("hola")).toThrow(/ni ese JSON/);
    expect(() => parseServiceAccountEnv("{ roto")).toThrow(/JSON válido/);
    expect(() => parseServiceAccountEnv(JSON.stringify({ client_email: "a@b" }))).toThrow(/private_key/);
    expect(() => parseServiceAccountEnv(JSON.stringify({ ...key, token_uri: "https://evil.test/token" }))).toThrow(/token_uri/);
    expect(() => parseServiceAccountEnv(Buffer.from("no es json").toString("base64"))).toThrow(/ni ese JSON/);
  });
});

describe("el mensaje describe qué parece el valor sin mostrarlo", () => {
  const msg = (v: string) => {
    try {
      parseServiceAccountEnv(v);
    } catch (err) {
      return (err as Error).message;
    }
    return "";
  };
  const apiKey = "AIzaSyDx1234567890abcdefghijklmnopqrstuv";

  it("reconoce una clave de API", () => {
    expect(msg(apiKey)).toMatch(/Parece una clave de API.*cuenta de servicio/);
    expect(msg(`"${apiKey}"`)).toMatch(/clave de API/);
    expect(msg(apiKey)).not.toContain(apiKey);
  });

  it("reconoce la llave privada sola, una ruta de archivo y un base64 que no es JSON", () => {
    expect(msg("-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----")).toMatch(/llave privada sola/);
    expect(msg("/etc/secretos/llave.json")).toMatch(/ruta o el nombre de un archivo/);
    expect(msg("llave-servicio.json")).toMatch(/ruta o el nombre de un archivo/);
    expect(msg("C:\\Users\\yo\\llave.json")).toMatch(/ruta o el nombre de un archivo/);
    const b64 = Buffer.from("esto no es un json, es solo texto largo para superar el mínimo").toString("base64");
    expect(msg(b64)).toMatch(/Parece base64 \(\d+ caracteres\), pero al decodificarlo no es un JSON/);
  });

  it("describe un mensaje de error pegado por accidente y cualquier otra cosa", () => {
    expect(msg("base64: invalid option -- w")).toMatch(/espacios o saltos de línea.*no se generó bien/);
    expect(msg("valor-raro")).toMatch(/Tiene 10 caracteres y no empieza por «\{»/);
  });
});
