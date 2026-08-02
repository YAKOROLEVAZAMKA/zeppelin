# Zeppelin 0.12.1 sidebar navigation fix

Workaround for a bug in Apache Zeppelin **0.12.1**: clicking a different notebook
in the sidebar updates the URL, but the page content doesn't change — you have
to press F5 to actually see the new notebook.

## What's actually going on

This is [ZEPPELIN-6423](https://issues.apache.org/jira/browse/ZEPPELIN-6423).
In the newer Angular-based web UI, the Angular router reuses the same
`NotebookComponent` instance across `:noteId` route changes, so the component
never refetches the note when you switch via the sidebar. It was fixed
upstream in `branch-0.12` / `master` after the 0.12.1 release, but as of this
writing there's no released version (0.12.2 or later) that includes the fix.

**Once you're on a Zeppelin version that includes ZEPPELIN-6423, remove this
workaround** — it's no longer needed and you'll go back to smooth SPA
navigation instead of a full page reload.

## Scope

- Only applies to the **modern Angular UI** (`zeppelin-web-angular`), served
  at the root path with hash-based routes like `/#/notebook/<id>`.
- Does **not** apply to the classic AngularJS UI (served under `/classic`) —
  that UI isn't affected by this bug, and this script does nothing to it.

## How it works

`patch_angular.sh` runs once at container startup (before Zeppelin's Java
process starts) and injects a small `<script>` into `index.html` inside
`zeppelin-web-angular-0.12.1.war`. That script watches for the note ID in the
URL (`hashchange` / `pushState` / `replaceState` / `popstate`) to change, and
when it does, forces `window.location.reload()`.

It's not a real fix — the page still does a full reload instead of updating
in place — but it means you get correct content automatically instead of
having to remember to hit F5 yourself.

## Setup

1. Copy `patch_angular.sh` into your Zeppelin project directory.
2. **Make it executable on the host before mounting it:**
   ```bash
   chmod +x patch_angular.sh
   ```
   This matters because the container's startup command invokes the script
   directly (not via `bash script.sh`), and a `:ro` bind mount preserves
   whatever permission bit the file has on the host. If you skip this step,
   the container will fail to start with a "Permission denied" error on that
   line of the startup command.
3. Merge the `entrypoint`, `command`, and `volumes` entries from
   `docker-compose-example.yaml` into your own `docker-compose.yml` (see
   below).
4. **Keep the script LF-only.** If you edit it on Windows or paste it through
   a tool that can introduce CRLF line endings, the shebang line becomes
   `#!/bin/bash\r`, which breaks with `bad interpreter: No such file or
   directory`. If you hit that error, run:
   ```bash
   sed -i 's/\r$//' patch_angular.sh
   ```
5. Restart the container:
   ```bash
   docker compose down
   docker compose up -d
   ```
6. Verify it applied:
   ```bash
   docker logs zeppelin 2>&1 | grep patch_angular_router
   ```
   You should see either `patched /opt/zeppelin/zeppelin-web-angular-0.12.1.war`
   (first run) or `already patched` (subsequent runs against the same
   container). Note that `docker compose down` followed by `up` recreates the
   container from the image, so the war resets and you'll see `patched` again
   each time — that's expected.
7. Hard-refresh your browser (Ctrl+Shift+R) once to clear any cached old
   `index.html`, then test switching notebooks from the sidebar.

## Requirements

The script relies on the `jar` command (bundled with the JDK) being present
in the image to update the war file in place. The official
`apache/zeppelin:0.12.1` image includes this out of the box; if you're
building a custom/slimmed-down image without a JDK, this won't work as-is.

## Files

- `patch_angular.sh` — the actual patch script, run at container startup.
- `docker-compose-example.yaml` — shows the `entrypoint`, `command`, and
  `volumes` wiring needed to run the script before Zeppelin starts. Merge
  the relevant lines into your own compose file rather than using this file
  standalone.
