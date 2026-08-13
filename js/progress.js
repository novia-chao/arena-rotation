/**
 * Position indicator: one dash per block in this tab's history.
 *
 * The dashes track history rather than position within a channel, because a
 * channel has no sequence to be at a position in — every draw is random. What
 * you can actually move through is what you've already seen, so the bar shows
 * how far back ← can take you and how much → has left to replay.
 *
 * The bar keeps a fixed width and the dashes divide it, so a long history
 * makes finer dashes instead of a wider strip.
 */

export function initProgress() {
  const bar = document.getElementById("progress");

  /**
   * @param {number} length how many blocks are in history
   * @param {number} cursor which one is on screen
   */
  function update(length, cursor) {
    bar.hidden = length < 2; // a single dash says nothing

    if (bar.childElementCount !== length) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < length; i++) {
        frag.appendChild(document.createElement("i"));
      }
      bar.replaceChildren(frag);
    }

    [...bar.children].forEach((dash, i) => {
      dash.className =
        i === cursor ? "is-current" : i < cursor ? "is-seen" : "is-ahead";
    });
  }

  return { update };
}
