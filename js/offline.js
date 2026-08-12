/**
 * Offline fallback.
 *
 * A new tab page gets opened dozens of times a day, including on a train or
 * behind a captive portal. Rather than showing an error, we keep a pool of
 * recently seen blocks and draw from it when are.na can't be reached.
 *
 * Two stores, because the two halves have very different sizes:
 *   - block JSON goes in key/value storage (a few KB each)
 *   - images go in the Cache API, which is backed by disk and won't blow the
 *     much smaller chrome.storage/localStorage quotas (a single are.na image
 *     is routinely 1–2 MB)
 */

import { storage } from "./store.js";

const POOL_KEY = "arena-rotation:pool";
const IMAGE_CACHE = "arena-rotation-images-v1";

const MAX_BLOCKS = 60;
const MAX_IMAGES = 24;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const hasCacheApi = typeof caches !== "undefined";

/* ------------------------------------------------------------ block pool */

async function readPool() {
  try {
    return (await storage.read(POOL_KEY)) || [];
  } catch {
    return [];
  }
}

/** Records a block so it can be drawn again with no network. */
export async function remember(block, slug) {
  try {
    const pool = await readPool();
    const next = [
      { slug, block },
      ...pool.filter((entry) => entry.block?.id !== block.id),
    ].slice(0, MAX_BLOCKS);
    await storage.write(POOL_KEY, next);
  } catch {
    /* a full quota shouldn't break the page */
  }
  cacheImage(block.image?.src);
}

/**
 * A block we can actually show right now: either it needs no image, or its
 * image is already in the cache. Without this check an offline draw can land
 * on an image block and render an empty frame.
 */
async function renderable(block) {
  const src = block?.image?.src;
  if (!src) return true;
  return hasCachedImage(src);
}

/** Presence check only — deliberately does not mint an object URL. */
async function hasCachedImage(src) {
  if (!hasCacheApi) return false;
  try {
    const cache = await caches.open(IMAGE_CACHE);
    return Boolean(await cache.match(src));
  } catch {
    return false;
  }
}

/** Random cached block for a channel, or null if nothing usable is stored. */
export async function drawCached(slug, avoid = []) {
  const pool = await readPool();
  const mine = pool.filter((entry) => entry.slug === slug).map((e) => e.block);
  if (!mine.length) return null;

  const usable = [];
  for (const block of mine) {
    if (await renderable(block)) usable.push(block);
  }
  if (!usable.length) return null;

  const fresh = usable.filter((block) => !avoid.includes(block.id));
  const pick = fresh.length ? fresh : usable;
  return pick[Math.floor(Math.random() * pick.length)];
}

/* ---------------------------------------------------------- image cache */

/** Stores an image for offline use. Fire-and-forget; failures are ignored. */
export async function cacheImage(src) {
  if (!src || !hasCacheApi) return;
  try {
    const cache = await caches.open(IMAGE_CACHE);
    if (await cache.match(src)) return;

    const response = await fetch(src, { mode: "cors" });
    if (!response.ok) return;

    const size = Number(response.headers.get("content-length") || 0);
    if (size > MAX_IMAGE_BYTES) return;

    await cache.put(src, response);
    // cache.keys() is insertion-ordered, so the oldest are at the front.
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_IMAGES))) {
      await cache.delete(key);
    }
  } catch {
    /* offline, opaque, or over quota — nothing to do */
  }
}

let lastObjectUrl = "";

/**
 * A usable src for a cached image, as an object URL. Returns "" on a miss.
 * Only one is held at a time; the previous is revoked so blobs don't pile up.
 */
export async function cachedImage(src) {
  if (!src || !hasCacheApi) return "";
  try {
    const cache = await caches.open(IMAGE_CACHE);
    const hit = await cache.match(src);
    if (!hit) return "";

    const url = URL.createObjectURL(await hit.blob());
    if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = url;
    return url;
  } catch {
    return "";
  }
}
