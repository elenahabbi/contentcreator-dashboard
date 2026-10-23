// Run with:  node --test tests/sample-comparison.test.js
// Uses only Node's built-in test runner (nothing to install).
const test = require("node:test");
const assert = require("node:assert");
const { buildComparison, makeSample, SAMPLE_PROFILES } = require("../frontend/sample-comparison.js");

const sched = (content_id, platform_name, status = "Scheduled", title = `Item ${content_id}`) =>
  ({ schedule_id: Math.random(), content_id, content_title: title, platform_name, status, computed_status: status });
const metric = (content_id, views, recorded_at = "2026-10-01 10:00:00", platform_name = "YouTube") =>
  ({ content_id, platform_name, views, likes: Math.round(views * 0.05), comments: Math.round(views * 0.005), shares: 9, recorded_at });

test("same inputs always give the same figures", () => {
  const yt = { views: 1200 };
  assert.deepStrictEqual(makeSample("TikTok", 5, yt), makeSample("TikTok", 5, yt));
  assert.deepStrictEqual(makeSample("Instagram", 5, yt), makeSample("Instagram", 5, yt));
});

test("samples stay in a believable range of the item's YouTube views and never include shares", () => {
  for (let id = 1; id <= 300; id++) {
    for (const platform of ["TikTok", "Instagram"]) {
      const yt = { views: 40 + id * 13 };
      const s = makeSample(platform, id, yt);
      const [lo, hi] = SAMPLE_PROFILES[platform].viewFactor;
      assert.ok(s.views >= Math.floor(yt.views * lo) - 1 && s.views <= Math.ceil(yt.views * hi) + 1, `${platform} ${id} views ${s.views}`);
      assert.ok(s.likes <= s.views && s.comments <= s.likes);
      assert.deepStrictEqual(Object.keys(s).sort(), ["comments", "likes", "views"]);
    }
  }
});

test("tiny YouTube numbers never produce absurd samples", () => {
  const s = makeSample("TikTok", 1, { views: 3 });
  assert.ok(s.views >= 1 && s.views <= 9);
});

test("pattern is mixed: TikTok beats YouTube on some items, not all; Instagram mostly lower", () => {
  let tiktokHigher = 0, tiktokLower = 0, igHigher = 0, igLower = 0;
  for (let id = 1; id <= 200; id++) {
    const yt = { views: 1000 };
    makeSample("TikTok", id, yt).views > 1000 ? tiktokHigher++ : tiktokLower++;
    makeSample("Instagram", id, yt).views > 1000 ? igHigher++ : igLower++;
  }
  assert.ok(tiktokHigher > 20 && tiktokLower > 20, `${tiktokHigher}/${tiktokLower}`);
  assert.ok(igLower > igHigher);
});

test("only platforms the creator scheduled get a sample; others are null", () => {
  const r = buildComparison(
    [sched(1, "YouTube"), sched(1, "TikTok"), sched(2, "YouTube"), sched(2, "Instagram"), sched(3, "YouTube")],
    [metric(1, 1000), metric(2, 500), metric(3, 800)], true);
  const byId = Object.fromEntries(r.items.map((i) => [i.contentId, i]));
  assert.ok(byId[1].tiktok && byId[1].instagram === null);
  assert.ok(byId[2].instagram && byId[2].tiktok === null);
  assert.ok(byId[3].tiktok === null && byId[3].instagram === null);
});

test("no content, titles or events are invented: output titles are a subset of scheduled titles", () => {
  const rows = [sched(1, "YouTube", "Scheduled", "Real A"), sched(1, "TikTok", "Scheduled", "Real A")];
  const r = buildComparison(rows, [metric(1, 100)], true);
  assert.deepStrictEqual(r.items.map((i) => i.title), ["Real A"]);
  assert.strictEqual(buildComparison([], [], true).items.length, 0);
});

test("cancelled and missed schedules do not count as scheduled", () => {
  const r = buildComparison(
    [sched(1, "YouTube"), sched(1, "TikTok", "Cancelled"), sched(1, "Instagram", "Missed")],
    [metric(1, 1000)], true);
  assert.strictEqual(r.items[0].tiktok, null);
  assert.strictEqual(r.items[0].instagram, null);
});

test("TikTok/Instagram without YouTube figures is listed as unavailable, not sampled", () => {
  const r = buildComparison(
    [sched(1, "TikTok"), sched(2, "YouTube"), sched(2, "Instagram")], [metric(2, 0, "2026-10-01", "TikTok")], true);
  assert.strictEqual(r.items.length, 0);
  assert.strictEqual(r.unavailable.length, 2);
});

test("uses the latest YouTube record and ignores other platforms' metric rows", () => {
  const r = buildComparison([sched(1, "YouTube"), sched(1, "TikTok")],
    [metric(1, 100, "2026-09-01 00:00:00"), metric(1, 900, "2026-10-01 00:00:00"), metric(1, 99999, "2026-10-02 00:00:00", "TikTok")], true);
  assert.strictEqual(r.items[0].youtube.views, 900);
});

test("YouTube is labelled Live only when the integration reports connected", () => {
  const rows = [sched(1, "YouTube")], m = [metric(1, 10)];
  assert.strictEqual(buildComparison(rows, m, true).items[0].youtube.label, "YouTube — Live Data");
  assert.strictEqual(buildComparison(rows, m, false).items[0].youtube.label, "YouTube — Recorded Data");
});

test("the module makes no network or storage calls and has no random source", () => {
  const src = require("fs").readFileSync(require.resolve("../frontend/sample-comparison.js"), "utf8");
  assert.ok(!/Math\.random/.test(src));
  assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(src));
  assert.ok(!/localStorage|sessionStorage/.test(src));
});