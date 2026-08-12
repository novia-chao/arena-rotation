#!/usr/bin/env node
/**
 * Exercises the authenticated are.na paths — the part of the app that can't be
 * tested without an account.
 *
 * It imports the real client from js/arena.js rather than reimplementing it, so
 * what passes here is the same code the page runs. The token is read from the
 * environment and never printed, written to a file, or sent anywhere but
 * api.are.na.
 *
 *   ARENA_TOKEN='paste-here' node scripts/verify-token.js
 *
 * Prefix the command with a space in most shells and it stays out of history.
 */

import { Arena, randomBlock } from "../js/arena.js";

const token = process.env.ARENA_TOKEN;
if (!token) {
  console.error(
    "ARENA_TOKEN is not set.\n\n" +
      "  ARENA_TOKEN='your-token' node scripts/verify-token.js\n",
  );
  process.exit(2);
}

const arena = new Arena(() => token);
const pass = (m) => console.log(`  ok    ${m}`);
const fail = (m) => {
  console.log(`  FAIL  ${m}`);
  failures++;
};
let failures = 0;

/* 1 — who are we -------------------------------------------------------- */
console.log("\n/v3/me");
let me;
try {
  me = await arena.me();
  pass(`signed in as ${me.name || me.slug} (@${me.slug})`);
} catch (error) {
  fail(error.message);
  console.log("\nToken rejected — nothing else can be checked.\n");
  process.exit(1);
}

/* 2 — channel import ---------------------------------------------------- */
console.log("\nImport my channels");
let mine = [];
try {
  mine = await arena.channelsOf(me.slug);
  if (mine.length) pass(`found ${mine.length} channel(s)`);
  else fail("found none — expected at least one if you own any");

  for (const c of mine.slice(0, 5)) console.log(`        · ${c.title} (${c.slug})`);
  if (mine.length > 5) console.log(`        · …and ${mine.length - 5} more`);

  // channelsOf stops after 4 pages. Check whether that truncated anything.
  const probe = await arena.request(`/users/${me.slug}/contents`, {
    page: 5,
    per: 100,
  });
  if (probe.data?.some((i) => i.type === "Channel")) {
    fail("more channels exist past the 4-page cap — the import is truncating");
  } else {
    pass("no channels past the 4-page import cap");
  }
} catch (error) {
  fail(error.message);
}

/* 3 — private channel access -------------------------------------------- */
console.log("\nPrivate channel access");
try {
  let checked = false;
  for (const candidate of mine.slice(0, 12)) {
    const channel = await arena.channel(candidate.slug);
    if (channel.visibility === "private" || channel.visibility === "closed") {
      pass(`read “${channel.title}” (${channel.visibility})`);
      const { block, total } = await randomBlock(arena, candidate.slug);
      if (total && block) pass(`drew a ${block.type} block from ${total}`);
      else if (!total) pass("channel is empty (nothing to draw, but readable)");
      else fail("could not draw a block");
      checked = true;
      break;
    }
  }
  if (!checked) {
    console.log("  skip  no private or closed channel found to test against");
  }
} catch (error) {
  fail(error.message);
}

console.log(
  failures ? `\n${failures} check(s) failed.\n` : "\nAll authenticated paths OK.\n",
);
process.exit(failures ? 1 : 0);
