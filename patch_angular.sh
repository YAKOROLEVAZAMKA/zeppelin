#!/bin/bash
set -e

WAR_FILE="/opt/zeppelin/zeppelin-web-angular-0.12.1.war"
MARKER="ZEPPELIN_ROUTER_RELOAD_PATCH"

if [ ! -f "$WAR_FILE" ]; then
  echo "[patch_angular_router] $WAR_FILE not found, skipping"
  exit 0
fi

if unzip -p "$WAR_FILE" index.html 2>/dev/null | grep -q "$MARKER"; then
  echo "[patch_angular_router] already patched"
  exit 0
fi

WORKDIR=$(mktemp -d)
unzip -q "$WAR_FILE" index.html -d "$WORKDIR"

PATCH='<script>/* ZEPPELIN_ROUTER_RELOAD_PATCH */(function(){function getNoteId(){var s=location.hash||location.pathname;var m=s.match(new RegExp("/notebook/([^/?#]+)"));return m?m[1]:null;}var lastNoteId=getNoteId();function check(){var cur=getNoteId();if(lastNoteId!==null\&\&cur!==null\&\&cur!==lastNoteId){window.location.reload();return;}lastNoteId=cur;}var ps=history.pushState;history.pushState=function(){ps.apply(this,arguments);setTimeout(check,0);};var rs=history.replaceState;history.replaceState=function(){rs.apply(this,arguments);setTimeout(check,0);};window.addEventListener("popstate",check);window.addEventListener("hashchange",check);})();</script>'

sed -i "s@</head>@${PATCH}</head>@" "$WORKDIR/index.html"

cd "$WORKDIR"
jar -uf "$WAR_FILE" index.html
cd - > /dev/null
rm -rf "$WORKDIR"

echo "[patch_angular_router] patched $WAR_FILE"
