/**
 * Arena Rotation — one random block from an are.na channel, full bleed.
 *
 * Opening the page (or a new tab, when installed as the extension) draws a
 * block. Clicking, tapping or pressing space draws another; ← goes back.
 */

import { Arena, forgetCount, randomBlock } from "./arena.js";
import { cacheImage, cachedImage, drawCached, remember } from "./offline.js";
import { afterMount, preload, renderBlock, imageSrc } from "./render.js";
import * as store from "./store.js";
import { initDock } from "./dock.js";
import { initProgress } from "./progress.js";
import { initSettings } from "./ui.js";

const stage = document.getElementById("stage");
const hint = document.getElementById("hint");
const arena = new Arena(store.token);

let drawing = false;
let settingsPanel;
let dock;
let progress;

/** False while the card is genied away and only the dock is on screen. */
let cardOpen = true;

/* ------------------------------------------------------------------ stage */

/**
 * How long a leaving view stays before it is removed. Must outlast the longest
 * exit animation in style.css — currently genie-out at 0.68s — or a card gets
 * cut off mid-flight.
 *
 * Removal is on a timer rather than animationend because a leaving view runs
 * several animations at once, on different durations, and the first to finish
 * would otherwise cut the others short.
 */
const EXIT_MS = 700;

/**
 * Points a view's genie animation at its channel's dock tile. The tile's
 * position can only be measured at runtime, so it arrives as custom properties
 * the keyframes read.
 *
 * @returns false when there's no tile to aim at, so the caller can fall back
 *          to an ordinary transition rather than flying into a corner.
 */
function aimGenie(view, slug) {
  const rect = dock?.tileRect(slug);
  if (!rect) return false;

  const target = view.querySelector(".card-frame") || view;
  const box = target.getBoundingClientRect();
  target.style.setProperty(
    "--gx",
    `${rect.left + rect.width / 2 - (box.left + box.width / 2)}px`,
  );
  // Measured from the card's bottom edge, matching transform-origin.
  target.style.setProperty("--gy", `${rect.top + rect.height / 2 - box.bottom}px`);
  return true;
}

/** Sends every view on stage away, with no replacement. */
function clearStage(exit) {
  for (const outgoing of [...stage.children]) {
    if (outgoing.classList.contains("view--leaving")) continue;
    // Aim before the class lands, so the animation starts with the offset set.
    const aimed = exit !== "genie" || aimGenie(outgoing, outgoing.dataset.slug);
    outgoing.classList.add("view--leaving", `view--out-${aimed ? exit : "next"}`);
    setTimeout(() => outgoing.remove(), EXIT_MS);
  }
}

/**
 * @param direction "next", "prev", "first" or "genie" — the transition reads
 *        as motion in the direction you travelled, so going back visibly
 *        rewinds and opening a channel pours out of its dock tile.
 */
function show(node, direction = "first", slug = "") {
  // Every block still on stage is on its way out — not just the first child.
  // Navigating faster than the transition leaves several here at once, and
  // reading only firstElementChild would re-mark the block that is already
  // leaving while the live one stayed behind forever.
  clearStage(direction === "genie" ? "genie" : direction === "prev" ? "prev" : "next");

  node.dataset.slug = slug;
  stage.appendChild(node);
  // Appending first so the frame can be measured; nothing has painted yet, so
  // adding the class in the same task still catches the first frame.
  if (direction === "genie" && !aimGenie(node, slug)) direction = "next";
  node.classList.add(`view--in-${direction}`);
}

function notice(title, body) {
  const wrap = document.createElement("div");
  wrap.className = "view view--bleed";
  const box = document.createElement("div");
  box.className = "notice";
  const h = document.createElement("h1");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = body;
  box.append(h, p);
  wrap.appendChild(box);
  return wrap;
}

function spinner() {
  const wrap = document.createElement("div");
  wrap.className = "view view--bleed";
  const dot = document.createElement("div");
  dot.className = "spinner";
  wrap.appendChild(dot);
  return wrap;
}

let renderSeq = 0;

/**
 * Paints an already-resolved draw. Cached images are looked up here rather
 * than stored on the entry, because object URLs are revoked as they age out
 * and a history entry can outlive its URL.
 */
async function display(entry, direction = "next") {
  // Holding ← fires navigations faster than they can paint. Each render claims
  // a sequence number and stale ones bail, so the last key pressed is the one
  // left on screen regardless of what order the awaits resolve in.
  const seq = ++renderSeq;
  const { fit, mode } = await store.load();
  const imageUrl = entry.offline ? await cachedImage(imageSrc(entry.block)) : "";
  if (seq !== renderSeq) return;

  const view = renderBlock(entry.block, {
    fit,
    mode,
    channel: entry.channel,
    imageUrl,
    offline: entry.offline,
  });
  show(view, direction, entry.channel?.slug || "");
  afterMount(view);
}

/* ---------------------------------------------------------------- history */

const HISTORY_MAX = 30;
const history = []; // { block, channel, offline }
let cursor = -1;

function pushHistory(entry) {
  history.splice(cursor + 1); // a fresh draw discards anything ahead
  history.push(entry);
  if (history.length > HISTORY_MAX) history.shift();
  cursor = history.length - 1;
  progress?.update(history.length, cursor);
}

async function goBack() {
  if (cursor <= 0) return false;
  cursor--;
  progress?.update(history.length, cursor);
  await display(history[cursor], "prev");
  return true;
}

async function goForward() {
  if (cursor >= history.length - 1) return false;
  cursor++;
  progress?.update(history.length, cursor);
  await display(history[cursor], "next");
  return true;
}

/* --------------------------------------------------------------- prefetch */

/**
 * The next block, fetched and decoded while you're still looking at the
 * current one, so a click swaps instantly instead of waiting on the network.
 */
let buffered = null; // { channel, block }
let prefetching = false;

const randomOf = (list) => list[Math.floor(Math.random() * list.length)];

/** A buffered block is only usable if its channel is still in play. */
function usable(entry, pool) {
  return Boolean(entry) && pool.some((c) => c.slug === entry.channel.slug);
}

async function prefetch(pool) {
  if (prefetching || usable(buffered, pool)) return;
  prefetching = true;
  try {
    const avoid = [...store.recent(), buffered?.block?.id].filter(Boolean);
    const { channel, block } = await drawFromPool(pool, avoid);
    if (block) {
      // Only buffer what actually loaded, and stash the image while the
      // connection is still up so the buffer survives losing it.
      const ok = await preload(imageSrc(block));
      if (ok) {
        buffered = { channel, block };
        cacheImage(imageSrc(block));
      }
    }
  } catch {
    // Offline, most likely. The next draw falls back to the cache.
  } finally {
    prefetching = false;
  }
}

function takeBuffered(pool) {
  if (!usable(buffered, pool)) return null;
  const entry = buffered;
  buffered = null;
  return entry;
}

/**
 * Draws from the pool, stepping past channels that error so one dead entry —
 * deleted, renamed, or made private — can't stall an all-channels rotation.
 * A network failure is not per-channel, so it aborts immediately instead of
 * retrying every channel in turn.
 */
async function drawFromPool(pool, avoid = store.recent()) {
  const tried = new Set();
  let lastError;

  for (let attempt = 0; attempt < Math.min(3, pool.length); attempt++) {
    const candidates = pool.filter((c) => !tried.has(c.slug));
    if (!candidates.length) break;

    const channel = randomOf(candidates);
    tried.add(channel.slug);
    try {
      const drawn = await randomBlock(arena, channel.slug, avoid);
      return { channel, ...drawn };
    } catch (error) {
      lastError = error;
      if (error.status === 0) throw error; // offline — no channel will work
    }
  }
  throw lastError;
}

/* -------------------------------------------------------------------- draw */

async function draw({ showSpinner = false, direction = "next" } = {}) {
  if (drawing) return;
  drawing = true;

  try {
    if (!cardOpen) {
      // Coming back from the closed state, whatever triggered it.
      cardOpen = true;
      dock?.pin(false);
      direction = "genie";
    }

    const settings = await store.load();
    const pool = store.drawPool(settings);
    dock?.mark(settings.active);

    if (!pool.length) {
      show(
        notice(
          "Nothing to rotate yet",
          "Open settings and add an are.na channel — paste its URL or slug.",
        ),
      );
      settingsPanel?.open();
      return;
    }

    // A prefetched block is already decoded, so it can go straight up.
    const ready = takeBuffered(pool);
    let entry = ready ? { ...ready, offline: false } : null;

    if (!entry) {
      let timer;
      if (showSpinner) {
        // Only surfaces on a slow network; an instant flash of spinner is
        // worse than no spinner at all.
        timer = setTimeout(() => show(spinner()), 450);
      }

      try {
        const { channel, block, total } = await drawFromPool(pool);
        clearTimeout(timer);

        if (!total) {
          show(
            notice(
              "That channel is empty",
              `“${channel.title || channel.slug}” has no blocks yet.`,
            ),
          );
          return;
        }
        if (!block) {
          show(notice("Couldn't draw a block", "Try again in a moment."));
          return;
        }
        // Decode first so the new block never paints half-loaded.
        await preload(imageSrc(block));
        entry = { block, channel, offline: false };
      } catch (error) {
        clearTimeout(timer);
        const cached = await drawCached(
          pool.map((c) => c.slug),
          store.recent(),
        );
        if (!cached) throw error; // nothing cached either — report the failure
        entry = {
          block: cached.block,
          channel: pool.find((c) => c.slug === cached.slug) || pool[0],
          offline: true,
        };
      }
    }

    store.remember(entry.block.id);
    await display(entry, direction);
    pushHistory(entry);

    if (!entry.offline) {
      remember(entry.block, entry.channel.slug);
      dock?.refresh();
      prefetch(pool);
    }
  } catch (error) {
    show(notice("Something went wrong", error.message || String(error)));
  } finally {
    drawing = false;
  }
}

/* ------------------------------------------------------------ interaction */

document.addEventListener("click", (event) => {
  // Let links, buttons and the settings sheet do their own thing.
  if (event.target.closest("a, button, dialog")) return;
  if (settingsPanel?.isOpen()) return;
  draw();
});

document.addEventListener("keydown", async (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (settingsPanel?.isOpen()) return; // <dialog> handles Escape itself

  switch (event.key) {
    case " ":
    case "r":
      event.preventDefault();
      draw();
      break;
    case "ArrowLeft":
      event.preventDefault();
      goBack();
      break;
    case "ArrowRight":
      // Retrace first if you've gone back; otherwise this is just "another".
      event.preventDefault();
      if (!(await goForward())) draw();
      break;
    case "s":
      event.preventDefault();
      settingsPanel?.open();
      break;
  }
});

/** The hint is for the first few seconds only; after that it's noise. */
async function flashHint() {
  const { mode } = await store.load();
  // In card mode the card itself opens the source, so it is no longer the
  // thing you click to move on.
  hint.textContent =
    mode === "card"
      ? "click around the card for another · ← to go back"
      : "click for another · ← to go back";
  hint.classList.add("hint--show");
  setTimeout(() => hint.classList.remove("hint--show"), 3200);
}

/** Genies the card away, leaving the dock as the only thing on screen. */
function closeCard() {
  if (!cardOpen) return;
  cardOpen = false;
  clearStage("genie");
  dock.pin(true); // nothing else to aim at, so the dock stays out
}

progress = initProgress();

dock = initDock({
  isOpen: () => cardOpen,
  onToggle: () => closeCard(),
  onPick: async (slug) => {
    // Send the current card away before anything is awaited. The new channel
    // needs a fetch, and waiting on it would leave the click with no response
    // for as long as the network takes.
    clearStage("genie");

    await store.update({ active: slug });
    // A different channel invalidates the cached counts and anything queued.
    forgetCount();
    buffered = null;
    cardOpen = true;
    dock.pin(false);
    draw({ showSpinner: true, direction: "genie" });
  },
});

settingsPanel = initSettings({
  onChange: () => {
    // The channel or token may have changed, so cached counts and any
    // prefetched block are suspect.
    forgetCount();
    buffered = null;
    dock.refresh();
    draw({ showSpinner: true });
  },
});

draw({ showSpinner: true, direction: "first" });
flashHint();
