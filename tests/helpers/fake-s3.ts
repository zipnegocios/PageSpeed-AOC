import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type FakeS3 = {
  url: string;
  objects: Map<string, Buffer>;
  /** Fecha de última modificación de cada objeto (para probar la retención). */
  mtimes: Map<string, Date>;
  /** Hace que las siguientes escrituras respondan con este código HTTP (p. ej. 403). */
  failWith(status: number | null): void;
  puts: number;
  close(): Promise<void>;
};

/** Servidor mínimo con la API de S3 (estilo ruta): PUT/GET/HEAD de objetos en memoria. */
export async function startFakeS3(): Promise<FakeS3> {
  const objects = new Map<string, Buffer>();
  const mtimes = new Map<string, Date>();
  let failStatus: number | null = null;
  const state = { puts: 0 };

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const [rawPath = "/", query = ""] = (req.url ?? "/").split("?");
      const path = decodeURIComponent(rawPath);
      const key = path.replace(/^\/[^/]+\//, ""); // quita /bucket/
      if (req.method === "GET" && /^\/[^/]+\/?$/.test(path) && query.includes("list-type=2")) {
        const prefix = decodeURIComponent(new URLSearchParams(query).get("prefix") ?? "");
        const items = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
        const xml =
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated><KeyCount>${items.length}</KeyCount>` +
          items.map((k) => `<Contents><Key>${k}</Key><LastModified>${(mtimes.get(k) ?? new Date()).toISOString()}</LastModified><Size>${objects.get(k)!.length}</Size></Contents>`).join("") +
          "</ListBucketResult>";
        res.writeHead(200, { "content-type": "application/xml" });
        return void res.end(xml);
      }
      if (req.method === "DELETE") {
        objects.delete(key);
        mtimes.delete(key);
        res.writeHead(204);
        return void res.end();
      }
      if (failStatus && req.method === "PUT") {
        res.writeHead(failStatus, { "content-type": "application/xml" });
        return void res.end(`<Error><Code>${failStatus === 403 ? "AccessDenied" : "InternalError"}</Code></Error>`);
      }
      if (req.method === "PUT") {
        state.puts++;
        objects.set(key, Buffer.concat(chunks));
        mtimes.set(key, new Date());
        res.writeHead(200, { etag: '"fake"' });
        return void res.end();
      }
      if (req.method === "GET" && objects.has(key)) {
        res.writeHead(200, { "content-type": "application/gzip" });
        return void res.end(objects.get(key));
      }
      res.writeHead(404, { "content-type": "application/xml" });
      res.end("<Error><Code>NoSuchKey</Code></Error>");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    objects,
    mtimes,
    failWith: (s) => {
      failStatus = s;
    },
    get puts() {
      return state.puts;
    },
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
