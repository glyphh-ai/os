// rpa — drive the web apps open in the OS. Every web panel is a <webview> in
// the renderer; it registers its webContents id here on dom-ready, so the agent
// clicks, types, reads and screenshots it straight from main.
import { webContents } from "electron";

const targets = new Map(); // app id → webContents id

export function register(app, wcId) { if (app && Number.isInteger(wcId)) targets.set(app, wcId); }
export function unregister(app) { targets.delete(app); }
export function liveApps() {
  return [...targets.entries()].filter(([, id]) => { const wc = webContents.fromId(id); return wc && !wc.isDestroyed(); })
    .map(([app, id]) => { const wc = webContents.fromId(id); return { app, url: wc.getURL(), title: wc.getTitle() }; });
}

function wcOf(app) {
  const id = targets.get(app);
  const wc = id !== undefined ? webContents.fromId(id) : undefined;
  if (!wc || wc.isDestroyed()) throw new Error(`"${app}" is not open as a web panel — open it with os_open first`);
  return wc;
}

const J = JSON.stringify;

async function waitFor(wc, selector, ms = 8000) {
  if (!selector) return;
  const ok = await wc.executeJavaScript(`new Promise((res) => {
    const t0 = Date.now();
    const tick = () => { if (document.querySelector(${J(selector)})) return res(true); if (Date.now() - t0 > ${ms}) return res(false); setTimeout(tick, 120); };
    tick();
  })`);
  if (!ok) throw new Error(`timed out waiting for ${selector}`);
}

export async function goto(app, url) {
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const wc = wcOf(app);
  await wc.loadURL(url);
  return `${app} → ${wc.getURL()}`;
}

export async function click(app, selector, text) {
  const wc = wcOf(app);
  await waitFor(wc, selector || "body");
  return wc.executeJavaScript(`(() => {
    let els = [...document.querySelectorAll(${J(selector || "a,button,[role=button],input[type=submit]")})];
    const want = ${J(text || "")}.toLowerCase();
    if (want) els = els.filter((e) => (e.innerText || e.value || e.getAttribute("aria-label") || "").toLowerCase().includes(want));
    const el = els[0];
    if (!el) return "no element matched";
    el.scrollIntoView({ block: "center" });
    el.focus?.();
    el.click();
    return "clicked " + (el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 80);
  })()`);
}

export async function type(app, selector, text, submit) {
  const wc = wcOf(app);
  await waitFor(wc, selector);
  await wc.executeJavaScript(`(() => {
    const el = document.querySelector(${J(selector)});
    el.scrollIntoView({ block: "center" }); el.focus();
    if (el.isContentEditable) { document.execCommand("selectAll"); document.execCommand("insertText", false, ${J(text)}); return; }
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${J(text)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  if (submit) {
    wc.sendInputEvent({ type: "keyDown", keyCode: "Return" });
    wc.sendInputEvent({ type: "char", keyCode: "\r" });
    wc.sendInputEvent({ type: "keyUp", keyCode: "Return" });
  }
  return `typed into ${selector}${submit ? " and pressed Enter" : ""}`;
}

export async function key(app, keyCode, modifiers = []) {
  const wc = wcOf(app);
  wc.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  wc.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  return `pressed ${[...modifiers, keyCode].join("+")}`;
}

export async function read(app, selector, html) {
  const wc = wcOf(app);
  const out = await wc.executeJavaScript(`(() => {
    const el = ${selector ? `document.querySelector(${J(selector)})` : "document.body"};
    if (!el) return "no element matched";
    return ${html ? "el.outerHTML" : "el.innerText"};
  })()`);
  return `${wc.getTitle()} — ${wc.getURL()}\n\n${String(out).slice(0, 40000)}`;
}

/** A map of what can be clicked or typed into, so the agent can pick selectors. */
export async function outline(app) {
  const wc = wcOf(app);
  return wc.executeJavaScript(`(() => {
    const sel = (e) => e.id ? "#" + CSS.escape(e.id)
      : e.getAttribute("data-testid") ? '[data-testid="' + e.getAttribute("data-testid") + '"]'
      : e.getAttribute("aria-label") ? e.tagName.toLowerCase() + '[aria-label="' + e.getAttribute("aria-label").replace(/"/g, '\\\\"') + '"]'
      : e.name ? e.tagName.toLowerCase() + '[name="' + e.name + '"]' : e.tagName.toLowerCase();
    const els = [...document.querySelectorAll("a,button,input,textarea,select,[role=button],[role=link],[role=tab],[contenteditable=true]")]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).slice(0, 200);
    return els.map((e) => sel(e) + "  " + (e.innerText || e.value || e.placeholder || e.getAttribute("aria-label") || "").trim().replace(/\\s+/g, " ").slice(0, 60)).join("\\n");
  })()`);
}

export async function evaluate(app, script) {
  const out = await wcOf(app).executeJavaScript(script, true);
  return typeof out === "string" ? out : JSON.stringify(out, null, 2)?.slice(0, 40000) ?? "undefined";
}

export async function screenshot(app) {
  const img = await wcOf(app).capturePage();
  return img.resize({ width: Math.min(1280, img.getSize().width) }).toPNG().toString("base64");
}
