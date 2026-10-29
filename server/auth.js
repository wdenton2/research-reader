import { createHmac, timingSafeEqual } from "node:crypto";
const equals = (a, b) => {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};
export function installAuth(app) {
  const password = process.env.APP_PASSWORD;
  const secure =
    process.env.PUBLIC_URL?.startsWith("https://") ||
    process.env.COOKIE_SECURE === "true";
  const sign = (expires) =>
    createHmac("sha256", password).update(expires).digest("base64url");
  const isAuthed = (req) => {
    if (!password) return true;
    const token =
      req.headers.cookie
        ?.split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("rr_session="))
        ?.slice(11) || "";
    const [expiry, signature = ""] = token.split(".");
    return (
      /^\d+$/.test(expiry || "") &&
      Number(expiry) > Date.now() &&
      equals(signature, sign(expiry))
    );
  };
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      const allowed = process.env.PUBLIC_URL
        ? new URL(process.env.PUBLIC_URL).origin
        : `${req.protocol}://${req.headers.host}`;
      if (
        (origin && origin !== allowed) ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        return res
          .status(403)
          .json({ error: "Cross-origin requests are not allowed." });
      if (!req.is("application/json"))
        return res.status(415).json({ error: "JSON requests are required." });
    }
    next();
  });
  const attempts = new Map();
  app.get("/api/session", (req, res) =>
    res.json({ authenticated: isAuthed(req), passwordRequired: !!password }),
  );
  app.post("/api/login", (req, res) => {
    if (!password) return res.json({ ok: true });
    const key = req.socket.remoteAddress;
    const prior = attempts.get(key);
    const record =
      prior && Date.now() - prior.start < 600000
        ? prior
        : { count: 0, start: Date.now() };
    if (record.count >= 10)
      return res
        .status(429)
        .json({ error: "Too many attempts. Please wait 10 minutes." });
    record.count++;
    attempts.set(key, record);
    if (
      typeof req.body.password !== "string" ||
      !equals(req.body.password, password)
    )
      return res.status(401).json({ error: "That password is not correct." });
    attempts.delete(key);
    const expiry = String(Date.now() + 30 * 86400000);
    res.setHeader(
      "Set-Cookie",
      `rr_session=${expiry}.${sign(expiry)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure ? "; Secure" : ""}`,
    );
    res.json({ ok: true });
  });
  app.post("/api/logout", (_req, res) => {
    res.setHeader(
      "Set-Cookie",
      `rr_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`,
    );
    res.json({ ok: true });
  });
  app.use("/api", (req, res, next) =>
    isAuthed(req)
      ? next()
      : res.status(401).json({ error: "Please sign in to Research Reader." }),
  );
}
