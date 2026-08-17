// scanner.js — QA Field Mapper: детект + авто-матчинг + пипетка (F) + игнор
(function () {
    const FIELD_SELECTOR = [
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"])',
      'textarea',
      'select',
      '[contenteditable="true"], [contenteditable=""]'
    ].join(', ');
    const EXCLUDE = 'script,style,button,a,nav,header,th,#qam-tooltip,#qam-panel';
  
    const fields = new Map(); // xpath -> rec
  
    // ---------- Стили ----------
    const style = document.createElement('style');
    style.textContent = `
      [data-qam-state="unmapped"] { outline: 2px dashed rgba(255,152,0,.75) !important; outline-offset: 1px; }
      [data-qam-state="mapped"]   { outline: 2px solid rgba(76,175,80,.75) !important; outline-offset: 1px; }
      @keyframes qam-flash { 50% { box-shadow: 0 0 0 6px rgba(33,150,243,.85); } }
      .qam-locate { animation: qam-flash .5s ease-in-out 4 !important; }
      .qam-picking, .qam-picking * { cursor: crosshair !important; }
      .qam-pick { outline: 3px solid #2196f3 !important; outline-offset: 1px; }
      #qam-tooltip {
        position: fixed; z-index: 2147483647; max-width: 460px; padding: 8px 10px;
        background: #101418; color: #e6e6e6; font: 12px/1.6 ui-monospace, monospace;
        border: 1px solid #3a3f44; border-radius: 6px; pointer-events: none;
        white-space: pre-wrap; word-break: break-word; box-shadow: 0 6px 16px rgba(0,0,0,.45);
        display: none;
      }
      #qam-panel {
        position: fixed; top: 0; right: 0; z-index: 2147483647;
        width: 430px; max-width: 92vw; height: 100vh; padding: 12px;
        background: #14181d; color: #eee; font: 13px/1.4 system-ui, sans-serif;
        border-left: 1px solid #333; box-shadow: -8px 0 24px rgba(0,0,0,.5);
        display: flex; flex-direction: column; gap: 8px;
      }
      #qam-panel .qam-p-head { display: flex; justify-content: space-between; align-items: center; }
      #qam-panel .qam-p-title { font-weight: 600; }
      #qam-panel button { cursor: pointer; background: #232a31; color: #eee; border: 1px solid #3a4149; border-radius: 4px; padding: 4px 8px; }
      #qam-panel .qam-p-search { background: #0e1114; color: #eee; border: 1px solid #3a4149; border-radius: 4px; padding: 6px 8px; }
      #qam-panel .qam-p-cur { color: #9fd39f; word-break: break-all; }
      #qam-panel .qam-p-list { overflow-y: auto; flex: 1; }
      #qam-panel .qam-p-row { display: flex; justify-content: space-between; gap: 6px; padding: 4px 6px; border-radius: 4px; }
      #qam-panel .qam-p-row:hover { background: #1d242b; }
      #qam-panel .qam-p-row.hit { background: #14301c; }
      #qam-panel .qam-p-row span { cursor: pointer; word-break: break-all; font-family: ui-monospace, monospace; font-size: 12px; }
    `;
    document.documentElement.appendChild(style);
    const tip = document.createElement('div');
    tip.id = 'qam-tooltip';
    document.documentElement.appendChild(tip);
  
    // ---------- Утилиты ----------
    function getXPath(el) {
      if (el.id) return `//*[@id="${el.id}"]`;
      const parts = [];
      while (el && el.nodeType === 1) {
        let index = 1, sib = el.previousElementSibling;
        while (sib) { if (sib.tagName === el.tagName) index++; sib = sib.previousElementSibling; }
        parts.unshift(`${el.tagName.toLowerCase()}[${index}]`);
        el = el.parentElement;
      }
      return '/' + parts.join('/');
    }
  
    function byXPath(x) {
      try {
        return document.evaluate(x, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      } catch (e) { return null; }
    }
  
    function findCustomEl(cf) {
      // 0. Сессионный маркер
      let el = null;
      try { el = document.querySelector(`[data-qam-custom="${CSS.escape(cf.x)}"]`); } catch (e) {}
      // 1. Точный XPath
      if (!el && cf.x) el = byXPath(cf.x);
      if (el) return el;
  
      // 2. Фолбэки, если DOM перестроился
      let cands = [];
      if (cf.tag) {
        for (const c of document.querySelectorAll(cf.tag)) {
          if ((c.textContent || '').trim() === (cf.text || '')) cands.push(c);
        }
      }
      if (!cands.length && cf.t) cands = [...document.querySelectorAll(`[data-testid="${CSS.escape(cf.t)}"]`)];
      if (!cands.length && cf.id) { const e = document.getElementById(cf.id); if (e) cands = [e]; }
      if (!cands.length && cf.n) cands = [...document.querySelectorAll(`[name="${CSS.escape(cf.n)}"]`)];
      if (!cands.length) return null;
  
      const exact = cands.find(c => getXPath(c) === cf.x);
      if (exact) return exact;
  
      if (cf.l) {
        const byLabel = cands.find(c => {
          const lc = labelCandidate(c);
          const lab = (lc ? leafText(lc) : '') || getLabel(c) || getTableLabel(c) || '';
          return lab === cf.l;
        });
        if (byLabel) return byLabel;
      }
      return cands.length === 1 ? cands[0] : null;
    }
  
    function getLabel(el) {
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) return l.textContent.trim();
      }
      const p = el.closest('label');
      if (p) return p.textContent.trim();
      return (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || '').trim();
    }
  
    function leafText(el) {
      if (!el || el.children.length > 0) return '';
      const t = (el.textContent || '').trim();
      return (t.length > 1 && t.length < 120) ? t : '';
    }
  
    const DECOR = new Set(['SVG', 'I', 'B', 'EM', 'STRONG', 'SPAN', 'IMG', 'SMALL', 'BR', 'SUB', 'SUP', 'CODE']);
    function isLeafish(el) {
      if (el.children.length === 0) return true;
      if ((el.textContent || '').trim().length > 200) return false;
      for (const c of el.children) if (!DECOR.has(c.tagName)) return false;
      return true;
    }
  
    function depthOf(el) { let d = 0, n = el; while (n) { d++; n = n.parentElement; } return d; }
  
    function labelCandidate(el) {
      const cands = [
        el.previousElementSibling,
        el.parentElement ? el.parentElement.previousElementSibling : null,
        el.parentElement && el.parentElement.firstElementChild !== el ? el.parentElement.firstElementChild : null
      ];
      const vs = getComputedStyle(el);
      for (const c of cands) {
        const t = leafText(c);
        if (!t || c.contains(el)) continue;
        if (parseFloat(getComputedStyle(c).fontSize) <= parseFloat(vs.fontSize)) return c;
      }
      return null;
    }
  
    function getTableLabel(el) {
      const cell = el.closest('td, [role="cell"], [role="gridcell"]');
      if (!cell || !cell.parentElement) return '';
      const idx = Array.prototype.indexOf.call(cell.parentElement.children, cell);
      if (idx < 0) return '';
      const root = cell.closest('table, [role="grid"], [role="table"]') || document;
      const h = root.querySelectorAll('th, [role="columnheader"]')[idx];
      return h ? h.textContent.trim().slice(0, 120) : '';
    }
  
    function getValue(el) {
      if (el.isContentEditable) return (el.textContent || '').trim().slice(0, 200);
      if (el.tagName === 'SELECT') return el.value;
      if (el.type === 'checkbox' || el.type === 'radio') return String(el.checked);
      return el.value;
    }
  
    function readValue(el) {
      if (el.matches(FIELD_SELECTOR)) return getValue(el);
      return (el.textContent || '').trim().slice(0, 200);
    }
  
    function isGood(v) {
      if (v === null || v === undefined || v === '' || typeof v === 'boolean') return false;
      if (typeof v === 'number') return v !== 0 && v !== 1;
      if (typeof v === 'string') return v.length >= 2 && v.length <= 200 && v !== 'true' && v !== 'false';
      return false;
    }
  
    function canonDate(s) {
      let m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}:\d{2})(?::(\d{2}))?)?$/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00:00'}:${m[5] || '00'}`;
      if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) {
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
          const p = n => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        }
      }
      return null;
    }
  
    function reps(v) {
      const s = String(v);
      const out = ['E:' + s, 'W:' + s.replace(/\s+/g, ' ').trim()];
      const t = canonDate(s);
      if (t) { out.push('T:' + t, 'D:' + t.slice(0, 10)); }
      return out;
    }
  
    function flatten(obj, prefix, out, depth) {
      if (out.length > 20000 || depth > 12 || obj === null || obj === undefined) return;
      if (typeof obj !== 'object') { out.push([prefix, obj]); return; }
      if (Array.isArray(obj)) {
        obj.slice(0, 25).forEach((item, i) => flatten(item, `${prefix}[${i}]`, out, depth + 1));
        return;
      }
      for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
    }
  
    // ---------- Кэш разворота payload-ов ----------
    let cacheLen = -1, cacheLast = null, flatPairs = [], payloadMaps = [];
  
    function ensureCache() {
      const store = window.__QAM__;
      const len = store ? store.payloads.length : 0;
      const last = len ? store.payloads[len - 1] : null;
      if (len === cacheLen && last === cacheLast) return;
      cacheLen = len; cacheLast = last;
      flatPairs = []; payloadMaps = [];
      if (!store) return;
      for (const p of store.payloads) {
        const pairs = [];
        flatten(p.data, '', pairs, 0);
        const good = pairs.filter(([, v]) => isGood(v));
        flatPairs = flatPairs.concat(good);
        const m = new Map();
        for (const [path, v] of good) {
          for (const rep of reps(v)) {
            if (!m.has(rep)) m.set(rep, new Set());
            m.get(rep).add(path);
          }
        }
        payloadMaps.push(m);
      }
    }
  
    function jsonPairs() { ensureCache(); return flatPairs; }
  
    // ---------- Сканер ----------
    function scan() {
      const store = window.__QAM__;
      if (!store || !store.enabled) return;
  
      let recs = [];
      const seenX = new Set();
  
      // 1. Интерактивные поля
      document.querySelectorAll(FIELD_SELECTOR).forEach((el) => {
        if (el.closest('#qam-panel,#qam-tooltip')) return;
        const xpath = getXPath(el);
        seenX.add(xpath);
        recs.push({ el, xpath, label: getLabel(el), value: getValue(el) });
      });
  
      // 2. Текстовые элементы-кандидаты
      const rawLeaves = [];
      if (document.body) {
        document.querySelectorAll('body *').forEach((el) => {
          if (!isLeafish(el)) return;
          const t = (el.textContent || '').trim();
          if (!t || t.length > 200) return;
          if (el.closest(EXCLUDE)) return;
          if (el.closest(FIELD_SELECTOR)) return;
          const xpath = getXPath(el);
          if (seenX.has(xpath)) return;
          rawLeaves.push({ el, xpath, text: t, depth: depthOf(el) });
        });
      }
      rawLeaves.sort((a, b) => b.depth - a.depth);
      const keptByText = new Map();
      const leaves = [];
      for (const L of rawLeaves) {
        const arr = keptByText.get(L.text) || [];
        let skip = false;
        for (const k of arr) {
          if (k.contains(L.el) || L.el.contains(k)) { skip = true; break; }
        }
        if (skip) continue;
        arr.push(L.el);
        keptByText.set(L.text, arr);
        leaves.push(L);
      }
  
      // 3. Пары "значение + лейбл"
      const labelEls = new Set();
      const pairList = [];
      for (const L of leaves) {
        const c = labelCandidate(L.el);
        if (c) { pairList.push([L, c]); labelEls.add(c); }
      }
      for (const [L, c] of pairList) {
        if (labelEls.has(L.el)) continue;
        seenX.add(L.xpath);
        recs.push({ el: L.el, xpath: L.xpath, label: leafText(c), value: L.text });
      }
  
      // 4. Табличные ячейки
      for (const L of leaves) {
        if (seenX.has(L.xpath)) continue;
        const tl = getTableLabel(L.el);
        if (!tl) continue;
        seenX.add(L.xpath);
        recs.push({ el: L.el, xpath: L.xpath, label: tl, value: L.text });
      }
  
      // 5. Ручные поля (пипетка)
      (store.custom || []).forEach((cf) => {
        const el = findCustomEl(cf);
        if (!el) return;
        const xpath = getXPath(el);
        if (recs.some(r => r.xpath === xpath)) return;
        seenX.add(xpath);
        recs.push({
          el, xpath,
          label: cf.l || getLabel(el) || getTableLabel(el),
          value: readValue(el),
          key: 'C::' + cf.x
        });
      });
  
      // 6. Фильтр игнорируемых
      const ign = new Set();
      (store.ignore || []).forEach(i => { ign.add(i.k); ign.add(i.x); });
      recs = recs.filter(r => !ign.has(r.key) && !ign.has(r.xpath));
  
      // 7. Ключи справочника
      const labelCount = new Map();
      recs.forEach(r => { if (r.label) labelCount.set(r.label, (labelCount.get(r.label) || 0) + 1); });
      recs.forEach(r => {
        if (!r.key) r.key = (r.label && labelCount.get(r.label) === 1) ? 'L::' + r.label : 'X::' + r.xpath;
      });
  
      // 8. Отрисовка + связи + дообогащение лейблами
      document.querySelectorAll('[data-qam-state]').forEach(el => el.removeAttribute('data-qam-state'));
      fields.clear();
      let needSave = false;
      recs.forEach(r => {
        fields.set(r.xpath, r);
        if (r.label && store.labels && store.labels.get(r.key) !== r.label) {
          store.labels.set(r.key, r.label);
          if (store.mappings.has(r.key)) needSave = true;
        }
        r.mappedTo = store.mappings.get(r.key) || null;
        r.el.setAttribute('data-qam-state', r.mappedTo ? 'mapped' : 'unmapped');
      });
      if (needSave && store.save) store.save();
  
      runMatching(recs);
    }
    window.__QAM__.rescan = scan;
  
    // ---------- Авто-матчинг с каскадом ----------
    function runMatching(recs) {
      const store = window.__QAM__;
      recs = recs || [...fields.values()];
      ensureCache();
  
      const recByKey = new Map(recs.map(r => [r.key, r]));
  
      const taken = new Map();
      for (const [key, path] of store.mappings) {
        const rec = recByKey.get(key);
        if (!rec) continue;
        for (const rep of reps(rec.value)) {
          if (!taken.has(rep)) taken.set(rep, new Set());
          taken.get(rep).add(path);
        }
      }
  
      const unmappedByRep = new Map();
      recs.forEach(r => {
        if (store.mappings.has(r.key) || !isGood(r.value)) return;
        for (const rep of reps(r.value)) {
          if (!unmappedByRep.has(rep)) unmappedByRep.set(rep, []);
          unmappedByRep.get(rep).push(r);
        }
      });
  
      let added = false;
      const assign = (r, path) => {
        store.mappings.set(r.key, path);
        r.mappedTo = path;
        r.el.setAttribute('data-qam-state', 'mapped');
        added = true;
      };
  
      for (const [rep, list] of unmappedByRep) {
        const takenSet = taken.get(rep);
        for (let i = payloadMaps.length - 1; i >= 0; i--) {
          const K = payloadMaps[i].get(rep);
          if (!K) continue;
          const Krem = new Set([...K].filter(p => !takenSet || !takenSet.has(p)));
          if (Krem.size === 1) {
            const path = [...Krem][0];
            list.forEach(r => { if (!store.mappings.has(r.key)) assign(r, path); });
          }
          break;
        }
      }
  
      if (added && store.save) store.save();
    }
  
    // ---------- Пипетка (режим выделения, F) ----------
    let pickMode = false, pickEl = null;
  
    function setPick(on) {
      pickMode = on;
      document.documentElement.classList.toggle('qam-picking', on);
      if (!on && pickEl) { pickEl.classList.remove('qam-pick'); pickEl = null; }
      tip.style.display = 'none';
    }
  
    // Глобальный тумблер вкл/выкл
    window.__QAM__.setEnabled = (on) => {
      window.__QAM__.enabled = on;
      if (!on) {
        document.querySelectorAll('[data-qam-state]').forEach(el => el.removeAttribute('data-qam-state'));
        tip.style.display = 'none';
        closePanel();
        setPick(false);
      } else {
        scan();
      }
    };
  
    document.addEventListener('mouseover', (e) => {
      if (!pickMode) return;
      if (pickEl) pickEl.classList.remove('qam-pick');
      pickEl = e.target;
      pickEl.classList.add('qam-pick');
    }, true);
  
  function handlePickClick(e) {
    if (!pickMode) return;
    if (e.target.closest && e.target.closest('#qam-panel')) return; 
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    if (e.type !== 'pointerdown' && e.type !== 'mousedown') return;

    const el = e.target;
    const framed = el.closest ? el.closest('[data-qam-state]') : null;
    if (framed) {
      const rec = fields.get(getXPath(framed));
      if (rec) openPanel(rec);
    } else {
      const lc = labelCandidate(el);
      const cf = {
        x: getXPath(el),
        id: el.id || '',
        t: (el.getAttribute && el.getAttribute('data-testid')) || '',
        n: (el.getAttribute && el.getAttribute('name')) || '',
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 200),
        l: (lc ? leafText(lc) : '') || getLabel(el) || getTableLabel(el) || ''
      };
      window.__QAM__.removeIgnore(getXPath(el)); 
      el.setAttribute('data-qam-custom', cf.x);
      window.__QAM__.addCustom(cf);
      el.setAttribute('data-qam-state', 'unmapped');
    }
  }

  ['pointerdown', 'mousedown', 'mouseup', 'click', 'auxclick', 'contextmenu'].forEach((evt) => {
    document.addEventListener(evt, handlePickClick, true);
  });
  
    // ---------- Тултип ----------
    let hoverRec = null;
  
    function isTyping(t) {
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    }
  
    function showTip(el) {
      const rec = fields.get(getXPath(el));
      if (!rec) { tip.style.display = 'none'; return; }
      hoverRec = rec;
      tip.textContent = [
        `🏷 ${rec.label || '(без лейбла)'}`,
        rec.mappedTo ? `🔑 Бэк-параметр: ${rec.mappedTo}` : `⚠️ Не замаплено`,
        `💳 Значение: ${JSON.stringify(rec.value)}`,
        `🧬 XPath: ${rec.xpath}`
      ].join('\n');
      tip.style.display = 'block';
      const r = el.getBoundingClientRect();
      let top = r.bottom + 8;
      if (top + tip.offsetHeight > innerHeight - 8) top = Math.max(8, r.top - tip.offsetHeight - 8);
      tip.style.top = top + 'px';
      tip.style.left = Math.min(Math.max(8, r.left), innerWidth - tip.offsetWidth - 8) + 'px';
    }
  
    document.addEventListener('mouseover', (e) => {
      if (pickMode || !window.__QAM__ || !window.__QAM__.enabled || e.target.closest('#qam-panel')) { tip.style.display = 'none'; return; }
      const el = e.target.closest ? e.target.closest('[data-qam-state]') : null;
      if (!el) { tip.style.display = 'none'; return; }
      showTip(el);
    });
    document.addEventListener('scroll', () => { tip.style.display = 'none'; }, true);
  
    // ---------- Click-to-Map панель ----------
    let panel = null, panelFor = null;
  
    function closePanel() { if (panel) { panel.remove(); panel = null; panelFor = null; } }
  
    function openPanel(rec) {
      closePanel();
      panelFor = rec;
      panel = document.createElement('div');
      panel.id = 'qam-panel';
      panel.innerHTML = `
        <div class="qam-p-head"><div class="qam-p-title"></div><button class="qam-p-close">✕</button></div>
        <div class="qam-p-cur"></div>
        <input class="qam-p-search" placeholder="Поиск по ключу или значению…" />
        <div class="qam-p-list"></div>
        <div><button class="qam-p-unmap">Размапить</button> <button class="qam-p-ignore">🚫 Игнорировать</button></div>`;
      document.documentElement.appendChild(panel);
      panel.querySelector('.qam-p-title').textContent = `🏷 ${rec.label || '(без лейбла)'} = ${rec.value}`;
      panel.querySelector('.qam-p-close').onclick = closePanel;
      panel.querySelector('.qam-p-unmap').onclick = () => {
        window.__QAM__.mappings.delete(rec.key);
        rec.mappedTo = null;
        rec.el.setAttribute('data-qam-state', 'unmapped');
        window.__QAM__.save && window.__QAM__.save();
        renderCur(); renderList(panel.querySelector('.qam-p-search').value);
      };
      panel.querySelector('.qam-p-ignore').onclick = () => {
        window.__QAM__.mappings.delete(rec.key);
        window.__QAM__.save && window.__QAM__.save();
        window.__QAM__.addIgnore({ k: rec.key, x: rec.xpath, l: rec.label || '' });
        closePanel();
      };
      panel.querySelector('.qam-p-search').oninput = (e) => renderList(e.target.value);
      renderCur();
      renderList('');
      panel.querySelector('.qam-p-search').focus();
    }
  
    function renderCur() {
      panel.querySelector('.qam-p-cur').textContent = panelFor.mappedTo
        ? `🔑 Сейчас: ${panelFor.mappedTo}` : '⚠️ Не замаплено';
    }
  
    function renderList(filter) {
      const list = panel.querySelector('.qam-p-list');
      list.innerHTML = '';
      const myReps = new Set(reps(panelFor.value));
      const seen = new Set();
      const rows = [];
      for (const [path, v] of jsonPairs()) {
        if (seen.has(path)) continue;
        seen.add(path);
        const text = `${path} = ${JSON.stringify(v)}`;
        if (filter && !text.toLowerCase().includes(filter.toLowerCase())) continue;
        rows.push({ path, text, match: reps(v).some(r => myReps.has(r)) });
      }
      rows.sort((a, b) => (b.match - a.match) || a.path.localeCompare(b.path));
      rows.slice(0, 200).forEach(row => {
        const div = document.createElement('div');
        div.className = 'qam-p-row' + (row.match ? ' hit' : '');
        const main = document.createElement('span');
        main.textContent = row.text;
        main.onclick = () => {
          window.__QAM__.mappings.set(panelFor.key, row.path);
          panelFor.mappedTo = row.path;
          panelFor.el.setAttribute('data-qam-state', 'mapped');
          window.__QAM__.save && window.__QAM__.save();
          renderCur();
        };
        const copy = document.createElement('button');
        copy.textContent = '⧉';
        copy.title = 'Скопировать путь';
        copy.onclick = () => navigator.clipboard.writeText(row.path);
        div.appendChild(main); div.appendChild(copy);
        list.appendChild(div);
      });
    }
  
    // ---------- Хоткеи ----------
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closePanel(); setPick(false); }
  
      // Delete в режиме выделения: снять выделение и удалить из справочника
      if (pickMode && e.key === 'Delete' && !isTyping(e.target)) {
        const target = pickEl && pickEl.closest ? pickEl.closest('[data-qam-state]') : null;
        if (target) {
          e.preventDefault();
          const rec = fields.get(getXPath(target));
          if (rec) {
            window.__QAM__.mappings.delete(rec.key);
            if (rec.key.startsWith('C::')) {
              window.__QAM__.removeCustom(rec.key.slice(3));
            } else {
              window.__QAM__.addIgnore({ k: rec.key, x: rec.xpath, l: rec.label || '' });
            }
            window.__QAM__.save && window.__QAM__.save();
          }
        }
      }
  
      // F — режим выделения элементов
      if (e.code === 'KeyF' && !e.ctrlKey && !e.altKey && !e.metaKey && !isTyping(e.target) && window.__QAM__.enabled) {
        e.preventDefault();
        setPick(!pickMode);
      }
  
      // Alt+Q — глобальный тумблер
      if (e.altKey && e.code === 'KeyQ') {
        const on = !window.__QAM__.enabled;
        chrome.storage.local.set({ qamEnabled: on });
        if (window.__QAM__.setEnabled) window.__QAM__.setEnabled(on);
      }
    });
  
    // ---------- «Показать на странице» из popup ----------
    function locate(key) {
      let rec = null;
      for (const r of fields.values()) { if (r.key === key) { rec = r; break; } }
      if (!rec && key.startsWith('X::')) rec = fields.get(key.slice(3));
      if (!rec) return;
      rec.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      rec.el.classList.remove('qam-locate');
      void rec.el.offsetWidth;
      rec.el.classList.add('qam-locate');
      setTimeout(() => rec.el.classList.remove('qam-locate'), 2200);
      if (rec.el.matches && rec.el.matches('input,select,textarea,button,[contenteditable="true"]')) {
        rec.el.focus({ preventScroll: true });
      }
    }
  
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'QAM_LOCATE') { locate(msg.key); sendResponse({ ok: true }); }
    });
  
    // ---------- Реактивность ----------
    let t = null;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 300); })
      .observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('change', () => { clearTimeout(t); t = setTimeout(scan, 100); }, true);
    window.__QAM__.onPayload.add(() => runMatching());
  
    scan();
    document.addEventListener('DOMContentLoaded', scan);
  })();
