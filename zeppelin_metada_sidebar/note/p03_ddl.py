%python
# =============================================================================
#  2. DDL — таблицы каталога в metastore-db
#  Запускается один раз. Повторный запуск безопасен (IF NOT EXISTS).
#
#  Две группы таблиц:
#    desc_*  — описания, которые пишут люди. Живут вечно, коллектор их не трогает.
#    obj_*   — метаданные, собранные из БД. Полностью перезаписываются каждый прогон.
# =============================================================================

DDL = r"""
CREATE SCHEMA IF NOT EXISTS catalog;
COMMENT ON SCHEMA catalog IS 'Каталог DWH: описания + собранные метаданные';

-- ── описания, которые пишут аналитики ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog.desc_schema (
    db_key      text NOT NULL CHECK (db_key IN ('ch','gg','pg')),
    schema_name text NOT NULL,
    description text NOT NULL,
    updated_by  text NOT NULL DEFAULT current_user,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (db_key, schema_name)
);

CREATE TABLE IF NOT EXISTS catalog.desc_table (
    db_key      text NOT NULL CHECK (db_key IN ('ch','gg','pg')),
    schema_name text NOT NULL,
    table_name  text NOT NULL,
    description text,
    doc_url     text,
    updated_by  text NOT NULL DEFAULT current_user,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (db_key, schema_name, table_name)
);

CREATE TABLE IF NOT EXISTS catalog.desc_column (
    db_key      text NOT NULL CHECK (db_key IN ('ch','gg','pg')),
    schema_name text NOT NULL,
    table_name  text NOT NULL,
    column_name text NOT NULL,
    description text NOT NULL,
    updated_by  text NOT NULL DEFAULT current_user,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (db_key, schema_name, table_name, column_name)
);

-- ── метаданные, собранные коллектором ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog.obj_table (
    db_key        text NOT NULL,
    schema_name   text NOT NULL,
    table_name    text NOT NULL,
    engine        text,
    native_comment text,
    n_rows        bigint,
    size_h        text,
    collected_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (db_key, schema_name, table_name)
);

CREATE TABLE IF NOT EXISTS catalog.obj_column (
    db_key        text NOT NULL,
    schema_name   text NOT NULL,
    table_name    text NOT NULL,
    column_name   text NOT NULL,
    ordinal       int,
    data_type     text,
    key_tag       text,
    native_comment text,
    collected_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (db_key, schema_name, table_name, column_name)
);

CREATE INDEX IF NOT EXISTS obj_column_name_idx ON catalog.obj_column (column_name);
CREATE INDEX IF NOT EXISTS obj_table_name_idx  ON catalog.obj_table  (table_name);

-- ── история: собранный JSON целиком ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog.snapshot (
    snapshot_id  bigserial PRIMARY KEY,
    collected_at timestamptz NOT NULL DEFAULT now(),
    n_tables     int,
    n_columns    int,
    payload      jsonb NOT NULL
);

-- ── автообновление updated_at / updated_by ──────────────────────────────────
CREATE OR REPLACE FUNCTION catalog.touch() RETURNS trigger AS $touch$
BEGIN
    NEW.updated_at := now();
    NEW.updated_by := current_user;
    RETURN NEW;
END;
$touch$ LANGUAGE plpgsql;

DO $mk$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['desc_schema','desc_table','desc_column'] LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS %1$s_touch ON catalog.%1$s;
             CREATE TRIGGER %1$s_touch BEFORE INSERT OR UPDATE ON catalog.%1$s
             FOR EACH ROW EXECUTE PROCEDURE catalog.touch();', t);
    END LOOP;
END $mk$;

-- ── удобный вид для поиска по каталогу обычным SQL ──────────────────────────
CREATE OR REPLACE VIEW catalog.v_search AS
SELECT c.db_key,
       c.schema_name,
       c.table_name,
       c.column_name,
       c.data_type,
       c.key_tag,
       COALESCE(dc.description, c.native_comment, '') AS column_desc,
       COALESCE(dt.description, t.native_comment, '') AS table_desc,
       dt.doc_url,
       t.n_rows,
       t.size_h
FROM catalog.obj_column c
JOIN catalog.obj_table  t USING (db_key, schema_name, table_name)
LEFT JOIN catalog.desc_column dc USING (db_key, schema_name, table_name, column_name)
LEFT JOIN catalog.desc_table  dt USING (db_key, schema_name, table_name);

COMMENT ON VIEW catalog.v_search IS
  'Плоский каталог: колонка + тип + описание + таблица. Для ad-hoc поиска SQL-ом.';
"""

with psycopg2.connect(**MS_DSN) as conn:
    with conn.cursor() as cur:
        cur.execute(DDL)
    conn.commit()

with psycopg2.connect(**MS_DSN) as conn, conn.cursor() as cur:
    cur.execute("""
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'catalog' ORDER BY 1
    """)
    print('✅ создано в schema catalog:')
    for (t,) in cur.fetchall():
        print('   •', t)
