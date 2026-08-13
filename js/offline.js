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

/**
 * Random cached block drawn from any of `slugs`, or null if nothing usable is
 * stored. Returns the slug too, since in all-channels mode the caller doesn't
 * know which channel it came from.
 *
 * @param {string[]} slugs channels the draw may come from
 */
export async function drawCached(slugs, avoid = []) {
  const allowed = new Set(slugs);
  const pool = (await readPool()).filter((entry) => allowed.has(entry.slug));
  if (!pool.length) return null;

  const usable = [];
  for (const entry of pool) {
    if (await renderable(entry.block)) usable.push(entry);
  }
  if (!usable.length) return null;

  const fresh = usable.filter((entry) => !avoid.includes(entry.block.id));
  const pick = fresh.length ? fresh : usable;
  return pick[Math.floor(Math.random() * pick.length)];
}

/**
 * An image to stand for a channel in the dock — the most recent one we've
 * shown from it. Free, because the pool already holds these; no extra request
 * just to decorate a tile.
 */
export async function thumbnailFor(slug) {
  const pool = await readPool();
  const hit = pool.find((e) => e.slug === slug && e.block?.image?.src);
  return hit ? hit.block.image.src : "";
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

/**
 * Object URLs are revoked as they age out. Two are kept rather than one: during
 * a transition the outgoing block is still painting from the previous URL, and
 * revoking it immediately can blank it mid-fade.
 */
const liveObjectUrls = [];

/** A usable src for a cached image, as an object URL. Returns "" on a miss. */
export async function cachedImage(src) {
  if (!src || !hasCacheApi) return "";
  try {
    const cache = await caches.open(IMAGE_CACHE);
    const hit = await cache.match(src);
    if (!hit) return "";

    const url = URL.createObjectURL(await hit.blob());
    liveObjectUrls.push(url);
    while (liveObjectUrls.length > 2) URL.revokeObjectURL(liveObjectUrls.shift());
    return url;
  } catch {
    return "";
  }
}
