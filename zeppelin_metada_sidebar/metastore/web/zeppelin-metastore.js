/*!
 * zeppelin-metastore.js — боковая панель метаданных хранилища для Apache Zeppelin
 * Подключается через zeppelin.server.html.body.addon. Работает и в classic UI, и в новом UI.
 * Зависимостей нет. Сборка: sidebar_core.js + integration.js
 */
/* ==========================================================================
   Zeppelin Metastore Sidebar — core rendering engine
   Shared by the standalone demo and the production bundle.
   No external dependencies. No storage APIs.
   ========================================================================== */
(function (global) {
  'use strict';

  var CSS = `
  .zm-root, .zm-root * { box-sizing: border-box; }
  /* z-index 900 — НИЖЕ всех слоёв Bootstrap, на котором построен classic UI:
     dropdown 1000, navbar-fixed-top 1030, modal-backdrop 1040, modal 1050,
     popover 1060, tooltip 1070. Любое меню и любое окно Zeppelin — включая
     выпадающее меню пользователя с входом-выходом — перекрывает панель,
     а не наоборот. Панель не должна перехватывать клики хозяйского интерфейса.
     --zm-top — высота фиксированной шапки Zeppelin, считается в рантайме,
     чтобы панель начиналась под ней и не закрывала навбар. */
  .zm-root {
    position: fixed; right: 0; z-index: 900;
    top: var(--zm-top, 0px); height: calc(100vh - var(--zm-top, 0px));
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 13px; color: #1f2933; display: flex; align-items: stretch;
    transition: transform .18s cubic-bezier(.4,0,.2,1);
  }
  /* Свёрнутое состояние — компактная вкладка, а не полоса во всю высоту:
     иначе она перекрывает кнопки параграфов Zeppelin по всей странице. */
  .zm-rail {
    width: 26px; flex: 0 0 26px; background: #2f4858; color: #fff;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 10px; cursor: pointer; user-select: none;
    box-shadow: -2px 0 8px rgba(0,0,0,.22);
    align-self: center; height: auto; padding: 14px 0;
    border-radius: 7px 0 0 7px; opacity: .82;
    transition: opacity .15s, background .15s;
  }
  .zm-rail:hover { background: #3a586c; opacity: 1; }
  /* когда панель открыта — плашка сливается с ней в одну колонку */
  .zm-root.zm-open .zm-rail {
    align-self: stretch; justify-content: flex-start; padding-top: 12px;
    border-radius: 0; opacity: 1;
  }
  .zm-rail-icon { font-size: 14px; line-height: 1; }
  .zm-rail-label {
    writing-mode: vertical-rl; text-orientation: mixed; letter-spacing: 2.2px;
    font-size: 10px; font-weight: 700; text-transform: uppercase; opacity: .9;
  }
  .zm-rail-count {
    writing-mode: vertical-rl; font-size: 9px; opacity: .55; letter-spacing: 1px;
  }
  /* положение вкладки по вертикали — ZM_CONFIG.railPosition */
  .zm-root.zm-rail-top    .zm-rail { align-self: flex-start; margin-top: 64px; }
  .zm-root.zm-rail-bottom .zm-rail { align-self: flex-end;   margin-bottom: 48px; }
  .zm-root.zm-open.zm-rail-top    .zm-rail,
  .zm-root.zm-open.zm-rail-bottom .zm-rail { align-self: stretch; margin: 0; }
  .zm-panel {
    width: 0; overflow: hidden; background: #fff; border-left: 1px solid #d8dee4;
    display: flex; flex-direction: column; transition: width .18s cubic-bezier(.4,0,.2,1);
    box-shadow: -6px 0 20px rgba(15,30,45,.10); position: relative;
  }
  .zm-root.zm-open .zm-panel { width: var(--zm-w, 420px); }
  .zm-root.zm-dragging .zm-panel { transition: none; }   /* при перетаскивании — без инерции */

  /* ручка изменения ширины по левому краю */
  .zm-grip {
    position: absolute; left: 0; top: 0; bottom: 0; width: 6px; cursor: col-resize;
    z-index: 2; background: transparent;
  }
  .zm-grip:hover, .zm-root.zm-dragging .zm-grip { background: #3071a9; opacity: .35; }
  .zm-root.zm-dragging { user-select: none; }

  .zm-head { padding: 9px 10px 8px; border-bottom: 1px solid #e6eaee; background: #f7f9fb; flex: 0 0 auto; }
  .zm-head-top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .zm-title { font-weight: 700; font-size: 12px; letter-spacing: .4px; text-transform: uppercase; color: #52606d; flex: 1; }
  .zm-x { border: 0; background: none; cursor: pointer; color: #7b8794; font-size: 17px; line-height: 1; padding: 0 3px; }
  .zm-x:hover { color: #1f2933; }
  .zm-search-wrap { position: relative; }
  .zm-search {
    width: 100%; padding: 6px 26px 6px 27px; border: 1px solid #cbd2d9; border-radius: 4px;
    font-size: 13px; outline: none; background: #fff;
  }
  .zm-search:focus { border-color: #3071a9; box-shadow: 0 0 0 2px rgba(48,113,169,.14); }
  .zm-search-ico { position: absolute; left: 8px; top: 6px; color: #9aa5b1; font-size: 12px; pointer-events: none; }
  .zm-clear { position: absolute; right: 6px; top: 4px; border: 0; background: none; cursor: pointer; color: #9aa5b1; font-size: 15px; display: none; }
  .zm-root.zm-searching .zm-clear { display: block; }
  .zm-filters { display: flex; gap: 5px; margin-top: 7px; flex-wrap: wrap; }
  .zm-chip {
    border: 1px solid #cbd2d9; background: #fff; border-radius: 11px; padding: 2px 9px;
    font-size: 11px; cursor: pointer; color: #52606d; font-weight: 600; letter-spacing: .3px;
  }
  .zm-chip.zm-on { background: #2f4858; border-color: #2f4858; color: #fff; }

  .zm-body { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; padding: 4px 0 12px; }
  .zm-body::-webkit-scrollbar { width: 9px; }
  .zm-body::-webkit-scrollbar-thumb { background: #cbd2d9; border-radius: 5px; }
  .zm-body::-webkit-scrollbar-thumb:hover { background: #9aa5b1; }

  .zm-row { display: flex; align-items: center; gap: 5px; padding: 3px 10px 3px 8px; cursor: pointer; line-height: 1.35; }
  .zm-row:hover { background: #eef4f9; }
  .zm-row.zm-sel { background: #e0ecf6; }
  .zm-tw { width: 12px; flex: 0 0 12px; color: #9aa5b1; font-size: 9px; text-align: center; transition: transform .12s; }
  .zm-tw.zm-rot { transform: rotate(90deg); }
  .zm-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .zm-db > .zm-name { font-weight: 700; font-size: 12.5px; }
  .zm-badge {
    font-size: 9px; font-weight: 800; letter-spacing: .5px; padding: 1px 5px; border-radius: 3px;
    color: #fff; flex: 0 0 auto;
  }
  .zm-schema { padding-left: 16px; }
  .zm-schema > .zm-name { font-weight: 600; color: #323f4b; }
  .zm-table { padding-left: 28px; }
  .zm-col   { padding-left: 42px; cursor: pointer; }
  .zm-col .zm-name {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px;
    flex: 0 1 auto; min-width: 0; max-width: 60%;
  }
  .zm-type {
    color: #7b8794; font-size: 11px; white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  }
  /* Метка ключа короткая и не переносится: DISTRIBUTED BY в 392 px ломало строку */
  .zm-key {
    font-size: 8.5px; font-weight: 800; color: #b06f00; background: #fff3d6;
    border-radius: 2px; padding: 1px 3px; letter-spacing: .3px;
    flex: 0 0 auto; white-space: nowrap; cursor: help;
  }
  .zm-meta { color: #9aa5b1; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1 1 auto; min-width: 0; }
  .zm-spacer { flex: 1 1 auto; min-width: 4px; }
  .zm-acts { display: none; gap: 2px; flex: 0 0 auto; }
  .zm-row:hover .zm-acts { display: flex; }
  .zm-act {
    border: 0; background: #fff; border: 1px solid #d8dee4; border-radius: 3px; cursor: pointer;
    font-size: 10px; padding: 1px 5px; color: #52606d; line-height: 1.5;
  }
  .zm-act:hover { background: #2f4858; border-color: #2f4858; color: #fff; }

  .zm-secthead {
    padding: 8px 10px 3px; font-size: 10px; font-weight: 800; letter-spacing: .8px;
    text-transform: uppercase; color: #9aa5b1;
  }
  .zm-crumb { color: #9aa5b1; font-size: 11px; }

  /* two-line search result rows: the name must never be truncated */
  .zm-sr { align-items: flex-start; padding: 4px 10px 4px 9px; }
  .zm-sr .zm-badge { margin-top: 2px; }
  .zm-sr-txt { flex: 1 1 auto; min-width: 0; }
  .zm-sr-l1 { display: flex; align-items: baseline; gap: 6px; }
  .zm-sr-l1 .zm-name { flex: 0 0 auto; overflow: visible; }
  .zm-sr-l1 .zm-type { flex: 0 0 auto; }
  .zm-sr-l1 .zm-crumb { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .zm-sr-l2 {
    color: #7b8794; font-size: 11px; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; margin-top: 1px;
  }
  .zm-sr .zm-acts { margin-top: 1px; }
  .zm-hit { background: #ffe9a8; border-radius: 2px; font-weight: 700; }
  .zm-empty { padding: 26px 16px; text-align: center; color: #9aa5b1; font-size: 12px; line-height: 1.6; }

  .zm-foot {
    flex: 0 0 auto; border-top: 1px solid #e6eaee; background: #f7f9fb;
    padding: 5px 10px; display: flex; align-items: center; gap: 8px;
    font-size: 10.5px; color: #7b8794; flex-wrap: nowrap; overflow: hidden;
  }
  .zm-foot > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .zm-foot button {
    border: 1px solid #cbd2d9; background: #fff; border-radius: 3px; cursor: pointer;
    font-size: 10.5px; padding: 1px 7px; color: #52606d; flex: 0 0 auto; white-space: nowrap;
  }
  .zm-foot button:hover { background: #eef4f9; }
  .zm-toast {
    position: fixed; bottom: 18px; right: 410px; background: #1f2933; color: #fff;
    padding: 7px 13px; border-radius: 4px; font-size: 12px; z-index: 950;
    opacity: 0; transform: translateY(6px); transition: opacity .18s, transform .18s; pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    max-width: 420px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .zm-toast.zm-show { opacity: 1; transform: translateY(0); }
  `;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mark(text, q) {
    var t = String(text == null ? '' : text);
    if (!q) return esc(t);
    var i = t.toLowerCase().indexOf(q);
    if (i < 0) return esc(t);
    return esc(t.slice(0, i)) + '<span class="zm-hit">' + esc(t.slice(i, i + q.length)) + '</span>' + esc(t.slice(i + q.length));
  }

  /* PostgreSQL пишет типы полностью — в узкой панели это съедает всю строку.
     Показываем короткий вариант, полный оставляем в подсказке. */
  var TYPE_SHORT = [
    [/^timestamp without time zone/, 'timestamp'],
    [/^timestamp with time zone/,    'timestamptz'],
    [/^time without time zone/,      'time'],
    [/^time with time zone/,         'timetz'],
    [/^character varying/,           'varchar'],
    [/^character(?!\s*varying)/,     'char'],
    [/^double precision/,            'float8'],
    [/^real$/,                       'float4'],
    [/^boolean/,                     'bool'],
    [/^integer/,                     'int4'],
    [/^smallint/,                    'int2'],
    [/^bigint/,                      'int8'],
  ];

  function shortType(t) {
    var s = String(t == null ? '' : t);
    for (var i = 0; i < TYPE_SHORT.length; i++) {
      if (TYPE_SHORT[i][0].test(s)) return s.replace(TYPE_SHORT[i][0], TYPE_SHORT[i][1]);
    }
    return s;
  }

  var KEY_SHORT = {
    'DISTRIBUTED BY': 'DIST',
    'PARTITION BY': 'PART',
    'ORDER BY': 'ORDER',
  };

  function keyTag(k) {
    if (!k) return '';
    return '<span class="zm-key" title="' + esc(k) + '">' + esc(KEY_SHORT[k] || k) + '</span>';
  }

  function fmtRows(n) {
    if (n == null) return '';
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace('.0', '') + ' млрд';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + ' млн';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + ' тыс';
    return String(n);
  }

  /* ------------------------------------------------------------------ */

  function Metastore(opts) {
    this.opts = opts || {};
    this.catalog = null;
    this.index = [];
    this.open = new Set();      // expanded node paths
    this.dbFilter = new Set();  // empty = all
    this.query = '';
    this.el = null;
    this._build();
  }

  Metastore.prototype._build = function () {
    if (!document.getElementById('zm-style')) {
      var st = document.createElement('style');
      st.id = 'zm-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }

    var root = document.createElement('div');
    root.className = 'zm-root';
    var pos = this.opts.railPosition;                 // 'center' (по умолчанию) | 'top' | 'bottom'
    if (pos === 'top' || pos === 'bottom') root.classList.add('zm-rail-' + pos);
    root.innerHTML =
      '<div class="zm-rail" title="Метаданные хранилища (Alt+D)">' +
        '<span class="zm-rail-icon">&#9776;</span>' +
        '<span class="zm-rail-label">Данные</span>' +
        '<span class="zm-rail-count"></span>' +
      '</div>' +
      '<div class="zm-panel">' +
        '<div class="zm-grip" title="Потяните, чтобы изменить ширину. Двойной клик — по умолчанию"></div>' +
        '<div class="zm-head">' +
          '<div class="zm-head-top">' +
            '<span class="zm-title">Метаданные хранилища</span>' +
            '<button class="zm-x" title="Свернуть">&times;</button>' +
          '</div>' +
          '<div class="zm-search-wrap">' +
            '<span class="zm-search-ico">&#128269;</span>' +
            '<input class="zm-search" type="text" placeholder="Схема, таблица или колонка…" spellcheck="false">' +
            '<button class="zm-clear" title="Очистить">&times;</button>' +
          '</div>' +
          '<div class="zm-filters"></div>' +
        '</div>' +
        '<div class="zm-body"><div class="zm-empty">Загрузка каталога…</div></div>' +
        '<div class="zm-foot"></div>' +
      '</div>';

    var toast = document.createElement('div');
    toast.className = 'zm-toast';

    (this.opts.mount || document.body).appendChild(root);
    (this.opts.mount || document.body).appendChild(toast);

    this.el = root;
    this.toastEl = toast;
    this.bodyEl = root.querySelector('.zm-body');
    this.footEl = root.querySelector('.zm-foot');
    this.searchEl = root.querySelector('.zm-search');
    this.filtersEl = root.querySelector('.zm-filters');

    var self = this;
    this._renderFooter('каталог не загружен');
    root.querySelector('.zm-rail').addEventListener('click', function () { self.toggle(); });
    root.querySelector('.zm-x').addEventListener('click', function () { self.toggle(false); });
    root.querySelector('.zm-clear').addEventListener('click', function () {
      self.searchEl.value = ''; self.query = ''; self.el.classList.remove('zm-searching'); self.render(); self.searchEl.focus();
    });

    var deb;
    this.searchEl.addEventListener('input', function () {
      clearTimeout(deb);
      deb = setTimeout(function () {
        self.query = self.searchEl.value.trim().toLowerCase();
        self.el.classList.toggle('zm-searching', !!self.query);
        self.render();
      }, 110);
    });

    this.bodyEl.addEventListener('click', function (e) {
      var act = e.target.closest('.zm-act');
      if (act) { e.stopPropagation(); self._action(act.dataset.act, JSON.parse(act.dataset.ref)); return; }
      var row = e.target.closest('.zm-row');
      if (!row) return;
      if (row.dataset.path) {
        if (self.open.has(row.dataset.path)) self.open.delete(row.dataset.path);
        else self.open.add(row.dataset.path);
        self.render();
      } else if (row.dataset.ref) {
        self._action('insert', JSON.parse(row.dataset.ref));
      }
    });

    this._initResize();
    this._initTopOffset();

    document.addEventListener('keydown', function (e) {
      if (e.altKey && (e.key === 'd' || e.key === 'D' || e.code === 'KeyD')) {
        e.preventDefault(); self.toggle();
        if (self.el.classList.contains('zm-open')) self.searchEl.focus();
      }
      if (e.key === 'Escape' && self.el.classList.contains('zm-open') && document.activeElement === self.searchEl) {
        self.searchEl.blur();
      }
    });
  };

  /* ---------------------------------------------------------- ширина панели */

  var WIDTH_KEY = 'zmSidebarWidth';
  var WIDTH_MIN = 300;
  var WIDTH_DEFAULT = 420;

  function readWidth() {
    try {
      var v = parseInt(window.localStorage.getItem(WIDTH_KEY), 10);
      if (v >= WIDTH_MIN) return v;
    } catch (e) { /* приватный режим или запрет хранилища — просто не помним */ }
    return WIDTH_DEFAULT;
  }

  function saveWidth(w) {
    try { window.localStorage.setItem(WIDTH_KEY, String(w)); } catch (e) { /* не критично */ }
  }

  Metastore.prototype.setWidth = function (w, persist) {
    var max = Math.max(WIDTH_MIN, window.innerWidth - 120);
    this.width = Math.round(Math.min(Math.max(w, WIDTH_MIN), max));
    this.el.style.setProperty('--zm-w', this.width + 'px');
    // тост не должен уезжать под панель
    this.toastEl.style.right = (this.width + 18) + 'px';
    if (persist) saveWidth(this.width);
  };

  /* Панель начинается под фиксированной шапкой Zeppelin, а не поверх неё.
     Высота шапки берётся из DOM: в classic UI и в новом UI она разная,
     да и Angular дорисовывает её асинхронно — поэтому пересчитываем несколько раз. */
  Metastore.prototype._initTopOffset = function () {
    var self = this;
    var SELECTORS = ['.navbar-fixed-top', 'nav.navbar', 'zeppelin-header', '.zeppelin-header', 'header'];

    function measure() {
      var top = 0;
      for (var i = 0; i < SELECTORS.length; i++) {
        var el = document.querySelector(SELECTORS[i]);
        if (!el) continue;
        var cs = window.getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
        var r = el.getBoundingClientRect();
        if (r.top <= 1 && r.height > 0 && r.height < 200) { top = Math.round(r.height); break; }
      }
      self.el.style.setProperty('--zm-top', top + 'px');
    }

    measure();
    [300, 1200, 3000].forEach(function (ms) { setTimeout(measure, ms); });
    window.addEventListener('resize', measure);
  };

  Metastore.prototype._initResize = function () {
    var self = this;
    var grip = this.el.querySelector('.zm-grip');
    var startX = 0, startW = 0;

    this.setWidth(readWidth(), false);

    function onMove(e) {
      // панель прижата к правому краю: тянем влево — становится шире
      self.setWidth(startW + (startX - e.clientX), false);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      self.el.classList.remove('zm-dragging');
      saveWidth(self.width);
    }

    grip.addEventListener('mousedown', function (e) {
      e.preventDefault();
      startX = e.clientX;
      startW = self.width;
      self.el.classList.add('zm-dragging');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    grip.addEventListener('dblclick', function () {
      self.setWidth(WIDTH_DEFAULT, true);
      self.toast('Ширина по умолчанию — ' + WIDTH_DEFAULT + ' px');
    });

    window.addEventListener('resize', function () { self.setWidth(self.width, false); });
  };

  Metastore.prototype.toggle = function (force) {
    var willOpen = force === undefined ? !this.el.classList.contains('zm-open') : !!force;
    this.el.classList.toggle('zm-open', willOpen);
    if (willOpen) { var s = this.searchEl; setTimeout(function () { s.focus(); }, 200); }
  };

  Metastore.prototype.toast = function (msg) {
    var t = this.toastEl;
    t.textContent = msg;
    t.classList.add('zm-show');
    clearTimeout(this._tt);
    this._tt = setTimeout(function () { t.classList.remove('zm-show'); }, 2000);
  };

  Metastore.prototype.setCatalog = function (cat) {
    this.catalog = cat;
    this.index = [];
    var self = this, nTab = 0, nCol = 0;
    (cat.dbs || []).forEach(function (db) {
      (db.schemas || []).forEach(function (sc) {
        self.index.push({ kind: 'schema', db: db, sc: sc, name: sc.name, desc: sc.desc });
        (sc.tables || []).forEach(function (tb) {
          nTab++;
          self.index.push({ kind: 'table', db: db, sc: sc, tb: tb, name: tb.name, desc: tb.desc });
          (tb.cols || []).forEach(function (co) {
            nCol++;
            self.index.push({ kind: 'column', db: db, sc: sc, tb: tb, co: co, name: co.n, desc: co.c });
          });
        });
      });
    });

    this.el.querySelector('.zm-rail-count').textContent = nTab + ' таб';
    this.filtersEl.innerHTML = (cat.dbs || []).map(function (db) {
      return '<button class="zm-chip" data-db="' + esc(db.key) + '">' + esc(db.badge || db.name) + '</button>';
    }).join('');
    Array.prototype.forEach.call(this.filtersEl.children, function (btn) {
      btn.addEventListener('click', function () {
        var k = btn.dataset.db;
        if (self.dbFilter.has(k)) self.dbFilter.delete(k); else self.dbFilter.add(k);
        btn.classList.toggle('zm-on', self.dbFilter.has(k));
        self.render();
      });
    });

    this._renderFooter('обновлено ' + String(cat.generated_at || '—').slice(0, 16),
                       nTab + ' табл · ' + (nCol >= 10000 ? Math.round(nCol / 1000) + 'k' : nCol) + ' кол');
    this.render();
  };

  /** Подвал есть всегда — в том числе когда каталог не загрузился,
   *  иначе переспросить можно было бы только через F5. */
  Metastore.prototype._renderFooter = function (left, right) {
    var self = this;
    this.footEl.innerHTML =
      '<span>' + esc(left) + '</span>' +
      '<span style="flex:1"></span>' +
      (right ? '<span>' + esc(right) + '</span>' : '') +
      '<button class="zm-refresh">Обновить</button>';
    this.footEl.querySelector('.zm-refresh').addEventListener('click', function () {
      self.footEl.querySelector('.zm-refresh').textContent = '…';
      if (self.onRetry) self.onRetry();
      else if (self.opts.onRefresh) self.opts.onRefresh();
    });
  };

  /** Состояние ошибки: понятная причина, техническая деталь и когда повторим. */
  Metastore.prototype.showError = function (html, detail, retryInSec) {
    this.bodyEl.innerHTML =
      '<div class="zm-empty" style="text-align:left;padding:20px 14px">' +
        '<div style="color:#1f2933;font-size:13px;line-height:1.6">' + html + '</div>' +
        '<div style="margin-top:12px;font-size:11px;color:#cf5555;word-break:break-all">' +
          esc(detail) + '</div>' +
        (retryInSec
          ? '<div style="margin-top:10px;font-size:11px">Повторю сам через ' +
            retryInSec + ' с — или нажмите «Обновить» внизу.</div>'
          : '') +
      '</div>';
    this._renderFooter('каталог не загружен');
  };

  Metastore.prototype._dbOk = function (db) {
    return this.dbFilter.size === 0 || this.dbFilter.has(db.key);
  };

  Metastore.prototype._ref = function (it) {
    return esc(JSON.stringify({
      db: it.db.key, dbName: it.db.name, sc: it.sc.name,
      tb: it.tb ? it.tb.name : null, co: it.co ? it.co.n : null,
      doc: it.tb ? (it.tb.doc || '') : '',
      cols: it.tb ? (it.tb.cols || []).map(function (c) { return c.n; }) : []
    }));
  };

  Metastore.prototype._tableActs = function (it) {
    var r = this._ref(it);
    var s = '<span class="zm-acts">' +
      '<button class="zm-act" data-act="select" data-ref="' + r + '" title="Вставить SELECT в параграф">SELECT</button>' +
      '<button class="zm-act" data-act="copy" data-ref="' + r + '" title="Копировать полное имя">⧉</button>';
    if (it.tb && it.tb.doc) s += '<button class="zm-act" data-act="doc" data-ref="' + r + '" title="Открыть описание в XWiki">?</button>';
    return s + '</span>';
  };

  Metastore.prototype.render = function () {
    if (!this.catalog) return;
    this.query ? this._renderSearch() : this._renderTree();
  };

  Metastore.prototype._renderTree = function () {
    var self = this, h = [];
    (this.catalog.dbs || []).forEach(function (db) {
      if (!self._dbOk(db)) return;
      var dbPath = db.key, dbOpen = self.open.has(dbPath);
      h.push('<div class="zm-row zm-db" data-path="' + esc(dbPath) + '">' +
        '<span class="zm-tw' + (dbOpen ? ' zm-rot' : '') + '">&#9654;</span>' +
        '<span class="zm-badge" style="background:' + esc(db.color) + '">' + esc(db.badge) + '</span>' +
        '<span class="zm-name">' + esc(db.name) + '</span>' +
        '<span class="zm-spacer"></span>' +
        '<span class="zm-meta" style="flex:0 0 auto">' + (db.schemas || []).length + '</span></div>');
      if (!dbOpen) return;

      (db.schemas || []).forEach(function (sc) {
        var scPath = dbPath + '.' + sc.name, scOpen = self.open.has(scPath);
        h.push('<div class="zm-row zm-schema" data-path="' + esc(scPath) + '">' +
          '<span class="zm-tw' + (scOpen ? ' zm-rot' : '') + '">&#9654;</span>' +
          '<span class="zm-name">' + esc(sc.name) + '</span>' +
          '<span class="zm-meta">' + esc(sc.desc || '') + '</span></div>');
        if (!scOpen) return;

        (sc.tables || []).forEach(function (tb) {
          var tbPath = scPath + '.' + tb.name, tbOpen = self.open.has(tbPath);
          var it = { db: db, sc: sc, tb: tb };
          h.push('<div class="zm-row zm-table" data-path="' + esc(tbPath) + '" title="' + esc(tb.desc || tb.name) + '">' +
            '<span class="zm-tw' + (tbOpen ? ' zm-rot' : '') + '">&#9654;</span>' +
            '<span class="zm-name">' + esc(tb.name) + '</span>' +
            '<span class="zm-meta">' + esc(tb.desc || '') + '</span>' +
            self._tableActs(it) + '</div>');
          if (!tbOpen) return;

          (tb.cols || []).forEach(function (co) {
            var cit = { db: db, sc: sc, tb: tb, co: co };
            var tip = co.n + ' ' + co.t + (co.k ? ' [' + co.k + ']' : '') + (co.c ? ' — ' + co.c : '');
            h.push('<div class="zm-row zm-col" data-ref="' + self._ref(cit) + '" title="' + esc(tip) + '">' +
              '<span class="zm-tw"></span>' +
              '<span class="zm-name">' + esc(co.n) + '</span>' +
              keyTag(co.k) +
              '<span class="zm-type">' + esc(shortType(co.t)) + '</span>' +
              '<span class="zm-meta">' + esc(co.c || '') + '</span></div>');
          });

          if (tb.rows != null || tb.engine) {
            h.push('<div class="zm-row zm-col" style="cursor:default"><span class="zm-tw"></span>' +
              '<span class="zm-meta" style="font-style:italic">' +
              (tb.rows != null ? '~' + fmtRows(tb.rows) + ' строк' : '') +
              (tb.size ? ' · ' + esc(tb.size) : '') +
              (tb.engine ? ' · ' + esc(tb.engine) : '') + '</span></div>');
          }
        });
      });
    });
    this.bodyEl.innerHTML = h.join('') || '<div class="zm-empty">Нет данных</div>';
  };

  Metastore.prototype._renderSearch = function () {
    var q = this.query, self = this;
    var buckets = { table: [], column: [], schema: [] };

    this.index.forEach(function (it) {
      if (!self._dbOk(it.db)) return;
      var name = String(it.name).toLowerCase();
      var pos = name.indexOf(q);
      var score;
      if (pos === 0) score = 0;
      else if (pos > 0) score = 1;
      else if ((it.desc || '').toLowerCase().indexOf(q) >= 0) score = 2;
      else return;
      buckets[it.kind].push({ it: it, score: score });
    });

    var order = [
      ['table', 'Таблицы'],
      ['column', 'Колонки'],
      ['schema', 'Схемы']
    ];
    var h = [], total = 0;

    order.forEach(function (pair) {
      var kind = pair[0], list = buckets[kind];
      if (!list.length) return;
      list.sort(function (a, b) { return a.score - b.score || a.it.name.length - b.it.name.length; });
      var shown = list.slice(0, kind === 'column' ? 120 : 80);
      total += list.length;
      h.push('<div class="zm-secthead">' + pair[1] + ' · ' + list.length +
        (list.length > shown.length ? ' (показано ' + shown.length + ')' : '') + '</div>');

      shown.forEach(function (r) {
        var it = r.it;
        var badge = '<span class="zm-badge" style="background:' + esc(it.db.color) + '">' + esc(it.db.badge) + '</span>';

        if (kind === 'table') {
          h.push('<div class="zm-row zm-sr" data-ref="' + self._ref(it) + '" title="' + esc(it.tb.desc || it.tb.name) + '">' + badge +
            '<div class="zm-sr-txt">' +
              '<div class="zm-sr-l1"><span class="zm-name">' + mark(it.tb.name, q) + '</span>' +
                '<span class="zm-crumb">' + esc(it.sc.name) + '</span></div>' +
              '<div class="zm-sr-l2">' + esc(it.tb.desc || '—') +
                (it.tb.rows != null ? ' · ~' + fmtRows(it.tb.rows) + ' строк' : '') + '</div>' +
            '</div>' + self._tableActs(it) + '</div>');

        } else if (kind === 'column') {
          var ctip = it.sc.name + '.' + it.tb.name + '.' + it.co.n + ' ' + it.co.t +
                     (it.co.k ? ' [' + it.co.k + ']' : '') + (it.co.c ? ' — ' + it.co.c : '');
          h.push('<div class="zm-row zm-sr" data-ref="' + self._ref(it) + '" title="' + esc(ctip) + '">' + badge +
            '<div class="zm-sr-txt">' +
              '<div class="zm-sr-l1">' +
                '<span class="zm-name" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px">' + mark(it.co.n, q) + '</span>' +
                '<span class="zm-type">' + esc(shortType(it.co.t)) + '</span>' +
                keyTag(it.co.k) +
              '</div>' +
              '<div class="zm-sr-l2"><b style="font-weight:600;color:#52606d">' + esc(it.sc.name + '.' + it.tb.name) + '</b>' +
                (it.co.c ? ' — ' + esc(it.co.c) : '') + '</div>' +
            '</div></div>');

        } else {
          h.push('<div class="zm-row zm-sr" data-path="' + esc(it.db.key + '.' + it.sc.name) + '">' + badge +
            '<div class="zm-sr-txt">' +
              '<div class="zm-sr-l1"><span class="zm-name">' + mark(it.sc.name, q) + '</span>' +
                '<span class="zm-crumb">' + esc(it.db.name) + '</span></div>' +
              '<div class="zm-sr-l2">' + esc(it.sc.desc || '—') + ' · ' + (it.sc.tables || []).length + ' табл.</div>' +
            '</div></div>');
        }
      });
    });

    this.bodyEl.innerHTML = total
      ? h.join('')
      : '<div class="zm-empty">Ничего не найдено по «' + esc(this.query) + '»<br><span style="font-size:11px">Попробуйте часть имени колонки, например <b>account_id</b></span></div>';
  };

  Metastore.prototype.fqn = function (ref) {
    return ref.sc + '.' + ref.tb;
  };

  Metastore.prototype._action = function (act, ref) {
    var handler = this.opts.onAction;
    if (act === 'doc') {
      if (ref.doc && ref.doc !== '#') window.open(ref.doc, '_blank');
      else this.toast('Ссылка на описание не заполнена');
      return;
    }
    var text;
    if (act === 'select') {
      var cols = (ref.cols || []).slice(0, 12);
      var more = (ref.cols || []).length > cols.length;
      text = 'SELECT\n    ' + (cols.length ? cols.join(',\n    ') + (more ? '\n    -- …' : '') : '*') +
        '\nFROM ' + this.fqn(ref) + '\nLIMIT 100';
    } else if (act === 'copy') {
      text = this.fqn(ref);
    } else {
      text = ref.co ? ref.co : this.fqn(ref);
    }
    if (handler) handler(act, text, ref, this);
  };

  global.ZeppelinMetastore = Metastore;
})(window);

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
