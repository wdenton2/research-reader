import { resolve } from "node:path";
import { secretStore } from "./secrets.js";
import { saveToZotero } from "./integrations.js";

const settingKey = "zotero.connection";
export function createZoteroConnection(db, options = {}) {
  const env = options.env || process.env;
  const request = options.fetch || fetch;
  const vault = secretStore(
    options.keyFile || resolve(env.DATA_DIR || "data", "connection.key"),
  );
  const pending = new Set();
  const getSetting = () =>
    db.prepare("SELECT value FROM settings WHERE key=?").get(settingKey);
  const persist = (config) =>
    db
      .prepare(
        "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(settingKey, JSON.stringify(config));
  function stored() {
    const row = getSetting();
    if (row) return { ...JSON.parse(row.value), source: "app" };
    return env.ZOTERO_API_KEY && /^\d+$/.test(env.ZOTERO_USER_ID || "")
      ? {
          enabled: true,
          userId: env.ZOTERO_USER_ID,
          username: "",
          collectionKey: env.ZOTERO_COLLECTION_KEY || "",
          source: "environment",
        }
      : { enabled: false, source: "none" };
  }
  function credentials() {
    const config = stored();
    if (!config.enabled)
      throw new Error("Connect Zotero in Settings to save citations directly.");
    return {
      ...config,
      apiKey:
        config.source === "environment"
          ? env.ZOTERO_API_KEY
          : vault.decrypt(config.secret),
    };
  }
  function status() {
    const c = stored();
    return {
      configured: !!c.enabled,
      source: c.source,
      userId: c.enabled ? c.userId : "",
      username: c.enabled ? c.username || "" : "",
      collectionKey: c.enabled ? c.collectionKey || "" : "",
      collectionName: c.enabled ? c.collectionName || "" : "",
      verifiedAt: c.enabled ? c.verifiedAt || null : null,
    };
  }
  async function get(path, apiKey) {
    let response;
    try {
      response = await request(`https://api.zotero.org${path}`, {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Zotero-API-Key": apiKey,
          "Zotero-API-Version": "3",
          Accept: "application/json",
        },
      });
    } catch {
      throw new Error(
        "Zotero could not be reached. Try again; your existing connection has not changed.",
      );
    }
    if ([401, 403].includes(response.status))
      throw new Error(
        "Zotero rejected this key. Check that it has personal-library read and write access.",
      );
    if (response.status === 404)
      throw new Error("That Zotero collection is unavailable in this account.");
    if (response.status === 429)
      throw new Error("Zotero is limiting requests. Please try again later.");
    if (!response.ok)
      throw new Error(
        `Zotero returned HTTP ${response.status}. Please try again later.`,
      );
    try {
      return await response.json();
    } catch {
      throw new Error(
        "Zotero returned an unreadable response. Please try again.",
      );
    }
  }
  async function identify(apiKey) {
    const info = await get("/keys/current", apiKey);
    if (
      !/^\d+$/.test(String(info.userID || "")) ||
      info.access?.user?.library !== true ||
      info.access?.user?.write !== true
    )
      throw new Error(
        "This key needs both personal-library access and write access. Group-only keys are not supported.",
      );
    return {
      userId: String(info.userID),
      username: String(info.username || "").slice(0, 100),
      verifiedAt: new Date().toISOString(),
    };
  }
  // Preserve the earlier environment-only connector's duplicate protection.
  if (
    /^\d+$/.test(env.ZOTERO_USER_ID || "") &&
    !db
      .prepare("SELECT value FROM settings WHERE key='zotero.legacy-migrated'")
      .get()
  ) {
    db.prepare(
      "INSERT OR IGNORE INTO zotero_saves(article_id,user_id,item_key,created) SELECT id,?,zotero_key,? FROM articles WHERE zotero_key IS NOT NULL",
    ).run(env.ZOTERO_USER_ID, new Date().toISOString());
    db.prepare(
      "INSERT INTO settings(key,value) VALUES('zotero.legacy-migrated','1')",
    ).run();
  }
  function saveConfig(config) {
    const { apiKey, source, ...publicFields } = config;
    persist({ ...publicFields, enabled: true, secret: vault.encrypt(apiKey) });
    return status();
  }
  return {
    status,
    savedKey(articleId) {
      const c = status();
      return c.configured
        ? db
            .prepare(
              "SELECT item_key FROM zotero_saves WHERE article_id=? AND user_id=?",
            )
            .get(articleId, c.userId)?.item_key || null
        : null;
    },
    async connect(input) {
      const apiKey =
        typeof input.apiKey === "string" ? input.apiKey.trim() : "";
      if (!/^[A-Za-z0-9]{16,128}$/.test(apiKey))
        throw new Error("Enter a valid Zotero API key.");
      const identity = await identify(apiKey);
      const previous = stored();
      return saveConfig({
        apiKey,
        ...identity,
        collectionKey:
          previous.userId === identity.userId
            ? previous.collectionKey || ""
            : "",
        collectionName:
          previous.userId === identity.userId
            ? previous.collectionName || ""
            : "",
      });
    },
    async verify() {
      const c = credentials();
      const identity = await identify(c.apiKey);
      if (identity.userId !== c.userId)
        throw new Error(
          "The key belongs to a different Zotero account. Reconnect with the correct key.",
        );
      if (c.source === "app") return saveConfig({ ...c, ...identity });
      return { ...status(), ...identity };
    },
    async collections() {
      const c = credentials();
      const collections = [];
      for (let start = 0; start < 5000; start += 100) {
        const page = await get(
          `/users/${c.userId}/collections?format=json&limit=100&start=${start}`,
          c.apiKey,
        );
        if (!Array.isArray(page))
          throw new Error("Zotero returned an unreadable collection list.");
        for (const x of page)
          if (/^[A-Z0-9]{8}$/.test(x.key || ""))
            collections.push({
              key: x.key,
              name: String(x.data?.name || x.key),
              parent: x.data?.parentCollection || null,
            });
        if (page.length < 100)
          return collections.sort((a, b) => a.name.localeCompare(b.name));
      }
      throw new Error(
        "This library has too many collections to list. Saving to My Library is still available.",
      );
    },
    async destination(input) {
      const c = credentials();
      const collectionKey =
        typeof input.collectionKey === "string"
          ? input.collectionKey.trim()
          : "";
      if (collectionKey && !/^[A-Z0-9]{8}$/.test(collectionKey))
        throw new Error("Choose a valid Zotero collection.");
      const collection = collectionKey
        ? await get(`/users/${c.userId}/collections/${collectionKey}`, c.apiKey)
        : null;
      if (collection && collection.key !== collectionKey)
        throw new Error("Zotero did not confirm the chosen collection.");
      return saveConfig({
        ...c,
        collectionKey,
        collectionName: collection
          ? String(collection.data?.name || collectionKey)
          : "",
      });
    },
    disconnect() {
      // A disabled record prevents environment credentials from silently reconnecting.
      persist({ enabled: false });
      return status();
    },
    async save(article) {
      const c = credentials();
      const existing = db
        .prepare(
          "SELECT item_key FROM zotero_saves WHERE article_id=? AND user_id=?",
        )
        .get(article.id, c.userId);
      if (existing) return { key: existing.item_key, alreadySaved: true };
      const token = `${c.userId}:${article.id}`;
      if (pending.has(token))
        throw new Error("This citation is already being sent to Zotero.");
      pending.add(token);
      try {
        const key = await saveToZotero(article, c, request);
        db.prepare(
          "INSERT INTO zotero_saves(article_id,user_id,item_key,created) VALUES(?,?,?,?)",
        ).run(article.id, c.userId, key, new Date().toISOString());
        return { key };
      } finally {
        pending.delete(token);
      }
    },
  };
}
