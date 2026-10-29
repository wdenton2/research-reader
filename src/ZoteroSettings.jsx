import React, { useEffect, useState } from "react";
import { ArrowUpRight, Check, LoaderCircle, RefreshCw } from "lucide-react";

export default function ZoteroSettings({ connection = {}, request, changed }) {
  const [apiKey, setApiKey] = useState("");
  const [collections, setCollections] = useState([]);
  const [collectionKey, setCollectionKey] = useState(
    connection.collectionKey || "",
  );
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [collectionError, setCollectionError] = useState("");
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    setCollectionKey(connection.collectionKey || "");
  }, [connection.collectionKey, connection.userId]);
  useEffect(() => {
    let active = true;
    setCollections([]);
    setCollectionError("");
    if (!connection.configured) return;
    setLoadingCollections(true);
    request("/settings/zotero/collections")
      .then((data) => {
        if (active) setCollections(data.collections);
      })
      .catch((e) => {
        if (active) setCollectionError(e.message);
      })
      .finally(() => {
        if (active) setLoadingCollections(false);
      });
    return () => {
      active = false;
    };
  }, [connection.configured, connection.userId, connection.verifiedAt, reload]);

  async function action(kind) {
    setWorking(kind);
    setError("");
    setMessage("");
    try {
      if (kind === "connect") {
        await request("/settings/zotero", "PUT", { apiKey });
        setApiKey("");
        setMessage("Connected. You can now send citations to Zotero.");
      } else if (kind === "verify") {
        await request("/settings/zotero/verify", "POST");
        setMessage(
          "Connection verified. Personal-library read and write access is available.",
        );
      } else if (kind === "destination") {
        await request("/settings/zotero", "PATCH", { collectionKey });
        setMessage("Destination saved for future citations.");
      } else {
        await request("/settings/zotero", "DELETE");
        setApiKey("");
        setMessage("Disconnected. Your Zotero library is unchanged.");
      }
      await changed();
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking("");
    }
  }
  function collectionLabel(c, seen = new Set()) {
    if (!c.parent || seen.has(c.key)) return c.name;
    seen.add(c.key);
    const parent = collections.find((x) => x.key === c.parent);
    return parent ? `${collectionLabel(parent, seen)} / ${c.name}` : c.name;
  }
  return (
    <section
      className="section-card zotero-settings"
      aria-labelledby="zotero-settings-title"
    >
      <div className="section-card-heading">
        <div>
          <h2 id="zotero-settings-title">Zotero</h2>
          <p>From a good read to your reference library.</p>
        </div>
        <span className="zotero-mark">Z</span>
      </div>
      <div className="connection-summary">
        <div>
          <h3>
            {connection.configured
              ? `Connected to ${connection.username || `user ${connection.userId}`}`
              : "Connect your personal library"}
          </h3>
          <p>
            {connection.configured
              ? "Send to Zotero saves citation details and abstracts. PDF attachments are not downloaded."
              : "Create a dedicated API key with personal-library access and write access. Your account is detected automatically."}
          </p>
          {connection.source === "environment" && connection.configured && (
            <p className="connection-note">
              Using your server configuration. You can replace the key or choose
              a collection here.
            </p>
          )}
        </div>
        <span className="status-badge">
          {connection.configured ? "Connected" : "Not connected"}
        </span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action("connect");
        }}
        className="connection-form"
      >
        <label className="field" htmlFor="zotero-api-key">
          {connection.configured ? "Replace API key" : "API key"}
          <input
            id="zotero-api-key"
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              connection.configured
                ? "Enter a new key to replace the saved key"
                : "Paste your Zotero API key"
            }
            maxLength={128}
            required
            disabled={!!working}
            aria-describedby="zotero-key-help"
          />
        </label>
        <p id="zotero-key-help" className="connection-note">
          Your key is encrypted on this server and is never returned to the
          browser or included in library exports.
        </p>
        <div className="connection-actions">
          <button
            className="button primary"
            type="submit"
            disabled={!!working || !apiKey.trim()}
          >
            {working === "connect" && (
              <LoaderCircle size={16} className="spin" />
            )}
            {connection.configured ? "Update key" : "Connect Zotero"}
          </button>
          <a
            href="https://www.zotero.org/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="text-button"
          >
            Create an API key <ArrowUpRight size={14} />
          </a>
        </div>
      </form>
      {connection.configured && (
        <div className="connection-destination">
          <label className="field" htmlFor="zotero-collection">
            Save new citations to
            <select
              id="zotero-collection"
              value={collectionKey}
              onChange={(e) => setCollectionKey(e.target.value)}
              disabled={!!working || loadingCollections}
            >
              <option value="">My Library (no collection)</option>
              {connection.collectionKey &&
                !collections.some(
                  (c) => c.key === connection.collectionKey,
                ) && (
                  <option value={connection.collectionKey}>
                    {connection.collectionName || connection.collectionKey}
                  </option>
                )}
              {collections.map((c) => (
                <option key={c.key} value={c.key}>
                  {collectionLabel(c)}
                </option>
              ))}
            </select>
          </label>
          {loadingCollections && (
            <p className="connection-note" role="status">
              Loading collections…
            </p>
          )}
          {collectionError && (
            <p className="form-error" role="alert">
              {collectionError}
            </p>
          )}
          <div className="connection-actions">
            <button
              className="button small"
              disabled={
                !!working ||
                loadingCollections ||
                collectionKey === (connection.collectionKey || "")
              }
              onClick={() => action("destination")}
            >
              {working === "destination" && (
                <LoaderCircle size={15} className="spin" />
              )}
              Save destination
            </button>
            <button
              className="text-button"
              disabled={!!working || loadingCollections}
              onClick={() => setReload((x) => x + 1)}
            >
              <RefreshCw size={14} />
              Refresh collections
            </button>
          </div>
          <div className="connection-actions connection-maintenance">
            <button
              className="button small"
              disabled={!!working}
              onClick={() => action("verify")}
            >
              {working === "verify" ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Check size={15} />
              )}
              Test connection
            </button>
            <button
              className="text-button danger"
              disabled={!!working}
              onClick={() => action("disconnect")}
            >
              Disconnect Zotero
            </button>
          </div>
          <p className="connection-note">
            Changing collections affects future saves. Disconnecting removes the
            key from Research Reader; it doesn’t delete citations or revoke the
            key at Zotero.
          </p>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="connection-message" role="status">
          {message}
        </p>
      )}
      <p className="connection-note connection-footer">
        You can always export RIS or use Share → Zotero from the publisher page.
      </p>
    </section>
  );
}
