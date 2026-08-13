/**
 * Channel dock.
 *
 * A row of channel tiles along the bottom edge, hidden until the pointer comes
 * near it. Switching channels used to mean opening settings; here it's one
 * click, and the tiles give the open/close animation somewhere real to fly to.
 *
 * Settings still owns adding and removing channels — this is the switcher, not
 * the manager.
 */

import { thumbnailFor } from "./offline.js";
import * as store from "./store.js";

/** How close to the bottom edge the pointer has to come for the dock to show. */
const REVEAL_PX = 120;

function initials(name) {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

export function initDock({ onPick, onToggle, isOpen }) {
  const dock = document.getElementById("dock");
  const items = document.getElementById("dock-items");
  let shown = false;
  let pinned = false; // stays out while no card is on screen
  let dirty = false;

  function reveal(next) {
    if (shown === next) return;
    shown = next;
    dock.classList.toggle("dock--shown", next);
    document.body.classList.toggle("dock-shown", next);
    // Rebuild only once it's out of sight — retiling under the pointer would
    // drop the hover state and interrupt whatever the cursor was on.
    if (!next && dirty) repaint();
  }

  function repaint() {
    dirty = false;
    paint();
  }

  /**
   * Tile art comes from blocks we've already shown, so it improves as you
   * browse. Marks the dock stale rather than rebuilding immediately.
   */
  function refresh() {
    dirty = true;
    if (!shown) repaint();
  }

  async function tile(slug, label, sublabel) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.className = "dock__tile";
    button.type = "button";
    button.dataset.slug = slug;
    button.title = label;
    button.setAttribute("aria-label", label);

    const face = document.createElement("span");
    face.className = "dock__face";

    if (slug === store.ALL_CHANNELS) {
      face.classList.add("dock__face--all");
      for (let i = 0; i < 4; i++) face.appendChild(document.createElement("i"));
    } else {
      const src = await thumbnailFor(slug);
      if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = "";
        // A tile is decoration; if the image is gone, fall back rather than
        // leaving a hole.
        img.addEventListener("error", () => {
          img.remove();
          face.textContent = initials(label);
        });
        face.appendChild(img);
      } else {
        face.textContent = initials(label);
      }
    }

    const name = document.createElement("span");
    name.className = "dock__label";
    name.textContent = sublabel || label;

    button.append(face, name);
    button.addEventListener("click", (event) => {
      event.stopPropagation(); // the dock is not the reshuffle canvas
      const active = button.classList.contains("dock__tile--active");
      if (active && isOpen()) onToggle(slug);
      else onPick(slug);
    });

    li.appendChild(button);
    return li;
  }

  async function paint() {
    const settings = await store.load();
    const frag = document.createDocumentFragment();

    if (settings.channels.length > 1) {
      frag.appendChild(
        await tile(store.ALL_CHANNELS, "All channels", "All"),
      );
    }
    for (const channel of settings.channels) {
      frag.appendChild(
        await tile(channel.slug, channel.title || channel.slug),
      );
    }
    items.replaceChildren(frag);
    dock.hidden = settings.channels.length === 0;
    mark(settings.active);
  }

  /** Dots the tile the current draw came from. */
  function mark(slug) {
    for (const button of items.querySelectorAll(".dock__tile")) {
      button.classList.toggle("dock__tile--active", button.dataset.slug === slug);
    }
  }

  /** Viewport rect of a tile's face, for aiming the open/close animation. */
  function tileRect(slug) {
    const face = items.querySelector(
      `.dock__tile[data-slug="${CSS.escape(slug)}"] .dock__face`,
    );
    return face ? face.getBoundingClientRect() : null;
  }

  document.addEventListener("pointermove", (event) => {
    if (pinned) return;
    reveal(event.clientY >= window.innerHeight - REVEAL_PX);
  });

  document.addEventListener("pointerleave", () => {
    if (!pinned) reveal(false);
  });

  /** With no card on screen the dock is the only thing to aim at, so it stays. */
  function pin(next) {
    pinned = next;
    if (next) reveal(true);
  }

  paint();
  return { paint, refresh, mark, tileRect, pin };
}
