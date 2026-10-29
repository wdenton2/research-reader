import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// The wrapping key is separate from SQLite and never included in JSON exports.
export function secretStore(keyFile) {
  function key(create = false) {
    try {
      const bytes = readFileSync(keyFile);
      if (bytes.length !== 32) throw new Error("Invalid key file");
      return bytes;
    } catch (e) {
      if (e.code === "ENOENT" && create) {
        mkdirSync(dirname(keyFile), { recursive: true });
        const bytes = randomBytes(32);
        try {
          writeFileSync(keyFile, bytes, { mode: 0o600, flag: "wx" });
        } catch (writeError) {
          if (writeError.code === "EEXIST") return key();
          throw writeError;
        }
        return bytes;
      }
      throw new Error(
        "The saved connection key is unavailable. Restore the server key file or reconnect Zotero.",
      );
    }
  }
  return {
    encrypt(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key(true), iv);
      const ciphertext = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      return {
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      };
    },
    decrypt(value) {
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key(),
          Buffer.from(value.iv, "base64"),
        );
        decipher.setAuthTag(Buffer.from(value.tag, "base64"));
        return Buffer.concat([
          decipher.update(Buffer.from(value.ciphertext, "base64")),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        throw new Error(
          "The saved connection key is unavailable. Restore the server key file or reconnect Zotero.",
        );
      }
    },
  };
}
