/**
 * Settings sheet: channel list, token, display preferences.
 *
 * Owns everything inside <dialog id="settings">, and tells the app when
 * something changed that should affect what's on screen.
 */

import { Arena } from "./arena.js";
import * as store from "./store.js";

const $ = (id) => document.getElementById(id);

/** Accepts a full are.na URL or a bare slug and returns the slug. */
export function parseChannelRef(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";

  if (/^https?:\/\//i.test(text)) {
    try {
      const parts = new URL(text).pathname.split("/").filter(Boolean);
      // are.na channel URLs are /:user/:channel — the slug is the last segment.
      return parts.length ? parts[parts.length - 1] : "";
    } catch {
      return "";
    }
  }
  return text.replace(/^\/+|\/+$/g, "").split("/").pop();
}

function say(node, message, kind) {
  node.textContent = message;
  node.className = kind ? `status status--${kind}` : "status";
}

/** The "everything" row that sits above the individual channels. */
function allChannelsRow(checked, count, onPick) {
  const li = document.createElement("li");
  li.className = "channel channel--all";

  const label = document.createElement("label");
  label.className = "channel__label";

  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "active-channel";
  radio.value = store.ALL_CHANNELS;
  radio.checked = checked;
  radio.addEventListener("change", onPick);

  const title = document.createElement("span");
  title.className = "channel__title";
  title.textContent = "All channels";

  const note = document.createElement("span");
  note.className = "channel__slug";
  note.textContent = `${count} channels`;

  label.append(radio, title, note);
  li.appendChild(label);
  return li;
}

export function initSettings({ onChange }) {
  const dialog = $("settings");
  const list = $("channel-list");
  const empty = $("channels-empty");
  const addForm = $("add-channel");
  const addInput = $("channel-input");
  const addStatus = $("add-status");
  const tokenForm = $("token-form");
  const tokenInput = $("token-input");
  const tokenStatus = $("token-status");

  // Reads the token at call time so a freshly saved one takes effect at once.
  const arena = new Arena(store.token);

  async function paint() {
    const settings = await store.load();

    list.replaceChildren();
    empty.hidden = settings.channels.length > 0;

    // With one channel left the "all" row is hidden, so fall back to selecting
    // that channel — otherwise nothing appears checked.
    const everything =
      settings.active === store.ALL_CHANNELS && settings.channels.length > 1;
    const active = store.activeChannel(settings);

    // Rotating across everything only means something with more than one.
    if (settings.channels.length > 1) {
      list.appendChild(
        allChannelsRow(everything, settings.channels.length, async () => {
          await store.update({ active: store.ALL_CHANNELS });
          onChange();
        }),
      );
    }

    for (const channel of settings.channels) {
      const li = document.createElement("li");
      li.className = "channel";

      const label = document.createElement("label");
      label.className = "channel__label";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "active-channel";
      radio.value = channel.slug;
      radio.checked = !everything && active?.slug === channel.slug;
      radio.addEventListener("change", async () => {
        await store.update({ active: channel.slug });
        onChange();
      });

      const title = document.createElement("span");
      title.className = "channel__title";
      title.textContent = channel.title || channel.slug;

      const slug = document.createElement("span");
      slug.className = "channel__slug";
      slug.textContent = channel.slug;

      label.append(radio, title, slug);

      const remove = document.createElement("button");
      remove.className = "channel__remove";
      remove.type = "button";
      remove.textContent = "✕";
      remove.title = `Remove ${channel.title || channel.slug}`;
      remove.addEventListener("click", async () => {
        const current = await store.load();
        const channels = current.channels.filter((c) => c.slug !== channel.slug);
        const stillActive =
          current.active === channel.slug ? channels[0]?.slug || "" : current.active;
        await store.update({ channels, active: stillActive });
        await paint();
        onChange();
      });

      li.append(label, remove);
      list.appendChild(li);
    }

    tokenInput.value = settings.token ? "•".repeat(24) : "";
    for (const radio of document.querySelectorAll('input[name="fit"]')) {
      radio.checked = radio.value === settings.fit;
    }
    for (const radio of document.querySelectorAll('input[name="mode"]')) {
      radio.checked = radio.value === settings.mode;
    }
  }

  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const slug = parseChannelRef(addInput.value);
    if (!slug) return say(addStatus, "That doesn't look like a channel.", "error");

    const settings = await store.load();
    if (settings.channels.some((c) => c.slug === slug)) {
      return say(addStatus, "Already in your list.", "error");
    }

    say(addStatus, "Checking…");
    try {
      const channel = await arena.channel(slug);
      const channels = [
        ...settings.channels,
        { slug, title: channel.title || slug, owner: channel.owner?.name || "" },
      ];
      await store.update({
        channels,
        active: settings.active || slug,
      });
      addInput.value = "";
      say(addStatus, `Added “${channel.title || slug}”.`, "ok");
      await paint();
      onChange();
    } catch (error) {
      say(addStatus, error.message, "error");
    }
  });

  tokenForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = tokenInput.value.trim();
    // Untouched masked placeholder means "keep what's stored".
    if (/^•+$/.test(value)) return say(tokenStatus, "Token unchanged.");
    if (!value) return say(tokenStatus, "Paste a token first.", "error");

    await store.update({ token: value });
    say(tokenStatus, "Checking…");
    try {
      const me = await arena.me();
      say(tokenStatus, `Signed in as ${me.name || me.slug}.`, "ok");
      await paint();
      onChange();
    } catch (error) {
      say(tokenStatus, error.message, "error");
    }
  });

  $("clear-token").addEventListener("click", async () => {
    await store.update({ token: "" });
    tokenInput.value = "";
    say(tokenStatus, "Token removed.", "ok");
    onChange();
  });

  $("import-channels").addEventListener("click", async () => {
    const settings = await store.load();
    if (!settings.token) {
      return say(tokenStatus, "Save a token first.", "error");
    }
    say(tokenStatus, "Fetching your channels…");
    try {
      const me = await arena.me();
      const mine = await arena.channelsOf(me.slug);
      const known = new Set(settings.channels.map((c) => c.slug));
      const added = mine.filter((c) => !known.has(c.slug));

      await store.update({
        channels: [...settings.channels, ...added],
        active: settings.active || added[0]?.slug || "",
      });
      say(
        tokenStatus,
        added.length ? `Imported ${added.length} channel(s).` : "Nothing new to import.",
        "ok",
      );
      await paint();
      onChange();
    } catch (error) {
      say(tokenStatus, error.message, "error");
    }
  });

  for (const [group, key] of [
    ["fit", "fit"],
    ["mode", "mode"],
  ]) {
    for (const radio of document.querySelectorAll(`input[name="${group}"]`)) {
      radio.addEventListener("change", async () => {
        if (!radio.checked) return;
        await store.update({ [key]: radio.value });
        onChange();
      });
    }
  }

  // Transient messages shouldn't survive until the next time the sheet opens.
  dialog.addEventListener("close", () => {
    say(addStatus, "");
    say(tokenStatus, "");
  });

  $("open-settings").addEventListener("click", (event) => {
    event.stopPropagation();
    open();
  });

  async function open() {
    await paint();
    if (!dialog.open) dialog.showModal();
  }

  paint();
  return { open, isOpen: () => dialog.open };
}
