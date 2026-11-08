// voice — speaking and listening in the renderer. Speech: the agent's reply is
// cut into sentences as it streams, each one fetched from ElevenLabs and
// played in order, its loudness driving the face's jaw. Listening: push to
// talk, or continuous mode, where a voice activity detector records each
// utterance, ElevenLabs transcribes it, and it goes straight to the agent.
const os = window.os;

export function createVoice({ onMouth, onMic, onUtterance, onSpeaking, onError }) {
  const ctx = new AudioContext();
  const out = ctx.createAnalyser(); out.fftSize = 512; out.connect(ctx.destination);
  const buf = new Uint8Array(out.fftSize);

  // ── speaking ────────────────────────────────────────────────────────
  const queue = []; // promises of AudioBuffers, in order
  let playing = false, current = null, pending = "", speakingGen = 0;

  const clean = (t) => t.replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_#>|~]/g, "").replace(/https?:\/\/\S+/g, "a link").replace(/\s+/g, " ").trim();

  function enqueue(sentence) {
    const s = clean(sentence);
    if (!s || !/[a-z0-9]/i.test(s)) return;
    const gen = speakingGen;
    queue.push(os.voice.speak(s).then((bytes) => ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)))
      .catch((e) => { if (gen === speakingGen) onError?.(e.message); return null; }));
    if (!playing) playNext();
  }

  async function playNext() {
    if (!queue.length) { playing = false; onSpeaking?.(false); return; }
    playing = true; onSpeaking?.(true);
    const gen = speakingGen;
    const audio = await queue.shift();
    if (gen !== speakingGen) return;
    if (!audio) return playNext();
    if (ctx.state === "suspended") await ctx.resume();
    const src = ctx.createBufferSource(); src.buffer = audio; src.connect(out);
    current = src;
    src.onended = () => { current = null; playNext(); };
    src.start();
  }

  /** Feed streamed text; whole sentences go out as soon as they end. */
  function feed(delta) {
    pending += delta;
    // don't read code aloud: hold everything while a fence is open
    if ((pending.match(/```/g) || []).length % 2 === 1) return;
    const re = /^([\s\S]*?[.!?…](?:["')\]]*)?)(\s+|\n)/;
    let m;
    while ((m = pending.match(re)) && m[1].length > 12) { enqueue(m[1]); pending = pending.slice(m[0].length); }
    if (pending.includes("\n\n")) { const [a, ...b] = pending.split("\n\n"); enqueue(a); pending = b.join("\n\n"); }
  }
  function flush() { if (pending.trim()) enqueue(pending); pending = ""; }
  function stopSpeaking() {
    speakingGen++; queue.length = 0; pending = "";
    try { current?.stop(); } catch { /* not started */ }
    current = null; playing = false; onSpeaking?.(false);
  }

  // ── listening ───────────────────────────────────────────────────────
  let stream = null, micNode = null, micAn = null, recorder = null, chunks = [], continuous = false, vadOn = false;
  let speechStart = 0, lastLoud = 0, threshold = 0.035;
  const micBuf = new Float32Array(1024);

  async function ensureMic() {
    if (stream) return;
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    micNode = ctx.createMediaStreamSource(stream);
    micAn = ctx.createAnalyser(); micAn.fftSize = 1024; micNode.connect(micAn);
  }

  function startRec() {
    if (recorder) return;
    chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const took = performance.now() - speechStart;
      recorder = null;
      if (blob.size < 2500 || took < 350) return;
      try {
        const text = await os.voice.transcribe(new Uint8Array(await blob.arrayBuffer()), "audio/webm");
        if (text && !/^\(.*\)$/.test(text)) onUtterance(text);
      } catch (e) { onError?.(e.message); }
    };
    recorder.start(250);
    speechStart = performance.now();
  }
  function stopRec() { if (recorder && recorder.state !== "inactive") recorder.stop(); }

  function level() {
    if (!micAn) return 0;
    micAn.getFloatTimeDomainData(micBuf);
    let s = 0; for (const v of micBuf) s += v * v;
    return Math.sqrt(s / micBuf.length);
  }

  // one loop for both meters: the jaw from what plays, the mic from what we hear
  function tick() {
    requestAnimationFrame(tick);
    out.getByteTimeDomainData(buf);
    let s = 0; for (const v of buf) { const d = (v - 128) / 128; s += d * d; }
    onMouth(current ? Math.min(1, Math.sqrt(s / buf.length) * 5) : 0);

    const lv = level();
    onMic(Math.min(1, lv * 8));
    if (!vadOn || !continuous) return;
    const now = performance.now();
    if (playing) { // barge-in: talk over it to cut it off
      if (lv > threshold * 2.4) { stopSpeaking(); }
      else return;
    }
    if (lv > threshold) { lastLoud = now; if (!recorder) startRec(); }
    else if (recorder && now - lastLoud > 900) stopRec();
    if (recorder && now - speechStart > 30000) stopRec();
  }
  tick();

  return {
    feed, flush, stopSpeaking,
    get speaking() { return playing; },
    setThreshold(v) { threshold = v; },
    async pushStart() { await ensureMic(); if (ctx.state === "suspended") await ctx.resume(); stopSpeaking(); startRec(); },
    pushStop() { stopRec(); },
    async setContinuous(on) {
      continuous = on;
      if (on) { await ensureMic(); if (ctx.state === "suspended") await ctx.resume(); vadOn = true; }
      else { vadOn = false; stopRec(); }
    },
    pause(p) { vadOn = !p && continuous; if (p) stopRec(); },
    get recording() { return !!recorder; },
  };
}
