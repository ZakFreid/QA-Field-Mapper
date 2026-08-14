if (window.__QA_MAPPER_INJECTED__) {
    console.warn('[QA Mapper] Already injected');
  } else {
    window.__QA_MAPPER_INJECTED__ = true;
  
    // ---------- 1. Перехват FETCH ----------
    const originalFetch = window.fetch;
  
    window.fetch = async function(resource, config) {
      const url = typeof resource === 'string' ? resource : resource.url;
      const method = (config && config.method) || (resource && resource.method) || 'GET';
  
      sendOutgoing(url, method, config ? config.body : undefined);
  
      const response = await originalFetch.apply(this, arguments);
  
      try {
        const cloned = response.clone(); // не ломаем ответ для приложения
        cloned.text().then(text => {
          try {
            post('QA_MAPPER_INCOMING', { url, data: JSON.parse(text) });
          } catch (e) { /* не JSON — игнорируем */ }
        }).catch(() => {});
      } catch (e) {}
  
      return response;
    };
  
    // ---------- 2. Перехват XMLHttpRequest ----------
    const xhrOpen = XMLHttpRequest.prototype.open;
    const xhrSend = XMLHttpRequest.prototype.send;
  
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__qaMapper = { method: String(method).toUpperCase(), url };
      return xhrOpen.apply(this, [method, url, ...rest]);
    };
  
    XMLHttpRequest.prototype.send = function(body) {
      const meta = this.__qaMapper || { method: 'GET', url: '' };
      sendOutgoing(meta.url, meta.method, body);
  
      this.addEventListener('load', function() {
        try {
          const ct = (this.getResponseHeader('content-type') || '').toLowerCase();
          if (ct.includes('json') || /^\s*[{[]/.test(this.responseText)) {
            post('QA_MAPPER_INCOMING', { url: meta.url, data: JSON.parse(this.responseText) });
          }
        } catch (e) {}
      });
  
      return xhrSend.apply(this, [body]);
    };
  
    // ---------- Хелперы ----------
    function sendOutgoing(url, method, body) {
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method).toUpperCase())) return;
      let payload = null;
      if (typeof body === 'string') payload = body;
      else if (body instanceof URLSearchParams) payload = body.toString();
      else if (typeof FormData !== 'undefined' && body instanceof FormData) {
        const obj = {};
        body.forEach((v, k) => (obj[k] = v));
        payload = JSON.stringify(obj);
      }
      post('QA_MAPPER_OUTGOING', { url, method, body: payload });
    }
  
    function post(type, payload) {
      window.postMessage({ type, ...payload }, '*');
    }
  
    console.log('%c[QA Mapper] Sniffer Injected (fetch + XHR)!', 'color: green; font-weight: bold;');
  }