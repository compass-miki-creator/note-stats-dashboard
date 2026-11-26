const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const context = vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function parseCSV('), html.indexOf('function parseAndStore(')), context);
const { build, trend } = vm.runInContext(fs.readFileSync(path.join(root, 'analysis.js'), 'utf8') + '\nDashboardAnalysis', context);

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
  assert.match(build(state, 'weekly').previous.reason, /取得時刻/);
  state.dailySummary.splice(1, 1);
  assert.match(build(state, 'weekly').previous.reason, /記録が揃っていません/);
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
  assert.match(result.previous.reason, /2026-10-26.*記録が揃っていません/);
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
  assert.match(all.previous.reason, /対応する前期間はありません/);
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
