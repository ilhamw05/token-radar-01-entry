/* Token Launch Radar — renders window.RADAR (written by main.ts beside this page) with no network. */
'use strict';

var R = window.RADAR;
var rows = R.rows;
var bySlug = {};
rows.forEach(function (r) { bySlug[r.slug] = r; });

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function trimNum(x, dp) { return String(parseFloat(x.toFixed(dp))); }
function fmtMoney(v) {
  if (v >= 1e9) return '$' + trimNum(v / 1e9, 2) + 'B';
  if (v >= 1e6) return '$' + trimNum(v / 1e6, 2) + 'M';
  if (v >= 1e3) return '$' + trimNum(v / 1e3, 1) + 'K';
  return '$' + v;
}
function fmtFull(v) { return '$' + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fmtPct(v) { return v === null ? '—' : (v > 0 ? '+' : '') + trimNum(v, 2) + '%'; }
function fmtAge(days) {
  if (days === null) return '—';
  if (days < 365) return days + 'd';
  return trimNum(days / 365, 1) + 'y';
}
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso) {
  if (!iso) return '—';
  var p = iso.split('-');
  return p[2] + ' ' + MONTHS[Number(p[1]) - 1] + ' ' + p[0];
}

/* ---------- masthead stats ---------- */
document.getElementById('stats').innerHTML = [
  [R.scanned, 'protocols scanned'],
  [R.pre_token_size, 'record no token'],
  [R.watchlist_size, 'on the watchlist', 'amber'],
  [R.board_size, 'ranked on the board'],
  [R.live_size, 'live tokens set aside'],
  [fmtDate(R.as_of), 'snapshot date'],
].map(function (s) {
  return '<div class="stat' + (s[2] ? ' ' + s[2] : '') + '"><span class="v">' + esc(s[0]) + '</span><span class="k">' + s[1] + '</span></div>';
}).join('');
document.getElementById('footDate').textContent = fmtDate(R.as_of);

/* ---------- controls ---------- */
var qEl = document.getElementById('q');
var chainSel = document.getElementById('chainSel');
var catSel = document.getElementById('catSel');
var segSel = document.getElementById('segSel');
var sortSel = document.getElementById('sortSel');
var countEl = document.getElementById('count');
var tbody = document.getElementById('rows');

var chainSet = {}, catSet = {};
rows.forEach(function (r) {
  r.chains.forEach(function (c) { chainSet[c] = 1; });
  catSet[r.category === null ? '__none' : r.category] = 1;
});
Object.keys(chainSet).sort().forEach(function (c) {
  var o = document.createElement('option'); o.value = c; o.textContent = c; chainSel.appendChild(o);
});
Object.keys(catSet).sort().forEach(function (c) {
  var o = document.createElement('option');
  o.value = c; o.textContent = c === '__none' ? 'Uncategorised' : c;
  catSel.appendChild(o);
});

function filtered() {
  var q = qEl.value.trim().toLowerCase();
  var chain = chainSel.value, cat = catSel.value, seg = segSel.value;
  var out = rows.filter(function (r) {
    if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
    if (chain && r.chains.indexOf(chain) < 0) return false;
    if (cat && (r.category === null ? '__none' : r.category) !== cat) return false;
    if (seg === 'watch' && !r.watchlist) return false;
    if (seg === 'early' && r.watchlist) return false;
    return true;
  });
  var sort = sortSel.value;
  var by = {
    rank: function (a, b) { return a.rank - b.rank; },
    implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
    growth: function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d); },
    age: function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days); },
  }[sort];
  return out.sort(by);
}

function rowHtml(r) {
  var ch = r.chains.length === 0 ? '—' : esc(r.chains[0]) + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '');
  var cls = r.change_7d === null || r.change_7d === 0 ? 'flat' : r.change_7d > 0 ? 'pos' : 'neg';
  var tag = r.watchlist ? '<span class="tag watch">WATCHLIST</span>' : '<span class="tag early">EARLY FIND</span>';
  return '<tr data-slug="' + esc(r.slug) + '">' +
    '<td class="num rk">' + r.rank + '</td>' +
    '<td class="nm">' + esc(r.name) + tag + '</td>' +
    '<td class="cat">' + esc(r.category === null ? 'Uncategorised' : r.category) + '</td>' +
    '<td class="ch">' + ch + '</td>' +
    '<td class="num">' + fmtMoney(r.tvl_usd) + '</td>' +
    '<td class="num ' + cls + '">' + fmtPct(r.change_7d) + '</td>' +
    '<td class="num">' + fmtAge(r.age_days) + '</td>' +
    '<td class="num">×' + trimNum(r.category_multiple, 3) + '</td>' +
    '<td class="num imp">' + fmtMoney(r.implied_value_usd) + '</td></tr>';
}

function renderBoard() {
  var list = filtered();
  tbody.innerHTML = list.map(rowHtml).join('');
  countEl.innerHTML = 'Showing <b>' + list.length + '</b> of ' + rows.length + ' protocols';
}

[qEl, chainSel, catSel, segSel, sortSel].forEach(function (el) {
  el.addEventListener('input', renderBoard);
  el.addEventListener('change', renderBoard);
});
document.getElementById('controls').addEventListener('submit', function (e) { e.preventDefault(); });
tbody.addEventListener('click', function (e) {
  var tr = e.target.closest('tr[data-slug]');
  if (tr) location.hash = '#/p/' + tr.getAttribute('data-slug');
});

/* ---------- detail view ---------- */
var boardView = document.getElementById('boardView');
var detailView = document.getElementById('detailView');

function statCard(k, v, cls) {
  return '<div class="stat-card"><div class="k">' + k + '</div><div class="v' + (cls ? ' ' + cls : '') + '">' + v + '</div></div>';
}

function renderDetail(r) {
  var cls = r.change_7d === null || r.change_7d === 0 ? 'flat' : r.change_7d > 0 ? 'pos' : 'neg';
  var mult = trimNum(r.category_multiple, 3);
  var growth = trimNum(r.growth_factor, 4);
  var maturity = trimNum(r.maturity_factor, 4);
  var peerNote = r.category === null
    ? 'Its category is unrecorded in the snapshot, so the overall live median applies.'
    : 'That multiple is the median market-cap/TVL of the listed ' + esc(r.category) + ' protocols in this snapshot (or the overall live median, when fewer than three listed peers price the category).';
  var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
  detailView.innerHTML =
    '<a class="back" href="#/">&larr; Back to the board</a>' +
    '<div class="detail-head"><h2>' + esc(r.name) +
    (r.watchlist ? '<span class="tag watch">WATCHLIST</span>' : '<span class="tag early">EARLY FIND</span>') +
    '</h2><p class="slugline">rank #' + r.rank + ' of ' + rows.length + ' · ' + esc(r.slug) + ' · records no token in this snapshot</p></div>' +
    '<div class="stat-grid">' +
    statCard('Implied value', fmtMoney(r.implied_value_usd), 'teal') +
    statCard('TVL', fmtMoney(r.tvl_usd)) +
    statCard('7d TVL change', '<span class="' + cls + '">' + fmtPct(r.change_7d) + '</span>') +
    statCard('Category', esc(r.category === null ? 'Uncategorised' : r.category)) +
    statCard('Chains', r.chains.length === 0 ? '—' : esc(r.chains[0]) + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '')) +
    statCard('Tracked since', fmtDate(r.listed_at)) +
    statCard('Age with no token', r.age_days === null ? 'not recorded' : r.age_days + ' days (' + fmtAge(r.age_days) + ')') +
    statCard('Category multiple', '×' + mult) +
    '</div>' +
    (r.chains.length > 1 ? '<p class="chainline">All chains: ' + esc(r.chains.join(', ')) + '</p>' : '') +
    '<section class="why"><h3>Why this value</h3>' +
    '<p class="formula">' + fmtFull(r.tvl_usd) + ' TVL × <b>' + mult + '</b> multiple × <b>' + growth + '</b> growth × <b>' + maturity + '</b> maturity = <b>' + fmtFull(r.implied_value_usd) + '</b></p>' +
    '<p>' + esc(r.name) + ' records no token in this snapshot: no CoinGecko id, no symbol, no market cap. ' +
    peerNote + ' The growth factor reads its 7-day TVL change (' + fmtPct(r.change_7d) + '), and the maturity factor reads how long it has run with no token recorded' +
    (r.age_days === null ? ' (no listing date is recorded, so the model uses its neutral 0.85).' : ' (' + r.age_days + ' days).') +
    ' Change any one figure and the implied value moves with it — the model has no other inputs.</p></section>' +
    '<section class="plan"><h3>Farm plan — what to do before a launch</h3><ol>' + steps + '</ol></section>';
}

/* ---------- router ---------- */
function route() {
  var m = location.hash.match(/^#\/p\/(.+)$/);
  var r = m ? bySlug[decodeURIComponent(m[1])] : undefined;
  document.querySelector('.method').hidden = !!r;
  if (r) {
    renderDetail(r);
    boardView.hidden = true;
    detailView.hidden = false;
    window.scrollTo(0, 0);
  } else {
    detailView.hidden = true;
    boardView.hidden = false;
    renderBoard();
  }
}
window.addEventListener('hashchange', route);
route();
