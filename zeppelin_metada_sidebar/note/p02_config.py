%python
# =============================================================================
#  1. Конфигурация и подключения
#  Всё берётся из переменных окружения (файл .env → docker-compose → контейнер).
#  Паролей в коде нет.
# =============================================================================
import os, sys, json, gzip, base64, datetime, fnmatch

# питоновские зависимости, доставленные init_metastore.sh в volume
sys.path.insert(0, '/metastore/pylibs')

import psycopg2
import psycopg2.extras
from clickhouse_driver import Client as ClickHouseClient


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if required and not v:
        raise RuntimeError(f'Не задана переменная окружения {name} — проверьте .env')
    return v


# ── куда складываем результат ────────────────────────────────────────────────
MS_DSN = dict(
    host=env('MS_DB_HOST', 'metastore-db'),
    port=int(env('MS_DB_PORT', '5432')),
    dbname=env('MS_DB_NAME', 'metastore'),
    user=env('MS_DB_USER', required=True),
    password=env('MS_DB_PASSWORD', required=True),
)
CATALOG_FILE = env('MS_CATALOG_FILE', '/metastore/web/metastore-catalog.json')

# ── источники ────────────────────────────────────────────────────────────────
CH_CONF = dict(
    host=env('CH_HOST', required=True),
    port=int(env('CH_PORT', '9000')),
    user=env('CH_USER', required=True),
    password=env('CH_PASSWORD', ''),
    connect_timeout=30,
)

GP_DSN = dict(
    host=env('GP_HOST', required=True),
    port=int(env('GP_PORT', '5432')),
    dbname=env('GP_DB', required=True),
    user=env('GP_USER', required=True),
    password=env('GP_PASSWORD', ''),
    connect_timeout=30,
)

# необязательный третий источник — ваша старая PG с метаданными.
# Оставьте PGMD_HOST пустым в .env, чтобы пропустить.
PGMD_DSN = None
if env('PGMD_HOST'):
    PGMD_DSN = dict(
        host=env('PGMD_HOST'),
        port=int(env('PGMD_PORT', '5432')),
        dbname=env('PGMD_DB', required=True),
        user=env('PGMD_USER', required=True),
        password=env('PGMD_PASSWORD', ''),
        connect_timeout=30,
    )

# ── что показываем и что прячем ──────────────────────────────────────────────
DBS = [
    {"key": "ch", "name": "ClickHouse",          "badge": "CH", "color": "#f5b53f"},
    {"key": "gg", "name": "Greengage",           "badge": "GG", "color": "#4caf7d"},
    {"key": "pg", "name": "PostgreSQL Metadata", "badge": "PG", "color": "#7b9fd4"},
]

EXCLUDE_SCHEMAS_CH = ('system', 'INFORMATION_SCHEMA', 'information_schema', 'default')
EXCLUDE_SCHEMAS_GP = ('information_schema', 'pg_catalog', 'gp_toolkit', 'pg_toast',
                      'kafka', 'stg_cps', 'stg_kfk', 'str_arch')
EXCLUDE_SCHEMAS_PG = ('information_schema', 'pg_catalog', 'pg_toast', 'pg_temp_1')

# ── что прячем от панели ─────────────────────────────────────────────────────
# Шаблоны в стиле glob, применяются ко ВСЕМ источникам.
#
# Важно: спрятанное всё равно попадает в catalog.obj_* и ищется SQL-ом через
# catalog.v_search. Прячем только из панели, чтобы она не тонула в песочницах.
# Сколько объектов ушло по фильтрам — печатается при сборе.
HIDE_SCHEMAS = (
    'srv_*',          # служебные схемы Greengage
    'sandbox_*',      # личные песочницы аналитиков
    # 'prod_tmp',     # раскомментируйте, если временное тоже не нужно
    # 'test_*',
    # 'prod_v_*',     # legacy distributed-вьюхи
)

HIDE_TABLES = (
    '*_prt_*',        # партиции-потомки (legacy-партиционирование GP)
    '*_prep',
    '*_bckp', '*_bak', '*_backup',
    '*_tmp', 'tmp_*',
)

COLLECT_SIZES = True     # строки и объём на диске
COLLECT_KEYS = True      # ORDER BY / PARTITION BY / DISTRIBUTED BY

# ── проверка связи ───────────────────────────────────────────────────────────
print('python', sys.version.split()[0])
print('psycopg2', psycopg2.__version__.split()[0])

def ping(dsn, label):
    conn = psycopg2.connect(**dsn)
    try:
        with conn.cursor() as cur:
            cur.execute('SELECT version()')
            print(f'✅ {label:<14}:', cur.fetchone()[0][:60])
    finally:
        conn.close()

ping(MS_DSN, 'metastore-db')
ping(GP_DSN, 'Greengage')
print(f'✅ {"ClickHouse":<14}:', ClickHouseClient(**CH_CONF).execute('SELECT version()')[0][0])
if PGMD_DSN:
    ping(PGMD_DSN, 'PG Metadata')
else:
    print('➖ PG Metadata  : пропущен (PGMD_HOST пуст)')

print('\n📁 каталог будет записан в', CATALOG_FILE)
print('   папка доступна на запись:', os.access(os.path.dirname(CATALOG_FILE), os.W_OK))
