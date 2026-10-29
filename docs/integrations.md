# Integration research — October 24, 2026

## RSS and JVIR

[Elsevier's RSS instructions](https://www.elsevier.support/sciencedirect/answer/how-do-i-set-up-an-rss-feed) describe subscribing from a journal's Articles & Issues menu. The live [JVIR feed](https://rss.sciencedirect.com/publication/science/10510443) responded with RSS 2.0 and 100 entries during implementation. Its descriptions contain citation details, not article abstracts. [SIR's announcement](https://www.sirweb.org/publications/news/jvir-is-moving-to-online-only-publication/) confirms that JVIR's digital-only distribution continues to support RSS updates.

[PubMed's user guide](https://pubmed.ncbi.nlm.nih.gov/help/) documents Create RSS for arbitrary search results and up to 200 feed items. The app accepts generated links, rather than attempting to invent PubMed feed tokens. The user's live JVIR PubMed and IR feeds each imported 15 articles after fixing namespace aliases: PubMed supplies both `title` and `dc:title`, which collapse into an array when namespace prefixes are removed. Scalar fields now choose the first nonempty value. Full abstracts come from `content:encoded`, with PubMed's citation, heading, and identifier footer removed; no-abstract notices are not presented as abstracts. Journal names and all creators are preserved, and PubMed record URLs are canonicalized without tracking parameters. A synthetic regression fixture reproduces the real XML structure. Nonempty feeds with no usable articles report an error instead of a silent successful import of zero articles.

Research data is treated as untrusted input: XML entities/DTDs are rejected, markup is converted to text, only HTTP(S) outbound links are displayed, and remote feed fetches reject private/local addresses, redirects into private networks, oversized responses, and non-standard ports. No user-supplied HTML is rendered.

## University of Kentucky

[UK's FAQ](https://libraries.uky.edu/library-policies/frequently-asked-questions) documents replacement of EZproxy with OpenAthens in July 2023 and this link prefix:

```js
"https://go.openathens.net/redirector/uky.edu?url=" +
  encodeURIComponent(publisherUrl);
```

UK's [access page](https://libraries.uky.edu/access) describes eligible users, linkblue login, and permitted use of licensed resources. [OpenAthens documentation](https://docs.openathens.net/libraries/create-redirector-links) explains compatible publisher deep links. The app links to the publisher through this flow and never handles library credentials or downloaded licensed content. Actual subscription entitlement cannot be inferred from the existence of a redirect URL.

For PubMed records with a DOI, the publisher and UK links use `https://doi.org/{doi}`; the original PubMed record remains separately accessible. A PubMed record without a DOI is labeled as a record and is not sent to OpenAthens as if it were a publisher. A live UK redirector request for DOI `10.1016/j.jvir.2026.109157` resolved to Elsevier's institutional sign-in with the UK entity ID and an Elsevier article return URL. This verifies routing only; authenticated access and subscription coverage have not been tested.

### Reading inside Research Reader

The [OpenAthens redirector](https://docs.openathens.net/libraries/how-the-redirector-works) establishes the publisher authentication route; it is not a content proxy. OpenAthens' [embedding documentation](https://docs.openathens.net/libraries/about-embedding) explicitly excludes putting sign-in into an iframe and notes authentication/session-cookie constraints. Publisher pages also control embedding through [CSP frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors) and X-Frame-Options. A direct unauthenticated ScienceDirect request returned HTTP 403 with SAMEORIGIN during investigation; this does not establish every authenticated page's policy.

The current app therefore opens the UK route in a browser tab. SAML/OIDC login to Research Reader itself would require institutional cooperation and would not confer a publisher session or supply article content. A future in-app reader could support permitted open-access article text and PDFs, plus PDFs the user imports. Seamless licensed content would require a supported publisher/library integration and verified entitlement; a native app could alternatively use a system browser sheet for the sign-in and publisher workflow. None of these future reader options is implemented in this release.

UK also provides [BrowZine/LibKey tools](https://libguides.uky.edu/ThirdIron). [LibKey's public linking syntax](https://thirdiron.atlassian.net/wiki/spaces/BrowZineAPIDocs/pages/1173094454/LibKey.io+Linking+Syntax) supports `https://libkey.io/{DOI-or-PMID}`. UK-specific API integration would require a verified library ID and provisioned credentials; neither was assumed.

## Metadata and free copies

[Europe PMC REST documentation](https://europepmc.org/RestfulWebService) supports JSON search with `resultType=core`. The implementation requests exact identifiers or an exact normalized title and uses returned `abstractText`, authors, journal, DOI, and PMID. Live endpoint connectivity was verified. PMID 33248227 returned a title, DOI, and 668-character abstract, and the PMC converter mapped it to PMC7840891. The first recent JVIR title was not yet indexed. No approximate match is accepted.

[Unpaywall's API](https://data.unpaywall.org/products/api) supports DOI lookup at `https://api.unpaywall.org/v2/{doi}?email={contactEmail}`. The contact email must be configured; no fabricated email is sent. Retain [version and location fields](https://unpaywall.org/data-format) to distinguish a published version, accepted manuscript, or submitted version. Search was retired in September 2026 and is not used.

[PMC's current ID Converter](https://pmc.ncbi.nlm.nih.gov/tools/id-converter-api/) maps DOI/PMID to PMCID at `https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/`. Returned embargo/live flags are checked before showing a PMC link. A missing match is not a claim that every copy is paywalled. The old [PMC OA Web Service](https://pmc.ncbi.nlm.nih.gov/tools/oa-service/) retired in August 2026 and is not used.

## Zotero

[Zotero's metadata guide](https://www.zotero.org/support/dev/exposing_metadata) documents Highwire citation tags and `ZoteroItemUpdated` events for dynamic pages. [Zotero iOS](https://www.zotero.org/support/ios) supports sharing webpages/PDFs into the native app. [Standard format imports](https://www.zotero.org/support/kb/importing_standardized_formats) include RIS.

For configured personal libraries, the app uses [Zotero API v3 write requests](https://www.zotero.org/support/dev/web_api/v3/write_requests) to POST a journalArticle to `/users/{userID}/items`, with `Zotero-API-Version: 3`, a dedicated API key, and a write token. Successful item keys are persisted for duplicate protection. It saves metadata only; authentication to a publisher does not grant this backend the user's browser session or a right to download PDFs.

The UI connector now verifies keys using [`GET /keys/current`](https://www.zotero.org/support/dev/web_api/v3/syncing#verify_key_access), checks personal-library read/write permissions, and obtains the account ID without manual entry. Collection lists are paginated; a chosen destination is checked against that user's collection endpoint. UI credentials are encrypted in SQLite with a separate server key file. Environment configuration remains a fallback for existing installations. API responses, exports, and error messages exclude credentials. Redirects are rejected on authenticated Zotero requests so the key is only sent to `api.zotero.org`. Saves are tracked by article and Zotero user ID, preserving duplicate protection when switching accounts.

A future multi-user authorization flow would require a registered [OAuth 1.0a client](https://www.zotero.org/support/dev/web_api/v3/oauth), user-scoped encrypted tokens, and separate per-user database records. It is intentionally outside this local single-user release.
