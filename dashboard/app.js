// Token Radar's page. It reads window.RADAR, the dataset main.ts writes beside the dashboard, and
// renders three views over it: the ranked board of pre-token protocols, the protocols whose token
// already trades, and the comparable multiples the model is built from. No network: every number on
// the page is in data.js, and the model below recomputes each row's implied value from the row's own
// snapshot figures, so the code and board.json can be checked against each other on screen.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var M = DATA.model;
  var state = { q: '', cat: 'all', chain: 'all', minTvl: 0, watchOnly: false, sort: 'rank', dir: 1, tab: 'board', sel: null };

  /* ---------------- the model, as the page states it ---------------- */

  // impliedValue is scoreProtocol in lib/model.ts, in the same order of operations: the protocol's TVL,
  // times the market cap per dollar of TVL its category's live tokens earn, times the pre-token
  // discount, times the seven-day growth factor, times the maturity factor of its track record.
  function impliedValue(row) {
    var growth = Math.min(M.growth_cap, Math.max(M.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * M.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? M.unknown_age_days : row.age_days;
    var maturity = M.maturity_floor + (Math.min(Math.max(age, 0), M.maturity_days) / M.maturity_days) * M.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.comparable_multiple * M.discount * growthMult * maturity));
  }

  /* ---------------- formatting ---------------- */

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(a >= 1e11 ? 0 : 2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function days(n) {
    if (n === null || n === undefined) return 'unknown';
    if (n >= 730) return (n / 365).toFixed(1) + 'y';
    if (n >= 60) return Math.round(n / 30) + 'mo';
    return Math.round(n) + 'd';
  }
  function mult(n) { return n.toFixed(2) + '\u00d7'; }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  /* ---------------- header, kpis, method ---------------- */

  document.getElementById('m-date').textContent = DATA.as_of;
  document.getElementById('m-floor').textContent = usd(DATA.floor_usd);
  document.getElementById('m-model').textContent = DATA.model_version;

  var S = DATA.stats;
  var kpis = [
    { k: 'Protocols in the snapshot', v: String(S.protocols), sub: S.pre_token + ' record no token, ' + S.live + ' already trade' },
    { k: 'On the house watchlist', v: String(S.watchlist), sub: 'no token, above ' + usd(DATA.floor_usd) + ', not a wrapped or staked receipt' },
    { k: 'Ranked on the board', v: String(S.board), sub: S.early + ' of them below the watchlist floor: the early radar' },
    { k: 'TVL the board covers', v: usd(S.board_tvl_usd), sub: usd(S.watchlist_tvl_usd) + ' of it on the watchlist' },
    { k: 'Median implied multiple', v: mult(S.median_implied_multiple), sub: 'live tokens trade at ' + mult(S.global_multiple) + ' of TVL' }
  ];
  var kpiBox = document.getElementById('kpis');
  kpis.forEach(function (x) {
    var c = el('div', 'kpi');
    c.appendChild(el('div', 'k', x.k));
    c.appendChild(el('div', 'v', x.v));
    c.appendChild(el('div', 'sub', x.sub));
    kpiBox.appendChild(c);
  });

  var method = document.getElementById('method');
  method.appendChild(el('span', 'lead', 'Implied value'));
  var f = el('div', 'formula');
  [['TVL', ''], ['\u00d7', 'op'], ['peer mcap/TVL', 'hot'], ['\u00d7', 'op'], [M.discount.toFixed(2) + ' pre-token discount', 'term'], ['\u00d7', 'op'], ['growth ' + M.growth_weight + '\u00d7', 'term'], ['\u00d7', 'op'], ['maturity ' + M.maturity_days + 'd', 'term']].forEach(function (part) {
    f.appendChild(el('span', part[1] === 'op' ? 'op' : 'term' + (part[1] === 'hot' ? ' hot' : ''), part[0]));
  });
  method.appendChild(f);
  method.appendChild(el('span', 'note', 'Peer multiples come from the snapshot itself: the median market cap per dollar of TVL of the protocols in the same category whose token already trades.'));

  /* ---------------- filters ---------------- */

  var cats = {};
  DATA.rows.forEach(function (r) { if (r.category) cats[r.category] = (cats[r.category] || 0) + 1; });
  var chains = {};
  DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chains[c] = (chains[c] || 0) + 1; }); });

  var catSel = document.getElementById('f-cat');
  catSel.appendChild(new Option('all (' + DATA.rows.length + ')', 'all'));
  Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; }).forEach(function (c) {
    catSel.appendChild(new Option(c + ' (' + cats[c] + ')', c));
  });
  var chainSel = document.getElementById('f-chain');
  chainSel.appendChild(new Option('all', 'all'));
  Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a]; }).forEach(function (c) {
    chainSel.appendChild(new Option(c + ' (' + chains[c] + ')', c));
  });

  document.getElementById('c-board').textContent = DATA.rows.length;
  document.getElementById('c-live').textContent = DATA.live.length;

  function bind(id, fn) { document.getElementById(id).addEventListener('input', fn); document.getElementById(id).addEventListener('change', fn); }
  bind('q', function (e) { state.q = e.target.value.trim().toLowerCase(); draw(); });
  bind('f-cat', function (e) { state.cat = e.target.value; draw(); });
  bind('f-chain', function (e) { state.chain = e.target.value; draw(); });
  bind('f-tvl', function (e) { state.minTvl = Number(e.target.value); draw(); });
  bind('f-wl', function (e) { state.watchOnly = e.target.checked; draw(); });
  function reset() {
    state.q = ''; state.cat = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchOnly = false;
    document.getElementById('q').value = ''; document.getElementById('f-cat').value = 'all';
    document.getElementById('f-chain').value = 'all'; document.getElementById('f-tvl').value = '0';
    document.getElementById('f-wl').checked = false;
    draw();
  }
  document.getElementById('reset').addEventListener('click', reset);
  document.getElementById('clear2').addEventListener('click', reset);

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () {
      state.tab = t.getAttribute('data-tab');
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (o) {
        o.classList.toggle('on', o === t);
        o.setAttribute('aria-selected', o === t ? 'true' : 'false');
      });
      draw();
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll('thead th'), function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (!k) return;
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'rank' || k === 'name' || k === 'category' ? 1 : -1; }
      draw();
    });
  });

  /* ---------------- selection ---------------- */

  function matches(r) {
    if (state.watchOnly && !r.watchlist) return false;
    if (state.cat !== 'all' && r.category !== state.cat) return false;
    if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
    if (state.minTvl && r.tvl_usd < state.minTvl) return false;
    if (state.q) {
      var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase();
      if (hay.indexOf(state.q) < 0) return false;
    }
    return true;
  }

  function sortRows(rows) {
    var k = state.sort, d = state.dir;
    return rows.slice().sort(function (a, b) {
      var x, y;
      if (k === 'multiple') { x = a.implied_value_usd / a.tvl_usd; y = b.implied_value_usd / b.tvl_usd; }
      else if (k === 'name' || k === 'category') { x = String(a[k] || '').toLowerCase(); y = String(b[k] || '').toLowerCase(); }
      else { x = a[k]; y = b[k]; }
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      if (x === y) return a.rank - b.rank;
      return (x < y ? -1 : 1) * d;
    });
  }

  /* ---------------- detail ---------------- */

  function waterfall(r) {
    var steps = [
      { lab: 'TVL', v: r.tvl_usd, base: true },
      { lab: 'peer multiple', v: r.comparable_multiple },
      { lab: 'pre-token', v: M.discount },
      { lab: 'growth 7d', v: r.growth_multiplier },
      { lab: 'maturity', v: r.maturity_multiplier }
    ];
    var box = el('div', 'waterfall');
    steps.forEach(function (s) {
      var row = el('div', 'wf-row' + (s.base ? ' base' : ''));
      row.appendChild(el('div', 'lab', s.lab));
      var track = el('div', 'track');
      var fill = el('div', 'fill');
      // The TVL bar is the row's own width; a multiplier bar is drawn against 1.50x, so 1.00x is visible.
      fill.style.width = s.base ? '100%' : Math.max(3, Math.min(100, Math.round((s.v / 1.5) * 100))) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('div', 'val', s.base ? usd(s.v) : mult(s.v)));
      box.appendChild(row);
    });
    var out = el('div', 'wf-row last');
    out.appendChild(el('div', 'lab', 'implied FDV'));
    var tr = el('div', 'track');
    var fl = el('div', 'fill');
    fl.style.width = '100%';
    tr.appendChild(fl);
    out.appendChild(tr);
    out.appendChild(el('div', 'val', usd(r.implied_value_usd)));
    box.appendChild(out);
    return box;
  }

  function showDetail(r) {
    state.sel = r.slug;
    var box = document.getElementById('detail');
    box.textContent = '';

    var head = el('div', 'd-head');
    var left = el('div');
    left.appendChild(el('h2', null, r.name));
    left.appendChild(el('div', 'slug', r.slug + (r.listed_at ? ' \u00b7 tracked since ' + r.listed_at : '')));
    head.appendChild(left);
    box.appendChild(head);

    var chips = el('div', 'd-chips');
    if (r.category) chips.appendChild(el('span', 'chip', r.category));
    (r.chains || []).slice(0, 4).forEach(function (c) { chips.appendChild(el('span', 'chip', c)); });
    chips.appendChild(el('span', 'chip accent', r.watchlist ? 'on the watchlist' : 'below the floor'));
    chips.appendChild(el('span', 'chip', 'records no token'));
    box.appendChild(chips);

    var val = el('div', 'd-value');
    val.appendChild(el('div', 'k', 'Implied launch value'));
    var v = el('div', 'v');
    v.appendChild(document.createTextNode(usd(r.implied_value_usd)));
    v.appendChild(el('small', null, '  FDV'));
    val.appendChild(v);
    val.appendChild(el('div', 'x', 'Rank ' + r.rank + ' of ' + DATA.rows.length + ' \u00b7 ' + mult(r.implied_value_usd / r.tvl_usd) + ' of TVL \u00b7 page recomputes ' + usd(impliedValue(r))));
    box.appendChild(val);

    var grid = el('div', 'd-grid');
    [['TVL', usd(r.tvl_usd)], ['7d change', pct(r.change_7d)], ['Tracked for', days(r.age_days)], ['Peer multiple', mult(r.comparable_multiple)]].forEach(function (p) {
      var c = el('div');
      c.appendChild(el('div', 'k', p[0]));
      c.appendChild(el('div', 'v', p[1]));
      grid.appendChild(c);
    });
    box.appendChild(grid);

    box.appendChild(el('h3', 'sec', 'How the number is built'));
    box.appendChild(waterfall(r));

    box.appendChild(el('h3', 'sec', 'Farm plan'));
    var ol = el('ol', 'plan');
    r.plan.forEach(function (s) {
      var li = el('li');
      li.appendChild(el('div', 'act', s.action));
      var cm = el('div', 'cm');
      cm.appendChild(el('b', null, 'Cost '));
      cm.appendChild(document.createTextNode(s.cost + '  \u00b7  '));
      cm.appendChild(el('b', null, 'Time '));
      cm.appendChild(document.createTextNode(s.time));
      li.appendChild(cm);
      ol.appendChild(li);
    });
    box.appendChild(ol);

    var risk = el('div', 'risk');
    risk.textContent = 'A protocol that records no token is not a promise of one. ' + r.name + ' is priced here on its TVL of ' + usd(r.tvl_usd) + ' and a ' + days(r.age_days) + ' track record; a token may never be issued, and a claim always comes from the protocol, never from a link you are sent.';
    box.appendChild(risk);

    Array.prototype.forEach.call(document.querySelectorAll('tbody tr'), function (tr) {
      tr.classList.toggle('sel', tr.getAttribute('data-slug') === r.slug);
    });
  }


  /* ---------------- a protocol's own page ---------------- */

  // The permalink (?focus=<slug>) renders one protocol full width: its figures, the arithmetic behind
  // its implied value, and the whole farm plan in two columns. The board's drawer shows the same blocks
  // in a narrower column, so the page and the board can never disagree.
  function renderFocus(r) {
    document.body.classList.add('focus');
    var box = document.getElementById('focus-view');
    box.textContent = '';
    var head = el('div', 'f-head');
    var left = el('div');
    left.appendChild(el('h2', null, r.name));
    left.appendChild(el('div', 'slug', r.slug + ' \u00b7 ' + (r.category || 'Uncategorised') + (r.listed_at ? ' \u00b7 tracked since ' + r.listed_at : '')));
    head.appendChild(left);
    var figs = el('div', 'f-figures');
    [['Rank', '#' + r.rank], ['TVL', usd(r.tvl_usd)], ['7d', pct(r.change_7d)], ['Age', days(r.age_days)]].forEach(function (p) {
      var d = el('div');
      d.appendChild(el('div', 'k', p[0]));
      d.appendChild(el('div', 'v', p[1]));
      figs.appendChild(d);
    });
    head.appendChild(figs);
    box.appendChild(head);

    var cols = el('div', 'f-cols');
    var leftCol = el('div');
    var val = el('div', 'd-value');
    val.appendChild(el('div', 'k', 'Implied launch value'));
    var v = el('div', 'v');
    v.appendChild(document.createTextNode(usd(r.implied_value_usd)));
    v.appendChild(el('small', null, '  FDV'));
    val.appendChild(v);
    val.appendChild(el('div', 'x', mult(r.implied_value_usd / r.tvl_usd) + ' of its ' + usd(r.tvl_usd) + ' of TVL'));
    leftCol.appendChild(val);
    leftCol.appendChild(el('h3', 'sec', 'How the number is built'));
    leftCol.appendChild(waterfall(r));
    var note = el('p', 'f-note');
    note.textContent = 'Peer multiple: ' + mult(r.comparable_multiple) + ', the median market cap per dollar of TVL of the snapshot\u2019s live-token protocols in ' + (r.category || 'this category') + '. Growth factor ' + mult(r.growth_multiplier) + ' follows the seven-day change of ' + pct(r.change_7d) + '; maturity ' + mult(r.maturity_multiplier) + ' follows ' + days(r.age_days) + ' tracked with no token recorded.';
    leftCol.appendChild(note);

    var risk = el('div', 'risk');
    risk.textContent = 'Recording no token is not a promise of one. This value rests on ' + usd(r.tvl_usd) + ' of TVL and ' + days(r.age_days) + ' of history; a token may never come, and a real claim is announced by the protocol itself, never by a link or a fee.';
    leftCol.appendChild(risk);
    cols.appendChild(leftCol);

    var rightCol = el('div', 'f-plan');
    rightCol.appendChild(el('h3', 'sec', 'Farm plan'));
    var ol = el('ol', 'plan');
    r.plan.forEach(function (st) {
      var li = el('li');
      li.appendChild(el('div', 'act', st.action));
      var cm = el('div', 'cm');
      cm.appendChild(el('b', null, 'Cost '));
      cm.appendChild(document.createTextNode(st.cost + '  \u00b7  '));
      cm.appendChild(el('b', null, 'Time '));
      cm.appendChild(document.createTextNode(st.time));
      li.appendChild(cm);
      ol.appendChild(li);
    });
    rightCol.appendChild(ol);

    // The rest of the radar in this category: the protocols a reader should compare it with, and the
    // reason a board of 100+ rows exists at all.
    var siblings = DATA.rows.filter(function (x) { return x.category === r.category && x.slug !== r.slug; }).slice(0, 4);
    if (siblings.length) {
      rightCol.appendChild(el('h3', 'sec', 'Same category, still no token'));
      var st = el('table', 'mtable');
      var stb = el('tbody');
      siblings.forEach(function (x) {
        var tr = el('tr');
        var n = el('td');
        n.appendChild(el('b', null, x.name));
        n.appendChild(el('div', 'chains', 'rank ' + x.rank + ' \u00b7 ' + usd(x.tvl_usd) + ' of TVL'));
        tr.appendChild(n);
        tr.appendChild(el('td', 'num', usd(x.implied_value_usd)));
        tr.appendChild(el('td', 'num', mult(x.implied_value_usd / x.tvl_usd)));
        stb.appendChild(tr);
      });
      st.appendChild(stb);
      rightCol.appendChild(st);
    }

    // The peers the model priced this protocol against: the live-token protocols of its own category.
    var peers = DATA.live.filter(function (l) { return l.category === r.category; }).slice(0, 4);
    if (peers.length) {
      rightCol.appendChild(el('h3', 'sec', 'Peers whose token already trades'));
      var pt = el('table', 'mtable');
      var ptb = el('tbody');
      peers.forEach(function (l) {
        var tr = el('tr');
        var n = el('td');
        n.appendChild(el('b', null, l.name));
        tr.appendChild(n);
        tr.appendChild(el('td', 'num', usd(l.mcap_usd)));
        tr.appendChild(el('td', 'num', mult(l.multiple)));
        ptb.appendChild(tr);
      });
      pt.appendChild(ptb);
      rightCol.appendChild(pt);
    }
    cols.appendChild(rightCol);
    box.appendChild(cols);
  }

  /* ---------------- table ---------------- */

  function boardRows() {
    var rows = DATA.rows.filter(matches);
    // The drawer always shows a row the filters left on screen: a reader who narrows the board to
    // Lending must not be looking at a Risk Curator in the panel beside it.
    if (!rows.some(function (r) { return r.slug === state.sel; })) state.sel = rows.length ? rows[0].slug : null;
    var maxImplied = DATA.rows.length ? DATA.rows[0].implied_value_usd : 1;
    var tb = document.getElementById('rows');
    tb.textContent = '';
    var total = rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    sortRows(rows).forEach(function (r) {
      var tr = el('tr');
      tr.setAttribute('data-slug', r.slug);
      if (state.sel === r.slug) tr.className = 'sel';
      tr.addEventListener('click', function () { showDetail(r); });

      var name = el('td');
      var line = el('div', 'pname');
      line.appendChild(el('span', 'rank' + (r.rank <= 10 ? ' top' : ''), r.rank));
      line.appendChild(el('b', null, r.name));
      line.appendChild(el('span', 'slug', r.slug));
      if (r.watchlist) line.appendChild(el('span', 'tag', 'watchlist'));
      name.appendChild(line);
      name.appendChild(el('div', 'chains', (r.chains || []).join(' \u00b7 ') || 'chain not recorded'));
      tr.appendChild(name);

      tr.appendChild(el('td', null, r.category || 'Uncategorised'));

      tr.appendChild(el('td', 'num', usd(r.tvl_usd)));

      var g = el('td', 'num');
      var gg = el('span', 'growth ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), pct(r.change_7d));
      g.appendChild(gg);
      tr.appendChild(g);

      tr.appendChild(el('td', 'num', days(r.age_days)));

      var im = el('td', 'num imp');
      im.appendChild(el('span', 'implied', usd(r.implied_value_usd)));
      var bar = el('div', 'bar');
      var inner = el('i');
      inner.style.width = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100)) + '%';
      bar.appendChild(inner);
      im.appendChild(bar);
      tr.appendChild(im);

      tr.appendChild(el('td', 'num', mult(r.implied_value_usd / r.tvl_usd)));

      tb.appendChild(tr);
    });
    document.getElementById('empty').hidden = rows.length > 0;
    var share = total > 0 ? ' \u00b7 ' + usd(total) + ' of implied value in view' : '';
    document.getElementById('count').textContent = rows.length + ' of ' + DATA.rows.length + ' protocols' + share;
    if (state.sel) {
      var sel = DATA.rows.filter(function (x) { return x.slug === state.sel; })[0];
      if (sel) showDetail(sel);
    }
  }

  /* ---------------- live tokens and comparables ---------------- */

  function liveView() {
    var box = el('div', 'panel');
    box.appendChild(el('h2', null, 'The protocols whose token already trades'));
    box.appendChild(el('p', 'lede', 'These are the market\'s own values, kept off the ranked board: the board prices only protocols that record no token. Their market cap per dollar of TVL is what the model\'s peer multiples are the median of.'));
    var t = el('table', 'mtable');
    var thead = el('thead');
    var hr = el('tr');
    ['#', 'Protocol', 'Category', 'TVL', 'Market cap', 'mcap / TVL', '7d'].forEach(function (h, i) {
      var th = el('th', i > 1 ? 'num' : null, h);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    t.appendChild(thead);
    var tb = el('tbody');
    DATA.live.forEach(function (l, i) {
      var tr = el('tr');
      tr.appendChild(el('td', 'num', i + 1));
      var n = el('td');
      n.appendChild(el('b', null, l.name));
      n.appendChild(el('div', 'chains', (l.chains || []).join(' \u00b7 ')));
      tr.appendChild(n);
      tr.appendChild(el('td', null, l.category || 'Uncategorised'));
      tr.appendChild(el('td', 'num', usd(l.tvl_usd)));
      tr.appendChild(el('td', 'num', usd(l.mcap_usd)));
      tr.appendChild(el('td', 'num', mult(l.multiple)));
      var g = el('td', 'num');
      g.appendChild(el('span', 'growth ' + (l.change_7d === null ? '' : l.change_7d >= 0 ? 'up' : 'down'), pct(l.change_7d)));
      tr.appendChild(g);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    box.appendChild(t);
    return box;
  }

  function peersView() {
    var box = el('div', 'panel');
    box.appendChild(el('h2', null, 'Comparable multiples, by category'));
    box.appendChild(el('p', 'lede', 'The median market cap per dollar of TVL of the snapshot\'s live-token protocols, by category. A category with fewer than three live tokens borrows the snapshot-wide median of ' + mult(DATA.stats.global_multiple) + ', so no multiple rests on a single comparison.'));
    var t = el('table', 'mtable');
    var thead = el('thead');
    var hr = el('tr');
    ['Category', 'Median mcap / TVL', 'Live tokens compared', 'Protocols on the board'].forEach(function (h, i) {
      hr.appendChild(el('th', i > 0 ? 'num' : null, h));
    });
    thead.appendChild(hr);
    t.appendChild(thead);
    var counts = {};
    DATA.rows.forEach(function (r) { if (r.category) counts[r.category] = (counts[r.category] || 0) + 1; });
    var tb = el('tbody');
    DATA.multiples.forEach(function (m) {
      var tr = el('tr');
      tr.appendChild(el('td', null, m.category));
      tr.appendChild(el('td', 'num', mult(m.multiple)));
      tr.appendChild(el('td', 'num', m.samples));
      tr.appendChild(el('td', 'num', counts[m.category] || 0));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    box.appendChild(t);
    return box;
  }

  /* ---------------- draw ---------------- */

  function draw() {
    var boardView = document.getElementById('board-view');
    var panelView = document.getElementById('panel-view');
    var detail = document.getElementById('detail');
    var isBoard = state.tab === 'board';
    boardView.hidden = !isBoard;
    panelView.hidden = isBoard;
    detail.hidden = !isBoard;
    if (isBoard) {
      Array.prototype.forEach.call(document.querySelectorAll('#board-table thead th'), function (th) {
        th.classList.toggle('sorted', th.getAttribute('data-k') === state.sort);
        th.classList.toggle('asc', state.dir === 1);
      });
      boardRows();
    } else {
      panelView.textContent = '';
      panelView.appendChild(state.tab === 'live' ? liveView() : peersView());
    }
  }

  document.getElementById('provenance').textContent = DATA.source + ' \u00b7 snapshot ' + DATA.as_of + ' \u00b7 ' + DATA.stats.protocols + ' protocols \u00b7 model ' + DATA.model_version;

  // A link may carry the view it opens: ?tab=live, ?cat=Lending, ?chain=Base, ?q=usd, ?watch=1, ?sort=implied.
  (function fromLocation() {
    var p = new URLSearchParams(location.search);
    if (p.get('tab')) state.tab = p.get('tab');
    if (p.get('cat')) state.cat = p.get('cat');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('q')) state.q = p.get('q').toLowerCase();
    if (p.get('watch') === '1') state.watchOnly = true;
    if (p.get('tvl')) state.minTvl = Number(p.get('tvl'));
    if (p.get('sort')) { state.sort = p.get('sort'); state.dir = -1; }
    if (p.get('focus')) {
      var target = DATA.rows.filter(function (x) { return x.slug === p.get('focus'); })[0];
      if (target) { renderFocus(target); return; }
    }
    document.getElementById('q').value = state.q;
    document.getElementById('f-cat').value = state.cat;
    document.getElementById('f-chain').value = state.chain;
    document.getElementById('f-tvl').value = String(state.minTvl);
    document.getElementById('f-wl').checked = state.watchOnly;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (o) {
      var on = o.getAttribute('data-tab') === state.tab;
      o.classList.toggle('on', on);
      o.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  })();

  if (!document.body.classList.contains('focus')) {
    draw();
    if (state.sel === null && DATA.rows.length) showDetail(DATA.rows[0]);
  }
})();
