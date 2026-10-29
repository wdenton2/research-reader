# Research Reader

A personal, phone-friendly research feed for a homelab. Follow journal RSS/Atom feeds or PubMed RSS searches, scroll through articles, hide them, favorite them, and save them for later. JVIR is the first source.

## Run locally

Requires **Node.js 24 or newer** (uses Node's built-in SQLite).

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4173**. Local development binds to loopback and needs no password. The server refreshes feeds on startup and hourly. SQLite data is stored in `data/reader.sqlite`, excluded from Git. Restarting the app or refreshing feeds preserves article states.

`npm run build` builds the client. `npm test` runs parser, storage, HTTP API, Zotero connection, gesture, and security regression tests. `npm run check` does both. Vite hot-reloads the frontend; restart the development server after changing backend files.

## What works

- Journal RSS 2.0, RDF/RSS 1.0, and Atom feeds; PubMed generated RSS URLs.
- Add feeds, pause/resume them, remove them, and filter articles by source.
- Persistent favorites, saved papers, hidden articles with undo/restore, and read/unread states.
- Mobile swipes: right marks read, left marks unread, with Undo. A mail icon on each card provides the same action without swiping.
- Search titles, supplied abstracts/summaries, and authors; paginated scrolling feed.
- Abstracts when supplied, with optional exact-match metadata lookup in Europe PMC/PubMed.
- PubMed Central free-copy lookup, with optional Unpaywall DOI lookup.
- University of Kentucky OpenAthens deep links and publisher links; LibKey lookup when an identifier is available.
- RIS citation export and article metadata for Zotero Connector. Native sharing where supported.
- UI-configurable Zotero connection, collection selection, and direct citation saving with duplicate protection per account.
- Server-side database shared by your phone and desktop, JSON data export, and a phone home-screen manifest.

This is a **single-user** app. It does not yet provide separate accounts, PDF storage, offline article caching, or background notifications. The browser UI requires the server to be available. Polling happens while the server runs, including when the browser is closed. There is no scheduler outside this process.

## Add journals and PubMed searches

Use **Add source** or **Sources → Follow another source**, and paste a public RSS or Atom URL. A feed name is optional. Feed URLs are fetched on the server, so browser CORS restrictions do not block journal subscriptions.

For PubMed, search at [PubMed](https://pubmed.ncbi.nlm.nih.gov/), choose **Create RSS**, select the item count, and paste the generated feed URL. PubMed allows up to 200 items per feed. A regular search results URL is not an RSS feed. To follow a journal through PubMed, search `"J Vasc Interv Radiol"[journal]` and create RSS. [Official PubMed instructions](https://pubmed.ncbi.nlm.nih.gov/help/#create-an-rss-feed-for-a-search).

JVIR's default source is [ScienceDirect RSS](https://rss.sciencedirect.com/publication/science/10510443). Verified on October 24, 2026: 100 entries, with titles, authors, publication/issue dates, and publisher links, but no abstracts or DOIs. Dates such as “December 2026” are the publisher's issue dates, not invented day-level publication dates. Entries without dated RSS fields retain their feed order within the ingestion batch. The feed can include editorials and journal front matter as well as research papers.

Abstract lookup matches an exact normalized title or an exact DOI/PMID; a merely similar title is never accepted. Very new papers may not yet be indexed. Publisher RSS metadata is preserved, and abstracts are never generated. Other feeds may provide short summaries instead of full abstracts.

Pausing a source stops updates; existing articles remain. Removing a source removes it from Latest, unless another source includes the article. Saved articles, favorites, and hidden articles remain in their respective views. The database keeps historical articles rather than expiring reading state when an item leaves its RSS feed. Duplicate articles merge when a DOI, PMID, or canonical publisher URL matches; different URLs without shared identifiers may remain separate.

## Full-text access

**Open through UK** uses UK's documented OpenAthens prefix and leaves login to UK. Research Reader does not request, store, or proxy linkblue credentials. This is a deep-link route, not confirmation that UK subscribes to a particular article. The authenticated publisher workflow still needs to be verified with your own account.

PubMed articles use their DOI for publisher and UK access, with a separate link back to the PubMed record. UK sign-in and publisher reading open in a browser tab: OpenAthens does not support embedded sign-in, and publisher pages may prohibit framing. An in-app full-text/PDF reader is not implemented. See [integration research](docs/integrations.md) for the options and limitations.

**Find free full text** first obtains an identifier, when needed, through an exact metadata match. It checks Unpaywall if configured and then PubMed Central's current ID Converter API. A result is a link to a lawful publisher or repository copy. No result is not proof of a paywall. Lookups are cached for 24 hours, except failed/unavailable lookups. For Unpaywall, add a real contact email to `.env`:

```dotenv
UNPAYWALL_EMAIL=your-contact-email@example.com
```

The app does not use the retired PMC OA Web Service or Unpaywall search endpoint. It does not scrape or download licensed PDFs. See [docs/integrations.md](docs/integrations.md) for sources and decisions.

## Zotero

Without credentials:

- **Export RIS** downloads citation metadata that Zotero can import. It does not silently write to your library.
- On iPhone, use **Open publisher page** in Safari, then **Share → Zotero**. This requires the Zotero iOS app.
- On desktop, an open article detail exposes Highwire `citation_*` metadata and announces updates to Zotero Connector. Connector/mobile import has not been verified with an authenticated Zotero account in this project.

For direct saving, open **Settings → Zotero**:

1. Use **Create an API key** to visit [Zotero API settings](https://www.zotero.org/settings/keys). Create a dedicated key with personal-library access and write access. Group-only keys are not supported.
2. Paste the key and choose **Connect Zotero**. The server verifies the key's permissions and detects your user ID; this check does not create a citation.
3. Choose **My Library** or one of your collections and select **Save destination**. Nested collections show their parent names. This choice applies to future saves; existing citations are not moved or duplicated into a different collection.
4. Open a paper and choose **Send to Zotero**. **Test connection**, **Update key**, and **Disconnect Zotero** are available in Settings without restarting the server.

Keys entered in the UI are encrypted with AES-256-GCM before storage in SQLite. The encryption key is a separate `data/connection.key` file created with owner-only permissions. Neither API keys nor encrypted credentials are returned by the settings API or included in JSON exports. Protect and back up the whole data directory, including `connection.key`; encryption does not protect against someone who can read both files. Use HTTPS and the app/reverse-proxy authentication when accessing the app over a network.

Disconnect removes the app's saved connection and stops direct saving; it does not revoke the key at Zotero or delete any Zotero items. Previously sent citations are tracked per Zotero user ID, so reconnecting to the same account preserves duplicate protection. Only successful, confirmed saves are recorded. Network failures can leave a save's outcome uncertain: check Zotero before retrying.

The earlier `.env` configuration remains supported when there is no UI connection record:

```dotenv
ZOTERO_USER_ID=your_numeric_user_id
ZOTERO_API_KEY=your_dedicated_library_write_key
# Optional
ZOTERO_COLLECTION_KEY=your_collection_key
```

Environment changes require a restart. UI settings take precedence; disconnecting in the UI also disables any environment fallback until you reconnect through the UI. Legacy saved item keys are associated with the configured environment user ID on migration. Citation metadata is saved as `journalArticle`, with full-name author fields when the feed does not provide structured names. No PDFs are attached. Group libraries and OAuth authorization are not implemented. Automated Zotero tests use mocked responses; a real-account save remains unverified until you connect and send a paper.

Never put API keys in client code, Git, screenshots, or chat. Paste them only into the app's password-style key field; the saved key is never prefilled or revealed.

## Move to your homelab

The image is published to **`ghcr.io/wdenton2/research-reader:latest`** for **Linux AMD64 and ARM64**. Docker selects the architecture automatically. The [GitHub workflow](https://github.com/wdenton2/research-reader/actions/workflows/publish-image.yml) runs the tests and a container smoke check before publishing on each push to `main`. Each image also receives a `sha-<full-commit-sha>` tag for pinning; `v*` version tags publish matching version tags.

You only need **`compose.yaml`** and **`.env.example`** on the other machine; no checkout, Node installation, or local image build is required:

```sh
mkdir research-reader
cd research-reader
curl -fsSLO https://raw.githubusercontent.com/wdenton2/research-reader/main/compose.yaml
curl -fsSLO https://raw.githubusercontent.com/wdenton2/research-reader/main/.env.example
cp .env.example .env
```

Edit `.env` and set a long unique **`APP_PASSWORD`**. For an HTTPS reverse proxy, set **`PUBLIC_URL`** to your exact browser-facing origin without a trailing slash (for example `https://reader.your-domain.example`). This controls origin checks and secure cookies. Then run:

```sh
docker compose pull
docker compose up -d
docker compose ps
```

The same service can be added to an existing Compose stack:

```yaml
services:
  research-reader:
    image: ghcr.io/wdenton2/research-reader:latest
    init: true
    restart: unless-stopped
    ports:
      - "127.0.0.1:4173:4173"
    environment:
      APP_PASSWORD: ${APP_PASSWORD:?Set APP_PASSWORD in .env}
      PUBLIC_URL: ${PUBLIC_URL:-}
    volumes:
      - reader-data:/app/data
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL

volumes:
  reader-data:
```

The default Compose port is **127.0.0.1:4173** on the host. Point your existing reverse proxy at that port and use HTTPS for phone access and browser sharing. For a proxy in another container, connect both services to your existing Docker network and target `research-reader:4173`; do not expose the backend directly. Alternatively use your existing private network/Tailscale setup. For direct LAN access using the provided Compose file, set `READER_BIND_IP` to the host's LAN IP (or `0.0.0.0` for all interfaces) in `.env`, retain authentication, and visit `http://HOST-IP:4173`. Set `PUBLIC_URL` to the actual origin you use, with `http://` if serving over plain HTTP; an HTTPS value makes session cookies require HTTPS. `READER_PORT` changes the host port. `HOST`, `PORT`, and `DATA_DIR` inside the container are fixed by Compose.

For an existing authenticated reverse proxy you may use `TRUST_PROXY_AUTH=true` instead of the app password **only if it protects every request and direct backend access is blocked**. This flag is an operator assertion, not automatic verification of proxy authentication. `APP_PASSWORD` takes precedence if both are set. The default app session is an HttpOnly, SameSite=Strict cookie; it lasts 30 days. Production/network startup refuses to run without one of these authentication choices. Use a long password; a salted password-account database is outside this single-user MVP.

Open the HTTPS address on your phone. In Safari use **Share → Add to Home Screen**. This provides a standalone app window, not offline reading.

### Updates and pinned versions

```sh
docker compose pull
docker compose up -d
```

The named volume remains in place when the image is replaced. To pin a known build, set `RESEARCH_READER_IMAGE=ghcr.io/wdenton2/research-reader:sha-<full-commit-sha>` in `.env`, or use the published `ghcr.io/wdenton2/research-reader@sha256:...` digest shown in the workflow summary. Keep the Compose project name/directory stable so Docker continues using the same volume.

Public GHCR images can be pulled without signing in. If you make the package private, authenticate on the Docker host with `docker login ghcr.io -u wdenton2` and supply a GitHub personal access token (classic) with `read:packages` at the password prompt. See [GitHub's registry authentication instructions](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry). Never put that token in the Compose file or commit it.

### Build locally instead

From a source checkout, after configuring `.env`:

```sh
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

To check a locally built image with a disposable volume (without using your library):

```sh
docker build -t research-reader:test .
bash scripts/smoke-image.sh research-reader:test
```

## Back up and restore

The Docker named volume `reader-data` persists across container replacement. Do not run `docker compose down -v` unless you mean to delete the library.

For a consistent local SQLite backup, stop the app, copy the **entire `data/` directory**, then restart it. For Docker, stop the service and back up the entire mounted volume (including any WAL/SHM files) with your host's normal volume backup tool, then restart. Restore only while the service is stopped. Keep ownership writable by the container's `node` user (UID 1000). Make a backup of the current volume before replacing it. The existing local library is not automatically transferred to a fresh Docker volume.

**Settings → Export data** provides a portable JSON snapshot of sources, article metadata, state, and source/article associations. JSON restore is not yet implemented; SQLite backups are the supported restoration path. Credentials are not included in export.

## Project layout

- `src/main.jsx`, `src/styles.css`: responsive React UI.
- `server/feed.js`: RSS/Atom parsing, text normalization, citation export.
- `server/network.js`: bounded HTTP fetching, redirect checks, public-address validation and DNS pinning.
- `server/db.js`: SQLite persistence and import deduplication.
- `server/app.js`: application API and feed refresh orchestration.
- `server/integrations.js`: metadata, open-access lookup, UK links, Zotero API.
- `server/auth.js`: single-user session and origin protection.
- `test/reader.test.js`: functional and security regression checks.

No existing project files or data were replaced. The initial database is created only if absent, and the default JVIR subscription is seeded only once.
