// Anonymous play counts via GoatCounter (https://www.goatcounter.com): no cookies, no personal data.
//
// Setup: create a free GoatCounter site and put its code below, e.g. "namngo-games".
// Leave it empty to turn analytics off completely (nothing is loaded, events only go to console.debug).
//
// GoatCounter ignores localhost. To test from `npm start`, open the game with `?track-local`
// in the URL, e.g. http://127.0.0.1:5173/?track-local
export const GOATCOUNTER_CODE = "";

const queue = [];
let ready = false;

function flush() {
  const gc = window.goatcounter;
  if (!gc?.count) return;
  ready = true;
  while (queue.length) {
    const name = queue.shift();
    try { gc.count({ path: name, title: name, event: true }); } catch { /* blocked or offline */ }
  }
}

/** Load the counter script (also records the page view). Safe to call once at startup. */
export function initAnalytics() {
  if (!GOATCOUNTER_CODE || typeof document === "undefined") return;
  try {
    if (new URLSearchParams(location.search).has("track-local")) {
      window.goatcounter = { ...(window.goatcounter ?? {}), allow_local: true };
    }
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://gc.zgo.at/count.js";
    script.dataset.goatcounter = `https://${GOATCOUNTER_CODE}.goatcounter.com/count`;
    script.addEventListener("load", flush);
    document.head.append(script);
  } catch { /* analytics must never break the game */ }
}

/** Count one event, e.g. track("rts/match-start"). Never throws. */
export function track(name) {
  try {
    console.debug("[analytics]", name);
    if (!GOATCOUNTER_CODE) return;
    queue.push(name);
    if (ready) flush();
  } catch { /* ignore */ }
}
