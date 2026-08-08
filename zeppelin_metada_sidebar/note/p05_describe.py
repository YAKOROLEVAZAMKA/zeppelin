%python
# =============================================================================
#  4. Описания
#  Заполняются руками и живут в metastore-db. Коллектор их не перетирает.
#  Приоритет в панели: desc_* → нативный COMMENT ON в самой БД → пусто.
# =============================================================================

def describe(db_key, schema, table=None, column=None, text=None, doc_url=None):
    """Записать описание. Уровень определяется по заполненным аргументам.

    describe('gg', 'mart_ru', text='Аналитические витрины')
    describe('gg', 'mart_ru', 'deposit_detail', text='Депозиты', doc_url='https://xwiki…')
    describe('gg', 'mart_ru', 'deposit_detail', 'account_id', text='ID счёта игрока')
    """
    conn = psycopg2.connect(**MS_DSN)
    try:
        with conn.cursor() as cur:
            if column:
                cur.execute("""
                    INSERT INTO catalog.desc_column
                           (db_key, schema_name, table_name, column_name, description)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (db_key, schema_name, table_name, column_name)
                    DO UPDATE SET description = EXCLUDED.description
                """, (db_key, schema, table, column, text))
            elif table:
                cur.execute("""
                    INSERT INTO catalog.desc_table
                           (db_key, schema_name, table_name, description, doc_url)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (db_key, schema_name, table_name)
                    DO UPDATE SET description = COALESCE(EXCLUDED.description, catalog.desc_table.description),
                                  doc_url     = COALESCE(EXCLUDED.doc_url,     catalog.desc_table.doc_url)
                """, (db_key, schema, table, text, doc_url))
            else:
                cur.execute("""
                    INSERT INTO catalog.desc_schema (db_key, schema_name, description)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (db_key, schema_name)
                    DO UPDATE SET description = EXCLUDED.description
                """, (db_key, schema, text))
        conn.commit()
    finally:
        conn.close()


def todo(limit=40):
    """Что описать в первую очередь: самые большие таблицы без описания."""
    conn = psycopg2.connect(**MS_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT t.db_key, t.schema_name, t.table_name, t.n_rows
                FROM catalog.obj_table t
                LEFT JOIN catalog.desc_table d USING (db_key, schema_name, table_name)
                WHERE COALESCE(NULLIF(d.description, ''), t.native_comment) IS NULL
                ORDER BY t.n_rows DESC NULLS LAST
                LIMIT %s
            """, (limit,))
            rows = cur.fetchall()
    finally:
        conn.close()
    print(f'без описания — {len(rows)} самых крупных:\n')
    for k, s, t, n in rows:
        print(f'  {k}  {s}.{t:<40} {n if n is not None else "?":>15}')
    return rows


# ── примеры, раскомментируйте и правьте под себя ─────────────────────────────
# describe('gg', 'mart_ru', text='Аналитические витрины для аналитиков')
# describe('gg', 'mart_ru', 'deposit_detail', text='Начисление депозитов',
#          doc_url='https://xwiki.olimp.dev/bin/view/...')
# describe('gg', 'mart_ru', 'deposit_detail', 'account_id', text='Идентификатор счёта игрока')

todo()
