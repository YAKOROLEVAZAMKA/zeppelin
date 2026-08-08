# Metastore — боковая панель метаданных DWH в Zeppelin

Постоянная панель со схемами, таблицами и **колонками** ClickHouse, Greengage
и PostgreSQL на каждой странице Zeppelin. Поиск сразу по всем именам,
клик по колонке вставляет её в параграф под курсором.

Zeppelin при этом не патчится: панель подключается штатным свойством
`zeppelin.server.html.body.addon`, файлы отдаёт отдельный nginx.
Упадёт nginx — просто не будет панели, Zeppelin не заметит.

---

## Как это устроено

```
        ┌──────────────┐   собирает    ┌──────────────┐
        │  ClickHouse  │──────┐        │              │
        │  Greengage   │──────┼───────▶│  metastore   │  описания + метаданные
        │  PostgreSQL  │──────┘        │      -db     │  + история слепков
        └──────────────┘   ноут в      └──────────────┘
                           Zeppelin           │
                                              │ пишет файл
                                              ▼
        ┌──────────────┐   fetch       ┌──────────────┐
        │   браузер    │◀──────────────│ metastore-web│  nginx :8086
        │  (панель)    │               │ catalog.json │
        └──────────────┘               │ metastore.js │
                                       └──────────────┘
```

Панель не ходит в PostgreSQL напрямую — браузер не умеет в его протокол.
База остаётся источником правды, а ноут раскладывает из неё один JSON-файл
в общий volume, который отдаёт nginx.

---

## Что в архиве

Файлы делятся на две группы. **Рантайм** нужен, чтобы всё работало;
**исходники** — только если вы захотите править код.

| | Файл | Зачем |
|---|---|---|
| рантайм | `docker-compose.yml` | ваш файл + три сервиса |
| рантайм | `zeppelin-data/conf/zeppelin-site.xml` | ваш конфиг + `body.addon` |
| рантайм | `.env.example` → `.env` | подключения и порты |
| рантайм | `metastore/nginx.conf` | конфиг nginx |
| рантайм | `metastore/init_metastore.sh` | ставит python-зависимости при старте |
| рантайм | `metastore/web/zeppelin-metastore.js` | **сама панель**, её отдаёт nginx |
| рантайм | `00_metastore_catalog.zpln` | ноут, импортируется в Zeppelin |
| исходники | `src/sidebar_core.js`, `src/integration.js` | из них собран `zeppelin-metastore.js` |
| исходники | `note/p0*.py`, `note/p0*.md` | из них собран `.zpln` |
| исходники | `build.py` | пересобирает оба артефакта |
| — | `zeppelin_metastore_demo.html` | макет на фейковых данных, открывается в браузере |

`src/` и `note/` **никуда не монтируются и не нужны контейнерам** — это то,
из чего собраны два готовых артефакта. Собранные версии уже лежат на своих
местах, так что для установки правки не нужны: разложили, подняли, работает.

Если понадобится что-то поменять — например ширину панели в
`src/sidebar_core.js` или список исключаемых схем в `note/p02_config.py`:

```bash
python3 build.py
```

Пересоберёт `metastore/web/zeppelin-metastore.js` и `00_metastore_catalog.zpln`.
Питоновский код параграфов проверяется на синтаксис до упаковки — сломанный
ноут в `.zpln` не попадёт. Панель подхватится после перезагрузки страницы
(nginx отдаёт файл с `no-cache`), ноут придётся переимпортировать.

Держать `src/` и `note/` рядом с compose необязательно, но удобно: тогда
правки и продакшен лежат вместе и не разъезжаются.

---

## Что вы получаете в `metastore-db`

| Таблица | Что внутри | Кто пишет |
|---|---|---|
| `catalog.desc_schema` / `desc_table` / `desc_column` | описания и ссылки на XWiki | вы, руками |
| `catalog.obj_table` / `obj_column` | сырьё из системных каталогов | коллектор, перезаписывает |
| `catalog.snapshot` | собранный JSON, последние 30 прогонов | коллектор |
| `catalog.v_search` | плоский вид «колонка + тип + описание» | вид |

`v_search` полезен сам по себе, без всякой панели:

```sql
SELECT db_key, schema_name, table_name, data_type
FROM catalog.v_search WHERE column_name = 'account_id';
```

---

# Установка

## Шаг 1. Положить файлы рядом с docker-compose

Распакуйте архив в папку, где лежит ваш `docker-compose.yml`:

```
<папка с docker-compose.yml>
├── docker-compose.yml                     ← шаг 3
├── .env                                   ← шаг 2
├── metastore/
│   ├── init_metastore.sh                  ← ставит python-зависимости
│   ├── nginx.conf
│   ├── web/
│   │   ├── zeppelin-metastore.js          ← сама панель
│   │   └── metastore-catalog.json         ← появится после первого сбора
│   ├── pylibs/                            ← создастся само
│   └── pgdata/                            ← создастся само
├── zeppelin-data/conf/zeppelin-site.xml    ← шаг 4
├── 00_metastore_catalog.zpln              ← шаг 6, импортируется в Zeppelin
│
├── src/                                   ← исходники панели, в рантайме не нужны
├── note/                                  ← исходники ноута, в рантайме не нужны
├── build.py                               ← пересобирает панель и ноут
└── zeppelin_metastore_demo.html           ← макет, можно открыть локально
```

`src/`, `note/`, `build.py` и демо никуда не монтируются — они нужны только
для правок (см. «Что в архиве» выше). Можно оставить рядом, можно убрать
в отдельный репозиторий.

Права: контейнер Zeppelin пишет каталог в `metastore/web`, поэтому папка
должна быть ему доступна на запись.

```bash
mkdir -p metastore/web metastore/pylibs metastore/pgdata
chmod +x metastore/init_metastore.sh
chmod 777 metastore/web metastore/pylibs
# аккуратнее, если знаете uid пользователя в контейнере:
# chown -R 1000:1000 metastore/web metastore/pylibs
```

## Шаг 2. Создать `.env`

```bash
cp .env.example .env
$EDITOR .env
```

Заполните подключения к ClickHouse и Greengage, придумайте пароль для
`MS_DB_PASSWORD`. `PGMD_*` (ваша старая PG с метаданными) можно оставить
пустыми — источник просто пропустится.

`.env` подхватывается docker-compose автоматически, если лежит рядом.
Паролей ни в compose, ни в ноуте нет — всё приходит отсюда.

> `MS_WEB_PORT` (по умолчанию 8086) прописан **в двух местах**: в `.env`
> и в `zeppelin-site.xml`. Меняете — меняйте в обоих.

## Шаг 3. Обновить `docker-compose.yml`

Возьмите приложенный `docker-compose.yml` — это ваш файл с тремя блоками
правок, все помечены `# ── METASTORE ──`. Если правите свой, нужно:

**в сервисе `zeppelin`:**

```yaml
    command: ["bash", "-c", "/docker-entrypoint-init.d/patch_angular.sh; /docker-entrypoint-init.d/init_metastore.sh; exec bin/zeppelin.sh"]
    depends_on:
      - metastore-db
    volumes:
      - ./metastore/init_metastore.sh:/docker-entrypoint-init.d/init_metastore.sh:ro
      - ./metastore/pylibs:/metastore/pylibs
      - ./metastore/web:/metastore/web
    environment:
      - MS_DB_HOST=metastore-db
      - MS_DB_PORT=5432
      - MS_DB_NAME=${MS_DB_NAME}
      - MS_DB_USER=${MS_DB_USER}
      - MS_DB_PASSWORD=${MS_DB_PASSWORD}
      - MS_CATALOG_FILE=/metastore/web/metastore-catalog.json
      - CH_HOST=${CH_HOST}
      - CH_PORT=${CH_PORT}
      - CH_USER=${CH_USER}
      - CH_PASSWORD=${CH_PASSWORD}
      - GP_HOST=${GP_HOST}
      - GP_PORT=${GP_PORT}
      - GP_DB=${GP_DB}
      - GP_USER=${GP_USER}
      - GP_PASSWORD=${GP_PASSWORD}
      - PGMD_HOST=${PGMD_HOST}
      - PGMD_PORT=${PGMD_PORT}
      - PGMD_DB=${PGMD_DB}
      - PGMD_USER=${PGMD_USER}
      - PGMD_PASSWORD=${PGMD_PASSWORD}
      - PIP_INDEX_URL=${PIP_INDEX_URL}
      - PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST}
```

**плюс два новых сервиса** — `metastore-db` (postgres:16-alpine) и
`metastore-web` (nginx:alpine), они целиком есть в приложенном файле.

`ZEPPELIN_INTERPRETER_OUTPUT_LIMIT` трогать не нужно: каталог уходит в файл,
а не в вывод параграфа. В выводе только лог сборки, он мелкий.

Проверить, что ничего не сломали:

```bash
docker compose config >/dev/null && echo ok
```

## Шаг 4. Обновить `zeppelin-site.xml`

В приложенном файле ваш конфиг **плюс одно свойство** в самом конце —
`zeppelin.server.html.body.addon`. Оно подставляет в `index.html` маленький
загрузчик:

```xml
<property>
  <name>zeppelin.server.html.body.addon</name>
  <value><![CDATA[<script>
(function () {
  var base = location.protocol + "//" + location.hostname + ":8086";
  window.ZM_CONFIG = {
    catalogUrl: base + "/metastore-catalog.json",
    refreshMinutes: 30
  };
  var s = document.createElement("script");
  s.defer = true;
  s.src = base + "/zeppelin-metastore.js";
  document.body.appendChild(s);
})();
</script>]]></value>
</property>
```

Хост не зашит — панель берёт его из адресной строки, поэтому одинаково
работает и по IP, и по доменному имени. Порт `8086` должен совпадать
с `MS_WEB_PORT` из `.env`.

**Выключить панель** в любой момент: закомментировать это свойство,
`docker compose up -d zeppelin`. Больше нигде ничего откатывать не нужно.

## Шаг 5. Поднять

```bash
docker compose up -d
docker compose logs -f zeppelin | grep metastore
```

Ожидаемое в логе при первом старте:

```
[metastore] ставлю psycopg2-binary и clickhouse-driver в /metastore/pylibs ...
[metastore] зависимости установлены
[metastore] файлов в /metastore/web: 1
```

При следующих стартах — сразу `[metastore] python-зависимости на месте`.

Проверки:

```bash
curl -s http://localhost:8086/healthz                      # ok
curl -sI http://localhost:8086/zeppelin-metastore.js | head -1   # 200
docker compose exec metastore-db psql -U $MS_DB_USER -d $MS_DB_NAME -c '\l'
```

## Шаг 6. Импортировать ноут и собрать каталог

В Zeppelin: **Import note → Select JSON File** → `00_metastore_catalog.zpln`.
Появится ноут `00. Metastore / 00. Metastore Catalog` из шести параграфов.

Запускайте по порядку:

| Параграф | Что делает |
|---|---|
| **1. Конфигурация** | читает `.env`-переменные, проверяет связь со всеми БД |
| **2. DDL** | создаёт `catalog.*` в metastore-db. Нужен один раз |
| **3. `load_catalog_data()`** | собирает метаданные и пишет каталог |
| **4. Описания** | `describe(...)` и `todo()` — заполнять по мере надобности |

Параграф 1 должен напечатать пять зелёных галочек и
`папка доступна на запись: True`. Если `False` — вернитесь к правам в шаге 1.

Параграф 3 в конце скажет что-то вроде:

```
✅ 812 таблиц, 15100 колонок за 34 с
   размер каталога: 1840 КБ
   записано в /metastore/web/metastore-catalog.json
```

Предупреждения `⚠ pg_partition_columns: пропущено` — норма: GP-специфичные
запросы пробуются по очереди, неподошедшие тихо пропускаются.

## Шаг 7. Проверить панель

Откройте любой ноут. Справа — вертикальная плашка **«Данные»**, разворачивается
кликом или по **Alt+D**.

* в свёрнутом виде это **небольшая вкладка по центру правого края**,
  26 px шириной — она не перекрывает кнопки параграфов. Если всё равно
  мешает, сдвиньте её: в `zeppelin-site.xml` добавьте в `ZM_CONFIG`
  `railPosition: "top"` или `"bottom"`;
* **ширина меняется** — потяните за левый край панели. Выбранная ширина
  запоминается в браузере у каждого аналитика отдельно (диапазон 300 px …
  ширина экрана минус 120 px). Двойной клик по краю — вернуть 420 px
  по умолчанию;
* найдите `account_id` — должны прийти все колонки с таким именем из обеих БД;
* кликните по колонке — имя вставится в параграф под курсором;
* кнопка **SELECT** на таблице соберёт готовый запрос;
* в подвале — время сборки каталога и счётчики.

## Шаг 8. Поставить на расписание

Когда убедитесь, что каталог собирается правильно: иконка часов в шапке ноута →
cron, например `0 0 */2 * * ?`. Включите **Auto-restart interpreter on cron
execution**, иначе соединения протухнут между запусками.
`zeppelin.notebook.cron.enable` и `cron.folders=/` у вас уже стоят.

---

## Что прячется от панели

У вас 2981 таблица, из них заметная часть — личные песочницы и бэкапы.
Панель их не показывает, чтобы поиск не тонул. Правила — в первом параграфе
ноута, шаблоны в стиле glob, применяются ко **всем** источникам:

```python
HIDE_SCHEMAS = (
    'srv_*',          # служебные схемы Greengage
    'sandbox_*',      # личные песочницы аналитиков
    # 'prod_tmp',     # раскомментируйте, если временное тоже не нужно
    # 'test_*',
    # 'prod_v_*',     # legacy distributed-вьюхи
)

HIDE_TABLES = (
    '*_prt_*', '*_prep', '*_bckp', '*_bak', '*_backup', '*_tmp', 'tmp_*',
)
```

Важно: **спрятанное всё равно попадает в `catalog.obj_*`** и ищется SQL-ом
через `catalog.v_search`. Прячем только из панели, ничего не теряем.
Сколько объектов ушло по фильтрам — коллектор печатает при сборе:

```
   🙈 скрыто от панели по HIDE_SCHEMAS/HIDE_TABLES: 640 таблиц
      (в catalog.obj_* они есть, ищутся через catalog.v_search)
```

Если каталог всё равно больше 3 МБ, коллектор в конце покажет,
какие схемы весят больше всего — по ним и решайте, что ещё скрыть.

---

## Бонус: автодополнение в JDBC (5 минут, без рестарта)

Не связано с панелью, но снимает половину походов в DBeaver. JDBC-интерпретатор
умеет подсказывать схемы, таблицы и колонки по **Ctrl+.** прямо в параграфе.
`admin → Interpreter`, ваш JDBC:

| Свойство | Значение |
|---|---|
| `default.completer.schemaFilters` | `prod%,mart_ru,dv_raw_ru,str_kfk_ru,stg_kfk_ru` |
| `default.completer.ttlInSeconds` | `3600` |

Без `schemaFilters` он полезет за метаданными по всем схемам сразу, и первое
нажатие `Ctrl+.` будет висеть.

---

## Если что-то пошло не так

| Симптом | Причина | Что делать |
|---|---|---|
| Панели нет вообще | `body.addon` не подхватился | `docker compose exec zeppelin cat /opt/zeppelin/conf/zeppelin-site.xml \| grep -A2 body.addon`; контейнер должен быть **пересоздан** (`up -d`), а не перезапущен |
| Панель есть, «Каталог ещё не собран» | коллектор ещё не отработал | запустите параграф 3. Панель переспросит сама (15 с → 30 → 60 → 120 → 300) или по кнопке «Обновить» внизу |
| То же, в консоли CORS-ошибка | nginx не отдал заголовок | `curl -sI http://<хост>:8086/metastore-catalog.json \| grep -i access-control` |
| `HTTP 404` на `zeppelin-metastore.js` | файл не там | он должен лежать в `metastore/web/`, не в `metastore/` |
| Параграф 1: `ModuleNotFoundError: psycopg2` | pip не отработал | см. следующий раздел |
| Параграф 1: `папка доступна на запись: False` | права на `metastore/web` | `chmod 777 metastore/web` |
| Параграф 1: `Не задана переменная окружения ...` | `.env` не подхватился | `.env` рядом с compose; `docker compose config \| grep CH_HOST` |
| Клик по колонке копирует в буфер вместо вставки | курсор не стоял в параграфе | кликните в параграф, потом в панель — так и задумано |
| Панель закрывает содержимое | — | потяните за левый край, ширина запомнится; или сверните по **Alt+D** |

### Нет доступа к PyPI

Если `pip install` в контейнере не проходит, есть два пути.

**Внутреннее зеркало** — впишите в `.env`:

```
PIP_INDEX_URL=https://pypi.your-mirror.local/simple
PIP_TRUSTED_HOST=pypi.your-mirror.local
```

**Скачать колёса руками** на машине с интернетом и положить в `metastore/pylibs`:

```bash
pip download psycopg2-binary clickhouse-driver -d /tmp/wh --only-binary=:all: \
  --platform manylinux2014_x86_64 --python-version 3.9
pip install --no-index --find-links /tmp/wh --target ./metastore/pylibs \
  psycopg2-binary clickhouse-driver
```

Ноут ищет их в `/metastore/pylibs` (`sys.path.insert` в первом параграфе),
глобальный `PYTHONPATH` не трогается — другие интерпретаторы не затрагиваются.

---

## Что проверено

* **DDL** прогнан на живом PostgreSQL 16: идемпотентен, повторный запуск чистый,
  триггеры `updated_at`/`updated_by` срабатывают, `v_search` отдаёт правильный
  приоритет `desc_*` над нативным `COMMENT ON`.
* **SQL сбора** проверен на живой БД: партиции-потомки отсекаются,
  `format_type` даёт настоящий тип (`numeric(18,2)`), `col_description`
  подтягивает комментарии.
* **Совместимость версий**: `relispartition` есть только с PG 10, поэтому
  наличие колонки проверяется перед запросом (Greengage 6 построен на PG 9.4);
  `gp_distribution_policy` и `pg_partition_columns` на «ванильном» PostgreSQL
  пропускаются с предупреждением, а не роняют сбор.
* **Сборка JSON** проверена на данных той же формы, что отдают сборщики:
  фильтры `srv_*` / `_prt_` / `test`, приоритет описаний, ключи
  `DISTRIBUTED BY` / `PARTITION BY`.
* **docker-compose.yml** проходит `docker compose config`.
* **Панель** проверена end-to-end на двух портах (настоящий cross-origin,
  как у вас будет): загрузчик из `zeppelin-site.xml` вычисляет адрес,
  тянет скрипт и каталог, поиск и вставка в ACE работают, консоль чистая.
* **`.zpln`** — валидный JSON, все шесть параграфов с уникальными id,
  питоновский код проходит `ast.parse` перед упаковкой.

## Чего нет

* Свежесть каталога равна периоду cron — это не онлайн-метаданные.
* Профилирования колонок (доля NULL, примеры значений) нет: это уже
  сканирование данных, а не чтение системного каталога.
* Права не учитываются: панель показывает весь каталог всем, кто открыл
  Zeppelin. Если нужно резать по ролям — вместо статики понадобится
  эндпоинт, фильтрующий по пользователю.
* В новом UI (Default UI) панель откроется и будет искать, но вставка
  в параграф не сработает: там другой редактор. Для classic UI всё работает.
