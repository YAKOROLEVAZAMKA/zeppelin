%python
# =============================================================================
#  3. load_catalog_data() — сбор метаданных
#
#  Что делает за один прогон:
#    1. читает системные каталоги ClickHouse / Greengage / PostgreSQL;
#    2. складывает сырьё в catalog.obj_table и catalog.obj_column;
#    3. подмешивает описания из catalog.desc_*;
#    4. собирает итоговый JSON, кладёт его в catalog.snapshot
#       и записывает в файл, который отдаёт nginx боковой панели.
#
#  Запускать можно сколько угодно раз: obj_* полностью перезаписываются,
#  desc_* не трогаются.
# =============================================================================

# ─────────────────────────────── SQL ─────────────────────────────────────────

CH_TABLES_SQL = """
SELECT database, name, engine, comment, total_rows, formatReadableSize(total_bytes)
FROM system.tables
WHERE database NOT IN %(exclude)s AND is_temporary = 0
ORDER BY database, name
"""

CH_COLUMNS_SQL = """
SELECT database, table, name, type, comment, position,
       is_in_sorting_key, is_in_partition_key
FROM system.columns
WHERE database NOT IN %(exclude)s
ORDER BY database, table, position
"""

PG_TABLES_SQL = """
SELECT n.nspname, c.relname,
       CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned table'
                      WHEN 'v' THEN 'view'  WHEN 'm' THEN 'materialized view'
                      WHEN 'f' THEN 'foreign table' ELSE c.relkind::text END,
       obj_description(c.oid, 'pg_class'),
       CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END,
       {size_expr}
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','p','v','m','f')
  AND n.nspname NOT IN %(exclude)s
  {part_filter}
ORDER BY 1, 2
"""

PG_COLUMNS_SQL = """
SELECT n.nspname, c.relname, a.attname,
       format_type(a.atttypid, a.atttypmod),
       col_description(c.oid, a.attnum),
       a.attnum
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE c.relkind IN ('r','p','v','m','f')
  AND n.nspname NOT IN %(exclude)s
  {part_filter}
ORDER BY 1, 2, a.attnum
"""

PG_SCHEMA_COMMENT_SQL = """
SELECT n.nspname, obj_description(n.oid, 'pg_namespace')
FROM pg_namespace n WHERE n.nspname NOT IN %(exclude)s
"""

HAS_RELISPARTITION_SQL = """
SELECT count(*) FROM pg_attribute
WHERE attrelid = 'pg_class'::regclass AND attname = 'relispartition'
"""

# Ключ распределения Greenplum/Greengage. На обычном PG таблицы нет.
GP_DISTKEY_SQL = """
SELECT n.nspname, c.relname, a.attname
FROM gp_distribution_policy d
JOIN pg_class c     ON c.oid = d.localoid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (d.distkey::int2[]::int[])
WHERE n.nspname NOT IN %(exclude)s
"""

# Партиционирование: сначала legacy-вью GP6, потом нативное PG10+.
GP_PARTCOL_SQL = """
SELECT schemaname, tablename, columnname
FROM pg_catalog.pg_partition_columns WHERE schemaname NOT IN %(exclude)s
"""

PG_PARTKEY_SQL = """
SELECT n.nspname, c.relname, a.attname
FROM pg_partitioned_table p
JOIN pg_class c     ON c.oid = p.partrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (p.partattrs::int2[]::int[])
WHERE n.nspname NOT IN %(exclude)s
"""


# ────────────────────────────── хелперы ──────────────────────────────────────

def pg_rows(dsn, sql, params=None):
    conn = psycopg2.connect(**dsn)
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params or {})
            return cur.fetchall()
    finally:
        conn.close()          # `with psycopg2.connect(...)` закрывает транзакцию, но НЕ соединение


def pg_rows_safe(dsn, sql, label, params=None):
    """Необязательный запрос: нет объекта — просто пропускаем."""
    try:
        return pg_rows(dsn, sql, params)
    except Exception as exc:
        print(f'   ⚠ {label}: пропущено ({type(exc).__name__})')
        return []


def pg_sql(dsn, template):
    """Подставляет куски, зависящие от версии сервера."""
    part_filter = ''
    try:
        if pg_rows(dsn, HAS_RELISPARTITION_SQL)[0][0]:
            part_filter = 'AND NOT c.relispartition'
    except Exception:
        pass
    return template.format(
        part_filter=part_filter,
        size_expr=('pg_size_pretty(pg_total_relation_size(c.oid))'
                   if COLLECT_SIZES else 'NULL::text'))


def is_hidden(schema, table):
    """Прятать ли объект от панели. В catalog.obj_* он всё равно попадёт."""
    if any(fnmatch.fnmatchcase(schema, p) for p in HIDE_SCHEMAS):
        return True
    return any(fnmatch.fnmatchcase(table, p) for p in HIDE_TABLES)


# ─────────────────────────── сбор по источникам ──────────────────────────────
# Каждый сборщик возвращает три плоских списка:
#   tables  : (schema, table, engine, comment, n_rows, size_h)
#   columns : (schema, table, column, ordinal, data_type, key_tag, comment)
#   sdesc   : {schema: comment}

def collect_ch():
    print('🏗️  ClickHouse…')
    ch = ClickHouseClient(**CH_CONF)
    p = {'exclude': EXCLUDE_SCHEMAS_CH}
    tables = [(s, t, eng, com or None, rows, size)
              for s, t, eng, com, rows, size in ch.execute(CH_TABLES_SQL, p)]
    columns = []
    for s, t, name, typ, com, pos, in_ob, in_pt in ch.execute(CH_COLUMNS_SQL, p):
        key = 'ORDER BY' if in_ob else ('PARTITION BY' if in_pt else None)
        columns.append((s, t, name, pos, typ, key, com or None))
    print(f'   {len(tables)} таблиц, {len(columns)} колонок')
    return tables, columns, {}


def collect_pg_like(dsn, label, exclude, with_gp_keys=False):
    print(f'{label}…')
    p = {'exclude': exclude}
    tables = pg_rows(dsn, pg_sql(dsn, PG_TABLES_SQL), p)
    raw_cols = pg_rows(dsn, pg_sql(dsn, PG_COLUMNS_SQL), p)
    sdesc = {s: d for s, d in pg_rows_safe(dsn, PG_SCHEMA_COMMENT_SQL, 'комментарии схем', p)}

    keys = {}
    if COLLECT_KEYS and with_gp_keys:
        for s, t, c in pg_rows_safe(dsn, GP_DISTKEY_SQL, 'gp_distribution_policy', p):
            keys[(s, t, c)] = 'DISTRIBUTED BY'
        part = (pg_rows_safe(dsn, GP_PARTCOL_SQL, 'pg_partition_columns', p)
                or pg_rows_safe(dsn, PG_PARTKEY_SQL, 'pg_partitioned_table', p))
        for s, t, c in part:
            keys[(s, t, c)] = 'PARTITION BY'

    columns = [(s, t, name, pos, typ, keys.get((s, t, name)), com)
               for s, t, name, typ, com, pos in raw_cols]
    print(f'   {len(tables)} таблиц, {len(columns)} колонок'
          + (f', {len(keys)} ключей' if keys else ''))
    return tables, columns, sdesc


# ──────────────────────── запись сырья в metastore ───────────────────────────

def store_objects(conn, db_key, tables, columns):
    with conn.cursor() as cur:
        cur.execute('DELETE FROM catalog.obj_column WHERE db_key = %s', (db_key,))
        cur.execute('DELETE FROM catalog.obj_table  WHERE db_key = %s', (db_key,))
        psycopg2.extras.execute_values(
            cur,
            'INSERT INTO catalog.obj_table '
            '(db_key, schema_name, table_name, engine, native_comment, n_rows, size_h) VALUES %s',
            [(db_key,) + tuple(r) for r in tables], page_size=1000)
        psycopg2.extras.execute_values(
            cur,
            'INSERT INTO catalog.obj_column '
            '(db_key, schema_name, table_name, column_name, ordinal, data_type, key_tag, native_comment) '
            'VALUES %s',
            [(db_key,) + tuple(r) for r in columns], page_size=2000)


# ──────────────────────────── сборка JSON ────────────────────────────────────

def fetch_descriptions(conn):
    out = {'schema': {}, 'table': {}, 'column': {}}
    with conn.cursor() as cur:
        cur.execute('SELECT db_key, schema_name, description FROM catalog.desc_schema')
        for k, s, d in cur.fetchall():
            out['schema'][(k, s)] = d
        cur.execute('SELECT db_key, schema_name, table_name, description, doc_url FROM catalog.desc_table')
        for k, s, t, d, u in cur.fetchall():
            out['table'][(k, s, t)] = (d, u)
        cur.execute('SELECT db_key, schema_name, table_name, column_name, description FROM catalog.desc_column')
        for k, s, t, c, d in cur.fetchall():
            out['column'][(k, s, t, c)] = d
    print(f"   📖 описания: {len(out['schema'])} схем, "
          f"{len(out['table'])} таблиц, {len(out['column'])} колонок")
    return out


def assemble(db_key, tables, columns, sdesc, desc):
    """Плоские списки → дерево схема → таблица → колонки."""
    by_table = {}
    for s, t, name, pos, typ, key, com in columns:
        by_table.setdefault((s, t), []).append((name, typ, key, com))

    schemas = {}
    hidden = 0
    for s, t, engine, tcom, n_rows, size_h in tables:
        if is_hidden(s, t):
            hidden += 1
            continue

        cols = []
        for name, typ, key, com in by_table.get((s, t), []):
            col = {'n': name,
                   't': typ,
                   'c': desc['column'].get((db_key, s, t, name)) or com or ''}
            if key:
                col['k'] = key
            cols.append(col)

        d, doc = desc['table'].get((db_key, s, t), (None, None))
        entry = {'name': t, 'desc': d or tcom or '', 'cols': cols}
        if doc:
            entry['doc'] = doc
        if engine:
            entry['engine'] = engine
        if n_rows is not None:
            entry['rows'] = int(n_rows)
        if size_h:
            entry['size'] = size_h
        schemas.setdefault(s, []).append(entry)

    out = [{'name': s,
            'desc': desc['schema'].get((db_key, s)) or sdesc.get(s) or '',
            'tables': sorted(schemas[s], key=lambda x: x['name'])}
           for s in sorted(schemas)]
    return out, hidden


# ────────────────────────────── точка входа ──────────────────────────────────

def load_catalog_data(write_file=True):
    started = datetime.datetime.now()
    sources = {
        'ch': lambda: collect_ch(),
        'gg': lambda: collect_pg_like(GP_DSN, '🟢 Greengage', EXCLUDE_SCHEMAS_GP, with_gp_keys=True),
        'pg': (lambda: collect_pg_like(PGMD_DSN, '🧩 PostgreSQL Metadata', EXCLUDE_SCHEMAS_PG))
              if PGMD_DSN else None,
    }

    raw = {}
    conn = psycopg2.connect(**MS_DSN)
    try:
        for db in DBS:
            fn = sources.get(db['key'])
            if fn is None:
                print(f"➖ {db['name']}: пропущен")
                raw[db['key']] = ([], [], {})
                continue
            try:
                tables, columns, sdesc = fn()
                store_objects(conn, db['key'], tables, columns)
                conn.commit()
                raw[db['key']] = (tables, columns, sdesc)
            except Exception as exc:
                conn.rollback()
                print(f"   ❌ {db['name']}: {type(exc).__name__}: {str(exc)[:200]}")
                print('      (в metastore осталась прошлая версия этой БД)')
                raw[db['key']] = ([], [], {})

        desc = fetch_descriptions(conn)

        payload = {'generated_at': started.strftime('%Y-%m-%d %H:%M:%S'), 'dbs': []}
        n_hidden = 0
        for db in DBS:
            tables, columns, sdesc = raw[db['key']]
            schemas, hidden = assemble(db['key'], tables, columns, sdesc, desc)
            n_hidden += hidden
            payload['dbs'].append({**db, 'schemas': schemas})

        n_tab = sum(len(s['tables']) for d in payload['dbs'] for s in d['schemas'])
        n_col = sum(len(t['cols']) for d in payload['dbs'] for s in d['schemas'] for t in s['tables'])
        if n_hidden:
            print(f'   🙈 скрыто от панели по HIDE_SCHEMAS/HIDE_TABLES: {n_hidden} таблиц '
                  f'(в catalog.obj_* они есть, ищутся через catalog.v_search)')

        with conn.cursor() as cur:
            cur.execute(
                'INSERT INTO catalog.snapshot (n_tables, n_columns, payload) VALUES (%s, %s, %s)',
                (n_tab, n_col, json.dumps(payload, ensure_ascii=False)))
            cur.execute('DELETE FROM catalog.snapshot WHERE snapshot_id NOT IN '
                        '(SELECT snapshot_id FROM catalog.snapshot ORDER BY collected_at DESC LIMIT 30)')
        conn.commit()
    finally:
        conn.close()

    body = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    if write_file:
        tmp = CATALOG_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as fh:
            fh.write(body)
        os.replace(tmp, CATALOG_FILE)           # атомарная подмена, панель не поймает недописанный файл
        os.chmod(CATALOG_FILE, 0o644)

    took = (datetime.datetime.now() - started).total_seconds()
    kb = len(body.encode('utf-8')) / 1024
    print(f'\n✅ {n_tab} таблиц, {n_col} колонок за {took:.0f} с')
    print(f'   размер каталога: {kb:.0f} КБ')
    if write_file:
        print(f'   записано в {CATALOG_FILE}')
    if kb > 3000:
        print(f'\n   ⚠ каталог {kb/1024:.1f} МБ — его тянет каждый браузер при открытии Zeppelin.')
        print('     nginx отдаёт его в gzip (примерно вчетверо меньше), но если хочется легче —')
        print('     добавьте схемы в HIDE_SCHEMAS в первом параграфе. Что именно тяжёлое:')
        for d in payload['dbs']:
            top = sorted(d['schemas'],
                         key=lambda s: -sum(len(t['cols']) for t in s['tables']))[:5]
            for s in top:
                nc = sum(len(t['cols']) for t in s['tables'])
                if nc > 3000:
                    print(f"       {d['badge']}  {s['name']:<32} {len(s['tables']):>5} табл. {nc:>7} кол.")
    return payload


catalog = load_catalog_data()
