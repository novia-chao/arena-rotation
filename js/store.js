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
  mode: "card", // "card" | "bleed"
};

const KEY = "arena-rotation:settings";

/** Key/value storage over whichever backend this host provides. */
export const storage = (() => {
  const ext =
    typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  if (ext) {
    return {
      async read(key) {
        const bag = await chrome.storage.local.get(key);
        return bag[key];
      },
      async write(key, value) {
        await chrome.storage.local.set({ [key]: value });
      },
    };
  }
  return {
    async read(key) {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : undefined;
    },
    async write(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    },
  };
})();

let cache = null;

export async function load() {
  if (cache) return cache;
  let stored;
  try {
    stored = await storage.read(KEY);
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
  await storage.write(KEY, next);
  return next;
}

/** Sentinel for `active`: rotate across every saved channel. */
export const ALL_CHANNELS = "*";

/** The channel we should be showing, or null if none is configured yet. */
export function activeChannel(settings) {
  if (!settings.channels.length) return null;
  return (
    settings.channels.find((c) => c.slug === settings.active) ||
    settings.channels[0]
  );
}

/**
 * The channels a draw may come from — every saved channel in all-channels
 * mode, otherwise just the active one.
 *
 * A draw picks uniformly from this list rather than weighting by block count.
 * Weighting would make every block equally likely, but it would also let one
 * 4,000-block channel drown out a carefully kept channel of twelve, and it
 * would cost a request per channel just to learn the sizes.
 */
export function drawPool(settings) {
  if (!settings.channels.length) return [];
  if (settings.active === ALL_CHANNELS) return settings.channels;
  const one = activeChannel(settings);
  return one ? [one] : [];
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
