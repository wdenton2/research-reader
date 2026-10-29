import { fetchJson } from "./network.js";
import { createHash } from "node:crypto";
import { normalizeTitle, plainText, safeLink } from "./feed.js";

export { ukLink } from "../shared/article-links.js";
export async function findMetadata(article) {
  const query = article.pmid
    ? `EXT_ID:${article.pmid} AND SRC:MED`
    : article.doi
      ? `DOI:"${article.doi.replace(/["\\]/g, "")}"`
      : `TITLE:"${article.title.replace(/["\\]/g, " ")}"`;
  const url = new URL(
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
  );
  url.search = new URLSearchParams({
    query,
    format: "json",
    resultType: "core",
    pageSize: "5",
  });
  const data = await fetchJson(url.href);
  const candidates = data.resultList?.result || [];
  // Do not silently attach a similar paper's abstract to this article.
  return (
    candidates.find(
      (r) =>
        (article.doi && r.doi?.toLowerCase() === article.doi.toLowerCase()) ||
        (article.pmid && r.id === article.pmid && r.source === "MED") ||
        normalizeTitle(r.title) === normalizeTitle(article.title),
    ) || null
  );
}
export function metadataFields(match, a) {
  return {
    doi: match.doi || a.doi,
    pmid: match.source === "MED" ? match.id : a.pmid,
    abstract: plainText(match.abstractText) || a.abstract,
    abstractSource: match.abstractText
      ? "Europe PMC / PubMed"
      : a.abstract_source,
    authors:
      match.authorList?.author
        ?.map((x) => x.fullName || x.collectiveName)
        .filter(Boolean) || a.authors,
    journal: match.journalInfo?.journal?.title || a.journal,
    pmcid: match.pmcid || null,
  };
}
export async function findOpenAccess(article) {
  const errors = [];
  let checked = false;
  if (article.doi && process.env.UNPAYWALL_EMAIL) {
    try {
      const data = await fetchJson(
        `https://api.unpaywall.org/v2/${encodeURIComponent(article.doi)}?email=${encodeURIComponent(process.env.UNPAYWALL_EMAIL)}`,
      );
      checked = true;
      const location = data.best_oa_location;
      if (location && safeLink(location.url))
        return {
          status: "found",
          url: safeLink(location.url),
          pdf: safeLink(location.url_for_pdf),
          provider: "Unpaywall",
          version: location.version || "",
          license: location.license || "",
        };
    } catch {
      errors.push("Unpaywall could not be reached.");
    }
  }
  if (article.doi || article.pmid) {
    try {
      const params = new URLSearchParams({
        ids: article.doi || article.pmid,
        format: "json",
        tool: "ResearchReader",
      });
      if (process.env.NCBI_EMAIL || process.env.UNPAYWALL_EMAIL)
        params.set(
          "email",
          process.env.NCBI_EMAIL || process.env.UNPAYWALL_EMAIL,
        );
      const data = await fetchJson(
        `https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/?${params}`,
      );
      checked = true;
      const record = data.records?.[0];
      if (
        record?.pmcid &&
        /^PMC\d+$/.test(record.pmcid) &&
        record.live !== false &&
        record.live !== "false" &&
        (!record["release-date"] ||
          Date.parse(record["release-date"]) <= Date.now())
      )
        return {
          status: "found",
          url: `https://pmc.ncbi.nlm.nih.gov/articles/${record.pmcid}/`,
          provider: "PubMed Central",
          version: "Repository copy",
        };
    } catch {
      errors.push("PubMed Central could not be reached.");
    }
  }
  return {
    status: errors.length ? "error" : checked ? "not_found" : "unavailable",
    message:
      errors.join(" ") ||
      (!article.doi && !article.pmid
        ? "A DOI or PubMed ID is needed to look for a free copy."
        : "No free copy found in the sources checked."),
    unpaywallConfigured: !!process.env.UNPAYWALL_EMAIL,
  };
}
export function zoteroItem(a, collectionKey = "") {
  return {
    itemType: "journalArticle",
    title: a.title,
    creators: a.authors.map((name) => ({ creatorType: "author", name })),
    abstractNote: a.abstract,
    publicationTitle: a.journal,
    date: a.published?.slice(0, 10) || a.display_date || "",
    DOI: a.doi,
    url: a.url,
    extra: a.pmid ? `PMID: ${a.pmid}` : "",
    tags: [{ tag: "Research Reader" }],
    ...(collectionKey ? { collections: [collectionKey] } : {}),
  };
}
export async function saveToZotero(a, config, request = fetch) {
  let response;
  try {
    response = await request(
      `https://api.zotero.org/users/${config.userId}/items`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          "Content-Type": "application/json",
          "Zotero-API-Version": "3",
          "Zotero-API-Key": config.apiKey,
          "Zotero-Write-Token": createHash("sha256")
            .update(`${config.userId}:${a.id}`)
            .digest("hex")
            .slice(0, 32),
        },
        body: JSON.stringify([zoteroItem(a, config.collectionKey)]),
      },
    );
  } catch {
    throw new Error(
      "Zotero could not confirm this save. Check your library before retrying.",
    );
  }
  if (!response.ok)
    throw new Error(
      `Zotero returned HTTP ${response.status}. Check the API key and library permissions.`,
    );
  const result = await response.json();
  const key = result.successful?.["0"]?.key || result.success?.["0"];
  if (!/^[A-Z0-9]{8}$/.test(key || ""))
    throw new Error(
      "Zotero did not confirm this citation was saved. Check your library before retrying.",
    );
  return key;
}
