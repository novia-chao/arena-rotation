/**
 * A deliberately small markdown renderer that builds DOM nodes.
 *
 * are.na hands back `content.html` for text blocks, but that is user-authored
 * markup from a third party. Rendering it with innerHTML would let any block in
 * any channel run script in this page, so we render the markdown source into
 * nodes we construct ourselves. Text can then only ever be text.
 *
 * Supports what shows up in are.na text blocks: paragraphs, **bold**, *italic*,
 * `code`, [links](url), and bare URLs. Everything else stays literal.
 */

const INLINE =
  /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+)/g;

function safeUrl(raw) {
  try {
    const url = new URL(raw, "https://www.are.na");
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function link(href, text) {
  const safe = safeUrl(href);
  if (!safe) return document.createTextNode(text);
  const a = document.createElement("a");
  a.href = safe;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = text;
  return a;
}

function inlineNodes(text) {
  const out = [];
  let last = 0;

  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) {
      out.push(document.createTextNode(text.slice(last, m.index)));
    }

    const [, , strong, , em, code, linkText, linkHref, bareUrl] = m;
    if (strong !== undefined) {
      const el = document.createElement("strong");
      el.append(...inlineNodes(strong));
      out.push(el);
    } else if (em !== undefined) {
      const el = document.createElement("em");
      el.append(...inlineNodes(em));
      out.push(el);
    } else if (code !== undefined) {
      const el = document.createElement("code");
      el.textContent = code;
      out.push(el);
    } else if (linkText !== undefined) {
      out.push(link(linkHref, linkText));
    } else if (bareUrl !== undefined) {
      out.push(link(bareUrl, bareUrl.replace(/^https?:\/\/(www\.)?/, "")));
    }

    last = m.index + m[0].length;
  }

  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

/** @returns {DocumentFragment} paragraphs and blockquotes for `src` */
export function render(src) {
  const frag = document.createDocumentFragment();

  for (const chunk of String(src || "")
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const quoted = chunk
      .split("\n")
      .every((line) => line.trimStart().startsWith(">"));
    const body = quoted ? chunk.replace(/^\s*>\s?/gm, "") : chunk;

    const el = document.createElement(quoted ? "blockquote" : "p");
    // A single newline inside a paragraph is a visual line break in are.na.
    body.split("\n").forEach((line, i) => {
      if (i) el.appendChild(document.createElement("br"));
      el.append(...inlineNodes(line));
    });
    frag.appendChild(el);
  }

  return frag;
}
