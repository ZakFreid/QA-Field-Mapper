// popup.js — справочник QA Field Mapper: 📁 host -> 📄 страница -> 🔗 связи
const $ = s => document.querySelector(s);

let all = {};
let X = {};
let nav = []; // [] | [host] | [host, pattern]
let search = '';
let cur = { host: null, pattern: null };
const LEGACY = '__legacy__';

const normVal = v => (typeof v === 'string' ? { p: v, l: '' } : (v || { p: '', l: '' }));
const labelOf = (key, obj) => obj.l || (key.startsWith('L::') ? key.slice(3) : '');

function isMappingMap(m) {
  if (!m || typeof m !== 'object') return false;
  const vals = Object.values(m);
  return vals.length > 0 && vals.every(v => typeof v === 'string' || (v && typeof v === 'object' && typeof v.p === 'string'));
}
function urlPatternFromUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname.split('/').map(s => (/\d/.test(s) ? ':id' : s)).join('/') || '/';
  } catch (e) { return null; }
}
function hostFromUrl(url) { try { return new URL(url).host || null; } catch (e) { return null; } }

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function save(cb) { chrome.storage.local.set({ qam: all }).then(cb || render); }
function saveX() { chrome.storage.local.set({ qamX: X }); }
let enabled = true;
function renderToggle() {
  const b = $('#btn-toggle');
  b.textContent = enabled ? '🟢 Вкл' : '⚪ Выкл';
  b.title = 'Включить/выключить расширение';
}
function load() {
  chrome.storage.local.get({ qam: {}, qamX: {}, qamEnabled: true }).then(res => {
    all = res.qam || {};
    X = res.qamX || {};
    enabled = res.qamEnabled !== false;
    renderToggle();
    render();
  });
}

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  if (tab && tab.url) { cur.host = hostFromUrl(tab.url); cur.pattern = urlPatternFromUrl(tab.url); }
  load();
});
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.qam) all = changes.qam.newValue || {};
    if (changes.qamX) X = changes.qamX.newValue || {};
    if (changes.qamEnabled) { enabled = changes.qamEnabled.newValue !== false; renderToggle(); }
    if (changes.qam || changes.qamX) render();
  });
  
  $('#btn-toggle').onclick = () => chrome.storage.local.set({ qamEnabled: !enabled });

// ---------- Доступ к данным ----------
function entriesOf(host, pattern) {
  const src = host === LEGACY ? all[pattern] : (all[host] || {})[pattern];
  return Object.entries(src || {}).map(([k, raw]) => [k, normVal(raw)]);
}
function pagesOf(host) {
  if (host === LEGACY) {
    return Object.keys(all).filter(k => k.startsWith('/') && isMappingMap(all[k]))
      .map(p => [p, entriesOf(LEGACY, p)]);
  }
  return Object.entries(all[host] || {}).map(([p, m]) => [p, Object.entries(m).map(([k, r]) => [k, normVal(r)])]);
}
function entryMatch(host, pattern, k, o, q) {
  return ((host === LEGACY ? '' : host) + ' ' + pattern + ' ' + k + ' ' + o.p + ' ' + labelOf(k, o)).toLowerCase().includes(q);
}
function setEntry(host, pattern, key, val) {
  if (host === LEGACY) { (all[pattern] || (all[pattern] = {}))[key] = val; }
  else { const dir = all[host] || (all[host] = {}); (dir[pattern] || (dir[pattern] = {}))[key] = val; }
  save();
}
function delEntry(host, pattern, key) {
  const src = host === LEGACY ? all[pattern] : (all[host] || {})[pattern];
  if (src) { delete src[key]; save(); }
}
function xPage(host, pattern) {
  return ((X[host] || {})[pattern]) || { custom: [], ignore: [] };
}

function locateOnPage(key) {
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab && tab.id) chrome.tabs.sendMessage(tab.id, { type: 'QAM_LOCATE', key }).catch(() => {});
  });
}

// ---------- Рендер ----------
function render() {
  const root = $('#list');
  root.innerHTML = '';
  const q = search.trim().toLowerCase();

  if (nav.length) {
    const head = el('div', 'crumbs');
    const b0 = el('button', '', '📁 Хосты');
    b0.onclick = () => { nav = []; render(); };
    head.appendChild(b0);
    if (nav.length >= 1) {
      const b1 = el('button', '', nav[0] === LEGACY ? 'Старый формат' : nav[0]);
      b1.onclick = () => { nav = [nav[0]]; render(); };
      head.appendChild(b1);
    }
    if (nav.length >= 2) head.appendChild(el('span', '', nav[1]));
    root.appendChild(head);
  }

  if (nav.length === 0) {
    // ----- уровень хостов -----
    const rows = [];
    for (const h of Object.keys(all)) {
      if (h.startsWith('/')) continue;
      const pages = pagesOf(h);
      const count = pages.reduce((s, [, e]) => s + e.length, 0);
      if (!count) continue;
      if (q && !h.toLowerCase().includes(q) &&
        !pages.some(([p, e]) => p.toLowerCase().includes(q) || e.some(([k, o]) => entryMatch(h, p, k, o, q)))) continue;
      rows.push([h, count]);
    }
    rows.sort((a, b) => b[1] - a[1]);
    const ci = rows.findIndex(r => r[0] === cur.host);
    if (ci > 0) rows.unshift(rows.splice(ci, 1)[0]);

    const legacyPages = pagesOf(LEGACY);
    if (legacyPages.length) rows.push([LEGACY, legacyPages.reduce((s, [, e]) => s + e.length, 0)]);

    for (const [h, count] of rows) {
      const div = el('div', 'row');
      const main = el('span', 'main', `${h === cur.host ? '● ' : '📁 '}${h === LEGACY ? 'Старый формат (без хоста)' : h}`);
      main.onclick = () => { nav = [h]; render(); };
      div.append(main, el('span', 'badge', String(count)));
      root.appendChild(div);
    }
    if (!rows.length) root.appendChild(el('div', 'empty', 'Справочник пуст.'));

  } else if (nav.length === 1) {
    // ----- уровень страниц -----
    const host = nav[0];
    const pages = pagesOf(host)
      .filter(([p, e]) => e.length || (p === cur.pattern && host === cur.host))
      .filter(([p, e]) => !q || p.toLowerCase().includes(q) || e.some(([k, o]) => entryMatch(host, p, k, o, q)))
      .sort((a, b) => b[1].length - a[1].length);
    for (const [p, e] of pages) {
      const div = el('div', 'row');
      const main = el('span', 'main', `${p === cur.pattern && host === cur.host ? '● ' : '📄 '}${p}`);
      main.onclick = () => { nav = [host, p]; render(); };
      const del = el('button', 'icon danger', '🗑');
      del.title = 'Удалить страницу';
      del.onclick = () => { if (confirm(`Удалить справочник страницы ${p}?`)) {
        if (host === LEGACY) delete all[p]; else delete (all[host] || {})[p];
        save();
      } };
      div.append(main, el('span', 'badge', String(e.length)), del);
      root.appendChild(div);
    }
    if (!pages.length) root.appendChild(el('div', 'empty', 'Нет страниц.'));

  } else {
    // ----- уровень связей -----
    const [host, pattern] = nav;
    const entries = entriesOf(host, pattern)
      .filter(([k, o]) => !q || entryMatch(host, pattern, k, o, q))
      .sort((a, b) => (labelOf(a[0], a[1]) || a[0]).localeCompare(labelOf(b[0], b[1]) || b[0], 'ru'));
    for (const [k, o] of entries) root.appendChild(mappingRow(host, pattern, k, o));

    // ручные поля (пипетка)
    const xp = xPage(host, pattern);
    const customs = (xp.custom || []).filter(cf => !q || ((cf.l || '') + ' ' + (cf.x || '')).toLowerCase().includes(q));
    if (customs.length) {
      root.appendChild(el('div', 'empty', '🎯 Ручные поля'));
      for (const cf of customs) {
        const div = el('div', 'row');
        const lab = el('span', 'key');
        lab.appendChild(el('div', 'klabel', '🎯 ' + (cf.l || cf.x)));
        const del = el('button', 'icon danger', '🗑');
        del.title = 'Удалить ручное поле';
        del.onclick = () => {
          const pg = (X[host] || (X[host] = {}))[pattern] || (X[host][pattern] = { custom: [], ignore: [] });
          pg.custom = (pg.custom || []).filter(c => c.x !== cf.x);
          saveX();
        };
        div.append(lab, del);
        root.appendChild(div);
      }
    }

    // игнорируемые поля
    const ignores = (xp.ignore || []).filter(ig => !q || ((ig.l || '') + ' ' + (ig.k || '')).toLowerCase().includes(q));
    if (ignores.length) {
      root.appendChild(el('div', 'empty', '🚫 Игнорируемые поля'));
      for (const ig of ignores) {
        const div = el('div', 'row');
        const lab = el('span', 'key');
        lab.appendChild(el('div', 'klabel', '🚫 ' + (ig.l || ig.k)));
        const back = el('button', 'icon', '↩');
        back.title = 'Вернуть поле';
        back.onclick = () => {
          const pg = (X[host] || (X[host] = {}))[pattern] || (X[host][pattern] = { custom: [], ignore: [] });
          pg.ignore = (pg.ignore || []).filter(i => i.x !== ig.x);
          saveX();
        };
        div.append(lab, back);
        root.appendChild(div);
      }
    }

    if (!entries.length && !customs.length && !ignores.length) {
      root.appendChild(el('div', 'empty', 'Ничего не найдено'));
    }
  }
}

function mappingRow(host, pattern, key, obj) {
  const div = el('div', 'row');
  const label = labelOf(key, obj);
  const name = label || (key.startsWith('X::') ? key.slice(3) : key);

  const lab = el('span', 'key');
  lab.appendChild(el('div', 'klabel', '🏷 ' + name));
  if (!label) lab.title = key;

  const val = el('span', 'val', obj.p);
  val.title = 'Клик — скопировать бэк-путь';
  val.style.cursor = 'pointer';
  val.onclick = () => navigator.clipboard.writeText(obj.p);

  const loc = el('button', 'icon', '🎯');
  loc.title = 'Показать на странице (скролл + фокус)';
  loc.onclick = () => locateOnPage(key);

  const copy = el('button', 'icon', '⧉');
  const isX = key.startsWith('X::');
  copy.title = isX ? 'Скопировать XPath' : 'Скопировать бэк-путь';
  copy.onclick = () => navigator.clipboard.writeText(isX ? key.slice(3) : obj.p);

  const edit = el('button', 'icon', '✎');
  edit.onclick = () => {
    const input = document.createElement('input');
    input.value = obj.p;
    val.replaceWith(input);
    input.focus();
    input.onblur = () => {
      const nv = input.value.trim();
      if (nv && nv !== obj.p) setEntry(host, pattern, key, { p: nv, l: obj.l }); else render();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.onblur = null; render(); }
    };
  };

  const del = el('button', 'icon danger', '🗑');
  del.onclick = () => delEntry(host, pattern, key);

  div.append(lab, val, loc, copy, edit, del);
  return div;
}

// ---------- Тулбар ----------
$('#search').oninput = e => { search = e.target.value; render(); };

$('#btn-export').onclick = () => {
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'qa-mapper-dictionary.json';
  a.click();
  URL.revokeObjectURL(a.href);
};

$('#btn-import').onclick = () => $('#file-import').click();
$('#file-import').onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      for (const [k, v] of Object.entries(data)) {
        if (k.startsWith('/') && isMappingMap(v)) {
          // старый плоский формат -> под текущий хост
          const host = cur.host || '(imported)';
          const dir = all[host] || (all[host] = {});
          const page = dir[k] || (dir[k] = {});
          for (const [key, val] of Object.entries(v)) page[key] = normVal(val);
        } else if (v && typeof v === 'object') {
          const dir = all[k] || (all[k] = {});
          for (const [p, m] of Object.entries(v)) {
            if (!isMappingMap(m)) continue;
            const page = dir[p] || (dir[p] = {});
            for (const [key, val] of Object.entries(m)) page[key] = normVal(val);
          }
        }
      }
      save();
    } catch (err) { alert('Не удалось разобрать JSON: ' + err.message); }
  };
  r.readAsText(f);
  e.target.value = '';
};