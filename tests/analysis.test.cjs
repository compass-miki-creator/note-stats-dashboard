const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const context = vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function parseCSV('), html.indexOf('function parseAndStore(')), context);
const { build, comparePeriods, snapshots, trend } = vm.runInContext(fs.readFileSync(path.join(root, 'analysis.js'), 'utf8') + '\nDashboardAnalysis', context);

const snapshot = (date, views, likes, time = '05:00:00') => ({ date, views, likes, time });
const source = (dailySummary, extra) => ({ dailySummary, articles: [], followers: [], publicationAge: [], articleClassification: [], ...extra });

test('a partial week compares the same weekday and keeps missing separate from zero', () => {
  const state = source([
    snapshot('2026-11-15', 100, 10), snapshot('2026-11-17', 125, 10),
    snapshot('2026-11-19', 180, 16), snapshot('2026-11-22', 215, 19),
    snapshot('2026-11-24', 230, 22),
  ]);
  const result = build(state, 'weekly');
  assert.equal(result.current.views, 15);
  assert.equal(result.previousValues.views, 25);
  assert.equal(result.current.likeRate, 20);
  assert.equal(result.previousValues.likes, 0);
  assert.equal(result.previousValues.likeRate, 0);
  assert.equal(result.current.comments, null);
});

test('a Monday compares one day, with missing dates and mismatched acquisition times rejected', () => {
  const state = source([
    snapshot('2026-11-15', 100, 10), snapshot('2026-11-16', 115, 12),
    snapshot('2026-11-22', 120, 12), snapshot('2026-11-23', 125, 12),
  ]);
  assert.equal(build(state, 'weekly').previousValues.views, 15);
  state.dailySummary[1].time = '23:00:00';
  assert.match(build(state, 'weekly').calendar.reason, /取得時刻/);
  state.dailySummary.splice(1, 1);
  assert.match(build(state, 'weekly').calendar.reason, /境界記録がありません/);
});

test('monthly boundaries do not fall back to the prior month’s final total', () => {
  const state = source([
    snapshot('2026-09-30', 40, 4), snapshot('2026-10-26', 70, 7),
    snapshot('2026-10-31', 90, 9), snapshot('2026-11-26', 110, 11),
  ]);
  let result = build(state, 'monthly');
  assert.equal(result.current.views, 20);
  assert.equal(result.previousValues.views, 30);
  state.dailySummary.splice(1, 1);
  result = build(state, 'monthly');
  assert.match(result.calendar.reason, /2026-10-26.*境界記録がありません/);
});

test('year uses observed endpoints and all uses the latest cumulative value', () => {
  const state = source([
    snapshot('2026-08-24', 100, 10), snapshot('2026-09-01', 120, 11),
    snapshot('2026-11-26', 200, 20),
  ]);
  const annual = build(state, 'yearly');
  const all = build(state, 'all');
  assert.equal(annual.current.views, 100);
  assert.equal(annual.exact, undefined);
  assert.equal(trend(annual).views[0], 100);
  assert.equal(all.current.views, 200);
  assert.match(all.calendar.reason, /累計を表示/);
});

test('article attribution uses the publication timestamp and withholds incomplete cohort comparisons', () => {
  const state = source([
    { ...snapshot('2026-11-22', 100, 10), article_count: '1' },
    { ...snapshot('2026-11-24', 180, 20), article_count: '3' },
  ], {
    articles: [
      { key: 'old', date: '2026-11-22', views: '100' },
      { key: 'old', date: '2026-11-24', views: '130' },
      { key: 'new', date: '2026-11-24', views: '30' },
      { key: 'unknown', date: '2026-11-24', views: '20' },
    ],
    publicationAge: [
      { key: 'old', published_at: '2026-01-01T00:00:00+09:00', latest_date: '2026-11-24' },
      { key: 'new', published_at: '2026-11-22T06:00:00+09:00', latest_date: '2026-11-24' },
      { key: 'unknown', latest_date: '2026-11-24' },
    ],
  });
  const result = build(state, 'weekly');
  assert.equal(result.current.posts, null);
  assert.equal(result.minimumPosts, 1);
  assert.equal(result.current.viewsPerPost, 30);
  assert.equal(result.current.likesPerPost, null);
  assert.equal(result.previousValues.viewsPerPost, null);
  assert.equal(result.rows.find(row => row.key === 'new').group, '新規記事');
  assert.equal(result.rows.some(row => row.key === 'unknown'), false);
});

test('shorter previous month compares only the aligned common dates', () => {
  const state = source([
    snapshot('2026-01-31', 10, 1), snapshot('2026-02-27', 25, 2),
    snapshot('2026-02-28', 30, 3), snapshot('2026-03-28', 68, 8),
    snapshot('2026-03-31', 80, 10),
  ]);
  const result = build(state, 'monthly');
  assert.equal(result.current.views, 50);
  assert.equal(result.calendar.code, 'differentLength');
  assert.equal(result.comparison.code, 'common');
  assert.equal(result.comparison.days, 28);
  assert.equal(result.comparison.currentData.values.views, 38);
  assert.equal(result.comparison.previousData.values.views, 20);
  assert.notEqual(result.comparison.latest.date, result.latest.date);
});

test('common windows require real matched endpoints and choose the longest interval', () => {
  const state = source([
    snapshot('2026-09-30', 100, 10), snapshot('2026-10-03', 110, 11),
    snapshot('2026-10-22', 130, 13), snapshot('2026-10-26', 140, 14, '22:00:00'),
    snapshot('2026-10-31', 150, 15), snapshot('2026-11-03', 160, 16),
    snapshot('2026-11-22', 210, 21), snapshot('2026-11-26', 250, 25),
  ]);
  const result = build(state, 'monthly');
  assert.equal(result.calendar.code, 'clock');
  assert.equal(result.comparison.code, 'common');
  assert.equal(result.comparison.days, 22);
  assert.equal(result.comparison.currentData.values.views, 60);
  assert.equal(result.comparison.previousData.values.views, 30);
});

test('annual rolling growth and total growth have independent scopes', () => {
  const state = source([
    snapshot('2026-08-24', 100, 10),
    snapshot('2026-09-27', 130, 13), snapshot('2026-10-27', 160, 17),
    snapshot('2026-11-26', 210, 30), snapshot('2026-11-27', 220, 30),
  ]);
  const year = build(state, 'yearly');
  assert.equal(year.calendar.code, 'missingBoundary');
  assert.equal(year.current.views, 120);
  assert.equal(year.comparison.code, 'rolling');
  assert.equal(year.comparison.days, 30);
  assert.equal(year.latest.date - year.comparison.latest.date, 1);
  assert.equal(year.comparison.currentData.values.views, 50);
  assert.equal(year.comparison.previousData.values.views, 30);
  const all = build(state, 'all');
  assert.equal(all.current.views, 220);
  assert.equal(all.trackedGrowth.views, 120);
  assert.equal(all.comparison.currentData.values.views, 50);
});

test('year start preserves an observed calendar comparison and avoids backdating a same-year rolling comparison', () => {
  const sameYear = source([
    snapshot('2024-12-31', 50, 5), snapshot('2025-01-01', 51, 5),
    snapshot('2025-12-31', 150, 15), snapshot('2026-01-01', 152, 15),
  ]);
  assert.equal(build(sameYear, 'yearly').calendar.code, 'calendar');
  assert.equal(build(sameYear, 'yearly').previousValues.views, 1);

  const yearBoundary = source([
    snapshot('2025-12-18', 120, 12), snapshot('2025-12-25', 130, 13),
    snapshot('2026-01-01', 150, 15),
  ]);
  assert.equal(build(yearBoundary, 'yearly').comparison, null);
  assert.equal(build(yearBoundary, 'all').comparison.days, 7);
});

test('rolling rejects a shared boundary with materially different clock time', () => {
  const state = source([
    snapshot('2026-11-12', 120, 12), snapshot('2026-11-19', 130, 13, '08:00:01'),
    snapshot('2026-11-26', 150, 15),
  ]);
  assert.equal(comparePeriods(snapshots(state), 'all').alternative, null);
});

test('published historical coverage is reproducible for the Issue #7 source revision', t => {
  const filename = path.join(root, 'data/daily_summary.csv');
  const rows = context.parseCSV(fs.readFileSync(filename, 'utf8'))
    .filter(row => row['日付'] >= '2026-08-24' && row['日付'] <= '2026-11-26');
  // The publisher owns these files and may repair old dates. In that case use the pinned revision for the audit.
  const fingerprint = require('node:crypto').createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  const expected = '0343a5170ca9c134927ae12b45e93cb24aca653b66fe9b55b165e9f1065144d4';
  if (fingerprint !== expected) return t.skip('Historical daily snapshots have changed since the pinned audit revision');
  const dates = snapshots(source(rows));
  for (const [period, expectedCounts] of [
    ['weekly', { calendar: 41, common: 32, rolling: 8, unavailable: 7 }],
    ['monthly', { calendar: 12, common: 18, rolling: 45, unavailable: 13 }],
    ['yearly', { rolling: 75, unavailable: 13 }],
    ['all', { rolling: 75, unavailable: 13 }],
  ]) {
    const counts = {};
    const observed = new Map();
    for (const [date, row] of dates) {
      observed.set(date, row);
      const verdict = comparePeriods(observed, period);
      const code = verdict.calendar.code === 'calendar' ? 'calendar' : verdict.alternative?.code || 'unavailable';
      counts[code] = (counts[code] || 0) + 1;
    }
    assert.deepEqual(counts, expectedCounts);
  }
});

test('market disclosures use valid IDs, dates, values and primary-source links', () => {
  const { definitions, records } = JSON.parse(fs.readFileSync(path.join(root, 'data/note_market.json')));
  assert.equal(new Set(records.map(record => record.id)).size, records.length);
  for (const record of records) {
    assert.match(record.publishedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(record.sources.length);
    for (const { url } of record.sources) assert.equal(new URL(url).protocol, 'https:');
    for (const [key, data] of Object.entries(record.metrics)) {
      assert.ok(definitions[key]?.basis);
      assert.ok(Number.isFinite(data.value));
    }
  }
});
