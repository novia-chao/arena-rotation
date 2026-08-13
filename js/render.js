/**
 * Turns an are.na block into a full-bleed view.
 *
 * One renderer per block class. They all return an element that fills the
 * stage; shared chrome (source line, metadata bar) is composed on top.
 */

import { render as markdown } from "./markdown.js";
import { cachedImage } from "./offline.js";

const ARENA_WEB = "https://www.are.na";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function anchor(href, className, text) {
  const a = el("a", className, text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

function bytes(n) {
  if (!n) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = n;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size < 10 && i ? size.toFixed(1) : Math.round(size)} ${units[i]}`;
}

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

/**
 * Resolves once the image is decodable, so we never swap in a half-painted
 * frame. Reports whether it actually loaded — a prefetched block whose image
 * failed must not be buffered as if it were ready.
 */
export function preload(src) {
  if (!src) return Promise.resolve(true);
  const img = new Image();
  img.src = src;
  const done = img.decode ? img.decode() : Promise.resolve();
  return done.then(
    () => true,
    () => false,
  );
}

export function imageSrc(block) {
  return block?.image?.src || "";
}

/** The block's own page on are.na. */
function permalink(block) {
  return block.type === "Channel"
    ? `${ARENA_WEB}/${block.owner?.slug || ""}/${block.slug}`
    : `${ARENA_WEB}/block/${block.id}`;
}

/**
 * Where a block points. A link or embed goes to what it references and an
 * attachment to its file; everything else has no outside source, so it goes to
 * its are.na page — which is where you'd go to see its context anyway.
 */
export function sourceUrl(block) {
  const direct = block.source?.url || block.attachment?.url;
  if (!direct) return permalink(block);
  try {
    const url = new URL(direct);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : permalink(block);
  } catch {
    return permalink(block);
  }
}

function hostOf(href) {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * @param imageUrl overrides the network src — an object URL from the offline
 *                 image cache, when we're drawing without a connection.
 */
function backdrop(block, fit, imageUrl) {
  const src = imageUrl || imageSrc(block);
  if (!src) return null;
  const wrap = el("div", `backdrop backdrop--${fit}`);
  const img = el("img");
  img.src = src;
  img.alt = block.image?.alt_text || block.title || "";
  img.decoding = "async";

  // The network can drop between drawing a block and painting it — a prefetched
  // block outliving the connection is the common case. Fall back to the cached
  // copy rather than showing a broken frame.
  if (!imageUrl) {
    img.addEventListener(
      "error",
      async () => {
        const cached = await cachedImage(imageSrc(block));
        if (cached) img.src = cached;
      },
      { once: true },
    );
  }

  wrap.appendChild(img);
  return wrap;
}

/* ---------------------------------------------------------------- renderers */

function renderImage(block, ctx) {
  const stage = el("div", "block block--image");
  const shot = backdrop(block, ctx.fit, ctx.imageUrl);
  if (shot) stage.appendChild(shot);
  else stage.appendChild(el("p", "fallback", block.title || "Untitled image"));

  if (block.title) {
    const cap = el("div", "caption");
    cap.appendChild(el("h1", "caption__title", block.title));
    stage.appendChild(cap);
  }
  return stage;
}

/**
 * Text blocks range from a six-word aphorism to several paragraphs, and one
 * type size cannot serve both. Step the size down as the text grows so short
 * quotes stay dramatic and long passages still fit on screen.
 */
function textScale(text) {
  const n = text.length;
  if (n < 140) return "prose--xl";
  if (n < 420) return "prose--lg";
  if (n < 1100) return "prose--md";
  return "prose--sm";
}

function renderText(block, _ctx) {
  const stage = el("div", "block block--text");
  const source = block.content?.markdown || block.content?.plain || "";
  const body = el("article", `prose ${textScale(block.content?.plain || source)}`);
  body.appendChild(markdown(source));
  stage.appendChild(body);
  return stage;
}

function renderLinkish(block, ctx, kind) {
  const stage = el("div", `block block--link`);
  const shot = backdrop(block, "cover", ctx.imageUrl);
  if (shot) {
    shot.classList.add("backdrop--dim");
    stage.appendChild(shot);
  }

  const card = el("div", "card");
  const provider = block.source?.provider?.name;
  if (provider) card.appendChild(el("p", "card__eyebrow", provider));

  card.appendChild(
    el("h1", "card__title", block.title || block.source?.title || "Untitled"),
  );

  const blurb = block.description?.plain;
  if (blurb) card.appendChild(el("p", "card__blurb", blurb));

  if (block.source?.url) {
    const go = anchor(
      block.source.url,
      "button",
      kind === "Embed" ? "Watch ↗" : "Open ↗",
    );
    card.appendChild(go);
  }

  stage.appendChild(card);
  return stage;
}

function renderAttachment(block, ctx) {
  const stage = el("div", "block block--link");
  const shot = backdrop(block, "cover", ctx.imageUrl);
  if (shot) {
    shot.classList.add("backdrop--dim");
    stage.appendChild(shot);
  }

  const file = block.attachment || {};
  const card = el("div", "card");
  const meta = [file.file_extension?.toUpperCase(), bytes(file.file_size)]
    .filter(Boolean)
    .join(" · ");
  if (meta) card.appendChild(el("p", "card__eyebrow", meta));
  card.appendChild(el("h1", "card__title", block.title || file.filename || "File"));

  const blurb = block.description?.plain;
  if (blurb) card.appendChild(el("p", "card__blurb", blurb));
  if (file.url) card.appendChild(anchor(file.url, "button", "Open file ↗"));

  stage.appendChild(card);
  return stage;
}

function renderChannel(block, _ctx) {
  const stage = el("div", "block block--channel");
  const card = el("div", "card card--channel");
  card.appendChild(el("p", "card__eyebrow", "Channel"));
  card.appendChild(el("h1", "card__title", block.title || block.slug));

  const counts = block.counts || {};
  const line = [
    counts.contents ? `${counts.contents} blocks` : "",
    block.owner?.name ? `by ${block.owner.name}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (line) card.appendChild(el("p", "card__blurb", line));

  if (block.slug) {
    card.appendChild(
      anchor(`${ARENA_WEB}/${block.owner?.slug || "channel"}/${block.slug}`, "button", "Open channel ↗"),
    );
  }
  stage.appendChild(card);
  return stage;
}

const RENDERERS = {
  Image: renderImage,
  Text: renderText,
  Link: (b, c) => renderLinkish(b, c, "Link"),
  Embed: (b, c) => renderLinkish(b, c, "Embed"),
  Media: (b, c) => renderLinkish(b, c, "Embed"),
  Attachment: renderAttachment,
  Channel: renderChannel,
};

/** Metadata strip: who connected it, when, and a way back to are.na. */
function chrome(block, ctx) {
  const bar = el("footer", "meta");

  const left = el("div", "meta__group");
  if (ctx.channel) {
    left.appendChild(el("span", "meta__channel", ctx.channel.title || ctx.channel.slug));
  }
  const who = block.user?.name || block.owner?.name;
  if (who) left.appendChild(el("span", "meta__dot", "·"));
  if (who) left.appendChild(el("span", null, who));

  const date = when(block.connection?.connected_at || block.created_at);
  if (date) {
    left.appendChild(el("span", "meta__dot", "·"));
    left.appendChild(el("span", null, date));
  }
  bar.appendChild(left);

  const right = el("div", "meta__group");
  // Say so rather than passing off a cached block as a fresh draw.
  if (ctx.offline) right.appendChild(el("span", "meta__badge", "offline"));
  right.appendChild(anchor(permalink(block), "meta__link", "are.na ↗"));
  bar.appendChild(right);

  return bar;
}

/**
 * @param {object} block  an are.na v3 block
 * @param {{fit:string, channel:object, imageUrl?:string, offline?:boolean}} ctx
 * @returns {HTMLElement} a full-bleed stage for the block
 */
/**
 * Blurred, dimmed copy of the block's image filling the viewport behind a
 * card, so the card sits in light borrowed from its own contents rather than
 * on flat grey.
 */
function ambient(block, imageUrl) {
  const src = imageUrl || imageSrc(block);
  if (!src) return null;
  const wrap = el("div", "ambient");
  const img = el("img");
  img.src = src;
  img.alt = "";
  img.decoding = "async";
  wrap.appendChild(img);
  return wrap;
}

export function renderBlock(block, ctx) {
  const build = RENDERERS[block.type] || renderLinkish;
  const content = build(block, ctx);
  const meta = chrome(block, ctx);

  if (ctx.mode !== "card") {
    const view = el("div", "view view--bleed");
    view.append(content, meta);
    return view;
  }

  const view = el("div", "view view--card");
  const glow = ambient(block, ctx.imageUrl);
  if (glow) view.appendChild(glow);

  // An image card is sized by the picture itself — the frame shrink-wraps it,
  // so the card arrives at the image's proportions without being told them.
  // Everything else is a panel that sizes to its text.
  const media = Boolean(imageSrc(block)) && block.type === "Image";
  const frame = el("div", `card-frame card-frame--${media ? "media" : "panel"}`);

  frame.append(content, meta);
  linkCard(frame, block);
  view.appendChild(frame);
  return view;
}

/**
 * Makes the whole card open the block's source.
 *
 * A wrapping <a> would be the obvious approach, but cards contain their own
 * links — "Open ↗", "are.na ↗" — and nesting anchors is invalid. So the frame
 * takes a click handler and the inner links keep working untouched. The
 * anchors are also what keyboard users tab to, since a div is not focusable;
 * this handler is a pointer convenience on top of them, not the only way in.
 */
function linkCard(frame, block) {
  const href = sourceUrl(block);
  if (!href) return;

  frame.classList.add("card-frame--linked");

  const host = hostOf(href);
  if (host) {
    const pill = el("span", "card-frame__dest", `${host} ↗`);
    frame.appendChild(pill);
  }

  frame.addEventListener("click", (event) => {
    // A real link or button inside the card wins; let it bubble so the
    // document handler sees the anchor and skips the reshuffle too.
    if (event.target.closest("a, button")) return;
    event.stopPropagation(); // clicking the card must not also draw another
    window.open(href, "_blank", "noopener,noreferrer");
  });
}

/**
 * Run once the stage is in the document — overflow can only be measured after
 * layout. Marks text that still doesn't fit so it fades out instead of ending
 * on a hard, arbitrary crop.
 */
export function afterMount(stage) {
  const prose = stage.querySelector(".prose");
  if (prose && prose.scrollHeight > prose.clientHeight + 2) {
    prose.classList.add("prose--clipped");
  }
}
