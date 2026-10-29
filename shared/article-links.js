export const ukLink = (url) =>
  `https://go.openathens.net/redirector/uky.edu?url=${encodeURIComponent(url)}`;

export function articleLinks(article) {
  const isPubmed =
    /^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/?(?:[?#]|$)/i.test(
      article.url,
    );
  // PubMed is a citation record. Send its DOI to the publisher/UK redirector.
  const publisher = isPubmed
    ? /^10\.\d{4,9}\/.+/.test(article.doi || "")
      ? `https://doi.org/${article.doi.split("/").map(encodeURIComponent).join("/")}`
      : ""
    : article.url;
  return {
    publisher,
    uk: publisher ? ukLink(publisher) : "",
    pubmed: isPubmed ? article.url : "",
  };
}
