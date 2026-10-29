import express from "express";
import {
  addSource,
  articleById,
  importArticles,
  serializeArticle,
} from "./db.js";
import { parseFeed, toRis } from "./feed.js";
import { fetchText } from "./network.js";
import {
  findMetadata,
  metadataFields,
  findOpenAccess,
} from "./integrations.js";
import { articleLinks } from "../shared/article-links.js";
import { createZoteroConnection } from "./zotero.js";
import { installAuth } from "./auth.js";

export function createApp(db, options = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
    });
    next();
  });
  if (!process.env.APP_PASSWORD && process.env.TRUST_PROXY_AUTH !== "true")
    app.use((req, res, next) => {
      const hostname = req.hostname;
      if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(hostname))
        return res.status(403).json({
          error:
            "Local preview accepts localhost requests only. Configure authentication before network access.",
        });
      next();
    });
  installAuth(app);
  const zotero = createZoteroConnection(db, options.zotero);
  const decorate = (article) =>
    article ? { ...article, zotero_key: zotero.savedKey(article.id) } : null;
  const getArticle = (id) => decorate(articleById(db, id));
  let refreshing = null;
  const fetchFeed = options.fetchFeed || fetchText;
  async function refreshSource(source) {
    const checked = new Date().toISOString();
    try {
      const feed = parseFeed(await fetchFeed(source.url), source.url);
      const added = importArticles(db, source.id, feed.articles);
      db.prepare(
        "UPDATE sources SET last_checked=?,last_success=?,error=NULL WHERE id=?",
      ).run(checked, checked, source.id);
      return { source: source.name, added, total: feed.articles.length };
    } catch (e) {
      db.prepare("UPDATE sources SET last_checked=?,error=? WHERE id=?").run(
        checked,
        String(e.message).slice(0, 500),
        source.id,
      );
      return { source: source.name, error: String(e.message).slice(0, 500) };
    }
  }
  async function refreshAll() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const results = [];
      for (const source of db
        .prepare("SELECT * FROM sources WHERE enabled=1")
        .all())
        results.push(await refreshSource(source));
      return results;
    })();
    try {
      return await refreshing;
    } finally {
      refreshing = null;
    }
  }
  app.get("/api/sources", (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT s.*, (SELECT count(*) FROM source_articles WHERE source_id=s.id) AS article_count FROM sources s ORDER BY created",
        )
        .all(),
    ),
  );
  app.post("/api/sources", async (req, res) => {
    const url = String(req.body.url || "").trim();
    const name = String(req.body.name || "")
      .trim()
      .slice(0, 100);
    if (url.length > 4096)
      return res.status(400).json({ error: "The feed URL is too long." });
    if (db.prepare("SELECT id FROM sources WHERE url=?").get(url))
      return res.status(409).json({ error: "You already follow this feed." });
    if (db.prepare("SELECT count(*) AS n FROM sources").get().n >= 100)
      return res
        .status(400)
        .json({ error: "This reader supports up to 100 sources." });
    const feed = parseFeed(await fetchFeed(url), url);
    const source = addSource(
      db,
      name || feed.title.slice(0, 100) || "New feed",
      url,
    );
    const added = importArticles(db, source.id, feed.articles);
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE sources SET last_checked=?,last_success=? WHERE id=?",
    ).run(now, now, source.id);
    res.status(201).json({ ...source, added });
  });
  app.patch("/api/sources/:id", (req, res) => {
    const source = db
      .prepare("SELECT * FROM sources WHERE id=?")
      .get(req.params.id);
    if (!source) return res.status(404).json({ error: "Source not found." });
    const name =
      typeof req.body.name === "string"
        ? req.body.name.trim().slice(0, 100)
        : source.name;
    if (!name)
      return res.status(400).json({ error: "A source name is required." });
    const enabled =
      typeof req.body.enabled === "boolean"
        ? Number(req.body.enabled)
        : source.enabled;
    db.prepare("UPDATE sources SET name=?,enabled=? WHERE id=?").run(
      name,
      enabled,
      source.id,
    );
    res.json({ ok: true });
  });
  app.delete("/api/sources/:id", (req, res) => {
    db.prepare("DELETE FROM sources WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });
  app.post("/api/refresh", async (_req, res) =>
    res.json({ results: await refreshAll() }),
  );
  app.get("/api/articles", (req, res) => {
    const view = String(req.query.view || "latest");
    const q = String(req.query.q || "").slice(0, 200);
    const source = String(req.query.source || "");
    const offset = Math.max(
      0,
      Math.min(100000, parseInt(req.query.offset) || 0),
    );
    const limit = 30;
    const clauses = [];
    const args = [];
    if (["favorite", "saved", "hidden"].includes(view))
      clauses.push(`a.${view}=1`);
    else {
      clauses.push("a.hidden=0");
      clauses.push(
        "EXISTS(SELECT 1 FROM source_articles sa WHERE sa.article_id=a.id)",
      );
      if (view === "unread") clauses.push("a.read=0");
    }
    if (source) {
      clauses.push(
        "EXISTS(SELECT 1 FROM source_articles sa WHERE sa.article_id=a.id AND sa.source_id=?)",
      );
      args.push(source);
    }
    if (q) {
      clauses.push("(a.title LIKE ? OR a.abstract LIKE ? OR a.authors LIKE ?)");
      args.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const where = clauses.join(" AND ");
    const total = db
      .prepare(`SELECT count(*) AS n FROM articles a WHERE ${where}`)
      .get(...args).n;
    const rows = db
      .prepare(
        `SELECT a.*, (SELECT group_concat(s.name, ' · ') FROM sources s JOIN source_articles sa ON sa.source_id=s.id WHERE sa.article_id=a.id) AS sources FROM articles a WHERE ${where} ORDER BY coalesce(a.published,a.first_seen) DESC, (SELECT min(position) FROM source_articles WHERE article_id=a.id) ASC, a.id LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset);
    res.json({
      articles: rows.map((row) => decorate(serializeArticle(row))),
      total,
      hasMore: offset + limit < total,
    });
  });
  app.get("/api/stats", (_req, res) =>
    res.json(
      db
        .prepare(
          `SELECT count(*) AS total, coalesce(sum(favorite),0) AS favorite, coalesce(sum(saved),0) AS saved, coalesce(sum(hidden),0) AS hidden, coalesce(sum(CASE WHEN read=0 AND hidden=0 AND EXISTS(SELECT 1 FROM source_articles sa WHERE sa.article_id=articles.id) THEN 1 ELSE 0 END),0) AS unread FROM articles`,
        )
        .get(),
    ),
  );
  app.get("/api/articles/:id", (req, res) => {
    const article = getArticle(req.params.id);
    article
      ? res.json(article)
      : res.status(404).json({ error: "Article not found." });
  });
  app.patch("/api/articles/:id", (req, res) => {
    if (!getArticle(req.params.id))
      return res.status(404).json({ error: "Article not found." });
    const fields = ["favorite", "saved", "hidden", "read"].filter(
      (k) => typeof req.body[k] === "boolean",
    );
    if (!fields.length)
      return res.status(400).json({ error: "Choose an article action." });
    db.prepare(
      `UPDATE articles SET ${fields.map((k) => `${k}=?`).join(",")} WHERE id=?`,
    ).run(...fields.map((k) => Number(req.body[k])), req.params.id);
    res.json(getArticle(req.params.id));
  });
  app.get("/api/articles/:id/ris", (req, res) => {
    const a = getArticle(req.params.id);
    if (!a) return res.status(404).json({ error: "Article not found." });
    res
      .set({
        "Content-Type": "application/x-research-info-systems; charset=utf-8",
        "Content-Disposition": `attachment; filename="research-reader-${a.id}.ris"`,
      })
      .send(toRis(a));
  });
  app.post("/api/articles/:id/metadata", async (req, res) => {
    const a = getArticle(req.params.id);
    if (!a) return res.status(404).json({ error: "Article not found." });
    const match = await findMetadata(a);
    if (!match)
      return res.json({
        article: a,
        message:
          "No exact match found in Europe PMC / PubMed yet. Newly published papers can take time to be indexed.",
      });
    const m = metadataFields(match, a);
    db.prepare(
      "UPDATE articles SET doi=?,pmid=?,abstract=?,abstract_source=?,authors=?,journal=? WHERE id=?",
    ).run(
      m.doi,
      m.pmid,
      m.abstract,
      m.abstractSource,
      JSON.stringify(m.authors),
      m.journal,
      a.id,
    );
    res.json({
      article: getArticle(a.id),
      message: m.abstract
        ? "Article metadata updated."
        : "Matched the article, but no abstract is available in the record.",
    });
  });
  app.post("/api/articles/:id/access", async (req, res) => {
    let a = getArticle(req.params.id);
    if (!a) return res.status(404).json({ error: "Article not found." });
    if (!a.doi && !a.pmid) {
      try {
        const match = await findMetadata(a);
        if (match) {
          const m = metadataFields(match, a);
          db.prepare(
            "UPDATE articles SET doi=?,pmid=?,abstract=?,abstract_source=?,authors=?,journal=? WHERE id=?",
          ).run(
            m.doi,
            m.pmid,
            m.abstract,
            m.abstractSource,
            JSON.stringify(m.authors),
            m.journal,
            a.id,
          );
          a = getArticle(a.id);
        }
      } catch {
        /* Other full-text options remain available. */
      }
    }
    let oa = a.oa;
    if (
      !oa ||
      ["error", "unavailable"].includes(oa.status) ||
      !a.oa_checked ||
      Date.now() - Date.parse(a.oa_checked) > 86400000
    ) {
      oa = await findOpenAccess(a);
      db.prepare("UPDATE articles SET oa=?,oa_checked=? WHERE id=?").run(
        JSON.stringify(oa),
        new Date().toISOString(),
        a.id,
      );
    }
    res.json({
      oa,
      ...articleLinks(a),
      libkey:
        a.doi || a.pmid
          ? `https://libkey.io/${encodeURIComponent(a.doi || a.pmid)}`
          : null,
      article: getArticle(a.id),
    });
  });
  app.post("/api/articles/:id/zotero", async (req, res) => {
    const a = getArticle(req.params.id);
    if (!a) return res.status(404).json({ error: "Article not found." });
    res.json(await zotero.save(a));
  });
  // Serialize settings changes, so a late verification cannot undo a disconnect.
  let configuringZotero = false;
  const updateZotero = (action) => async (req, res) => {
    if (configuringZotero)
      return res
        .status(409)
        .json({ error: "A Zotero connection change is already in progress." });
    configuringZotero = true;
    try {
      res.json(await action(req.body));
    } finally {
      configuringZotero = false;
    }
  };
  app.put(
    "/api/settings/zotero",
    updateZotero((body) => zotero.connect(body)),
  );
  app.post(
    "/api/settings/zotero/verify",
    updateZotero(() => zotero.verify()),
  );
  app.patch(
    "/api/settings/zotero",
    updateZotero((body) => zotero.destination(body)),
  );
  app.delete(
    "/api/settings/zotero",
    updateZotero(() => zotero.disconnect()),
  );
  app.get("/api/settings/zotero/collections", async (_req, res) =>
    res.json({ collections: await zotero.collections() }),
  );
  app.get("/api/settings", (_req, res) =>
    res.json({
      institution: "University of Kentucky",
      unpaywallConfigured: !!process.env.UNPAYWALL_EMAIL,
      zoteroConfigured: zotero.status().configured,
      zotero: zotero.status(),
      authConfigured: !!(
        process.env.APP_PASSWORD || process.env.TRUST_PROXY_AUTH === "true"
      ),
      refreshMinutes: Math.max(15, Number(process.env.REFRESH_MINUTES) || 60),
    }),
  );
  app.get("/api/export", (_req, res) => {
    res
      .set(
        "Content-Disposition",
        'attachment; filename="research-reader-backup.json"',
      )
      .json({
        version: 1,
        exported: new Date().toISOString(),
        sources: db.prepare("SELECT * FROM sources").all(),
        articles: db
          .prepare("SELECT * FROM articles")
          .all()
          .map(serializeArticle),
        sourceArticles: db.prepare("SELECT * FROM source_articles").all(),
        zoteroSaves: db.prepare("SELECT * FROM zotero_saves").all(),
      });
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  app.use((err, _req, res, _next) => {
    console.error(err.message);
    res.status(err.status || 400).json({
      error:
        err.type === "entity.parse.failed"
          ? "Invalid JSON request."
          : String(err.message).slice(0, 500),
    });
  });
  return { app, refreshAll };
}
