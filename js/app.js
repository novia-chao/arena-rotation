/**
 * Arena Rotation — one random block from an are.na channel, full bleed.
 *
 * Opening the page (or a new tab, when installed as the extension) draws a
 * block. Clicking, tapping or pressing space draws another.
 */

import { Arena, forgetCount, randomBlock } from "./arena.js";
import { cacheImage, cachedImage, drawCached, remember } from "./offline.js";
import { afterMount, preload, renderBlock, imageSrc } from "./render.js";
import * as store from "./store.js";
import { initSettings } from "./ui.js";

const stage = document.getElementById("stage");
const hint = document.getElementById("hint");
const arena = new Arena(store.token);

let drawing = false;
let settingsPanel;

/**
 * The next block, fetched and decoded while you're still looking at the
 * current one, so a click swaps instantly instead of waiting on the network.
 */
let buffered = null; // { slug, block }
let prefetching = false;

async function prefetch(slug) {
  if (prefetching || buffered?.slug === slug) return;
  prefetching = true;
  try {
    const avoid = [...store.recent(), buffered?.block?.id].filter(Boolean);
    const { block } = await randomBlock(arena, slug, avoid);
    if (block) {
      // Only buffer what actually loaded, and stash the image while the
      // connection is still up so the buffer survives losing it.
      const ok = await preload(imageSrc(block));
      if (ok) {
        buffered = { slug, block };
        cacheImage(imageSrc(block));
      }
    }
  } catch {
    // Offline, most likely. The next draw falls back to the cache.
  } finally {
    prefetching = false;
  }
}

/** Takes the buffered block if it belongs to this channel. */
function takeBuffered(slug) {
  if (buffered?.slug !== slug) return null;
  const { block } = buffered;
  buffered = null;
  return block;
}

function show(node) {
  const outgoing = stage.firstElementChild;
  if (outgoing) {
    outgoing.classList.add("block--leaving");
    outgoing.addEventListener("animationend", () => outgoing.remove(), {
      once: true,
    });
    // Guarantees removal even if the animation never fires (reduced motion,
    // background tab), so stages can't pile up.
    setTimeout(() => outgoing.remove(), 400);
  }
  stage.appendChild(node);
}

function notice(title, body) {
  const wrap = document.createElement("div");
  wrap.className = "block";
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
  wrap.className = "block";
  const dot = document.createElement("div");
  dot.className = "spinner";
  wrap.appendChild(dot);
  return wrap;
}

async function draw({ showSpinner = false } = {}) {
  if (drawing) return;
  drawing = true;

  try {
    const settings = await store.load();
    const channel = store.activeChannel(settings);

    if (!channel) {
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
    let block = takeBuffered(channel.slug);
    let offline = false;

    if (!block) {
      let timer;
      if (showSpinner) {
        // Only surfaces on a slow network; an instant flash of spinner is
        // worse than no spinner at all.
        timer = setTimeout(() => show(spinner()), 450);
      }
      try {
        const drawn = await randomBlock(arena, channel.slug, store.recent());
        clearTimeout(timer);
        if (!drawn.total) {
          show(
            notice(
              "That channel is empty",
              `“${channel.title || channel.slug}” has no blocks yet.`,
            ),
          );
          return;
        }
        block = drawn.block;
      } catch (error) {
        clearTimeout(timer);
        block = await drawCached(channel.slug, store.recent());
        offline = true;
        if (!block) throw error; // nothing cached either — report the failure
      }
    }

    if (!block) {
      show(notice("Couldn't draw a block", "Try again in a moment."));
      return;
    }

    store.remember(block.id);
    // Offline, the image has to come from the cache rather than the network.
    const imageUrl = offline ? await cachedImage(imageSrc(block)) : "";
    // Decode first so the new block never paints half-loaded.
    if (!offline) await preload(imageSrc(block));

    const view = renderBlock(block, {
      fit: settings.fit,
      channel,
      imageUrl,
      offline,
    });
    show(view);
    afterMount(view);

    if (!offline) {
      remember(block, channel.slug);
      prefetch(channel.slug);
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

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const dialogOpen = settingsPanel?.isOpen();
  if (dialogOpen) return; // <dialog> handles Escape itself

  if (event.key === " " || event.key === "r" || event.key === "ArrowRight") {
    event.preventDefault();
    draw();
  } else if (event.key === "s") {
    event.preventDefault();
    settingsPanel?.open();
  }
});

/** The hint is for the first few seconds only; after that it's noise. */
function flashHint() {
  hint.classList.add("hint--show");
  setTimeout(() => hint.classList.remove("hint--show"), 3200);
}

settingsPanel = initSettings({
  onChange: () => {
    // The channel or token may have changed, so cached block counts are suspect.
    forgetCount();
    draw({ showSpinner: true });
  },
});

draw({ showSpinner: true });
flashHint();
