/* ==========================================================================
   Zeppelin integration layer
   Loaded on every Zeppelin page via zeppelin.server.html.body.addon.
   Works with both the classic UI (/classic) and the new Default UI.
   ========================================================================== */
(function () {
  'use strict';

  var CFG = window.ZM_CONFIG || {};

  // --- transport A: static file served next to this script ------------------
  //     e.g. "metastore-catalog.json" or "metastore-catalog.json.gz"
  var CATALOG_URL = CFG.catalogUrl || null;

  // --- transport B: output of a Zeppelin paragraph, read over the REST API ---
  var NOTE_ID = CFG.noteId || null;
  var PARAGRAPH_ID = CFG.paragraphId || null;

  var API = CFG.apiBase || (location.origin + '/api');

  /* ---------------------------------------------------------------- utils */

  function b64ToBytes(b64) {
    var bin = atob(b64), len = bin.length, out = new Uint8Array(len);
    for (var i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function gunzip(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error(
        'Браузер не поддерживает DecompressionStream. ' +
        'Используйте несжатый каталог (COMPRESS=False в коллекторе).'));
    }
    var ds = new DecompressionStream('gzip');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).text();
  }

  /** Accepts: raw JSON text, or "ZMCATALOG_GZ:<base64>" */
  function parsePayload(text) {
    text = String(text || '').trim();
    var m = text.match(/ZMCATALOG_GZ:([A-Za-z0-9+/=\s]+)/);
    if (m) {
      return gunzip(b64ToBytes(m[1].replace(/\s+/g, ''))).then(JSON.parse);
    }
    var i = text.indexOf('{');
    if (i < 0) throw new Error('В выводе параграфа нет JSON-каталога');
    return Promise.resolve(JSON.parse(text.slice(i)));
  }

  function loadFromFile() {
    return fetch(CATALOG_URL, { credentials: 'same-origin', cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) {
          var e = new Error('HTTP ' + r.status + ' при загрузке ' + CATALOG_URL);
          e.status = r.status;
          throw e;
        }
        return r.text();
      })
      .then(parsePayload);
  }

  function loadFromParagraph() {
    var url = API + '/notebook/' + NOTE_ID + '/paragraph/' + PARAGRAPH_ID;
    return fetch(url, { credentials: 'include', cache: 'no-cache' })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error('Нет доступа к ноуту каталога (проверьте права на ' + NOTE_ID + ')');
        if (!r.ok) throw new Error('HTTP ' + r.status + ' от Zeppelin REST API');
        return r.json();
      })
      .then(function (j) {
        var msgs = (((j.body || {}).results || {}).msg) || [];
        if (!msgs.length) throw new Error('Параграф каталога пуст — запустите его хотя бы раз');
        return parsePayload(msgs.map(function (m) { return m.data; }).join('\n'));
      });
  }

  function loadCatalog() {
    if (CATALOG_URL) return loadFromFile();
    if (NOTE_ID && PARAGRAPH_ID) return loadFromParagraph();
    return Promise.reject(new Error('Не задан ни ZM_CONFIG.catalogUrl, ни noteId/paragraphId'));
  }

  /* ------------------------------------------- ACE editor insertion hook */

  var lastEditorEl = null;

  function rememberEditor(e) {
    var ed = e.target && e.target.closest ? e.target.closest('.ace_editor') : null;
    if (ed) lastEditorEl = ed;
  }
  document.addEventListener('focusin', rememberEditor, true);
  document.addEventListener('mousedown', rememberEditor, true);

  function activeAceEditor() {
    if (!window.ace || typeof window.ace.edit !== 'function') return null;
    var el = document.querySelector('.ace_editor.ace_focus') || lastEditorEl;
    if (el && !document.body.contains(el)) el = null;   // параграф удалён/перерисован
    if (!el) {
      // на странице ровно один редактор — вставляем в него без риска ошибиться
      var all = document.querySelectorAll('.ace_editor');
      if (all.length === 1) el = all[0];
    }
    if (!el) return null;
    try { return window.ace.edit(el); } catch (err) { return null; }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  /** Никогда не реджектится: Zeppelin часто отдаётся по plain HTTP,
   *  где navigator.clipboard недоступен или запрещён политикой. */
  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () {
        return fallbackCopy(text) ? undefined : Promise.resolve();
      });
    }
    fallbackCopy(text);
    return Promise.resolve();
  }

  function insertIntoParagraph(text, ms) {
    var ed = activeAceEditor();
    if (!ed) {
      copyToClipboard(text).then(function () {
        ms.toast('Курсор не в параграфе — скопировано в буфер');
      });
      return;
    }
    ed.insert(text);
    ed.focus();
    ms.toast('Вставлено: ' + (text.length > 60 ? text.slice(0, 57) + '…' : text).replace(/\n/g, ' '));
  }

  /* ------------------------------------------------------------- bootstrap */

  function start() {
    var ms = new window.ZeppelinMetastore({
      onAction: function (act, text, ref, self) {
        if (act === 'copy') {
          copyToClipboard(text)
            .then(function () { self.toast('Скопировано: ' + text); })
            .catch(function () { self.toast('Не удалось скопировать: ' + text); });
        } else {
          insertIntoParagraph(text, self);
        }
      },
      onRefresh: function () { refresh(true); },
      railPosition: CFG.railPosition          // 'center' | 'top' | 'bottom'
    });

    window.__zmSidebar = ms;

    // Пока каталога нет, панель сама переспрашивает с растущей паузой,
    // чтобы после первого прогона коллектора ожить без перезагрузки страницы.
    var RETRY_STEPS = [15, 30, 60, 120, 300];   // секунды
    var retryIdx = 0;
    var retryTimer = null;

    function scheduleRetry() {
      clearTimeout(retryTimer);
      var wait = RETRY_STEPS[Math.min(retryIdx, RETRY_STEPS.length - 1)];
      retryIdx++;
      retryTimer = setTimeout(function () { refresh(false); }, wait * 1000);
      return wait;
    }

    function explain(err) {
      if (err.status === 404) {
        return 'Каталог ещё не собран.<br>Запустите параграф <b>3. load_catalog_data()</b> ' +
               'в ноуте «00. Metastore Catalog».';
      }
      if (err.status === 403) {
        return 'Файл каталога есть, но nginx не может его прочитать.<br>' +
               'Проверьте права: <code>chmod 644 metastore/web/metastore-catalog.json</code>';
      }
      if (err instanceof TypeError) {
        return 'Не отвечает metastore-web.<br>' +
               '<code>docker compose ps metastore-web</code>';
      }
      return String(err.message || err);
    }

    function refresh(notify) {
      loadCatalog().then(function (cat) {
        clearTimeout(retryTimer);
        retryIdx = 0;
        ms.setCatalog(cat);
        if (notify) ms.toast('Каталог обновлён (' + (cat.generated_at || '—') + ')');
      }).catch(function (err) {
        var wait = scheduleRetry();
        ms.showError(explain(err), String(err.message || err), wait);
        if (notify) ms.toast('Ошибка обновления каталога');
      });
    }

    ms.onRetry = function () { retryIdx = 0; refresh(true); };

    refresh(false);
    // periodic silent refresh (default 30 min; 0 disables)
    var period = CFG.refreshMinutes === undefined ? 30 : CFG.refreshMinutes;
    if (period > 0) setInterval(function () { refresh(false); }, period * 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
