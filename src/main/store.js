// store — Glyphh OS keeps everything under ~/.glyphh/os: settings, layout, dips.
// Secrets (the ElevenLabs key) are sealed with the OS keychain via safeStorage.
import { app, safeStorage } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOME = path.join(os.homedir(), ".glyphh", "os");
fs.mkdirSync(HOME, { recursive: true });

const file = (name) => path.join(HOME, name);

export function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), "utf8")); } catch { return fallback; }
}
export function writeJson(name, value) {
  const p = file(name);
  fs.writeFileSync(p + ".tmp", JSON.stringify(value, null, 2));
  fs.renameSync(p + ".tmp", p);
}

export const DEFAULT_SETTINGS = {
  model: "default",
  effort: "medium",
  permissionMode: "ask",          // ask | auto (bypassPermissions)
  cwd: path.join(os.homedir(), "development"),
  speakReplies: true,
  voiceId: "JBFqnCBsd6RMkjVDRZzb", // ElevenLabs "George": calm, British
  ttsModel: "eleven_flash_v2_5",
  sttModel: "scribe_v1",
  vadThreshold: 0.035,
  claudePath: "",                  // empty = the claude on PATH, else the SDK's own
};

export function getSettings() {
  const s = { ...DEFAULT_SETTINGS, ...readJson("settings.json", {}) };
  delete s.elevenKeySealed;
  return { ...s, elevenKeySet: !!getElevenKey() };
}

export function setSettings(patch) {
  const cur = readJson("settings.json", {});
  const next = { ...cur };
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in patch) next[k] = patch[k];
  if (typeof patch.elevenKey === "string") {
    const key = patch.elevenKey.trim();
    if (!key) delete next.elevenKeySealed;
    else next.elevenKeySealed = safeStorage.isEncryptionAvailable()
      ? "enc:" + safeStorage.encryptString(key).toString("base64")
      : "raw:" + Buffer.from(key).toString("base64");
  }
  writeJson("settings.json", next);
  return getSettings();
}

export function getElevenKey() {
  const sealed = readJson("settings.json", {}).elevenKeySealed;
  if (!sealed) return process.env.ELEVENLABS_API_KEY || "";
  try {
    if (sealed.startsWith("enc:")) return safeStorage.decryptString(Buffer.from(sealed.slice(4), "base64"));
    if (sealed.startsWith("raw:")) return Buffer.from(sealed.slice(4), "base64").toString("utf8");
  } catch { /* keychain refused */ }
  return "";
}

export const appVersion = () => app.getVersion();
