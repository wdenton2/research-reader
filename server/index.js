import express from "express";
import { resolve } from "node:path";
import { openDatabase, seed } from "./db.js";
import { createApp } from "./app.js";
const production = process.env.NODE_ENV === "production";
const host = process.env.HOST || "127.0.0.1";
if (
  (production || !["127.0.0.1", "localhost", "::1"].includes(host)) &&
  !process.env.APP_PASSWORD &&
  process.env.TRUST_PROXY_AUTH !== "true"
)
  throw new Error(
    "Set APP_PASSWORD before serving over the network, or TRUST_PROXY_AUTH=true behind an authenticated reverse proxy.",
  );
const db = openDatabase(
  resolve(process.env.DATA_DIR || "data", "reader.sqlite"),
);
seed(db);
const { app, refreshAll } = createApp(db);
let vite;
if (production) {
  app.use(express.static("dist"));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT) || 4173;
const server = app.listen(port, host, () => {
  console.log(`Research Reader is ready at http://${host}:${port}`);
  if (process.env.AUTO_REFRESH !== "false")
    refreshAll().then((r) =>
      console.log(
        `Feed refresh: ${r.map((x) => (x.error ? `${x.source}: ${x.error}` : `${x.source}: ${x.total} articles`)).join("; ")}`,
      ),
    );
});
const interval = setInterval(
  () => {
    if (process.env.AUTO_REFRESH !== "false") refreshAll().catch(console.error);
  },
  Math.max(15, Number(process.env.REFRESH_MINUTES) || 60) * 60000,
);
interval.unref();
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(interval);
  await vite?.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
