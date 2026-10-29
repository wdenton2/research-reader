import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { articleKey } from "./feed.js";

export function openDatabase(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, last_checked TEXT, last_success TEXT, error TEXT, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS articles(id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, doi TEXT NOT NULL DEFAULT '', pmid TEXT NOT NULL DEFAULT '', authors TEXT NOT NULL, abstract TEXT NOT NULL DEFAULT '', abstract_source TEXT NOT NULL DEFAULT '', journal TEXT NOT NULL DEFAULT '', published TEXT, display_date TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', first_seen TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, saved INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, read INTEGER NOT NULL DEFAULT 0, oa TEXT, oa_checked TEXT, zotero_key TEXT);
    CREATE INDEX IF NOT EXISTS articles_doi ON articles(doi);
    CREATE INDEX IF NOT EXISTS articles_pmid ON articles(pmid);
    CREATE INDEX IF NOT EXISTS articles_url ON articles(url);
    CREATE TABLE IF NOT EXISTS source_articles(source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE, position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(source_id, article_id));
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS zotero_saves(article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE, user_id TEXT NOT NULL, item_key TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(article_id,user_id));
  `);
  return db;
}
export function addSource(db, name, url) {
  const source = {
    id: randomUUID(),
    name,
    url,
    created: new Date().toISOString(),
  };
  db.prepare("INSERT INTO sources(id,name,url,created) VALUES(?,?,?,?)").run(
    source.id,
    name,
    url,
    source.created,
  );
  return source;
}
export function seed(db) {
  if (db.prepare("SELECT value FROM settings WHERE key='initialized'").get())
    return;
  addSource(
    db,
    "JVIR",
    "https://rss.sciencedirect.com/publication/science/10510443",
  );
  db.prepare("INSERT INTO settings(key,value) VALUES('initialized','1')").run();
}
export function importArticles(db, sourceId, articles) {
  const now = new Date().toISOString();
  let added = 0;
  db.exec("BEGIN");
  try {
    for (const [index, a] of articles.entries()) {
      const existing = db
        .prepare(
          "SELECT * FROM articles WHERE (? != '' AND lower(doi)=lower(?)) OR (? != '' AND pmid=?) OR url=? LIMIT 1",
        )
        .get(a.doi, a.doi, a.pmid, a.pmid, a.url);
      const id = existing?.id || articleKey(a);
      if (!existing) {
        db.prepare(
          "INSERT INTO articles(id,title,url,doi,pmid,authors,abstract,abstract_source,journal,published,display_date,summary,first_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          id,
          a.title,
          a.url,
          a.doi,
          a.pmid,
          JSON.stringify(a.authors),
          a.abstract,
          a.abstractSource,
          a.journal,
          a.published,
          a.displayDate,
          a.summary,
          now,
        );
        added++;
      } else {
        db.prepare(
          "UPDATE articles SET title=?, doi=CASE WHEN doi='' THEN ? ELSE doi END, pmid=CASE WHEN pmid='' THEN ? ELSE pmid END, abstract=CASE WHEN abstract='' THEN ? ELSE abstract END, abstract_source=CASE WHEN abstract='' THEN ? ELSE abstract_source END WHERE id=?",
        ).run(a.title, a.doi, a.pmid, a.abstract, a.abstractSource, id);
      }
      db.prepare(
        "INSERT INTO source_articles(source_id,article_id,position) VALUES(?,?,?) ON CONFLICT(source_id,article_id) DO UPDATE SET position=excluded.position",
      ).run(sourceId, id, index);
    }
    db.exec("COMMIT");
    return added;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function serializeArticle(a) {
  if (!a) return null;
  return {
    ...a,
    authors: JSON.parse(a.authors),
    favorite: !!a.favorite,
    saved: !!a.saved,
    hidden: !!a.hidden,
    read: !!a.read,
    oa: a.oa ? JSON.parse(a.oa) : null,
  };
}
export function articleById(db, id) {
  return serializeArticle(
    db.prepare("SELECT * FROM articles WHERE id=?").get(id),
  );
}
