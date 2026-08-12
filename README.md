# Arena Rotation

A random block from one of your [are.na](https://www.are.na) channels, full bleed.
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
ARENA_TOKEN='your-token' node scripts/verify-token.js
```

It reports who you're signed in as, how many channels import, whether the import is
hitting its page cap, and whether a private channel can be read and drawn from. The
token is read from the environment — it is never printed or written to a file.

## Controls

| Action | Key |
|---|---|
| Next block | click / tap, <kbd>Space</kbd>, <kbd>R</kbd>, <kbd>→</kbd> |
| Settings | <kbd>S</kbd> |
| Close settings | <kbd>Esc</kbd> |

## How it works

Nothing runs server-side. `api.are.na` sends `access-control-allow-origin: *`, so the
browser calls the [v3 API](https://www.are.na/developers) directly.

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
