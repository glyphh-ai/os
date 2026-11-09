// voice — ElevenLabs text-to-speech and speech-to-text. The key never leaves
// the main process; the renderer hands over text or audio and gets back bytes
// or words.
import { getElevenKey, getSettings } from "./store.js";

const API = "https://api.elevenlabs.io/v1";

function key() {
  const k = getElevenKey();
  if (!k) throw new Error("Set your ElevenLabs API key in Settings (top right).");
  return k;
}

async function fail(res) {
  let msg = `${res.status} ${res.statusText}`;
  try { const j = await res.json(); msg = j?.detail?.message || j?.detail || msg; } catch { /* body was not json */ }
  throw new Error(`ElevenLabs: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
}

/** text → mp3 bytes, in the given voice (a bot's) or the user's chosen one. */
export async function speak(text, voiceId) {
  const s = getSettings();
  const res = await fetch(`${API}/text-to-speech/${encodeURIComponent(voiceId || s.voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key(), "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: s.ttsModel, voice_settings: { stability: 0.45, similarity_boost: 0.8 } }),
  });
  if (!res.ok) await fail(res);
  return new Uint8Array(await res.arrayBuffer());
}

/** audio bytes (webm/opus from MediaRecorder) → text. */
export async function transcribe(bytes, mime = "audio/webm") {
  const s = getSettings();
  const form = new FormData();
  form.append("model_id", s.sttModel);
  form.append("file", new Blob([bytes], { type: mime }), "speech.webm");
  const res = await fetch(`${API}/speech-to-text`, { method: "POST", headers: { "xi-api-key": key() }, body: form });
  if (!res.ok) await fail(res);
  const j = await res.json();
  return (j.text || "").trim();
}

export async function voices() {
  const res = await fetch(`${API}/voices`, { headers: { "xi-api-key": key() } });
  if (!res.ok) await fail(res);
  const j = await res.json();
  return (j.voices || []).map((v) => ({ id: v.voice_id, name: v.name, labels: v.labels || {} }));
}
