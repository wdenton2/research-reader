import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFeed, plainText, safeLink, toRis } from "../server/feed.js";
import { articleLinks } from "../shared/article-links.js";
import { isPublicAddress, validateRemoteUrl } from "../server/network.js";
import {
  openDatabase,
  addSource,
  importArticles,
  articleById,
} from "../server/db.js";
import { createApp } from "../server/app.js";
import { ukLink, metadataFields, zoteroItem } from "../server/integrations.js";

const feed = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/"><channel><title>Journal</title><item><title>Trial &amp; follow-up</title><link>https://example.org/paper?utm_source=rss</link><description><![CDATA[<p>Purpose: a real abstract.</p><p>Results: details.</p>]]></description><dc:creator>Lee, A</dc:creator><prism:doi>10.1234/example</prism:doi><pubDate>Fri, 23 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
test("RSS preserves abstract, authors, DOI and dates while removing tracking", () => {
  const {
    articles: [a],
  } = parseFeed(feed, "https://example.org/rss");
  assert.equal(a.title, "Trial & follow-up");
  assert.equal(a.abstract, "Purpose: a real abstract.\n\nResults: details.");
  assert.equal(a.doi, "10.1234/example");
  assert.equal(a.url, "https://example.org/paper");
  assert.deepEqual(a.authors, ["Lee, A"]);
  assert.equal(a.published, "2026-10-23T12:00:00.000Z");
});
test("ScienceDirect citation-only description is not mislabeled as an abstract", () => {
  const xml =
    "<rss><channel><title>JVIR</title><item><title>Paper</title><link>https://example.org/paper</link><description><![CDATA[<p>Publication date: December 2026</p><p><b>Source:</b> Journal of Vascular and Interventional Radiology, Volume 37</p><p>Author(s): One Person, Two Person</p>]]></description></item></channel></rss>";
  const a = parseFeed(xml, "https://example.org").articles[0];
  assert.equal(a.abstract, "");
  assert.equal(a.displayDate, "December 2026");
  assert.equal(a.published, null);
  assert.deepEqual(a.authors, ["One Person", "Two Person"]);
  assert.equal(a.journal, "Journal of Vascular and Interventional Radiology");
});
test("Atom chooses the article link, not its enclosure, and strips markup", () => {
  const xml =
    '<feed xmlns="http://www.w3.org/2005/Atom"><title>Feed</title><entry><title>A paper</title><link rel="enclosure" href="https://example.org/file.pdf"/><link rel="alternate" href="https://example.org/paper"/><author><name>Alex Smith</name></author><summary type="html">&lt;p&gt;Abstract&lt;/p&gt;</summary></entry></feed>';
  const a = parseFeed(xml, "https://example.org").articles[0];
  assert.equal(a.url, "https://example.org/paper");
  assert.deepEqual(a.authors, ["Alex Smith"]);
  assert.equal(a.abstract, "Abstract");
});
test("RDF feeds are supported", () => {
  const xml =
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><channel><title>Feed</title></channel><item><title>Paper</title><link>https://example.org/paper</link></item></rdf:RDF>';
  assert.equal(parseFeed(xml, "https://example.org").articles.length, 1);
});
test("malformed XML and entity declarations are rejected", () => {
  assert.throws(
    () => parseFeed("<html>not a feed</html>", "https://example.org"),
    /No RSS/,
  );
  assert.throws(
    () => parseFeed("<rss><channel>", "https://example.org"),
    /valid RSS/,
  );
  assert.throws(
    () =>
      parseFeed(
        '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>',
        "https://example.org",
      ),
    /entity declarations/,
  );
});
test("unsafe article URLs are dropped and script content stripped", () => {
  assert.equal(
    parseFeed(
      "<rss><channel><item><title>Unsafe</title><link>javascript:alert(1)</link></item><item><title>Safe</title><link>https://example.org/paper</link></item></channel></rss>",
      "https://example.org",
    ).articles.length,
    1,
  );
  assert.equal(plainText("<script>secret()</script><p>Visible</p>"), "Visible");
  assert.equal(
    plainText(
      "<p>Results: P &lt; 0.001; confidence &gt; 95%.</p><p>Conclusion: retained.</p>",
    ),
    "Results: P < 0.001; confidence > 95%.\n\nConclusion: retained.",
  );
});
test("SSRF validation blocks private, loopback, metadata, IPv6 mapped and non-web URLs", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "0.0.0.0",
    "100.64.0.1",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress("1.1.1.1"), true);
  await assert.rejects(validateRemoteUrl("file:///etc/passwd"), /HTTP/);
  await assert.rejects(
    validateRemoteUrl("https://example.org:1234/rss"),
    /standard port/,
  );
  await assert.rejects(
    validateRemoteUrl("https://example.org", async () => [
      { address: "192.168.1.5", family: 4 },
    ]),
    /Private/,
  );
});
test("deduplication across sources and repeated refresh preserve every reading state", () => {
  const db = openDatabase(":memory:");
  const s1 = addSource(db, "One", "https://example.org/1"),
    s2 = addSource(db, "Two", "https://example.org/2");
  const articles = parseFeed(feed, s1.url).articles;
  assert.equal(importArticles(db, s1.id, articles), 1);
  const id = db.prepare("SELECT id FROM articles").get().id;
  db.prepare(
    "UPDATE articles SET favorite=1,saved=1,hidden=1,read=1 WHERE id=?",
  ).run(id);
  assert.equal(importArticles(db, s1.id, articles), 0);
  assert.equal(
    importArticles(db, s2.id, [
      { ...articles[0], url: "https://other.example.org/article" },
    ]),
    0,
  );
  const a = articleById(db, id);
  assert.equal(a.favorite, true);
  assert.equal(a.saved, true);
  assert.equal(a.hidden, true);
  assert.equal(a.read, true);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM source_articles").get().n,
    2,
  );
  db.prepare("DELETE FROM sources WHERE id=?").run(s1.id);
  assert.ok(articleById(db, id).saved);
  db.close();
});
test("RIS does not allow metadata to inject records", () => {
  const text = toRis({
    title: "A\nER  - bad",
    authors: ["Person"],
    journal: "Test",
    published: null,
    doi: "10.1/test",
    url: "https://example.org",
    abstract: "Some\ntext",
  });
  assert.ok(text.includes("TI  - A ER  - bad"));
  assert.equal(text.split("\r\n").filter((l) => l === "ER  - ").length, 1);
});
test("UK deep link encodes article URL and Zotero payload saves metadata only", () => {
  assert.equal(
    ukLink("https://example.org/a?b=1&c=2"),
    "https://go.openathens.net/redirector/uky.edu?url=https%3A%2F%2Fexample.org%2Fa%3Fb%3D1%26c%3D2",
  );
  const item = zoteroItem({
    title: "A",
    authors: ["A Person"],
    abstract: "Text",
    journal: "J",
    doi: "10.1/test",
    pmid: "123",
    url: "https://example.org",
    display_date: "December 2026",
  });
  assert.equal(item.itemType, "journalArticle");
  assert.equal(item.creators[0].name, "A Person");
  assert.equal(item.extra, "PMID: 123");
  assert.equal(item.attachments, undefined);
});
test("API adds, refreshes, filters, persists state, exports and reports failed sources", async () => {
  const db = openDatabase(":memory:");
  let fail = false;
  const { app } = createApp(db, {
    fetchFeed: async () => {
      if (fail) throw new Error("Source unavailable");
      return feed;
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function req(path, method = "GET", body) {
    const r = await fetch(base + path, {
      method,
      headers: method === "GET" ? {} : { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
    });
    return { status: r.status, data: await r.json() };
  }
  try {
    const add = await req("/sources", "POST", {
      url: "https://example.org/feed",
      name: "Journal",
    });
    assert.equal(add.status, 201);
    assert.equal(add.data.added, 1);
    assert.equal(
      (await req("/sources", "POST", { url: "https://example.org/feed" }))
        .status,
      409,
    );
    const list = await req("/articles");
    const a = list.data.articles[0];
    await req(`/articles/${a.id}`, "PATCH", { saved: true, favorite: true });
    await req("/refresh", "POST");
    assert.equal((await req("/articles?view=saved")).data.total, 1);
    await req(`/articles/${a.id}`, "PATCH", { hidden: true });
    assert.equal((await req("/articles")).data.total, 0);
    assert.equal((await req("/articles?view=hidden")).data.total, 1);
    fail = true;
    const refresh = await req("/refresh", "POST");
    assert.equal(refresh.data.results[0].error, "Source unavailable");
    assert.equal((await req("/sources")).data[0].error, "Source unavailable");
    const exportData = await req("/export");
    assert.equal(exportData.data.articles[0].saved, true);
    await req(`/sources/${add.data.id}`, "DELETE");
    assert.equal((await req("/articles?view=saved")).data.total, 1);
    assert.equal((await req(`/articles/${a.id}`)).data.favorite, true);
    const crossOrigin = await fetch(base + "/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: "{}",
    });
    assert.equal(crossOrigin.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test("PubMed-shaped feed handles multiple identifiers and escaped abstracts", () => {
  const xml =
    '<rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>PubMed search</title><item><title>A paper</title><link>https://pubmed.ncbi.nlm.nih.gov/12345678/</link><dc:identifier>pubmed:12345678</dc:identifier><dc:identifier>doi:10.1234/abc</dc:identifier><description>&lt;p&gt;An abstract with &amp;amp; symbols.&lt;/p&gt;</description></item></channel></rss>';
  const a = parseFeed(xml, "https://pubmed.ncbi.nlm.nih.gov/rss/search/example")
    .articles[0];
  assert.equal(a.pmid, "12345678");
  assert.equal(a.doi, "10.1234/abc");
  assert.equal(a.abstract, "An abstract with & symbols.");
});
test("opaque RSS GUID is not fabricated into a publisher URL", () => {
  assert.throws(
    () =>
      parseFeed(
        '<rss><channel><item><title>Paper</title><guid isPermaLink="false">abc-123</guid></item></channel></rss>',
        "https://example.org/feed",
      ),
    /none have a readable title and a valid article link/,
  );
});
const pubmedFixture = readFileSync(
  new URL("./fixtures/pubmed.xml", import.meta.url),
  "utf8",
);
test("real PubMed RSS structure preserves duplicate title fields and full abstracts", () => {
  const { articles } = parseFeed(
    pubmedFixture,
    "https://pubmed.ncbi.nlm.nih.gov/rss/search/test",
  );
  assert.equal(articles.length, 2);
  assert.equal(articles[0].title, "Example trial & follow-up");
  assert.equal(articles[0].url, "https://pubmed.ncbi.nlm.nih.gov/12345678/");
  assert.equal(articles[0].journal, "Example Journal");
  assert.deepEqual(articles[0].authors, ["Alex Example", "Jordan Example"]);
  assert.equal(articles[0].pmid, "12345678");
  assert.equal(articles[0].doi, "10.1234/example");
  assert.equal(
    articles[0].abstract,
    "PURPOSE: A synthetic example & follow-up.\n\nRESULTS: Full results beyond the short description.\n\nCONCLUSION: The short summary only.",
  );
  assert.equal(articles[1].abstract, "");
  assert.equal(articles[1].abstractSource, "");
  assert.equal(
    safeLink("https://example.org/paper?a=1&amp;b=2"),
    "https://example.org/paper?a=1&b=2",
  );
});
test("PubMed refresh imports articles once and reports unusable feeds without losing state", async () => {
  const db = openDatabase(":memory:");
  let xml = pubmedFixture;
  const source = addSource(
    db,
    "PubMed",
    "https://pubmed.ncbi.nlm.nih.gov/rss/search/test",
  );
  const { refreshAll } = createApp(db, { fetchFeed: async () => xml });
  try {
    assert.equal((await refreshAll())[0].added, 2);
    const id = db
      .prepare("SELECT id FROM articles WHERE pmid='12345678'")
      .get().id;
    db.prepare(
      "UPDATE articles SET favorite=1,saved=1,hidden=1,read=1 WHERE id=?",
    ).run(id);
    assert.equal((await refreshAll())[0].added, 0);
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM source_articles WHERE source_id=?")
        .get(source.id).n,
      2,
    );
    xml =
      "<rss><channel><item><description>An unrecognized entry</description></item></channel></rss>";
    assert.match((await refreshAll())[0].error, /none have a readable title/);
    assert.match(
      db.prepare("SELECT error FROM sources WHERE id=?").get(source.id).error,
      /none have a readable title/,
    );
    xml = "<rss><channel><title>Empty search</title></channel></rss>";
    assert.equal((await refreshAll())[0].total, 0);
    assert.equal(
      db.prepare("SELECT error FROM sources WHERE id=?").get(source.id).error,
      null,
    );
    const a = articleById(db, id);
    for (const state of ["favorite", "saved", "hidden", "read"])
      assert.equal(a[state], true);
  } finally {
    db.close();
  }
});
test("PubMed publisher and UK links use the DOI; record-only items do not claim publisher access", () => {
  const a = {
    url: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
    doi: "10.1234/example",
  };
  const links = articleLinks(a);
  assert.equal(links.publisher, "https://doi.org/10.1234/example");
  assert.equal(new URL(links.uk).searchParams.get("url"), links.publisher);
  assert.equal(links.pubmed, a.url);
  assert.equal(articleLinks({ ...a, doi: "" }).uk, "");
  assert.equal(articleLinks({ ...a, doi: "" }).publisher, "");
  assert.equal(
    articleLinks({ url: "https://example.org/article", doi: a.doi }).publisher,
    "https://example.org/article",
  );
});
test("session authentication protects the library and sets an HttpOnly cookie", async () => {
  const previous = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = "test-only-password-not-a-real-credential";
  const db = openDatabase(":memory:");
  const { app } = createApp(db);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    assert.equal((await fetch(base + "/articles")).status, 401);
    assert.equal((await fetch(base + "/export")).status, 401);
    assert.equal(
      (await fetch(base + "/settings/zotero/collections")).status,
      401,
    );
    assert.equal(
      (
        await fetch(base + "/settings/zotero", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: "TestOnlyKey12345678901234" }),
        })
      ).status,
      401,
    );
    let r = await fetch(base + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "incorrect" }),
    });
    assert.equal(r.status, 401);
    r = await fetch(base + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: process.env.APP_PASSWORD }),
    });
    assert.equal(r.status, 200);
    const cookie = r.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal(
      (
        await fetch(base + "/articles", {
          headers: { Cookie: cookie.split(";")[0] },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(base + "/articles", {
          headers: { Cookie: "rr_session=9999999999999.invalid" },
        })
      ).status,
      401,
    );
    r = await fetch(base + "/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie.split(";")[0],
      },
      body: "{}",
    });
    assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    if (previous === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = previous;
  }
});
