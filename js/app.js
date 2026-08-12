/**
 * Arena Rotation — one random block from an are.na channel, full bleed.
 *
 * Opening the page (or a new tab, when installed as the extension) draws a
 * block. Clicking, tapping or pressing space draws another.
 */

import { Arena, forgetCount, randomBlock } from "./arena.js";
import { afterMount, preload, renderBlock, imageSrc } from "./render.js";
import * as store from "./store.js";
import { initSettings } from "./ui.js";

const stage = document.getElementById("stage");
const hint = document.getElementById("hint");
const arena = new Arena(store.token);

let drawing = false;
let settingsPanel;

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

    let timer;
    if (showSpinner) {
      // Only surfaces on a slow network; an instant flash of spinner is worse
      // than no spinner at all.
      timer = setTimeout(() => show(spinner()), 450);
    }

    const { block, total } = await randomBlock(
      arena,
      channel.slug,
      store.recent(),
    );
    clearTimeout(timer);

    if (!total) {
      show(notice("That channel is empty", `“${channel.title || channel.slug}” has no blocks yet.`));
      return;
    }
    if (!block) {
      show(notice("Couldn't draw a block", "Try again in a moment."));
      return;
    }

    store.remember(block.id);
    // Decode the image first so the new block never paints half-loaded.
    await preload(imageSrc(block));
    const stage = renderBlock(block, { fit: settings.fit, channel });
    show(stage);
    afterMount(stage);
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
