"use strict";

const test = require("node:test");
const assert = require("node:assert");
const engine = require("../../shared/engine.js");

function board(spec) {
  return spec.map((s, i) => ({ id: "l" + i, bid: s[0], bidAt: s[1], board: s[2] || "amazon" }));
}

test("normalizeUrl strips protocol, www, tracking params and trailing slash", () => {
  const a = engine.normalizeUrl("https://www.amazon.com/Some-Name/dp/B0CHX3QBCH?tag=aff-20&utm_source=x");
  const b = engine.normalizeUrl("amazon.com/dp/b0chx3qbch/");
  assert.equal(a.key, b.key);
  assert.equal(a.key, "amazon.com/dp/B0CHX3QBCH");
  assert.equal(a.board, "amazon");
});

test("normalizeUrl keeps meaningful query params, sorted", () => {
  const a = engine.normalizeUrl("target.com/p/x/-/A-9?size=L&color=Red&utm_medium=cpc");
  const b = engine.normalizeUrl("target.com/p/x/-/A-9?color=red&size=l");
  assert.equal(a.key, b.key);
  assert.match(a.key, /\?color=red&size=l$/);
});

test("different products on one retailer never share a key", () => {
  const a = engine.normalizeUrl("amazon.com/dp/B0CHX3QBCH");
  const b = engine.normalizeUrl("amazon.com/dp/B09B8V1LZ3");
  assert.notEqual(a.key, b.key);
});

test("normalizeUrl rejects junk and flags unsupported retailers", () => {
  assert.equal(engine.normalizeUrl(""), null);
  assert.equal(engine.normalizeUrl("not a url"), null);
  assert.equal(engine.normalizeUrl("javascript:alert(1)"), null);
  assert.equal(engine.normalizeUrl("bestbuy.com/site/x").retailer, null);
});

test("ranking is global, ties broken by age", () => {
  const b = board([[100, 10, "amazon"], [100, 5, "target"], [250, 99, "walmart"]]);
  const order = engine.ordered(b).map((l) => l.id);
  assert.deepEqual(order, ["l2", "l1", "l0"]); // 250 first, then the older of the two 100s
});

test("board rank counts only listings from the same retailer", () => {
  const b = board([[300, 1, "amazon"], [200, 2, "target"], [100, 3, "amazon"]]);
  assert.equal(engine.rankFor(b, 100, "l2"), 3);
  assert.equal(engine.boardRankFor(b, 100, "amazon", "l2"), 2);
});

test("bids must be whole dollars inside the allowed range", () => {
  const b = board([[100, 1]]);
  assert.equal(engine.validateBid(b, null, 12.5, "amazon").code, "not_whole");
  assert.equal(engine.validateBid(b, null, 4, "amazon").code, "below_min");
  assert.equal(engine.validateBid(b, null, 1000000, "amazon").code, "above_max");
  assert.equal(engine.validateBid(b, null, "50", "amazon").code, "not_whole");
});

test("taking #1 costs the top bid plus the premium", () => {
  const b = board([[100, 1]]);
  assert.equal(engine.validateBid(b, null, 101, "amazon").code, "top_premium");
  assert.equal(engine.validateBid(b, null, 104, "amazon").code, "top_premium");
  assert.equal(engine.validateBid(b, null, 105, "amazon").ok, true);
  assert.equal(engine.validateBid(b, null, 105, "amazon").rank, 1);
});

test("bidding at or below the top still lands on the board", () => {
  const b = board([[100, 1]]);
  const tie = engine.validateBid(b, null, 100, "amazon");
  assert.equal(tie.ok, true);
  assert.equal(tie.rank, 2, "an equal bid placed later ranks below the older one");
  assert.equal(engine.validateBid(b, null, 50, "amazon").rank, 2);
});

test("raising your own listing costs only the difference", () => {
  const b = board([[100, 1], [40, 2]]);
  const mine = b[1];
  const raise = engine.validateBid(b, mine, 60, "amazon");
  assert.equal(raise.ok, true);
  assert.equal(raise.charge, 20);
  assert.equal(raise.basis, 40);
});

test("a raise must clear your current bid by at least $1", () => {
  const b = board([[100, 1], [40, 2]]);
  assert.equal(engine.validateBid(b, b[1], 40, "amazon").code, "raise_too_small");
  assert.equal(engine.validateBid(b, b[1], 41, "amazon").ok, true);
});

test("the #1 holder raises without paying the premium again", () => {
  const b = board([[100, 1], [40, 2]]);
  const top = b[0];
  const raise = engine.validateBid(b, top, 101, "amazon");
  assert.equal(raise.ok, true, "already #1, so the +$5 premium does not apply");
  assert.equal(raise.charge, 1);
});

test("titles are cleaned of markup and control characters", () => {
  assert.equal(engine.cleanTitle("  Sony <b>XM5</b>\n30% off "), "Sony b XM5 /b 30% off");
  assert.equal(engine.cleanTitle("x".repeat(200)).length, engine.MAX_TITLE);
  assert.equal(engine.cleanTitle("   "), null);
});

test("prices are bounded and rounded to cents", () => {
  assert.equal(engine.cleanPrice("19.999"), 20);
  assert.equal(engine.cleanPrice(-5), null);
  assert.equal(engine.cleanPrice("abc"), null);
  assert.equal(engine.cleanPrice(""), null);
});
