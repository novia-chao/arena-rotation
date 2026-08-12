/**
 * Settings persistence.
 *
 * Runs in two hosts: as a Chrome extension (chrome.storage.local, which syncs
 * across the extension's pages) and as a plain website (localStorage). The
 * adapter picks whichever exists so the rest of the app never has to care.
 */

const DEFAULTS = {
  token: "",
  channels: [], // [{ slug, title, owner }]
  active: "",
  fit: "cover", // "cover" | "contain"
};

const KEY = "arena-rotation:settings";

const backend = (() => {
  const ext =
    typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  if (ext) {
    return {
      async read() {
        const bag = await chrome.storage.local.get(KEY);
        return bag[KEY];
      },
      async write(value) {
        await chrome.storage.local.set({ [KEY]: value });
      },
    };
  }
  return {
    async read() {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : undefined;
    },
    async write(value) {
      localStorage.setItem(KEY, JSON.stringify(value));
    },
  };
})();

let cache = null;

export async function load() {
  if (cache) return cache;
  let stored;
  try {
    stored = await backend.read();
  } catch {
    stored = undefined;
  }
  cache = { ...DEFAULTS, ...(stored || {}) };
  return cache;
}

/**
 * The token as of the last load/update, readable synchronously.
 * The API client needs a token at request time, not a promise.
 */
export function token() {
  return cache?.token || "";
}

export async function update(patch) {
  const next = { ...(await load()), ...patch };
  cache = next;
  await backend.write(next);
  return next;
}

/** The channel we should be showing, or null if none is configured yet. */
export function activeChannel(settings) {
  if (!settings.channels.length) return null;
  return (
    settings.channels.find((c) => c.slug === settings.active) ||
    settings.channels[0]
  );
}

/**
 * Recently shown block ids, so a reshuffle doesn't land on the same block
 * twice in a row. Kept in sessionStorage: it is a nicety, not a setting, and
 * should not accumulate across days.
 */
const RECENT_KEY = "arena-rotation:recent";
const RECENT_MAX = 12;

export function recent() {
  try {
    return JSON.parse(sessionStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

export function remember(id) {
  const list = [id, ...recent().filter((x) => x !== id)].slice(0, RECENT_MAX);
  try {
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* private mode; repeat-avoidance is optional */
  }
}
