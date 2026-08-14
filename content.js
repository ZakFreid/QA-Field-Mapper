// content.js — приёмник сети + хранилище (qam: host->page->связи; qamX: custom/ignore)
window.__QAM__ = {
    enabled: true,
    payloads: [],
    mappings: new Map(), // key -> бэк-путь
    labels: new Map(),   // key -> лейбл
    custom: [],          // ручные поля текущей страницы
    ignore: [],          // игнорируемые текущей страницы
    onPayload: new Set()
  };
  
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || typeof event.data.type !== 'string') return;
    if (event.data.type === 'QA_MAPPER_INCOMING') pushPayload('IN', event.data.url, event.data.data);
    if (event.data.type === 'QA_MAPPER_OUTGOING') {
      let body = event.data.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) {} }
      pushPayload('OUT', event.data.url, body);
    }
  });
  
  function pushPayload(dir, url, data) {
    if (!window.__QAM__.enabled) return; // выключено — не копим трафик
    if (data === null || typeof data !== 'object') return;
    const store = window.__QAM__;
    store.payloads.push({ dir, url, data });
    if (store.payloads.length > 20) store.payloads.shift();
    store.onPayload.forEach(fn => fn());
  }
  
  // ---------- URL и host ----------
  function urlPattern() {
    return location.pathname.split('/').map(seg => (/\d/.test(seg) ? ':id' : seg)).join('/') || '/';
  }
  function hostKey() { return location.host || '(local)'; }
  window.__QAM__.urlPattern = urlPattern;
  window.__QAM__.hostKey = hostKey;
  
  function normVal(v) {
    return typeof v === 'string' ? { p: v, l: '' } : (v || { p: '', l: '' });
  }
  
  function isMappingMap(m) {
    if (!m || typeof m !== 'object') return false;
    const vals = Object.values(m);
    return vals.length > 0 && vals.every(v => typeof v === 'string' || (v && typeof v === 'object' && typeof v.p === 'string'));
  }
  
  function getPageFromAll(all, host, pattern) {
    if (all[host] && all[host][pattern]) return all[host][pattern];
    if (pattern.startsWith('/') && isMappingMap(all[pattern])) return all[pattern]; // legacy
    return {};
  }
  
  // ---------- Сохранение связей (qam) ----------
  let saveTimer = null;
  window.__QAM__.save = function () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const host = hostKey(), pattern = urlPattern();
      chrome.storage.local.get({ qam: {} }).then(res => {
        const all = res.qam;
        const dir = all[host] || (all[host] = {});
        const page = dir[pattern] || (dir[pattern] = {});
        for (const [key, path] of window.__QAM__.mappings) {
          page[key] = {
            p: path,
            l: window.__QAM__.labels.get(key) || (key.startsWith('L::') ? key.slice(3) : '')
          };
        }
        // миграция старого плоского формата
        if (pattern.startsWith('/') && isMappingMap(all[pattern])) {
          for (const [k, v] of Object.entries(all[pattern])) if (!(k in page)) page[k] = v;
          delete all[pattern];
        }
        const hosts = Object.keys(all);
        if (hosts.length > 200) delete all[hosts[0]];
        chrome.storage.local.set({ qam: all });
      });
    }, 400);
  };
  
  function loadMappings() {
    chrome.storage.local.get({ qam: {} }).then(res => {
      const page = getPageFromAll(res.qam, hostKey(), urlPattern());
      let changed = false;
      for (const [key, raw] of Object.entries(page)) {
        const { p } = normVal(raw);
        if (!window.__QAM__.mappings.has(key)) { window.__QAM__.mappings.set(key, p); changed = true; }
      }
      if (changed && window.__QAM__.rescan) window.__QAM__.rescan();
    });
  }
  
  // ---------- Ручные поля и игнор (qamX) ----------
  let xData = {};
  
  function saveX() {
    const h = hostKey(), p = urlPattern();
    const dir = xData[h] || (xData[h] = {});
    dir[p] = { custom: window.__QAM__.custom, ignore: window.__QAM__.ignore };
    chrome.storage.local.set({ qamX: xData });
  }
  
  function loadX() {
    chrome.storage.local.get({ qamX: {} }).then(res => {
      xData = res.qamX || {};
      const page = (xData[hostKey()] || {})[urlPattern()] || {};
      window.__QAM__.custom = page.custom || [];
      window.__QAM__.ignore = page.ignore || [];
      if (window.__QAM__.rescan) window.__QAM__.rescan();
    });
  }
  
  window.__QAM__.addCustom = (cf) => {
    if (!window.__QAM__.custom.some(c => c.x === cf.x)) {
      window.__QAM__.custom.push(cf);
      saveX();
      if (window.__QAM__.rescan) window.__QAM__.rescan();
    }
  };
  window.__QAM__.removeCustom = (x) => {
    window.__QAM__.custom = window.__QAM__.custom.filter(c => c.x !== x);
    saveX();
    if (window.__QAM__.rescan) window.__QAM__.rescan();
  };
  window.__QAM__.addIgnore = (e) => {
    if (!window.__QAM__.ignore.some(i => i.x === e.x)) {
      window.__QAM__.ignore.push(e);
      saveX();
    }
    if (window.__QAM__.rescan) window.__QAM__.rescan();
  };
  window.__QAM__.removeIgnore = (x) => {
    window.__QAM__.ignore = window.__QAM__.ignore.filter(i => i.x !== x);
    saveX();
    if (window.__QAM__.rescan) window.__QAM__.rescan();
  };
  
  // ---------- Синхронизация из storage (правки из popup) ----------
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.qam) {
      const page = getPageFromAll(changes.qam.newValue || {}, hostKey(), urlPattern());
      window.__QAM__.mappings.clear();
      for (const [key, raw] of Object.entries(page)) window.__QAM__.mappings.set(key, normVal(raw).p);
      if (window.__QAM__.rescan) window.__QAM__.rescan();
    }
    if (changes.qamEnabled) {
        const on = changes.qamEnabled.newValue !== false;
        if (window.__QAM__.setEnabled) window.__QAM__.setEnabled(on);
        else window.__QAM__.enabled = on;
      }
    if (changes.qamX) {
      xData = changes.qamX.newValue || {};
      const page = (xData[hostKey()] || {})[urlPattern()] || {};
      window.__QAM__.custom = page.custom || [];
      window.__QAM__.ignore = page.ignore || [];
      if (window.__QAM__.rescan) window.__QAM__.rescan();
    }
  });
  
  loadMappings();
  loadX();
  
  // SPA-навигация
  let lastPattern = urlPattern(), lastHost = hostKey();
  setInterval(() => {
    const p = urlPattern(), h = hostKey();
    if (p !== lastPattern || h !== lastHost) { lastPattern = p; lastHost = h; loadMappings(); loadX(); }
  }, 1000);

  chrome.storage.local.get({ qamEnabled: true }).then(r => {
    window.__QAM__.enabled = r.qamEnabled !== false;
    if (window.__QAM__.rescan) window.__QAM__.rescan();
  });