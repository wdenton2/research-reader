import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import ipaddr from "ipaddr.js";

export function isPublicAddress(address) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export async function validateRemoteUrl(input, lookup = dns.lookup) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid feed URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error(
      "Use a public HTTP or HTTPS URL on a standard port, without credentials.",
    );
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    /\.(local|internal|localhost)$/i.test(hostname)
  )
    throw new Error("Private network addresses are not allowed for feeds.");
  const records = await lookup(hostname, { all: true });
  if (!records.length || records.some((r) => !isPublicAddress(r.address)))
    throw new Error("Private network addresses are not allowed for feeds.");
  return { url, record: records[0] };
}
export async function fetchText(
  input,
  { headers = {}, limit = 4 * 1024 * 1024, redirects = 4 } = {},
) {
  const { url, record } = await validateRemoteUrl(input);
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).get(
      url,
      {
        headers: {
          "User-Agent": "ResearchReader/0.1 (personal RSS reader)",
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, application/json, text/xml;q=0.9, */*;q=0.5",
          "Accept-Encoding": "identity",
          ...headers,
        },
        // Pin the checked address to avoid DNS rebinding between validation and connection.
        lookup: (_host, options, cb) =>
          options?.all
            ? cb(null, [record])
            : cb(null, record.address, record.family),
      },
      (response) => {
        const status = response.statusCode || 500;
        if (
          [301, 302, 303, 307, 308].includes(status) &&
          response.headers.location
        ) {
          response.resume();
          clearTimeout(deadline);
          if (!redirects)
            return reject(new Error("The feed redirected too many times."));
          // Never forward authentication to a redirect target.
          const redirectedHeaders = Object.fromEntries(
            Object.entries(headers).filter(
              ([key]) => !/authorization|cookie|api-key/i.test(key),
            ),
          );
          fetchText(new URL(response.headers.location, url).href, {
            headers: redirectedHeaders,
            limit,
            redirects: redirects - 1,
          }).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          clearTimeout(deadline);
          return reject(
            new Error(
              `Source returned HTTP ${status}. Try again later or use its PubMed RSS feed.`,
            ),
          );
        }
        if (Number(response.headers["content-length"]) > limit) {
          response.destroy();
          return reject(new Error("Response exceeded the size limit."));
        }
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > limit)
            response.destroy(new Error("Response exceeded the size limit."));
          else chunks.push(chunk);
        });
        response.on("end", () => {
          clearTimeout(deadline);
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
        response.on("error", reject);
      },
    );
    const deadline = setTimeout(
      () => request.destroy(new Error("The source took too long to respond.")),
      20000,
    );
    request.on("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
  });
}
export async function fetchJson(url, options) {
  return JSON.parse(await fetchText(url, options));
}
