/**
 * are.na v3 API client.
 *
 * api.are.na sends `access-control-allow-origin: *`, so the browser can talk to
 * it directly and this app needs no backend of its own.
 */

const BASE = "https://api.are.na/v3";

export class ArenaError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ArenaError";
    this.status = status;
  }
}

function explain(status, slug) {
  switch (status) {
    case 401:
      return "That access token was rejected. Check it in settings.";
    case 403:
      return `You don't have access to “${slug}”.`;
    case 404:
      // A private channel is indistinguishable from a missing one when you
      // aren't authorised, so say both.
      return `No channel “${slug}” — check the slug, or add a token if it's private.`;
    case 429:
      return "are.na is rate limiting us. Give it a moment.";
    default:
      return `are.na returned ${status}.`;
  }
}

export class Arena {
  /** @param {() => string} getToken reads the current token at call time */
  constructor(getToken) {
    this.getToken = getToken;
  }

  async request(path, params = {}) {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers = { Accept: "application/json" };
    const token = this.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(url, { headers });
    } catch {
      throw new ArenaError(0, "Can't reach are.na. Are you online?");
    }
    if (!res.ok) {
      throw new ArenaError(res.status, explain(res.status, params.__slug || ""));
    }
    return res.json();
  }

  channel(slug) {
    return this.request(`/channels/${encodeURIComponent(slug)}`, {
      __slug: slug,
    });
  }

  /**
   * One page of a channel's contents. With `per: 1` this returns exactly the
   * nth block, which is how we pull a random block without ever downloading
   * the whole channel.
   */
  contents(slug, { page = 1, per = 1 } = {}) {
    return this.request(`/channels/${encodeURIComponent(slug)}/contents`, {
      page,
      per,
      __slug: slug,
    });
  }

  me() {
    return this.request("/me");
  }

  /**
   * Channels belonging to a user. /users/:slug/contents is a mixed feed of
   * their channels and loose blocks, so we page through it and keep the
   * channels.
   */
  async channelsOf(userSlug, { pages = 4, per = 100 } = {}) {
    const found = [];
    for (let page = 1; page <= pages; page++) {
      const body = await this.request(
        `/users/${encodeURIComponent(userSlug)}/contents`,
        { page, per },
      );
      for (const item of body.data || []) {
        if (item.type === "Channel") {
          found.push({
            slug: item.slug,
            title: item.title,
            owner: item.owner?.name || "",
          });
        }
      }
      if (!body.meta?.has_more_pages) break;
    }
    return found;
  }
}

/**
 * Total block count for a channel, cached briefly. Random selection needs the
 * count first; refetching it on every shuffle would double our requests.
 */
const counts = new Map();
const COUNT_TTL_MS = 5 * 60 * 1000;

export async function totalContents(arena, slug) {
  const hit = counts.get(slug);
  if (hit && Date.now() - hit.at < COUNT_TTL_MS) return hit.total;

  const body = await arena.contents(slug, { page: 1, per: 1 });
  const total = body.meta?.total_count ?? 0;
  counts.set(slug, { total, at: Date.now() });
  return total;
}

/** Invalidate a cached count, or all of them when called with no argument. */
export function forgetCount(slug) {
  if (slug === undefined) counts.clear();
  else counts.delete(slug);
}

/**
 * A random block from the channel, avoiding anything in `avoid` when the
 * channel is big enough to make that possible.
 */
export async function randomBlock(arena, slug, avoid = []) {
  const total = await totalContents(arena, slug);
  if (!total) return { block: null, total: 0 };

  const attempts = Math.min(5, Math.max(1, total - avoid.length));
  let block = null;
  for (let i = 0; i < attempts; i++) {
    const page = 1 + Math.floor(Math.random() * total);
    const body = await arena.contents(slug, { page, per: 1 });
    block = body.data?.[0] || null;
    if (!block || !avoid.includes(block.id)) break;
  }
  return { block, total };
}
