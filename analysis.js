/* globals esc */
const DashboardAnalysis = (() => {
  const day = 86400000;
  const periods = { weekly: '週', monthly: '月', yearly: '年', all: '全期間' };
  const comparisonNames = { weekly: '前週比', monthly: '前月比', yearly: '前年比' };
  const timeTolerance = 3 * 3600;
  const columns = {
    views: ['ビュー合計', 'views'],
    likes: ['スキ合計', 'likes'],
    comments: ['コメント合計', 'comments', 'comment_count'],
    followers: ['フォロワー数', 'followers', 'follower_count'],
    articles: ['記事数', 'article_count'],
  };
  const articleColumns = {
    views: ['read_count', 'views', 'view_count'],
    likes: ['like_count', 'likes', 'suki'],
    comments: ['comment_count', 'comments'],
  };
  const metrics = [
    ['views', 'ビュー', 'noteの全体ビューの記録。期間値は終了時点 − 開始前の時点。', '増加幅は届き方の目安。記事以外の一覧表示を含むので、読了数やユニーク読者数には使えません。'],
    ['likes', 'スキ', '記録されたスキ数。期間値は終了時点 − 開始前の時点。', '反応の量を見ます。取り消しも差分に含むため、ビューやスキ率と併せて読みます。'],
    ['comments', 'コメント', '記録されたコメント数。期間値は終了時点 − 開始前の時点。', '会話の量を見ます。同じ人の複数投稿や返信、削除があり得ます。'],
    ['followers', 'フォロワー', '期末の人数。期間の純増は期末人数 − 開始前の人数。', '増減はフォローと解除の差です。どの記事から登録されたかは分かりません。'],
    ['posts', '確認できた投稿', '公開日時が対象に入る、記事台帳上の重複のない記事数。', '増減は制作ペースの変化を示します。削除などで台帳にない記事は集計外です。'],
    ['likeRate', 'スキ率', '同じ期間のスキ ÷ ビュー × 100。', '反応の密度を見ます。ビューが少ないと振れやすく、読者単位の割合ではありません。'],
    ['commentRate', 'コメント率', '同じ期間のコメント ÷ ビュー × 100。', '会話の密度を見ます。少数の会話や返信の影響を受けます。'],
    ['viewsPerPost', '新規投稿1本あたりのビュー', '対象期間に公開した記事のビュー合計 ÷ 確認できた公開本数。', '新規記事の届き方を見ます。公開から取得までの日数が記事ごとに異なります。'],
    ['likesPerPost', '新規投稿1本あたりのスキ', '対象期間に公開した記事のスキ合計 ÷ 確認できた公開本数。', '新規記事への反応の目安です。本数や公開からの経過日数を併せて見ます。'],
    ['commentsPerPost', '新規投稿1本あたりのコメント', '対象期間に公開した記事のコメント合計 ÷ 確認できた公開本数。', '少数のコメントや投稿の影響を受けます。記事単位の結果も確認します。'],
  ];

  const percent = new Set(['likeRate', 'commentRate']);
  const perPost = new Set(['viewsPerPost', 'likesPerPost', 'commentsPerPost']);
  const decimal = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 });
  const shown = value => value == null ? '比較不可' : decimal.format(value);
  const signed = value => value > 0 ? `+${shown(value)}` : shown(value);
  const difference = (end, start) => end == null || start == null ? null : end - start;
  const divide = (value, denominator) => value == null || denominator == null || denominator <= 0 ? null : value / denominator;
  const count = (row, keys) => {
    for (const key of keys) {
      const value = row?.[key];
      if (value != null && /^\d+$/.test(String(value).trim()) && Number.isSafeInteger(Number(value))) return Number(value);
    }
    return null;
  };

  function dateNumber(value) {
    const date = String(value ?? '').replaceAll('/', '-').replace(/-(\d)(?=-|$)/g, '-0$1');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const ms = Date.parse(date);
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date ? ms / day : null;
  }

  const iso = number => new Date(number * day).toISOString().slice(0, 10);
  const clock = value => /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value ?? '') ? value : '';
  const seconds = value => value.split(':').reduce((sum, part) => sum * 60 + Number(part), 0) * (value.length === 5 ? 60 : 1);
  const stamp = row => `${iso(row.date)} ${row.time || '時刻不明'}`;
  const timeRange = (from, to) => `${stamp(from)} → ${stamp(to)}`;
  const durationText = seconds => {
    const minutes = Math.floor(seconds / 60);
    return `${Math.floor(minutes / 1440)}日${Math.floor(minutes / 60) % 24}時間${minutes % 60}分`;
  };
  const observed = row => row.date * 86400 + (row.time ? seconds(row.time) : 0);

  function periodStart(period, number) {
    if (period === 'weekly') return number - ((number + 3) % 7 + 7) % 7;
    if (period === 'monthly') return dateNumber(iso(number).slice(0, 7) + '-01');
    return dateNumber(iso(number).slice(0, 4) + '-01-01');
  }

  function snapshots(state) {
    const rows = new Map();
    for (const row of state.dailySummary) {
      const date = dateNumber(row['日付'] || row.date);
      if (date == null) continue;
      const entries = Object.entries(columns).map(([key, names]) => [key, count(row, names)]);
      const item = { date, time: clock(row['更新時刻'] || row.time), ...Object.fromEntries(entries) };
      if (!rows.has(date) || observed(item) >= observed(rows.get(date))) rows.set(date, item);
    }
    for (const row of state.followers) {
      const date = dateNumber(row['日付'] || row.date);
      const time = clock(row['時刻'] || row.time);
      const item = rows.get(date);
      // Only combine a follower record with the account snapshot from the same collection.
      if (item?.followers == null && item?.time && time === item.time) item.followers = count(row, columns.followers);
    }
    return new Map([...rows].sort(([a], [b]) => a - b));
  }

  function pairedWindows(baseline, latest, priorBaseline, priorLatest) {
    if (![baseline, latest, priorBaseline, priorLatest].every(row => row?.time)) return null;
    const days = latest.date - baseline.date;
    if (days < 1 || days !== priorLatest.date - priorBaseline.date) return null;
    const elapsed = observed(latest) - observed(baseline);
    const priorElapsed = observed(priorLatest) - observed(priorBaseline);
    const clockGap = Math.max(
      Math.abs(seconds(baseline.time) - seconds(priorBaseline.time)),
      Math.abs(seconds(latest.time) - seconds(priorLatest.time)),
      Math.abs(elapsed - priorElapsed),
    );
    return clockGap <= timeTolerance
      ? { baseline, latest, priorBaseline, priorLatest, days, elapsed, priorElapsed } : null;
  }

  function calendarComparison(dates, period, start, latest) {
    if (period === 'all') return { code: 'cumulative', reason: '全期間は累計を表示します。' };
    const name = comparisonNames[period];
    const previousStart = periodStart(period, start - 1);
    const previousEnd = previousStart + latest.date - start;
    if (previousEnd >= start) return {
      code: 'differentLength', reason: `${name}は比較不可。前期間に同じ経過日数がありません。`,
    };

    const missing = [start - 1, previousStart - 1, previousEnd].filter(date => !dates.has(date));
    if (missing.length) return {
      code: 'missingBoundary', reason: `${name}は比較不可。${missing.map(iso).join('、')} の境界記録がありません。`,
    };

    const baseline = dates.get(start - 1);
    const priorBaseline = dates.get(previousStart - 1);
    const priorLatest = dates.get(previousEnd);
    const pair = pairedWindows(baseline, latest, priorBaseline, priorLatest);
    if (!pair) return {
      code: 'clock', reason: `${name}は比較不可。前期間 ${stamp(priorBaseline)} → ${stamp(priorLatest)}。対応する取得時刻と観測時間の差を3時間以内と確認できません。`,
    };
    if ([baseline, latest, priorBaseline, priorLatest].some(row => row.views == null)) return {
      code: 'missingViews', reason: `${name}は比較不可。比較区間の端にビューの記録がありません。`,
    };
    return { code: 'calendar', name, ...pair };
  }

  function commonComparison(dates, period, start, latest) {
    const previousStart = periodStart(period, start - 1);
    const offset = start - previousStart;
    const end = Math.min(latest.date, start - 1 + offset);
    const aligned = [...dates.values()].filter(row => row.date >= start - 1 && row.date <= end
      && row.views != null && dates.get(row.date - offset)?.views != null);
    let best = null;
    // Both calendars use the same offsets from their respective period starts.
    for (let index = aligned.length - 1; index > 0; index--) {
      const currentEnd = aligned[index];
      for (let from = 0; from < index; from++) {
        const currentStart = aligned[from];
        if (best && currentEnd.date - currentStart.date <= best.days) break;
        const pair = pairedWindows(currentStart, currentEnd, dates.get(currentStart.date - offset), dates.get(currentEnd.date - offset));
        if (pair) {
          best = pair;
          break;
        }
      }
    }
    return best && { ...best, code: 'common', name: '観測可能な共通期間の比較' };
  }

  function rollingComparison(dates, period) {
    const windows = period === 'weekly' ? [7] : [30, 7];
    const observedDates = [...dates.values()].reverse();
    const earliest = period === 'yearly' ? periodStart(period, observedDates[0].date) : -Infinity;
    for (const latest of observedDates) {
      if (latest.views == null) continue;
      for (const days of windows) {
        const baseline = dates.get(latest.date - days);
        const before = dates.get(latest.date - days * 2);
        if (baseline?.views == null || before?.views == null) continue;
        if (before.date < earliest) continue;
        const pair = pairedWindows(baseline, latest, before, baseline);
        if (pair) return { ...pair, code: 'rolling', name: `${days}日間とその前の${days}日間のローリング比較` };
      }
    }
    return null;
  }

  function comparePeriods(dates, period) {
    const latest = [...dates.values()].at(-1);
    if (!latest) return { calendar: { code: 'noData' }, alternative: null };
    const start = period === 'all' ? null : periodStart(period, latest.date);
    const calendar = calendarComparison(dates, period, start, latest);
    const common = start != null && calendar.code !== 'calendar' ? commonComparison(dates, period, start, latest) : null;
    const alternative = calendar.code === 'calendar' ? null : common || rollingComparison(dates, period);
    return { calendar, alternative };
  }

  function articleMetadata(state) {
    const published = new Map(state.publicationAge.filter(row => row.key).map(row => [row.key, row]));
    const categories = new Map(state.articleClassification.map(row => [
      row.key, !row.category_primary || row.needs_review === 'true' ? '分類未確定' : row.category_primary,
    ]));
    return { published, categories };
  }

  function publicationTime(row) {
    const value = row?.published_at ?? '';
    if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms / 1000 + 9 * 3600 : null;
  }

  function articleRows(state, baseline, end, all, metadata) {
    const from = new Map();
    const to = new Map();
    for (const row of state.articles) {
      const key = row.key || row.note_id;
      const date = dateNumber(row.date || row['日付']);
      if (!key) continue;
      if (baseline && date === baseline.date) from.set(key, row);
      if (date === end.date) to.set(key, row);
    }
    const rows = [];
    const newArticles = [];
    let postTimingUnknown = false;
    for (const [key, entry] of metadata.published) {
      if (dateNumber(entry.latest_date) !== end.date && !to.has(key)) continue;
      if (all) {
        newArticles.push(key);
        continue;
      }
      if (from.has(key)) continue;
      const published = publicationTime(entry);
      if (published == null || (!end.time && Math.floor(published / 86400) === end.date) ||
          (baseline && !baseline.time && Math.floor(published / 86400) === baseline.date)) {
        postTimingUnknown = true;
        continue;
      }
      if (published <= observed(end) && (!baseline || published > observed(baseline))) newArticles.push(key);
    }
    const newKeys = new Set(newArticles);
    for (const [key, row] of to) {
      const before = from.get(key);
      const newPost = newKeys.has(key);
      if (!all && !before && !newPost) continue;
      const published = metadata.published.get(key);
      const timeKnown = publicationTime(published) != null;
      const group = all ? '全記事' : newPost ? '新規記事' : timeKnown ? '既存記事' : '公開日時不明';
      const values = Object.entries(articleColumns).map(([metric, names]) => [
        metric, difference(count(row, names), all || (!before && newPost) ? 0 : count(before, names)),
      ]);
      rows.push({
        key, title: row.title || published?.title || key, url: published?.note_url, group,
        category: metadata.categories.get(key) || '分類未確定', ...Object.fromEntries(values),
      });
    }

    const matched = new Map(rows.map(row => [row.key, row]));
    const postingCoverage = metadata.published.size > 0 && to.size > 0
      && (end.articles == null || to.size === end.articles)
      && [...to.keys()].every(key => from.has(key) || metadata.published.has(key));
    const posts = postingCoverage && !postTimingUnknown ? newKeys.size : null;
    const minimumPosts = metadata.published.size ? newKeys.size : null;
    const perArticle = {};
    for (const key of Object.keys(articleColumns)) {
      const values = newArticles.map(id => matched.get(id)?.[key]);
      const complete = values.every(value => value != null && value >= 0);
      perArticle[key] = complete ? divide(values.reduce((sum, value) => sum + value, 0), minimumPosts) : null;
    }
    return { rows, posts, minimumPosts, perArticle, articleCount: to.size };
  }

  function valuesFor(baseline, latest, articles) {
    const values = {};
    for (const key of Object.keys(columns)) values[key] = difference(latest[key], baseline ? baseline[key] : 0);
    values.posts = articles.posts;
    values.likeRate = values.likes == null || values.likes < 0 ? null : divide(values.likes * 100, values.views);
    values.commentRate = values.comments == null || values.comments < 0 ? null : divide(values.comments * 100, values.views);
    values.viewsPerPost = articles.perArticle.views;
    values.likesPerPost = articles.perArticle.likes;
    values.commentsPerPost = articles.perArticle.comments;
    return values;
  }

  function aggregate(rows, property) {
    const groups = new Map();
    for (const row of rows) {
      if (row.views == null) continue;
      const name = row[property];
      const group = groups.get(name) || { name, count: 0, views: 0, likes: 0, comments: 0 };
      group.count += 1;
      group.views += row.views;
      for (const key of ['likes', 'comments']) {
        group[key] = group[key] == null || row[key] == null ? null : group[key] + row[key];
      }
      groups.set(name, group);
    }
    return [...groups.values()].sort((a, b) => b.views - a.views);
  }

  function build(state, period) {
    const dates = snapshots(state);
    const latest = [...dates.values()].at(-1);
    const all = period === 'all';
    const label = periods[period];
    if (!latest) return { dates, period, label, all, rows: [] };
    const start = all ? null : periodStart(period, latest.date);
    const exact = all ? null : dates.get(start - 1);
    const baseline = all ? null : exact || [...dates.values()].find(row => row.date >= start && row.date < latest.date);
    const { calendar, alternative } = comparePeriods(dates, period);
    const first = dates.values().next().value;
    const metadata = articleMetadata(state);
    const articles = all || baseline ? articleRows(state, baseline, latest, all, metadata) : { rows: [], perArticle: {} };
    const current = all || baseline ? valuesFor(baseline, latest, articles) : {};
    const windowData = (from, to) => {
      const articles = articleRows(state, from, to, false, metadata);
      return { values: valuesFor(from, to, articles), articleCount: articles.articleCount, minimumPosts: articles.minimumPosts };
    };
    const previousValues = calendar.code === 'calendar' ? windowData(calendar.priorBaseline, calendar.priorLatest).values : {};
    if (current.posts == null || previousValues.posts == null) {
      for (const key of perPost) previousValues[key] = null;
    }
    const comparison = alternative && {
      ...alternative,
      currentData: windowData(alternative.baseline, alternative.latest),
      previousData: windowData(alternative.priorBaseline, alternative.priorLatest),
    };
    const trackedGrowth = all && first !== latest ? valuesFor(first, latest, { perArticle: {} }) : null;
    return {
      dates, period, label, all, start, exact, baseline, latest, first, calendar, comparison, current, previousValues, trackedGrowth,
      rows: articles.rows, minimumPosts: articles.minimumPosts, articleCount: articles.articleCount,
      cohorts: all ? [] : aggregate(articles.rows, 'group'), categories: aggregate(articles.rows, 'category'),
    };
  }

  function trend(analysis) {
    const { dates, all, period } = analysis;
    const buckets = new Map();
    for (const row of dates.values()) {
      const key = all ? row.date : periodStart(period, row.date);
      if (!buckets.has(key)) buckets.set(key, { first: row });
      buckets.get(key).last = row;
    }
    const records = [...buckets].slice(-(all ? dates.size : 13)).map(([key, { first, last }]) => {
      const baseline = all ? null : dates.get(key - 1) || (first !== last ? first : null);
      const label = all ? iso(key) : `${iso(baseline?.date === key - 1 ? key : first.date)}〜${iso(last.date)}`;
      return { label, views: all ? last.views : difference(last.views, baseline?.views),
        likes: all ? last.likes : difference(last.likes, baseline?.likes) };
    });
    return {
      labels: records.map(row => row.label),
      views: records.map(row => row.views),
      likes: records.map(row => row.likes),
    };
  }

  function changeText(key, current, previous) {
    const change = difference(current, previous);
    if (change == null) return '比較不可';
    if (percent.has(key)) return `${signed(change)} pt`;
    if (perPost.has(key)) return signed(change);
    const relative = current >= 0 ? divide(change, previous) : null;
    return relative == null ? `${signed(change)}（率は比較不可）` : `${signed(change)}（${signed(relative * 100)}%）`;
  }

  function summary(analysis) {
    const { all, current, previousValues, categories, cohorts, latest, period } = analysis;
    if (current.views == null) return ['この期間のビューは比較不可', '対象期間の両端に取得したビューが必要です。', 'まず日次記録の観測範囲を確認してください。'];

    const delta = difference(current.views, previousValues.views);
    const headline = all ? `現在の記事に累計 ${shown(current.views)} ビュー`
      : delta == null ? `観測範囲で ${signed(current.views)} ビュー`
      : delta === 0 ? `ビューは${comparisonNames[period]}で変化なし`
      : `ビューは${comparisonNames[period]}で ${shown(Math.abs(delta))} ${delta > 0 ? '増加' : '減少'}`;
    const evidence = [`${all ? '累計' : '今回'} ${shown(current.views)} ビュー`];
    if (delta != null) evidence.push(`前期間 ${shown(previousValues.views)} ビュー`);
    if (current.likeRate != null) evidence.push(`スキ率 ${shown(current.likeRate)}%`);
    if (current.followers != null) evidence.push(`フォロワー${all ? ' ' : '純増 '}${all ? shown(latest.followers) : signed(current.followers)} 人`);
    const largest = cohorts.find(group => group.views > 0);
    const primary = categories.find(group => group.name !== '分類未確定' && group.views > 0);
    if (largest) evidence.push(`記事別で最も大きいのは${largest.name}の ${shown(largest.views)} ビュー`);

    let next = '記事ランキングで読まれた記事を選び、公開後の経過日数が近い記事の反応を見比べましょう。';
    if (period === 'weekly' && largest?.name === '既存記事') next = 'ビューが伸びた既存記事を1本選び、関連する次の記事への導線を確認しましょう。次の週も同じ曜日までの増分を見ます。';
    if (period === 'monthly' && primary) next = `「${primary.name}」の記事で、ビューとスキの両方が伸びた記事を確認しましょう。次の月は形式やテーマを一つずつ試すと違いを追いやすくなります。`;
    if (period === 'yearly') next = '観測できた範囲で伸びた記事とカテゴリを振り返り、次の四半期に続けるテーマを選びましょう。';
    if (all) next = '累計ランキングから長く読まれている記事を選び、関連する記事へのリンクを点検しましょう。観測開始後の増減と、補助比較で最近の変化を確認できます。';
    return [headline, evidence.join(' ／ ') + '。', next];
  }

  function metricCard(analysis, entry) {
    const [key, label, formula, reading] = entry;
    const { all, current, latest, calendar, previousValues, minimumPosts } = analysis;
    const value = current[key];
    const measurement = value == null && key === 'posts' && minimumPosts != null
      ? `${shown(minimumPosts)} 本以上`
      : value == null ? '比較不可'
      : (all || percent.has(key) || perPost.has(key) || key === 'posts' ? shown(value) : signed(value)) + (percent.has(key) ? '%' : '');
    let detail = all ? '累計・期末' : '';
    if (calendar.code === 'calendar') detail = `${calendar.name} ${changeText(key, value, previousValues[key])}`;
    if (!all && previousValues[key] != null) {
      detail += ` ／ 前期間 ${shown(previousValues[key])}${percent.has(key) ? '%' : ''}`;
    }
    if (key === 'followers' && !all) detail = [detail, `期末 ${shown(latest.followers)} 人`].filter(Boolean).join(' ／ ');
    if (key === 'posts' && !all && current.articles != null) detail = [detail, `台帳の登録数 ${signed(current.articles)} 本`].filter(Boolean).join(' ／ ');
    if (all && key === 'posts') detail = '最新の記事台帳にある本数';
    if (all && percent.has(key)) detail = '累計値で計算';
    if (perPost.has(key) && value != null) {
      detail = [`${shown(minimumPosts)} 本で計算${all ? '（累計）' : ''}`, detail].filter(Boolean).join(' ／ ');
    }
    const metricLabel = all && perPost.has(key) ? label.replace('新規投稿', '記事') : label;
    const calculation = all && perPost.has(key) ? '取得できた記事の指標合計 ÷ 対象記事数。'
      : all && key === 'posts' ? '最新の記事台帳に含まれる重複のない記事数。' : formula;
    const guidance = all && perPost.has(key) ? '記事の公開からの経過日数により、1本あたりの値は変わります。' : reading;
    return `<article class="ops-metric">
      <h3>${metricLabel}</h3><div class="ops-value">${measurement}</div>${detail ? `<p>${detail}</p>` : ''}
      <details><summary>指標の読み方</summary><p>${calculation} ${guidance}</p></details>
    </article>`;
  }

  function contributionTable(groups, title) {
    if (!groups.length) return '';
    return `<section><h3>${title}</h3><div class="ops-scroll"><table>
      <thead><tr><th scope="col">内訳</th><th scope="col">記事数</th><th scope="col">ビュー</th><th scope="col">スキ</th><th scope="col">コメント</th></tr></thead>
      <tbody>${groups.map(row => `<tr><th scope="row">${esc(row.name)}</th><td>${shown(row.count)}</td>
        <td>${shown(row.views)}</td><td>${shown(row.likes)}</td><td>${shown(row.comments)}</td></tr>`).join('')}</tbody>
    </table></div></section>`;
  }

  function observedGrowth({ first, latest, trackedGrowth }) {
    if (!trackedGrowth) return '';
    const keys = ['views', 'likes', 'comments', 'followers'];
    const values = metrics.filter(([key]) => keys.includes(key))
      .map(([key, label]) => `${label} ${signed(trackedGrowth[key])}`);
    return `<section class="ops-card"><h2>観測開始後の増減</h2>
      <p>${timeRange(first, latest)}（JST、日付差 ${latest.date - first.date}日）</p>
      <p>${values.join(' ／ ')}</p>
      <p class="ops-muted">最新の累計から、取得履歴の最初に記録した累計を引いています。</p>
    </section>`;
  }

  function alternativeComparison({ comparison, latest, period }) {
    const { name, baseline, priorBaseline, priorLatest, days, elapsed, priorElapsed, currentData, previousData } = comparison;
    const end = comparison.latest;
    const keys = ['views', 'likes', 'comments', 'followers', 'posts', 'likeRate', 'commentRate'];
    const values = currentData.values;
    const previous = previousData.values;
    const views = changeText('views', values.views, previous.views);
    const currentChange = difference(values.views, previous.views);
    const reactionChange = difference(values.likeRate, previous.likeRate);
    let next = '同じ長さの区間で、ビューに大きな差はありません。スキ率も見ながら、次の投稿で変える要素を一つ選びましょう。';
    if (currentChange > 0) next = '比較区間ではビューが増えています。両区間の公開本数とスキ率を確認し、次の投稿で再度試す要素を一つ選びましょう。';
    if (currentChange < 0) next = '比較区間ではビューが減っています。公開本数や記事のテーマを確認し、次の投稿でタイトルか導線の一方を見直しましょう。';
    if (currentChange > 0 && reactionChange < 0) next = 'ビューが増え、スキ率は低下しました。次の投稿ではタイトルと本文の期待が揃っているかを確かめ、公開後の同じ日数で反応を見ましょう。';
    const format = (data, key) => {
      const value = data.values[key];
      if (key === 'posts' && value == null && data.minimumPosts != null) return `${shown(data.minimumPosts)}本以上`;
      return value == null ? '—' : shown(value) + (percent.has(key) ? '%' : '');
    };
    const rows = metrics.filter(([key]) => keys.includes(key)).map(([key, label]) => {
      const diff = changeText(key, values[key], previous[key]);
      return `<tr><th scope="row">${key === 'followers' ? 'フォロワー純増' : label}</th>
        <td>${format(currentData, key)}</td><td>${format(previousData, key)}</td><td>${diff}</td></tr>`;
    });
    const lag = latest.date - end.date;
    const label = comparison.code === 'common' ? '共通期間' : 'ローリング';
    return `<section class="ops-card ops-alternative" id="opsAlternative" data-method="${comparison.code}">
      <p class="ops-eyebrow">補助比較 <span>${label}</span></p>
      <h2>${name}</h2>
      <p>ビュー ${shown(values.views)} 対 ${shown(previous.views)} ／ 差 ${views}</p>
      <p class="ops-muted">${days}日ずつ（日付差）。${lag ? `比較区間の終了は最新記録の${lag}日前です。` : '比較区間は最新記録までです。'}
        ${period === 'yearly' && comparison.code === 'rolling' ? '同じ年の中の推移です。' : ''}</p>
      <dl class="ops-windows">
        <div><dt>新しい区間</dt><dd>${timeRange(baseline, end)}（JST）</dd><dd>観測時間 ${durationText(elapsed)}</dd></div>
        <div><dt>その前の区間</dt><dd>${timeRange(priorBaseline, priorLatest)}（JST）</dd><dd>観測時間 ${durationText(priorElapsed)}</dd></div>
      </dl>
      <details><summary>指標別の実測値と計算根拠</summary>
        <div class="ops-scroll ops-comparison-table"><table>
          <thead><tr><th scope="col">指標</th><th scope="col">新しい区間</th><th scope="col">その前の区間</th><th scope="col">差</th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table></div>
        <p>各区間の増分は終了記録 − 開始記録。増減率は区間の増分差 ÷ その前の区間の増分 × 100。スキ率・コメント率の変化はポイント差です。</p>
        <p>記事スナップショットの期末対象は新しい区間 ${shown(currentData.articleCount)} 本、その前の区間 ${shown(previousData.articleCount)} 本です。
          投稿数は対象内で両端の記録と公開日時を照合できる範囲を示し、未確認の公開日時があれば下限を表示します。カテゴリ・新旧記事の内訳は選択中の期間の実績です。</p>
      </details>
      <div class="ops-next"><h3>比較から試すこと</h3><p>${next}</p></div>
    </section>`;
  }

  function unavailableComparison({ period }) {
    const lengths = period === 'weekly' ? '7日' : '7日または30日';
    const scope = period === 'yearly' ? '同じ年の中で、' : '';
    return `<section class="ops-card"><h2>補助比較も比較不可</h2>
      <p>${scope}${lengths}ずつの連続した2区間を作れる3つの境界記録と、3時間以内にそろった取得時刻が必要です。${period === 'all' ? '' : '暦期間の比較には上の観測条件に記載した境界も必要です。'}</p>
    </section>`;
  }

  function render(target, analysis) {
    const { all, label, latest, baseline, exact, calendar, comparison, current, cohorts, categories, articleCount, rows } = analysis;
    if (!latest) {
      target.innerHTML = '<h2>運営の振り返り</h2><p>日次集計を読み込むと、ここに期間の所見が表示されます。</p>';
      return;
    }
    const [headline, evidence, next] = summary(analysis);
    const window = all ? `累計の取得時点 ${stamp(latest)}`
      : baseline ? timeRange(baseline, latest) : `最新記録 ${stamp(latest)}`;
    const nextStart = periodStart(analysis.period, latest.date + 1);
    const status = all ? '累計' : !exact ? '一部期間' : nextStart > latest.date ? '集計最終日' : '集計途中';
    const comparisonLabel = calendar.code === 'calendar'
      ? `${calendar.name}の観測 ${stamp(calendar.priorBaseline)} → ${stamp(calendar.priorLatest)}（${calendar.days}日間）` : calendar.reason;
    const displayed = categories.reduce((sum, group) => sum + group.views, 0);
    const coverage = rows.filter(row => row.views != null).length;
    const unexplained = difference(current.views, displayed);
    target.innerHTML = `<div class="ops-hero">
      <p class="ops-eyebrow">${label}の運営分析 <span>${status}</span> <a href="#noteMarket">市場動向</a>${comparison ? ' <a href="#opsAlternative">補助比較</a>' : ''}</p>
      <h2>${headline}</h2><p>${evidence}</p>
      <div class="ops-next"><h3>次の行動</h3><p>${esc(next)}</p></div>
      <details class="ops-observation" open><summary>観測条件</summary><p>${window}（JST）</p><p>${comparisonLabel}</p>
        <p>${all ? '最新の記録に含まれる記事の累計です。下の推移は観測できた日付を示します。'
          : '終了時点から開始時点を引いた実測増分です。比較の対応時刻と観測時間の差は3時間以内です。'}</p>
      </details>
    </div>
    ${all ? observedGrowth(analysis) : ''}
    ${comparison ? alternativeComparison(analysis) : calendar.code !== 'calendar' ? unavailableComparison(analysis) : ''}
    <section class="ops-card"><h2>${all ? '累計の指標' : '期間の指標'}</h2>
      <div class="ops-metrics">${metrics.map(entry => metricCard(analysis, entry)).join('')}</div>
    </section>
    <section class="ops-card"><h2>${all ? 'カテゴリ別の累計' : 'どの記事が寄与したか'}</h2>
      ${coverage ? `<p>ビューを計算できた ${shown(coverage)} / ${shown(articleCount)} 記事。${unexplained == null ? '' : `アカウント合計との差は ${signed(unexplained)} ビューです。`}</p>
        <div class="ops-contributions">${contributionTable(cohorts, '公開時期別')}${contributionTable(categories, 'カテゴリ別')}</div>
        <p class="ops-muted">${all ? '最新の記事別記録を集計。' : '両端で観測した記事と、観測開始後に公開したことを確認できる記事を集計。'}取得漏れや記事の公開状態の変更などにより、アカウント合計とは差が出ることがあります。要確認の分類は「分類未確定」です。</p>`
        : '<p>この期間の内訳を計算できる記事別記録がありません。</p>'}
    </section>`;
  }

  return { build, comparePeriods, snapshots, trend, render };
})();

async function loadNoteMarket() {
  const target = document.getElementById('noteMarketBody');
  try {
    const response = await fetch('./data/note_market.json');
    if (!response.ok) throw new Error('市場データを取得できませんでした');
    const { definitions, records } = await response.json();
    const latestQuarter = records.filter(record => record.kind === 'quarterly')
      .sort((a, b) => b.period.localeCompare(a.period))[0];
    const comparable = ['content', 'creators', 'buyers', 'gmv'];
    const changes = comparable
      .filter(key => Number.isFinite(latestQuarter.metrics[key]?.yoy))
      .map(key => [definitions[key].label, latestQuarter.metrics[key].yoy]);
    const supplyOutpaced = changes.length === 4 && Math.min(changes[0][1], changes[1][1]) > Math.max(changes[2][1], changes[3][1]);
    const survey = records.find(record => record.id === 'paid-article-2025-11').metrics;
    const sellerAverageChange = ((100 + survey.paidArticleSalesGrowth.value) /
      (100 + survey.paidArticleSellerGrowth.value) - 1) * 100;
    const figures = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 });
    const growth = percent => `${percent > 0 ? '+' : ''}${figures.format(percent)}%`;
    target.innerHTML = `<div class="ops-market-intro">
      ${changes.length ? `<p>${supplyOutpaced ? '<strong>供給の伸びが、課金需要の伸びを上回りました。</strong> ' : ''}${esc(latestQuarter.title)}は、${changes.map(([label, value]) => `${esc(label)} ${growth(value)}`).join('、')}（前年同期比）。市場全体の指標で、記事ごとの露出の変化までは分かりません。</p>` : ''}
      <p><strong>売上があった人の平均は、有料記事に限ると前年同月比 ${growth(sellerAverageChange)} と試算。</strong> 2025年11月の公表増加率から 1.268 ÷ 1.420 − 1 で計算。同じ人を追跡した比較や売上の中央値、全商品を含む売上者の平均は、この資料では確認できません。上位1,000人の平均は対象期間が一部重なります。</p>
      <p class="ops-muted">個人の週・月・年・累計の値と、市場の決算期・指標定義が揃っていないため、個人の成績との伸び率比較は表示していません。</p>
    </div>
    ${records.map(record => `<details class="ops-disclosure"${record === latestQuarter ? ' open' : ''}>
      <summary>${esc(record.title)} ／ ${esc(record.publishedAt)} 公表</summary>
      <p class="ops-muted">${esc(record.period)}</p>
      ${record.note ? `<p>${esc(record.note)}</p>` : ''}
      <dl>${Object.entries(record.metrics).map(([key, metric]) => {
        const { label, unit, basis } = definitions[key];
        const value = `${figures.format(metric.value)}${esc(unit)}`;
        const yoy = metric.yoy == null ? '' : ` ／ 前年同期比 ${growth(metric.yoy)}`;
        return `<div><dt>${esc(label)}</dt><dd><strong>${value}</strong>${yoy}</dd><dd class="ops-source">${esc(basis)}</dd></div>`;
      }).join('')}</dl>
      <p class="ops-source">${record.sources.map(source => {
        const label = esc(source.label);
        return /^https:\/\//.test(source.url) ? `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
      }).join(' ／ ')}</p>
    </details>`).join('')}`;
  } catch (error) {
    target.textContent = '公式の開示履歴を読み込めませんでした。';
    console.warn('note market data load skipped', error);
  }
}
