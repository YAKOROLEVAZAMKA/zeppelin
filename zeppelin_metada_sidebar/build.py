#!/usr/bin/env python3
"""
Пересобирает артефакты из исходников. Нужен, только если вы правите код.
Для установки и работы метастора запускать НЕ требуется.

    python3 build.py

Что собирается:

    src/sidebar_core.js  ─┐
                          ├─▶  metastore/web/zeppelin-metastore.js   (панель)
    src/integration.js   ─┘

    note/p0*.py, note/p0*.md ──▶  00_metastore_catalog.zpln          (ноут)

Проверки перед сборкой: питоновский код параграфов проходит ast.parse,
JS-файлы существуют, магия параграфов совпадает с типом.
"""
import ast
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# ─────────────────────────────── панель ──────────────────────────────────────

JS_HEADER = """/*!
 * zeppelin-metastore.js — боковая панель метаданных хранилища для Apache Zeppelin
 * Подключается через zeppelin.server.html.body.addon. Работает и в classic UI, и в новом UI.
 * Зависимостей нет. Сборка: sidebar_core.js + integration.js
 */
"""

JS_SOURCES = ["src/sidebar_core.js", "src/integration.js"]
JS_OUT = "metastore/web/zeppelin-metastore.js"


def build_js():
    parts = []
    for rel in JS_SOURCES:
        path = os.path.join(HERE, rel)
        if not os.path.exists(path):
            sys.exit(f"нет файла {rel}")
        parts.append(open(path, encoding="utf-8").read())

    bundle = JS_HEADER + "\n".join(parts)
    out = os.path.join(HERE, JS_OUT)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(bundle)
    print(f"✅ {JS_OUT} — {len(bundle) / 1024:.0f} КБ "
          f"({' + '.join(os.path.basename(s) for s in JS_SOURCES)})")


# ──────────────────────────────── ноут ───────────────────────────────────────

NOTE_ID = "2METASTORE1"
NOTE_NAME = "/00. Metastore/00. Metastore Catalog"
NOTE_OUT = "00_metastore_catalog.zpln"

PARAGRAPHS = [
    ("p01_intro.md",    "Что это такое",                 "md"),
    ("p02_config.py",   "1. Конфигурация и подключения", "python"),
    ("p03_ddl.py",      "2. DDL — таблицы каталога",     "python"),
    ("p04_collect.py",  "3. load_catalog_data() — сбор", "python"),
    ("p05_describe.py", "4. Описания",                   "python"),
    ("p06_cron.md",     "5. Расписание",                 "md"),
]


def paragraph(idx, text, title, lang):
    return {
        "title": title,
        "text": text.rstrip() + "\n",
        "user": "anonymous",
        "dateUpdated": "2026-08-07T12:00:00+0000",
        "progress": 0,
        "config": {
            "colWidth": 12.0,
            "fontSize": 9.0,
            "enabled": True,
            "results": {},
            "editorSetting": {
                "language": lang,
                "editOnDblClick": lang == "md",
                "completionKey": "TAB",
                "completionSupport": lang == "python",
            },
            "editorMode": f"ace/mode/{'markdown' if lang == 'md' else 'python'}",
            "editorHide": lang == "md",
            "tableHide": False,
        },
        "settings": {"params": {}, "forms": {}},
        "apps": [],
        "runtimeInfos": {},
        "progressUpdateIntervalMs": 500,
        "jobName": f"paragraph_metastore_{idx:02d}",
        "id": f"paragraph_metastore_{idx:02d}",
        "dateCreated": "2026-08-07T12:00:00+0000",
        "status": "READY",
    }


def build_note():
    paras = []
    for i, (fname, title, lang) in enumerate(PARAGRAPHS, start=1):
        path = os.path.join(HERE, "note", fname)
        if not os.path.exists(path):
            sys.exit(f"нет файла note/{fname}")
        text = open(path, encoding="utf-8").read()

        magic = text.split("\n", 1)[0].strip()
        expected = "%md" if lang == "md" else "%python"
        if magic != expected:
            sys.exit(f"note/{fname}: ожидалась магия {expected}, а там {magic!r}")

        if lang == "python":                    # синтаксис проверяем до упаковки
            try:
                ast.parse(text.split("\n", 1)[1], filename=fname)
            except SyntaxError as exc:
                sys.exit(f"note/{fname}: синтаксическая ошибка в строке {exc.lineno}: {exc.msg}")

        paras.append(paragraph(i, text, title, lang))

    note = {
        "paragraphs": paras,
        "name": NOTE_NAME,
        "id": NOTE_ID,
        "defaultInterpreterGroup": "python",
        "version": "0.12.1",
        "noteParams": {},
        "noteForms": {},
        "angularObjects": {},
        "config": {
            "isZeppelinNotebookCronEnable": True,
            "looknfeel": "default",
            "personalizedMode": "false",
        },
        "info": {},
    }

    out = os.path.join(HERE, NOTE_OUT)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(note, fh, ensure_ascii=False, indent=2)
    print(f"✅ {NOTE_OUT} — {len(paras)} параграфов, "
          f"{os.path.getsize(out) / 1024:.0f} КБ")


# ───────────────────────── проверка zeppelin-site.xml ────────────────────────

SITE_XML = "zeppelin-data/conf/zeppelin-site.xml"


def check_site_xml():
    """IndexHtmlServlet отдаёт index.html так:

        resp.setContentType("text/html");   // без charset
        resp.getWriter().append(content);   // setCharacterEncoding не вызывается

    getWriter() без явной кодировки по спецификации сервлетов работает
    в ISO-8859-1, поэтому любой не-ASCII символ внутри body.addon уедет
    в страницу битым. Ловим это здесь, а не на проде.
    """
    import re
    import xml.dom.minidom

    path = os.path.join(HERE, SITE_XML)
    if not os.path.exists(path):
        print(f"➖ {SITE_XML} нет рядом — проверку пропускаю")
        return

    try:
        xml.dom.minidom.parse(path)
    except Exception as exc:
        sys.exit(f"{SITE_XML}: не парсится — {exc}")

    raw = open(path, encoding="utf-8").read()
    m = re.search(r"body\.addon</name>\s*<value><!\[CDATA\[(.*?)\]\]></value>", raw, re.S)
    if not m:
        print(f"➖ {SITE_XML}: свойства body.addon нет — панель выключена")
        return

    addon = m.group(1)
    bad = sorted({c for c in addon if ord(c) > 127})
    if bad:
        sys.exit(f"{SITE_XML}: в CDATA body.addon не-ASCII символы {bad!r}.\n"
                 f"    Zeppelin отдаёт index.html через getWriter() в ISO-8859-1 — "
                 f"они уедут в страницу битыми.\n"
                 f"    Комментарии на русском пишите вне <value>: в XML-комментарии "
                 f"или в <description>.")

    if "]]>" in addon:
        sys.exit(f"{SITE_XML}: в CDATA встретилось ']]>' — секция оборвётся раньше времени")

    print(f"✅ {SITE_XML} — валиден, body.addon {len(addon)} символов, чистый ASCII")


if __name__ == "__main__":
    build_js()
    build_note()
    check_site_xml()
    print("\nГотово. Панель обновится у аналитиков после перезагрузки страницы "
          "(nginx отдаёт файл с no-cache).\nНоут нужно переимпортировать в Zeppelin.")
