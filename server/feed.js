import { XMLParser, XMLValidator } from "fast-xml-parser";
import he from "he";
import { createHash } from "node:crypto";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  processEntities: false,
});
const array = (value) =>
  value == null ? [] : Array.isArray(value) ? value : [value];
// Namespace aliases (e.g. title and dc:title) can collapse to an array.
// A scalar field uses the first nonempty value, not a comma-joined duplicate.
const value = (node) => {
  if (Array.isArray(node)) return node.map(value).find((v) => v.trim()) || "";
  if (typeof node === "object" && node !== null) return value(node["#text"]);
  return String(node ?? "");
};
export function plainText(input) {
  return he
    .decode(
      he
        .decode(value(input))
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
        .replace(/<\/(p|div|section|h[1-6])\s*>|<br\s*\/?\s*>/gi, "\n\n")
        .replace(/<\/?[a-z][^>]*>|<!--[\s\S]*?-->/gi, ""),
    )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
}
export function safeLink(input, base) {
  if (!value(input).trim()) return "";
  try {
    const u = new URL(he.decode(value(input)), base);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : "";
  } catch {
    return "";
  }
}
export function canonicalUrl(input) {
  const link = safeLink(input);
  if (!link) return "";
  const u = new URL(link);
  u.hash = "";
  if (
    u.hostname === "pubmed.ncbi.nlm.nih.gov" &&
    /^\/\d+\/?$/.test(u.pathname)
  ) {
    return `https://pubmed.ncbi.nlm.nih.gov/${u.pathname.split("/")[1]}/`;
  }
  for (const k of [...u.searchParams.keys()])
    if (k.startsWith("utm_") || ["dgcid", "via", "campaign"].includes(k))
      u.searchParams.delete(k);
  return u.href;
}
export function extractDoi(input) {
  return (
    value(input)
      .match(/10\.\d{4,9}\/[^\s<>"?#]+/i)?.[0]
      ?.replace(/[.,;]+$/, "")
      .toLowerCase() || ""
  );
}
export function articleKey(a) {
  return createHash("sha256")
    .update(
      a.doi ? `doi:${a.doi}` : a.pmid ? `pmid:${a.pmid}` : canonicalUrl(a.url),
    )
    .digest("hex")
    .slice(0, 24);
}
export function normalizeTitle(title) {
  return plainText(title)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
function pubmedAbstract(text) {
  // PubMed wraps the abstract with a citation, heading, and identifier footer.
  if (/(?:^|\n)\s*NO ABSTRACT\s*(?:\n|$)/i.test(text)) return "";
  const heading = /(?:^|\n)\s*ABSTRACT\s*(?:\n|$)/i.exec(text);
  const body = heading ? text.slice(heading.index + heading[0].length) : text;
  return body.replace(/(?:^|\n)\s*PMID:\s*\d+[\s\S]*$/, "").trim();
}
export function parseFeed(xml, sourceUrl) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error(
      "Feeds with document types or entity declarations are not supported.",
    );
  if (XMLValidator.validate(xml) !== true)
    throw new Error("This URL did not return valid RSS or Atom XML.");
  const doc = parser.parse(xml);
  const channel = doc.rss?.channel || doc.RDF?.channel || doc.feed;
  if (!channel)
    throw new Error(
      "No RSS or Atom feed was found. Paste the feed URL, not the journal homepage.",
    );
  const entries = array(
    doc.rss?.channel?.item || doc.RDF?.item || doc.feed?.entry,
  ).slice(0, 200);
  const articles = entries
    .map((item) => {
      const links = array(item.link);
      const link =
        links.find((l) => typeof l === "string") ||
        links.find((l) => !l["@rel"] || l["@rel"] === "alternate");
      const url =
        safeLink(typeof link === "object" ? link["@href"] : link, sourceUrl) ||
        safeLink(item.guid);
      const title = plainText(item.title);
      const rawSummary = plainText(
        item.abstract ||
          item.encoded ||
          item.description ||
          item.summary ||
          item.content,
      );
      const metadataOnly =
        /^Publication date:/i.test(rawSummary) &&
        !/\bAbstract\b/i.test(rawSummary);
      const authors = array(item.author || item.creator)
        .map((a) => plainText(a?.name || a))
        .filter(Boolean);
      if (!authors.length) {
        const match = rawSummary.match(/Author\(s\):\s*([^\n]+)/i);
        if (match) authors.push(...match[1].split(/,\s*/));
      }
      const doi = extractDoi(
        [...array(item.doi), ...array(item.identifier), url]
          .map(value)
          .join(" "),
      );
      const pmid =
        value(item.pmid) ||
        url.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/)?.[1] ||
        array(item.identifier)
          .map(value)
          .join(" ")
          .match(/(?:pmid|pubmed):\s*(\d+)/i)?.[1] ||
        "";
      const rawDate = value(
        item.pubDate || item.published || item.date || item.updated,
      );
      const published =
        rawDate && !Number.isNaN(Date.parse(rawDate))
          ? new Date(rawDate).toISOString()
          : null;
      const issueDate =
        rawSummary.match(/^Publication date:\s*([^\n]+)/i)?.[1] || "";
      const journal =
        plainText(item.publicationName || item.journal || item.source) ||
        rawSummary.match(/Source:\s*([^\n]+?)(?:, Volume|$)/im)?.[1] ||
        "";
      const abstract = metadataOnly
        ? ""
        : /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\//.test(
              canonicalUrl(url),
            )
          ? pubmedAbstract(rawSummary)
          : rawSummary;
      return {
        title,
        url: canonicalUrl(url),
        doi,
        pmid,
        authors,
        abstract,
        abstractSource: abstract ? "RSS feed" : "",
        journal,
        published,
        displayDate: published ? published.slice(0, 10) : issueDate,
        summary: metadataOnly ? rawSummary : "",
      };
    })
    .filter((a) => a.title && a.url);
  if (entries.length && !articles.length)
    throw new Error(
      "The feed contains entries, but none have a readable title and a valid article link.",
    );
  return { title: plainText(channel.title), articles };
}
export function toRis(a) {
  const oneLine = (s) => String(s || "").replace(/[\r\n]+/g, " ");
  return [
    "TY  - JOUR",
    `TI  - ${oneLine(a.title)}`,
    ...a.authors.map((x) => `AU  - ${oneLine(x)}`),
    a.journal && `JO  - ${oneLine(a.journal)}`,
    a.published && `PY  - ${a.published.slice(0, 4)}`,
    a.doi && `DO  - ${oneLine(a.doi)}`,
    a.pmid && `AN  - PMID:${a.pmid}`,
    `UR  - ${oneLine(a.url)}`,
    a.abstract && `AB  - ${oneLine(a.abstract)}`,
    "ER  - ",
    "",
  ]
    .filter((x) => x !== false && x !== undefined && x !== null)
    .join("\r\n");
}
