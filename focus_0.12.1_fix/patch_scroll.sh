#!/bin/bash
# =============================================================================
# patch_scroll.sh
#
# Stops the Zeppelin "new UI" (Angular) from dragging the viewport around when
# a paragraph takes focus:
#
#   1. clicking "Run paragraph" (or anywhere in a paragraph) no longer snaps the
#      paragraph's top edge to the top of the window;
#   2. clicking paragraph A while paragraph B's editor has focus no longer lets
#      B grab the focus - and the scroll position - back.
#
# Injects a <script> into index.html inside the packaged WAR. Idempotent.
# =============================================================================
set -euo pipefail

LOG_TAG="[patch_scroll]"
MARKER="ZEPPELIN_PARAGRAPH_FOCUS_PATCH_V2"
SUPERSEDED="ZEPPELIN_NO_SCROLL_ON_FOCUS_PATCH"
WAR_FILE=$(ls -1 /opt/zeppelin/zeppelin-web-angular-*.war 2>/dev/null | head -n1 || true)

if [ -z "${WAR_FILE}" ] || [ ! -f "${WAR_FILE}" ]; then
  echo "${LOG_TAG} no /opt/zeppelin/zeppelin-web-angular-*.war found, skipping"
  exit 0
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "${WORKDIR}"' EXIT

unzip -q -o "${WAR_FILE}" index.html -d "${WORKDIR}" 2>/dev/null || true
if [ ! -f "${WORKDIR}/index.html" ]; then
  echo "${LOG_TAG} index.html not found inside ${WAR_FILE}, skipping"
  exit 0
fi

if grep -q "${MARKER}" "${WORKDIR}/index.html"; then
  echo "${LOG_TAG} ${MARKER}: already present"
  exit 0
fi

if grep -q "${SUPERSEDED}" "${WORKDIR}/index.html"; then
  echo "${LOG_TAG} note: superseded ${SUPERSEDED} found in this WAR."
  echo "${LOG_TAG} it stays harmless (the new patch wraps it), but recreating the"
  echo "${LOG_TAG} container gives a clean WAR: docker compose up -d --force-recreate zeppelin"
fi

# -----------------------------------------------------------------------------
# Why this is needed
#
# zeppelin-web-angular puts tabindex="-1" on the <zeppelin-notebook-paragraph>
# host and calls host.focus() from two places in paragraph.component.ts:
#   - blurEditor(),  when the code editor loses focus;
#   - ngOnChanges(), when the paragraph becomes the selected one.
#
# HTMLElement.focus() scrolls the target into view using Blink's "center if
# needed" alignment: a partially visible element is pulled to the closest edge,
# so a paragraph taller than the viewport gets its top snapped to the top of the
# window. And because blurEditor() fires while the browser is still moving focus
# to whatever you clicked, the paragraph you just left takes focus back and drags
# the viewport with it.
#
# NB: Element.scrollIntoViewIfNeeded() cannot be used as the "safe" replacement -
# it shares that same "center if needed" alignment and reproduces the jump.
# -----------------------------------------------------------------------------
cat > "${WORKDIR}/inject.html" <<'PATCH_EOF'
<script>/* ZEPPELIN_PARAGRAPH_FOCUS_PATCH_V2 */
(function () {
  var PARAGRAPH_TAG = "ZEPPELIN-NOTEBOOK-PARAGRAPH";
  var POINTER_WINDOW_MS = 400;

  var currentFocus = HTMLElement.prototype.focus;
  if (!currentFocus || currentFocus.__zeppelinParagraphFocusPatch) { return; }

  // Remember which paragraph the user last pressed on. We resolve the paragraph
  // host at press time rather than keeping the raw event target, because that
  // target is often detached straight afterwards (the play icon is swapped for
  // the pause icon as soon as a paragraph starts running).
  var lastPressedHost = null;
  var lastPressedAt = 0;

  function paragraphHostOf(node) {
    while (node && node.nodeType === 1) {
      if (node.tagName === PARAGRAPH_TAG) { return node; }
      node = node.parentNode;
    }
    return null;
  }

  function rememberPress(event) {
    lastPressedHost = paragraphHostOf(event.target);
    lastPressedAt = Date.now();
  }

  document.addEventListener("mousedown", rememberPress, true);
  document.addEventListener("pointerdown", rememberPress, true);

  // True only when the user just pressed inside a DIFFERENT paragraph. Presses
  // outside any paragraph (toolbar, sidebar) are left alone, so this changes
  // nothing beyond the paragraph-to-paragraph case.
  function pressedAnotherParagraph(host) {
    if (!lastPressedHost || lastPressedHost === host) { return false; }
    return Date.now() - lastPressedAt <= POINTER_WINDOW_MS;
  }

  function isOnScreen(el) {
    var rect = el.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var vw = window.innerWidth || document.documentElement.clientWidth;
    return rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw;
  }

  function patchedFocus(options) {
    if (this.tagName !== PARAGRAPH_TAG) {
      return currentFocus.apply(this, arguments);
    }
    // (2) the user is clicking into another paragraph - do not take focus back
    if (pressedAnotherParagraph(this)) {
      return;
    }
    // caller made its own decision about scrolling - respect it
    if (options && "preventScroll" in options) {
      return currentFocus.apply(this, arguments);
    }
    // (1) focus without the implicit scroll; move the viewport only when the
    // paragraph is entirely off screen, matching what focus() would have done
    // there, so keyboard navigation between paragraphs is unchanged.
    var visible = isOnScreen(this);
    currentFocus.call(this, { preventScroll: true });
    if (!visible) {
      try {
        this.scrollIntoView({ block: "center" });
      } catch (e) {
        this.scrollIntoView();
      }
    }
  }

  patchedFocus.__zeppelinParagraphFocusPatch = true;
  HTMLElement.prototype.focus = patchedFocus;
})();
</script>
PATCH_EOF

# -----------------------------------------------------------------------------
# Insert before </head>. awk + getline copies the payload literally, so nothing
# in the JavaScript needs shell or sed escaping.
# -----------------------------------------------------------------------------
awk -v insfile="${WORKDIR}/inject.html" '
  !inserted {
    n = index($0, "</head>")
    if (n > 0) {
      printf "%s", substr($0, 1, n - 1)
      while ((getline line < insfile) > 0) { printf "%s\n", line }
      printf "%s\n", substr($0, n)
      inserted = 1
      next
    }
  }
  { print }
' "${WORKDIR}/index.html" > "${WORKDIR}/index.html.new"

if ! grep -q "${MARKER}" "${WORKDIR}/index.html.new"; then
  echo "${LOG_TAG} ERROR: could not inject ${MARKER} (no </head>?), ${WAR_FILE} left untouched"
  exit 0
fi

mv "${WORKDIR}/index.html.new" "${WORKDIR}/index.html"

if command -v jar >/dev/null 2>&1; then
  (cd "${WORKDIR}" && jar -uf "${WAR_FILE}" index.html)
elif command -v zip >/dev/null 2>&1; then
  (cd "${WORKDIR}" && zip -q "${WAR_FILE}" index.html)
else
  echo "${LOG_TAG} ERROR: neither jar nor zip available, ${WAR_FILE} left untouched"
  exit 0
fi

echo "${LOG_TAG} applied ${MARKER} -> ${WAR_FILE}"
