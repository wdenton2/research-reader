import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDatabase,
  addSource,
  importArticles,
  articleById,
} from "../server/db.js";
import { createZoteroConnection } from "../server/zotero.js";
import { createApp } from "../server/app.js";
import { parseFeed } from "../server/feed.js";

const keyA = "TestKeyForAccountA1234567890";
const keyB = "TestKeyForAccountB1234567890";
const readOnly = "TestKeyWithoutWrite12345678";
const fixture = readFileSync(
  new URL("./fixtures/pubmed.xml", import.meta.url),
  "utf8",
);
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "research-reader-zotero-"));
  const path = join(directory, "reader.sqlite");
  const db = openDatabase(path);
  const source = addSource(db, "Test", "https://example.org/feed");
  importArticles(db, source.id, parseFeed(fixture, source.url).articles);
  const article = articleById(
    db,
    db.prepare("SELECT id FROM articles LIMIT 1").get().id,
  );
  const requests = [];
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), { status });
  const mockFetch = async (url, options) => {
    assert.equal(options.redirect, "error");
    assert.equal(options.headers["Zotero-API-Version"], "3");
    assert.ok(url.startsWith("https://api.zotero.org/"));
    const apiKey = options.headers["Zotero-API-Key"];
    requests.push({ url, method: options.method || "GET", body: options.body });
    if (![keyA, keyB, readOnly].includes(apiKey))
      return json({ error: apiKey }, 403);
    const id = apiKey === keyB ? "456" : "123";
    if (url.endsWith("/keys/current"))
      return json({
        userID: id,
        username: `reader${id}`,
        access: { user: { library: true, write: apiKey !== readOnly } },
      });
    assert.ok(url.includes(`/users/${id}/`));
    if (url.includes("/collections?"))
      return json([
        {
          key: "COLLECT1",
          data: { name: "Research", parentCollection: false },
        },
      ]);
    if (url.endsWith("/collections/COLLECT1"))
      return json({ key: "COLLECT1", data: { name: "Research" } });
    if (url.endsWith("/items"))
      return json({
        successful: { 0: { key: id === "123" ? "ITEMKEY1" : "ITEMKEY2" } },
      });
    return json({}, 404);
  };
  const options = {
    keyFile: join(directory, "connection.key"),
    fetch: mockFetch,
    env: {},
  };
  return {
    db,
    path,
    directory,
    options,
    article,
    requests,
    cleanup() {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
test("Zotero keys are verified, encrypted, persisted and never returned; invalid changes keep the connection", async () => {
  const s = setup();
  try {
    const z = createZoteroConnection(s.db, s.options);
    assert.equal(z.status().configured, false);
    await assert.rejects(z.connect({ apiKey: "bad" }), /valid Zotero API key/);
    await assert.rejects(z.connect({ apiKey: readOnly }), /write access/);
    const status = await z.connect({ apiKey: keyA });
    assert.equal(status.userId, "123");
    assert.equal(status.username, "reader123");
    assert.equal(JSON.stringify(status).includes(keyA), false);
    assert.equal(
      s.db
        .prepare("SELECT value FROM settings WHERE key='zotero.connection'")
        .get()
        .value.includes(keyA),
      false,
    );
    assert.equal(statSync(s.options.keyFile).mode & 0o777, 0o600);
    assert.equal((await z.collections())[0].name, "Research");
    await z.destination({ collectionKey: "COLLECT1" });
    await assert.rejects(
      z.destination({ collectionKey: "INVALID1" }),
      /unavailable/,
    );
    await assert.rejects(
      z.connect({ apiKey: "RevokedKey12345678901234" }),
      /rejected/,
    );
    assert.equal(z.status().collectionKey, "COLLECT1");
    assert.equal(z.status().userId, "123");
    assert.ok(
      s.requests.every((r) => r.method === "GET"),
      "Verification never writes to the library",
    );
    const reopened = openDatabase(s.path);
    try {
      const restored = createZoteroConnection(reopened, s.options);
      assert.equal((await restored.verify()).userId, "123");
      assert.equal(restored.status().collectionName, "Research");
      const unavailableKey = createZoteroConnection(reopened, {
        ...s.options,
        keyFile: join(s.directory, "missing.key"),
      });
      await assert.rejects(
        unavailableKey.verify(),
        /saved connection key is unavailable/,
      );
    } finally {
      reopened.close();
    }
  } finally {
    s.cleanup();
  }
});
test("Zotero saves use the selected collection and track duplicates separately for each account", async () => {
  const s = setup();
  try {
    const z = createZoteroConnection(s.db, s.options);
    await z.connect({ apiKey: keyA });
    await z.destination({ collectionKey: "COLLECT1" });
    assert.equal((await z.save(s.article)).key, "ITEMKEY1");
    assert.equal((await z.save(s.article)).alreadySaved, true);
    const first = s.requests.find((r) => r.method === "POST");
    assert.deepEqual(JSON.parse(first.body)[0].collections, ["COLLECT1"]);
    await z.connect({ apiKey: keyB });
    assert.equal(z.savedKey(s.article.id), null);
    assert.equal(z.status().collectionKey, "");
    assert.equal((await z.save(s.article)).key, "ITEMKEY2");
    await z.connect({ apiKey: keyA });
    assert.equal(z.savedKey(s.article.id), "ITEMKEY1");
    assert.equal((await z.save(s.article)).alreadySaved, true);
    assert.equal(s.requests.filter((r) => r.method === "POST").length, 2);
    z.disconnect();
    assert.equal(z.status().configured, false);
    assert.equal(
      s.db
        .prepare("SELECT value FROM settings WHERE key='zotero.connection'")
        .get().value,
      '{"enabled":false}',
    );
    await assert.rejects(z.save(s.article), /Connect Zotero/);
    assert.equal(
      s.db.prepare("SELECT count(*) AS n FROM zotero_saves").get().n,
      2,
    );
  } finally {
    s.cleanup();
  }
});
test("environment credentials remain supported, legacy saves migrate, and disconnect persists over restart", async () => {
  const s = setup();
  try {
    s.db
      .prepare("UPDATE articles SET zotero_key='LEGACY01' WHERE id=?")
      .run(s.article.id);
    const options = {
      ...s.options,
      env: { ZOTERO_API_KEY: keyA, ZOTERO_USER_ID: "123" },
    };
    const z = createZoteroConnection(s.db, options);
    assert.equal(z.status().source, "environment");
    assert.equal(z.savedKey(s.article.id), "LEGACY01");
    assert.equal((await z.save(s.article)).alreadySaved, true);
    assert.equal((await z.verify()).userId, "123");
    z.disconnect();
    assert.equal(
      createZoteroConnection(s.db, options).status().configured,
      false,
    );
  } finally {
    s.cleanup();
  }
});
test("collection enumeration includes every page", async () => {
  const s = setup();
  try {
    const calls = [];
    const z = createZoteroConnection(s.db, {
      ...s.options,
      env: { ZOTERO_API_KEY: keyA, ZOTERO_USER_ID: "123" },
      fetch: async (url) => {
        calls.push(url);
        const start = Number(new URL(url).searchParams.get("start"));
        return new Response(
          JSON.stringify(
            Array.from({ length: start === 0 ? 100 : 1 }, (_, i) => ({
              key: `COL${String(start + i).padStart(5, "0")}`,
              data: { name: `Collection ${start + i}` },
            })),
          ),
        );
      },
    });
    assert.equal((await z.collections()).length, 101);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].endsWith("start=100"));
  } finally {
    s.cleanup();
  }
});
test("failed and concurrent Zotero writes never mark an unsaved citation as saved", async () => {
  const s = setup();
  try {
    let release;
    let writes = 0;
    const z = createZoteroConnection(s.db, {
      ...s.options,
      fetch: async (url, options) => {
        if (options.method !== "POST") return s.options.fetch(url, options);
        writes++;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    await z.connect({ apiKey: keyA });
    const saving = z.save(s.article);
    await assert.rejects(z.save(s.article), /already being sent/);
    assert.equal(writes, 1);
    release(new Response("{}", { status: 403 }));
    await assert.rejects(saving, /HTTP 403/);
    assert.equal(z.savedKey(s.article.id), null);
    const retry = z.save(s.article);
    release(
      new Response(JSON.stringify({ successful: { 0: { key: "ITEMKEY1" } } })),
    );
    assert.equal((await retry).key, "ITEMKEY1");
  } finally {
    s.cleanup();
  }
});
test("settings API verifies keys without exposing secrets in settings, exports or failures", async () => {
  const s = setup();
  const { app } = createApp(s.db, { zotero: s.options });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function req(path, method = "GET", body, origin) {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
      },
      ...(method !== "GET" ? { body: JSON.stringify(body || {}) } : {}),
    });
    return { status: r.status, data: await r.json() };
  }
  try {
    assert.equal(
      (
        await req(
          "/settings/zotero",
          "PUT",
          { apiKey: keyA },
          "https://evil.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (await req("/settings/zotero", "PUT", { apiKey: keyA })).status,
      200,
    );
    for (const path of [
      "/settings",
      "/export",
      "/settings/zotero/collections",
    ]) {
      const result = await req(path);
      assert.equal(result.status, 200);
      assert.equal(JSON.stringify(result).includes(keyA), false);
      assert.equal(JSON.stringify(result).includes("ciphertext"), false);
    }
    assert.equal((await req("/settings")).data.zoteroConfigured, true);
    const send = await req(`/articles/${s.article.id}/zotero`, "POST");
    assert.equal(send.data.key, "ITEMKEY1");
    assert.equal(
      (await req(`/articles/${s.article.id}`)).data.zotero_key,
      "ITEMKEY1",
    );
    await req("/settings/zotero", "PUT", { apiKey: keyB });
    assert.equal(
      (await req(`/articles/${s.article.id}`)).data.zotero_key,
      null,
    );
    await req("/settings/zotero", "DELETE");
    assert.equal((await req("/settings")).data.zoteroConfigured, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    s.cleanup();
  }
});
