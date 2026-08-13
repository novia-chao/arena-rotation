# Arena Rotation

A random block from one of your [are.na](https://www.are.na) channels, as a card.
Click anywhere for another.

Runs two ways from the same files:

- **Chrome extension** — replaces your new tab, so every new tab is a fresh block.
- **Website** — serve the folder and open it anywhere.

## Install as a Chrome extension

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Open a new tab

## Run as a website

Needs to be served over HTTP — the app uses ES modules, which browsers refuse to
load from `file://`.

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Setup

Open settings with the gear in the corner, or press <kbd>S</kbd>.

**Add a channel.** Paste an are.na channel URL (`https://www.are.na/you/some-channel`)
or just its slug (`some-channel`). Add as many as you like and pick which one is
active — that's the channel you're rotating through.

With more than one saved, an **All channels** option appears at the top of the list
and draws across every one of them. It picks a channel uniformly, then a block within
it, rather than weighting by size: weighting would make every block equally likely,
but it would let one 4,000-block channel drown out a carefully kept channel of twelve.
A channel that has been deleted or made private is skipped rather than stalling the
rotation.

**Add a token (optional).** Public channels work with no setup at all. A
[personal access token](https://www.are.na/settings/oauth) additionally unlocks your
private channels and enables **Import my channels**, which pulls in everything you own.

> The token is stored in this browser only (`chrome.storage.local` in the extension,
> `localStorage` on the web) and is only ever sent to `api.are.na`. It grants full
> access to your account, so don't paste it anywhere else, and never commit it —
> nothing in this repo should ever contain it.

## Checking the authenticated paths

Private channels and **Import my channels** can't be exercised without an account.
This checks them against the same client the page uses:

```bash
node scripts/verify-token.js
```

It prompts for the token with the echo off, so the token never reaches argv, your
shell history, or the process table — all of which a leading `ARENA_TOKEN=...` would
expose. (That environment variable still works if you'd rather script it.)

It reports who you're signed in as, how many channels import, whether the import is
hitting its page cap, and whether a private channel can be read and drawn from. The
token is never printed or written to a file.

**Pick a presentation.** Under Display, **Card** floats the block on a blurred wash of
its own image; **Full bleed** fills the screen with it. Card is the default.

In card mode the card opens the block's source — a link or embed goes to what it
references, an attachment to its file, and anything else to its are.na page. Hovering
names the destination. Clicking anywhere around the card still draws another block.

## Controls

| Action | Key |
|---|---|
| Open the block's source | click the card |
| Next block | click around the card, <kbd>Space</kbd>, <kbd>R</kbd> |
| Back | <kbd>←</kbd> |
| Forward, then next | <kbd>→</kbd> |
| Settings | <kbd>S</kbd> |
| Close settings | <kbd>Esc</kbd> |

<kbd>←</kbd> walks back through the last 30 blocks you've seen in this tab, and
<kbd>→</kbd> retraces. Drawing a new block from partway back discards what was ahead,
the same way browser history does. History is per-tab and not persisted.

## How it works

Nothing runs server-side. `api.are.na` sends `access-control-allow-origin: *`, so the
browser calls the [v3 API](https://www.are.na/developers) directly.

The next block is fetched and decoded while you're still looking at the current one,
so a click swaps in about 30ms instead of waiting on a round trip.

Blocks are kept in a pool as you see them, and their images in the Cache API — two
stores, because a single are.na image runs 1–2 MB while the block JSON is a few KB.
When are.na can't be reached the pool is drawn from instead, marked with an `offline`
badge, and limited to blocks whose image is actually cached so a fallback draw can't
land on an empty frame. Images are self-healing too: the connection can drop between
drawing a block and painting it, so a failed `<img>` retries from the cache.

Picking a random block never downloads the channel. One request with `?per=1&page=1`
returns `meta.total_count`; a second with a random `page` returns exactly that block.
The count is cached for five minutes, so a reshuffle is a single request. Recently seen
block ids are held in `sessionStorage` so a shuffle doesn't land on the same block twice
in a row.

Each block class gets its own renderer:

| Class | Rendered as |
|---|---|
| `Image` | full-bleed photo, fill or fit |
| `Text` | large serif type |
| `Link` / `Embed` | dimmed backdrop with title, source and a link out |
| `Attachment` | file card with type, size and a link out |
| `Channel` | channel card with block count and owner |

Text blocks are rendered from their markdown into DOM nodes we build ourselves rather
than by assigning are.na's `content.html` to `innerHTML` — blocks are third-party
content, and that would let any block in any channel run script on the page.
See [`js/markdown.js`](js/markdown.js).

## Layout

```
manifest.json     Chrome extension manifest (MV3)
index.html        the page — also the new tab
css/style.css
js/app.js         boot, shuffle, keyboard and click handling
js/arena.js       are.na v3 client, random-block selection, count cache
js/render.js      one renderer per block class
js/markdown.js    small safe markdown → DOM renderer
js/store.js       settings, over chrome.storage or localStorage
js/ui.js          settings sheet
```
