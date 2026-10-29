import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Heart,
  Library,
  LoaderCircle,
  LogOut,
  Menu,
  Mail,
  MailOpen,
  Plus,
  Radio,
  RefreshCw,
  Rss,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import "./styles.css";
import { articleLinks } from "../shared/article-links.js";
import ZoteroSettings from "./ZoteroSettings.jsx";
import useArticleSwipe from "./useArticleSwipe.js";

async function api(path, method = "GET", body) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: method === "GET" ? {} : { "Content-Type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify(body || {}) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}
const labels = {
  latest: "Your reading room",
  unread: "Unread articles",
  saved: "Saved for later",
  favorite: "Your favorites",
  hidden: "Hidden articles",
  sources: "Your sources",
  settings: "Your reader",
};
const subtitles = {
  latest: "A little less noise. A little more discovery.",
  unread: "Fresh perspectives, ready when you are.",
  saved: "Good reading for the right moment.",
  favorite: "The research you want to come back to.",
  hidden: "Out of your feed. Still here if you need it.",
  sources: "Follow the journals and questions that matter to you.",
  settings: "Make Research Reader feel at home.",
};
const dateLabel = (a) =>
  a.display_date
    ? /^\d{4}-\d{2}-\d{2}$/.test(a.display_date)
      ? new Date(a.display_date + "T12:00:00").toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : a.display_date
    : "Date not supplied";
const sourceLabel = (a) => a.sources || a.journal || "Journal article";
function App() {
  const [session, setSession] = useState(null);
  const [view, setView] = useState("latest");
  const [sources, setSources] = useState([]);
  const [stats, setStats] = useState({});
  const [settings, setSettings] = useState({});
  const [articles, setArticles] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState({});
  const [revision, setRevision] = useState(0);
  const [mobileMenu, setMobileMenu] = useState(false);
  const requestId = useRef(0);
  const toastTimer = useRef();
  const pendingChanges = useRef(new Set());
  const notify = (message, undo) => {
    clearTimeout(toastTimer.current);
    setToast({ message, undo });
    toastTimer.current = setTimeout(() => setToast(null), 8000);
  };
  async function loadMeta() {
    const [s, t, c] = await Promise.all([
      api("/sources"),
      api("/stats"),
      api("/settings"),
    ]);
    setSources(s);
    setStats(t);
    setSettings(c);
  }
  useEffect(() => {
    api("/session")
      .then(setSession)
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);
  useEffect(() => {
    if (session?.authenticated) loadMeta().catch((e) => notify(e.message));
  }, [session]);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!session?.authenticated || ["sources", "settings"].includes(view))
      return;
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    api(`/articles?${new URLSearchParams({ view, q: search, source })}`)
      .then((data) => {
        if (requestId.current !== id) return;
        setArticles(data.articles);
        setTotal(data.total);
        setHasMore(data.hasMore);
      })
      .catch((e) => {
        if (requestId.current === id) setError(e.message);
      })
      .finally(() => {
        if (requestId.current === id) setLoading(false);
      });
  }, [session, view, search, source, revision]);
  useEffect(() => {
    if (!session?.authenticated) return;
    const openFromUrl = () => {
      const match = location.pathname.match(/^\/article\/([a-f0-9]+)$/);
      if (match)
        api(`/articles/${match[1]}`)
          .then(setSelected)
          .catch((e) => notify(e.message));
      else setSelected(null);
    };
    openFromUrl();
    window.addEventListener("popstate", openFromUrl);
    return () => window.removeEventListener("popstate", openFromUrl);
  }, [session]);
  function navigate(next) {
    setView(next);
    setSource("");
    setQuery("");
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function refresh() {
    setRefreshing(true);
    try {
      const data = await api("/refresh", "POST");
      await loadMeta();
      setRevision((x) => x + 1);
      const errors = data.results.filter((r) => r.error);
      const added = data.results.reduce((n, r) => n + (r.added || 0), 0);
      notify(
        errors.length
          ? `${errors.length} source${errors.length > 1 ? "s" : ""} could not refresh. See Sources for details.`
          : added
            ? `${added} new article${added !== 1 ? "s" : ""} added.`
            : "You’re up to date. No new articles.",
      );
    } catch (e) {
      notify(e.message);
    } finally {
      setRefreshing(false);
    }
  }
  async function change(a, key, newValue = !a[key], options = {}) {
    const token = `${a.id}:${key}`;
    if (pendingChanges.current.has(token)) return;
    pendingChanges.current.add(token);
    setBusy((b) => ({ ...b, [token]: true }));
    try {
      const updated = await api(`/articles/${a.id}`, "PATCH", {
        [key]: newValue,
      });
      setArticles((list) =>
        list
          .map((x) => (x.id === a.id ? { ...x, ...updated } : x))
          .filter(
            (x) =>
              !(
                x.id === a.id &&
                ((["latest", "unread"].includes(view) && updated.hidden) ||
                  (view === "unread" && updated.read) ||
                  (view === "hidden" && !updated.hidden) ||
                  (view === "saved" && !updated.saved) ||
                  (view === "favorite" && !updated.favorite))
              ),
          ),
      );
      setSelected((s) => (s?.id === a.id ? { ...s, ...updated } : s));
      await loadMeta().catch(() => {});
      if (key === "hidden") {
        notify(
          newValue ? "Article hidden from your feed." : "Article restored.",
          () => change(updated, "hidden", !newValue),
        );
        setRevision((x) => x + 1);
      } else if (key === view || (key === "read" && view === "unread"))
        setRevision((x) => x + 1);
      if (key === "read" && options.notify) {
        notify(
          newValue ? "Article marked read." : "Article marked unread.",
          () => change(updated, "read", a.read, { notify: false }),
        );
      }
    } catch (e) {
      notify(e.message);
    } finally {
      pendingChanges.current.delete(token);
      setBusy((b) => ({ ...b, [token]: false }));
    }
  }
  function markRead(a, read) {
    if (a.read === read) {
      notify(
        read
          ? "This article is already read."
          : "This article is already unread.",
      );
      return;
    }
    return change(a, "read", read, { notify: true });
  }
  function openArticle(a) {
    setSelected(a);
    history.pushState({}, "", `/article/${a.id}`);
    if (!a.read) change(a, "read", true);
  }
  function closeArticle() {
    setSelected(null);
    history.replaceState({}, "", "/");
  }
  async function loadMore() {
    if (loading) return;
    const id = requestId.current;
    setLoading(true);
    try {
      const data = await api(
        `/articles?${new URLSearchParams({ view, q: search, source, offset: articles.length })}`,
      );
      if (requestId.current === id) {
        setArticles((a) => [
          ...a,
          ...data.articles.filter((x) => !a.some((y) => x.id === y.id)),
        ]);
        setHasMore(data.hasMore);
      }
    } catch (e) {
      notify(e.message);
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }
  async function share(a) {
    try {
      if (navigator.share)
        await navigator.share({ title: a.title, url: a.url });
      else {
        await navigator.clipboard.writeText(a.url);
        notify("Article link copied.");
      }
    } catch (e) {
      if (e.name !== "AbortError")
        notify(
          "Sharing is unavailable here. Open the publisher and use your browser’s Share menu.",
        );
    }
  }
  if (!session)
    return (
      <div className="splash">
        <Logo />
        <p>{error || "Opening your reading room…"}</p>
        {error && <button onClick={() => location.reload()}>Try again</button>}
      </div>
    );
  if (!session.authenticated)
    return <Login onSuccess={() => api("/session").then(setSession)} />;
  const navItems = [
    ["latest", BookOpen, "Latest", null],
    ["saved", Bookmark, "Saved for later", stats.saved],
    ["favorite", Star, "Favorites", stats.favorite],
  ];
  const sourceErrors = sources.filter((s) => s.error);
  return (
    <>
      <div className="app-shell">
        <aside className={`sidebar ${mobileMenu ? "is-open" : ""}`}>
          <Logo />
          <div className="sidebar-label">YOUR LIBRARY</div>
          <nav>
            {navItems.map(([key, Icon, label, count]) => (
              <button
                key={key}
                className={`nav-item ${view === key ? "active" : ""}`}
                onClick={() => navigate(key)}
              >
                <Icon size={19} />
                <span>{label}</span>
                {count > 0 && <span className="nav-count">{count}</span>}
              </button>
            ))}
          </nav>
          <div className="sidebar-label sources-label">
            FOLLOWING{" "}
            <button
              className="icon-button"
              aria-label="Add source"
              onClick={() => setAddOpen(true)}
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="source-nav">
            {sources.slice(0, 8).map((s) => (
              <button
                className={`nav-item ${source === s.id ? "active" : ""}`}
                key={s.id}
                onClick={() => {
                  setView("latest");
                  setSource(s.id);
                  setMobileMenu(false);
                }}
              >
                <span className="source-dot" />
                <span>{s.name}</span>
                {!s.enabled && <span className="small-muted">Paused</span>}
              </button>
            ))}
            <button
              className={`nav-item subtle ${view === "sources" ? "active" : ""}`}
              onClick={() => navigate("sources")}
            >
              <Rss size={18} />
              <span>Manage sources</span>
            </button>
          </div>
          <div className="sidebar-bottom">
            <div className="quiet-note">
              <span className="little-orbit">✳</span>
              <p>
                Stay curious.
                <br />
                <span>Read at your own pace.</span>
              </p>
            </div>
            <button
              className={`nav-item ${view === "hidden" ? "active" : ""}`}
              onClick={() => navigate("hidden")}
            >
              <EyeOff size={18} />
              <span>Hidden articles</span>
            </button>
            <button
              className={`nav-item ${view === "settings" ? "active" : ""}`}
              onClick={() => navigate("settings")}
            >
              <Settings size={18} />
              <span>Settings & connections</span>
            </button>
            <div className="profile">
              <span className="avatar">W</span>
              <div>
                My research library<small>Personal workspace</small>
              </div>
              <button
                className="icon-button mobile-close"
                onClick={() => setMobileMenu(false)}
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </aside>
        {mobileMenu && (
          <button
            className="menu-backdrop"
            aria-label="Close navigation"
            onClick={() => setMobileMenu(false)}
          />
        )}
        <div className="workspace">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-button mobile-toggle"
                aria-label="Open navigation"
                onClick={() => setMobileMenu(true)}
              >
                <Menu size={21} />
              </button>
              <span className="desktop-only">My workspace</span>
              <ChevronRight size={14} className="desktop-only" />
              <span>Research Reader</span>
            </div>
            <div className="topbar-right">
              <span className="local-badge">
                <span />
                Personal library
              </span>
              <button
                className="icon-button"
                aria-label="Settings"
                onClick={() => navigate("settings")}
              >
                <Settings size={18} />
              </button>
            </div>
          </header>
          <main>
            <section className="page-heading">
              <div>
                <div className="eyebrow">RESEARCH, AT YOUR PACE</div>
                <h1>
                  {source
                    ? sources.find((s) => s.id === source)?.name
                    : labels[view]}
                </h1>
                <p>{subtitles[view]}</p>
              </div>
              <button
                className="button primary add-heading"
                onClick={() => setAddOpen(true)}
              >
                <Plus size={17} />
                Add source
              </button>
            </section>
            {view === "sources" ? (
              <Sources
                sources={sources}
                add={() => setAddOpen(true)}
                refresh={refresh}
                refreshing={refreshing}
                notify={notify}
                changed={() => {
                  loadMeta();
                  setRevision((x) => x + 1);
                }}
              />
            ) : view === "settings" ? (
              <SettingsView
                settings={settings}
                connectionChanged={async () => {
                  await loadMeta();
                  setRevision((x) => x + 1);
                }}
                logout={async () => {
                  await api("/logout", "POST");
                  setSession(await api("/session"));
                }}
                passwordRequired={session.passwordRequired}
              />
            ) : (
              <div className="reading-layout">
                <div className="feed-column">
                  {view === "latest" && !source && !search && (
                    <div className="welcome-card">
                      <div className="welcome-icon">
                        <BookOpen size={26} />
                      </div>
                      <div>
                        <h2>Your next good read is here.</h2>
                        <p>
                          The latest from{" "}
                          {sources.length === 1
                            ? sources[0].name
                            : `your ${sources.length} sources`}
                          , gathered in one quiet place.
                        </p>
                      </div>
                      <div className="welcome-lines" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  )}
                  <div className="feed-toolbar">
                    <div className="feed-tabs">
                      {["latest", "unread"].includes(view) ? (
                        <>
                          <button
                            className={view === "latest" ? "selected" : ""}
                            onClick={() => setView("latest")}
                          >
                            All articles
                          </button>
                          <button
                            className={view === "unread" ? "selected" : ""}
                            onClick={() => setView("unread")}
                          >
                            Unread <span>{stats.unread || 0}</span>
                          </button>
                        </>
                      ) : (
                        <span className="result-label">
                          {total} article{total !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    <button
                      className="icon-button refresh-button"
                      disabled={refreshing}
                      onClick={refresh}
                      aria-label="Refresh feeds"
                      title="Refresh feeds"
                    >
                      <RefreshCw
                        size={17}
                        className={refreshing ? "spin" : ""}
                      />
                      <span>{refreshing ? "Refreshing" : "Refresh"}</span>
                    </button>
                  </div>
                  <div className="search-row">
                    <label className="search-box">
                      <Search size={17} />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search your articles"
                        aria-label="Search articles"
                      />
                      {query && (
                        <button
                          className="icon-button"
                          aria-label="Clear search"
                          onClick={() => setQuery("")}
                        >
                          <X size={15} />
                        </button>
                      )}
                    </label>
                    <label className="source-select">
                      <SlidersHorizontal size={16} />
                      <select
                        aria-label="Filter by source"
                        value={source}
                        onChange={(e) => setSource(e.target.value)}
                      >
                        <option value="">All sources</option>
                        {sources.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {sourceErrors.length > 0 && (
                    <div className="inline-warning">
                      Some sources couldn’t refresh. Existing articles are still
                      here.{" "}
                      <button onClick={() => navigate("sources")}>
                        View details
                      </button>
                    </div>
                  )}
                  <div className="feed-caption">
                    <span>
                      {search
                        ? "SEARCH RESULTS"
                        : view === "hidden"
                          ? "HIDDEN FROM YOUR FEED"
                          : "LATEST IN YOUR LIBRARY"}
                    </span>
                    <span>
                      {total} article{total !== 1 ? "s" : ""}{" "}
                      <ArrowDown size={12} />
                    </span>
                  </div>
                  {error ? (
                    <div className="empty-state">
                      <Radio size={28} />
                      <h2>Couldn’t load your library</h2>
                      <p>{error}</p>
                      <button
                        className="button"
                        onClick={() => setRevision((x) => x + 1)}
                      >
                        Try again
                      </button>
                    </div>
                  ) : loading && !articles.length ? (
                    <div className="loading-state">
                      <LoaderCircle className="spin" />
                      Gathering your research…
                    </div>
                  ) : !articles.length ? (
                    <div className="empty-state">
                      <BookOpen size={32} />
                      <h2>
                        {search
                          ? "No matching articles"
                          : view === "saved"
                            ? "Make room for a good read"
                            : view === "favorite"
                              ? "Keep your favorites close"
                              : view === "hidden"
                                ? "Nothing hidden here"
                                : view === "unread"
                                  ? "You’re all caught up"
                                  : "Your reading room is ready"}
                      </h2>
                      <p>
                        {search
                          ? "Try a different title, author, or phrase."
                          : view === "saved"
                            ? "Tap the bookmark on an article to save it for later."
                            : view === "favorite"
                              ? "Star a paper to find it here anytime."
                              : view === "hidden"
                                ? "Articles you hide can be restored here."
                                : view === "unread"
                                  ? "New articles will appear here after your next refresh."
                                  : "Refresh JVIR or add another RSS feed to start reading."}
                      </p>
                      {["latest", "unread"].includes(view) && (
                        <button
                          className="button"
                          disabled={refreshing}
                          onClick={refresh}
                        >
                          <RefreshCw size={16} />
                          Refresh feeds
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="article-list">
                      <p className="swipe-hint">
                        Swipe right to mark read · left to mark unread
                      </p>
                      {articles.map((a) => (
                        <ArticleCard
                          key={a.id}
                          a={a}
                          open={() => openArticle(a)}
                          change={change}
                          markRead={markRead}
                          busy={busy}
                        />
                      ))}
                    </div>
                  )}
                  {hasMore && (
                    <button
                      className="button load-more"
                      onClick={loadMore}
                      disabled={loading}
                    >
                      {loading ? (
                        <LoaderCircle className="spin" size={17} />
                      ) : (
                        <ArrowDown size={17} />
                      )}
                      Load more articles
                    </button>
                  )}
                  {!hasMore && articles.length > 0 && (
                    <div className="feed-end">
                      <span />A good place to pause.
                      <span />
                    </div>
                  )}
                </div>
                <aside className="right-rail">
                  <div className="rail-section">
                    <div className="rail-heading">
                      <h3>Your sources</h3>
                      <button
                        className="icon-button"
                        aria-label="Add source"
                        onClick={() => setAddOpen(true)}
                      >
                        <Plus size={17} />
                      </button>
                    </div>
                    {sources.map((s) => (
                      <button
                        className="rail-source"
                        key={s.id}
                        onClick={() => {
                          setSource(s.id);
                          setView("latest");
                        }}
                      >
                        <span className="journal-mark">
                          {s.name.slice(0, 2)}
                        </span>
                        <span>
                          <strong>{s.name}</strong>
                          <small>
                            {s.enabled ? "Following" : "Paused"} ·{" "}
                            {s.article_count} articles
                          </small>
                        </span>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                    <button
                      className="text-button"
                      onClick={() => navigate("sources")}
                    >
                      Manage sources <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <div className="library-card">
                    <div className="uk-mark">UK</div>
                    <span className="eyebrow">YOUR INSTITUTION</span>
                    <h3>
                      University of
                      <br />
                      Kentucky
                    </h3>
                    <p>
                      Take your library access with you. Open articles through
                      UK with your linkblue login.
                    </p>
                    <a
                      href="https://libraries.uky.edu/access"
                      target="_blank"
                      rel="noreferrer"
                    >
                      About library access <ArrowUpRight size={14} />
                    </a>
                  </div>
                  <div className="rail-tip">
                    <Bookmark size={20} />
                    <h3>A reading list, not a to-do list.</h3>
                    <p>
                      Save something interesting.
                      <br />
                      Come back when you have a moment.
                    </p>
                  </div>
                  <div className="rail-footer">
                    Built for curiosity.
                    <br />
                    Powered by your journal feeds.
                  </div>
                </aside>
              </div>
            )}
          </main>
          <footer className="page-footer">
            Research Reader <span>Less scrolling past. More reading into.</span>
          </footer>
        </div>
      </div>
      <nav className="mobile-nav">
        {[
          ["latest", BookOpen, "Latest"],
          ["saved", Bookmark, "Saved"],
          ["favorite", Star, "Favorites"],
          ["sources", Rss, "Sources"],
        ].map(([key, Icon, label]) => (
          <button
            key={key}
            className={view === key ? "active" : ""}
            onClick={() => navigate(key)}
          >
            <Icon size={21} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {addOpen && (
        <AddSource
          onClose={() => setAddOpen(false)}
          onAdded={async (result) => {
            await loadMeta();
            setRevision((x) => x + 1);
            setAddOpen(false);
            notify(`${result.added} articles imported. Your source is ready.`);
          }}
        />
      )}
      {selected && (
        <ArticleDetail
          a={selected}
          onClose={closeArticle}
          change={change}
          busy={busy}
          settings={settings}
          notify={notify}
          share={share}
          updated={(a) => {
            setSelected(a);
            setArticles((list) =>
              list.map((x) => (x.id === a.id ? { ...x, ...a } : x)),
            );
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              onClick={() => {
                toast.undo();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
function Logo() {
  return (
    <div className="logo">
      <span className="logo-icon">
        <BookOpen size={23} />
      </span>
      <div>
        Research
        <span>
          Reader<span className="logo-period">.</span>
        </span>
      </div>
    </div>
  );
}
function ArticleCard({ a, open, change, markRead, busy }) {
  const swipe = useArticleSwipe({
    disabled: !!busy[`${a.id}:read`],
    onSwipe: (read) => markRead(a, read),
  });
  return (
    <div
      className={`swipe-card ${swipe.offset ? "is-swiping" : ""} ${swipe.offset < 0 ? "swiping-left" : "swiping-right"}`}
    >
      {!!swipe.offset && (
        <div className="swipe-reveal" aria-hidden="true">
          {swipe.offset > 0 ? (
            <>
              <MailOpen size={22} />
              <span>Read</span>
            </>
          ) : (
            <>
              <Mail size={22} />
              <span>Unread</span>
            </>
          )}
        </div>
      )}
      <article
        data-article-id={a.id}
        className={`article-card ${a.read ? "is-read" : ""}`}
        style={{ transform: `translateX(${swipe.offset}px)` }}
        {...swipe.handlers}
      >
        <div className="article-meta">
          <span className="journal-chip">
            <span />
            {sourceLabel(a)}
          </span>
          <span className="article-date">{dateLabel(a)}</span>
          {!a.read && <span className="unread-dot" title="Unread" />}
          {a.read && <span className="read-indicator">Read</span>}
        </div>
        <a
          href={`/article/${a.id}`}
          className="article-title"
          draggable={false}
          onClick={(e) => {
            if (!e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              open();
            }
          }}
        >
          <h2>{a.title}</h2>
        </a>
        <p className="authors">
          {a.authors.length
            ? a.authors.slice(0, 4).join(", ") +
              (a.authors.length > 4 ? " et al." : "")
            : "Authors not supplied by this feed"}
        </p>
        {a.abstract ? (
          <p className="abstract-preview">{a.abstract}</p>
        ) : (
          <p className="no-abstract">
            <FileText size={14} />
            Abstract not included in this feed{" "}
            <button onClick={open}>
              View article <ArrowUpRight size={12} />
            </button>
          </p>
        )}
        <div className="article-actions">
          <button className="read-button" onClick={open}>
            Read article <ArrowUpRight size={15} />
          </button>
          <div className="article-actions-right">
            <button
              className="icon-button"
              aria-label={a.read ? "Mark unread" : "Mark read"}
              title={a.read ? "Mark unread" : "Mark read"}
              aria-pressed={a.read}
              disabled={busy[`${a.id}:read`]}
              onClick={() => markRead(a, !a.read)}
            >
              {a.read ? <MailOpen size={18} /> : <Mail size={18} />}
            </button>
            <button
              className={`icon-button ${a.favorite ? "favorited" : ""}`}
              aria-label={a.favorite ? "Remove favorite" : "Favorite article"}
              aria-pressed={a.favorite}
              disabled={busy[`${a.id}:favorite`]}
              onClick={() => change(a, "favorite")}
            >
              <Star size={19} fill={a.favorite ? "currentColor" : "none"} />
            </button>
            <button
              className={`icon-button ${a.saved ? "saved" : ""}`}
              aria-label={a.saved ? "Remove from saved" : "Save for later"}
              aria-pressed={a.saved}
              disabled={busy[`${a.id}:saved`]}
              onClick={() => change(a, "saved")}
            >
              <Bookmark size={19} fill={a.saved ? "currentColor" : "none"} />
            </button>
            <span className="action-divider" />
            <button
              className="icon-button"
              aria-label={a.hidden ? "Restore article" : "Hide article"}
              disabled={busy[`${a.id}:hidden`]}
              onClick={() => change(a, "hidden")}
            >
              {a.hidden ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}
function Modal({ children, onClose, label, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current;
    d.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      d.close();
      document.body.style.overflow = old;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">{children}</div>
    </dialog>
  );
}
function AddSource({ onClose, onAdded }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal onClose={onClose} label="Add a source">
      <div className="modal-top">
        <span className="modal-symbol">
          <Rss size={22} />
        </span>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <h2>Add a little discovery.</h2>
      <p className="modal-subtitle">
        Follow a journal, a research topic, or any RSS or Atom feed.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onAdded(await api("/sources", "POST", { name, url }));
          } catch (e) {
            setError(e.message);
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Source name <span>Optional</span>
          <input
            autoFocus
            placeholder="e.g. JVIR or pulmonary embolism"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
        </label>
        <label className="field">
          RSS or Atom feed URL
          <input
            required
            type="url"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <div className="form-hint">
          <Search size={18} />
          <div>
            <strong>Following a PubMed search?</strong>
            <p>
              Run your search on PubMed, choose <b>Create RSS</b>, then paste
              the generated feed link here.
            </p>
            <a
              href="https://pubmed.ncbi.nlm.nih.gov/"
              target="_blank"
              rel="noreferrer"
            >
              Open PubMed <ArrowUpRight size={13} />
            </a>
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full-width" disabled={busy}>
          {busy ? (
            <>
              <LoaderCircle size={17} className="spin" />
              Checking feed…
            </>
          ) : (
            <>
              <Plus size={17} />
              Follow source
            </>
          )}
        </button>
      </form>
    </Modal>
  );
}
function Sources({ sources, add, refresh, refreshing, notify, changed }) {
  const [pending, setPending] = useState("");
  const [remove, setRemove] = useState(null);
  async function update(s, body) {
    setPending(s.id);
    try {
      await api(`/sources/${s.id}`, "PATCH", body);
      await changed();
    } catch (e) {
      notify(e.message);
    } finally {
      setPending("");
    }
  }
  return (
    <div className="sources-page">
      <div className="section-card">
        <div className="section-card-heading">
          <div>
            <h2>
              Following <span className="count-pill">{sources.length}</span>
            </h2>
            <p>
              New articles arrive automatically while your server is running.
            </p>
          </div>
          <button className="button" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? "spin" : ""} />
            Refresh all
          </button>
        </div>
        {sources.map((s) => (
          <div className="source-row" key={s.id}>
            <span className="journal-mark">{s.name.slice(0, 2)}</span>
            <div className="source-info">
              <h3>
                {s.name}
                <span className={`status-badge ${s.error ? "warning" : ""}`}>
                  {s.error
                    ? "Needs attention"
                    : s.enabled
                      ? "Following"
                      : "Paused"}
                </span>
              </h3>
              <p className="source-url">{s.url}</p>
              <small>
                {s.article_count} articles ·{" "}
                {s.last_success
                  ? `Updated ${new Date(s.last_success).toLocaleString()}`
                  : "Awaiting first refresh"}
              </small>
              {s.error && <p className="source-error">{s.error}</p>}
            </div>
            <div className="source-controls">
              <button
                className="button small"
                disabled={pending === s.id}
                onClick={() => update(s, { enabled: !s.enabled })}
              >
                {s.enabled ? "Pause" : "Resume"}
              </button>
              <button
                className="icon-button"
                aria-label={`Remove ${s.name}`}
                onClick={() => setRemove(s)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          </div>
        ))}
        {!sources.length && (
          <div className="empty-state">
            <Rss size={30} />
            <h3>Follow your first source</h3>
            <p>Add any journal RSS feed or PubMed search feed.</p>
          </div>
        )}
        <button className="add-source-row" onClick={add}>
          <Plus size={18} />
          Follow another source
        </button>
      </div>
      <div className="source-explainer">
        <div>
          <Rss size={22} />
          <h3>Journal RSS & Atom</h3>
          <p>
            Find the RSS link on a journal’s website. Paste it once, and new
            articles will appear here.
          </p>
        </div>
        <div>
          <Search size={22} />
          <h3>PubMed search feeds</h3>
          <p>
            Follow a specific topic or search. Create an RSS feed on PubMed and
            add it like any journal.
          </p>
        </div>
        <div>
          <Bookmark size={22} />
          <h3>Your library stays yours</h3>
          <p>
            Pausing stops updates. Removing a source keeps its saved and
            favorited articles in your library.
          </p>
        </div>
      </div>
      {remove && (
        <Modal label="Remove source" onClose={() => setRemove(null)}>
          <h2>Stop following {remove.name}?</h2>
          <p className="modal-subtitle">
            Its articles will leave the latest feed unless another source
            includes them. Saved papers and favorites will stay in your library.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setRemove(null)}>
              Keep source
            </button>
            <button
              className="button danger"
              onClick={async () => {
                try {
                  await api(`/sources/${remove.id}`, "DELETE");
                  setRemove(null);
                  await changed();
                  notify(
                    "Source removed. Saved articles and favorites are still in your library.",
                  );
                } catch (e) {
                  notify(e.message);
                }
              }}
            >
              Remove source
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function SettingsView({
  settings,
  logout,
  passwordRequired,
  connectionChanged,
}) {
  return (
    <div className="settings-page">
      <div className="section-card">
        <div className="section-card-heading">
          <div>
            <h2>Full-text access</h2>
            <p>More paths to the paper you want to read.</p>
          </div>
          <Library size={23} />
        </div>
        <div className="setting-row">
          <span className="uk-mark">UK</span>
          <div>
            <h3>University of Kentucky</h3>
            <p>
              Open through UK uses OpenAthens to sign in with linkblue, then
              opens the publisher in a browser tab. Subscription coverage varies
              by article. Your UK password stays with UK.
            </p>
            <a
              href="https://libraries.uky.edu/access"
              target="_blank"
              rel="noreferrer"
            >
              Library access information <ExternalLink size={13} />
            </a>
          </div>
          <span className="status-badge">Ready</span>
        </div>
        <div className="setting-row">
          <span className="setting-symbol">
            <Unlock size={23} />
          </span>
          <div>
            <h3>Free full text</h3>
            <p>
              Look up lawful copies in PubMed Central
              {settings.unpaywallConfigured
                ? " and Unpaywall"
                : ". Add UNPAYWALL_EMAIL to the server environment to include Unpaywall’s DOI lookup"}
              .
            </p>
            <small>
              No result means no copy was found in the sources checked.
            </small>
          </div>
          <span className="status-badge">
            {settings.unpaywallConfigured ? "PMC + Unpaywall" : "PMC ready"}
          </span>
        </div>
      </div>
      <ZoteroSettings
        connection={settings.zotero}
        request={api}
        changed={connectionChanged}
      />
      <div className="section-card">
        <div className="section-card-heading">
          <div>
            <h2>Library & storage</h2>
            <p>Your articles and reading state are stored on your homelab.</p>
          </div>
          <BookOpen size={22} />
        </div>
        <div className="setting-row">
          <div>
            <h3>Automatic updates</h3>
            <p>
              Feeds refresh on startup and every {settings.refreshMinutes || 60}{" "}
              minutes while the server is running. You can refresh manually
              anytime.
            </p>
          </div>
        </div>
        <div className="setting-row">
          <div>
            <h3>Take a copy of your library</h3>
            <p>
              Export your sources, article metadata, and reading state as JSON.
              See the project README for a restorable SQLite backup.
            </p>
          </div>
          <a href="/api/export" className="button small">
            <Download size={16} />
            Export data
          </a>
        </div>
        {passwordRequired && (
          <div className="setting-row">
            <div>
              <h3>Session</h3>
              <p>Signed in to your personal reader.</p>
            </div>
            <button className="button small" onClick={logout}>
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
function ArticleDetail({
  a,
  onClose,
  change,
  busy,
  settings,
  notify,
  share,
  updated,
}) {
  const [access, setAccess] = useState(null);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const links = articleLinks(a);
  useEffect(() => {
    const tags = [];
    function tag(name, content) {
      if (!content) return;
      const el = document.createElement("meta");
      el.name = name;
      el.content = content;
      document.head.appendChild(el);
      tags.push(el);
    }
    tag("citation_title", a.title);
    a.authors.forEach((author) => tag("citation_author", author));
    tag("citation_journal_title", a.journal);
    tag("citation_date", a.published?.slice(0, 10));
    tag("citation_doi", a.doi);
    tag("citation_pmid", a.pmid);
    tag("citation_abstract", a.abstract);
    tag("citation_public_url", a.url);
    const previous = document.title;
    document.title = `${a.title} · Research Reader`;
    document.dispatchEvent(
      new Event("ZoteroItemUpdated", { bubbles: true, cancelable: true }),
    );
    return () => {
      tags.forEach((t) => t.remove());
      document.title = previous;
      document.dispatchEvent(
        new Event("ZoteroItemUpdated", { bubbles: true, cancelable: true }),
      );
    };
  }, [a]);
  async function action(kind) {
    setWorking(kind);
    setMessage("");
    try {
      const data = await api(`/articles/${a.id}/${kind}`, "POST");
      if (kind === "metadata") {
        updated(data.article);
        setMessage(data.message);
      }
      if (kind === "access") {
        setAccess(data);
        updated(data.article);
      }
      if (kind === "zotero") {
        updated({ ...a, zotero_key: data.key });
        setMessage(
          data.alreadySaved
            ? "This citation is already in your Zotero library."
            : "Citation saved to Zotero.",
        );
      }
    } catch (e) {
      setMessage(e.message);
    } finally {
      setWorking("");
    }
  }
  return (
    <Modal wide label="Article details" onClose={onClose}>
      <div className="detail-top">
        <button className="text-button" onClick={onClose}>
          <ArrowLeft size={17} />
          Back to reading
        </button>
        <button
          className="icon-button"
          aria-label="Close article"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      <div className="article-meta">
        <span className="journal-chip">{sourceLabel(a)}</span>
        <span>{dateLabel(a)}</span>
      </div>
      <h2 className="detail-title">{a.title}</h2>
      <p className="detail-authors">
        {a.authors.join(", ") || "Authors not supplied by this feed"}
      </p>
      <div className="detail-controls">
        <button
          className={`button small ${a.saved ? "tinted" : ""}`}
          disabled={busy[`${a.id}:saved`]}
          onClick={() => change(a, "saved")}
        >
          <Bookmark size={16} fill={a.saved ? "currentColor" : "none"} />
          {a.saved ? "Saved" : "Save for later"}
        </button>
        <button
          className={`button small ${a.favorite ? "tinted" : ""}`}
          disabled={busy[`${a.id}:favorite`]}
          onClick={() => change(a, "favorite")}
        >
          <Star size={16} fill={a.favorite ? "currentColor" : "none"} />
          {a.favorite ? "Favorited" : "Favorite"}
        </button>
        <button className="button small" onClick={() => share(a)}>
          <Share2 size={16} />
          Share
        </button>
        <button
          className="text-button read-state"
          onClick={() => change(a, "read")}
        >
          {a.read ? "Mark unread" : "Mark read"}
        </button>
      </div>
      {message && (
        <p className="detail-message" role="status">
          {message}
        </p>
      )}
      <section className="abstract-section">
        <div className="abstract-heading">
          <h3>Abstract</h3>
          {a.abstract && <span>{a.abstract_source}</span>}
        </div>
        {a.abstract ? (
          <div className="abstract-full">{a.abstract}</div>
        ) : (
          <div className="abstract-missing">
            <FileText size={25} />
            <h4>No abstract in this feed</h4>
            <p>
              The journal supplied citation details only. We can check for an
              exact match in Europe PMC / PubMed.
            </p>
            <button
              className="button small"
              disabled={!!working}
              onClick={() => action("metadata")}
            >
              {working === "metadata" ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Search size={16} />
              )}
              Look up abstract
            </button>
          </div>
        )}
      </section>
      <section className="fulltext-section">
        <h3>Keep reading</h3>
        <p>
          Find a free copy, use your library, or go straight to the journal.
        </p>
        <div className="access-options">
          <button
            className="access-option"
            disabled={!!working}
            onClick={() => action("access")}
          >
            <span className="access-icon">
              <Unlock size={21} />
            </span>
            <span>
              <strong>
                {working === "access"
                  ? "Looking for a free copy…"
                  : "Find free full text"}
              </strong>
              <small>Check available open-access sources</small>
            </span>
            {working === "access" ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <ChevronRight size={18} />
            )}
          </button>
          {access && (
            <div
              className={`access-result ${access.oa.status === "found" ? "found" : ""}`}
            >
              {access.oa.status === "found" ? (
                <>
                  <Check size={18} />
                  <div>
                    <a href={access.oa.url} target="_blank" rel="noreferrer">
                      Read free copy <ArrowUpRight size={14} />
                    </a>
                    <small>
                      {access.oa.provider} ·{" "}
                      {access.oa.version || "Version not specified"}
                    </small>
                  </div>
                </>
              ) : (
                <>
                  <Search size={18} />
                  <span>
                    {access.oa.message}
                    {!access.oa.unpaywallConfigured &&
                    access.oa.status === "not_found"
                      ? " Unpaywall is not configured."
                      : ""}
                  </span>
                </>
              )}
            </div>
          )}
          {links.uk && (
            <a
              className="access-option"
              href={links.uk}
              target="_blank"
              rel="noreferrer"
            >
              <span className="access-icon uk-small">UK</span>
              <span>
                <strong>Open through UK</strong>
                <small>
                  OpenAthens · linkblue sign-in · opens in a browser tab
                </small>
              </span>
              <ArrowUpRight size={18} />
            </a>
          )}
          <a
            className="access-option"
            href={links.publisher || a.url}
            target="_blank"
            rel="noreferrer"
          >
            <span className="access-icon">
              <ExternalLink size={20} />
            </span>
            <span>
              <strong>
                {links.publisher ? "Open publisher page" : "Open PubMed record"}
              </strong>
              <small>
                {links.publisher
                  ? "Full text depends on the journal’s access options"
                  : "Check the record for full-text links"}
              </small>
            </span>
            <ArrowUpRight size={18} />
          </a>
          {links.pubmed && links.publisher && (
            <a
              className="text-button libkey-link"
              href={links.pubmed}
              target="_blank"
              rel="noreferrer"
            >
              View PubMed record <ArrowUpRight size={14} />
            </a>
          )}
          {access?.libkey && (
            <a
              className="text-button libkey-link"
              href={access.libkey}
              target="_blank"
              rel="noreferrer"
            >
              Try LibKey library lookup <ArrowUpRight size={14} />
            </a>
          )}
        </div>
      </section>
      <section className="zotero-section">
        <div>
          <h3>Keep it in Zotero</h3>
          <p>
            {settings.zoteroConfigured
              ? "Save this citation to your reference library."
              : "Export a citation, or open the publisher and share to Zotero."}
          </p>
        </div>
        <div className="zotero-buttons">
          {settings.zoteroConfigured && (
            <button
              className="button primary small"
              disabled={!!working || !!a.zotero_key}
              onClick={() => action("zotero")}
            >
              {working === "zotero" ? (
                <LoaderCircle className="spin" size={15} />
              ) : a.zotero_key ? (
                <Check size={15} />
              ) : (
                <Plus size={15} />
              )}{" "}
              {a.zotero_key ? "In Zotero" : "Send to Zotero"}
            </button>
          )}
          <a className="button small" href={`/api/articles/${a.id}/ris`}>
            <Download size={15} />
            Export RIS
          </a>
        </div>
      </section>
      {(a.doi || a.pmid) && (
        <div className="article-identifiers">
          {a.doi && <span>DOI: {a.doi}</span>}
          {a.pmid && (
            <a
              href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`}
              target="_blank"
              rel="noreferrer"
            >
              PMID: {a.pmid} <ArrowUpRight size={12} />
            </a>
          )}
        </div>
      )}
    </Modal>
  );
}
function Login({ onSuccess }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="login-page">
      <div className="login-card">
        <Logo />
        <span className="eyebrow">WELCOME BACK</span>
        <h1>
          A little space
          <br />
          for discovery.
        </h1>
        <p>Sign in to your personal research library.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api("/login", "POST", { password });
              onSuccess();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            Reader password
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button className="button primary full-width" disabled={busy}>
            {busy ? "Signing in…" : "Open my reading room"}
            <ArrowUpRight size={17} />
          </button>
        </form>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
