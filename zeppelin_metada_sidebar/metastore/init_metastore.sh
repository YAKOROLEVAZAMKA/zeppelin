#!/usr/bin/env bash
# Готовит окружение для ноута каталога: ставит питоновские зависимости в volume,
# чтобы они пережили пересоздание контейнера. Идемпотентно.
set -u

LIBS=/metastore/pylibs
WEB=/metastore/web

mkdir -p "$LIBS" "$WEB" 2>/dev/null || true

if python3 -c "import sys; sys.path.insert(0, '$LIBS'); import psycopg2, clickhouse_driver" 2>/dev/null; then
    echo "[metastore] python-зависимости на месте"
else
    echo "[metastore] ставлю psycopg2-binary и clickhouse-driver в $LIBS ..."
    ARGS=""
    [ -n "${PIP_INDEX_URL:-}" ]    && ARGS="$ARGS --index-url ${PIP_INDEX_URL}"
    [ -n "${PIP_TRUSTED_HOST:-}" ] && ARGS="$ARGS --trusted-host ${PIP_TRUSTED_HOST}"
    # shellcheck disable=SC2086
    if pip install --no-cache-dir --target="$LIBS" $ARGS psycopg2-binary clickhouse-driver; then
        echo "[metastore] зависимости установлены"
    else
        echo "[metastore] ВНИМАНИЕ: pip не отработал."
        echo "[metastore] Если нет выхода в PyPI — см. README, раздел «Нет доступа к PyPI»."
    fi
fi

echo "[metastore] файлов в $WEB: $(ls -1 "$WEB" 2>/dev/null | wc -l)"
