#!/bin/sh
# PostToolUse hook (Edit|Write|NotebookEdit): eslint --fix + prettier on the
# just-edited file, the same pairing lint-staged runs in package.json.
# SessionEnd runs it with --stop-daemons to stop the daemons it starts.
command -v node >/dev/null 2>&1 || { [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; }

cd "$CLAUDE_PROJECT_DIR" || exit 0
[ -d node_modules ] || exit 0

# One run at a time talks to eslint_d and prettierd: their launches aren't
# atomic across processes (parallel starts orphan a daemon), and a prettierd
# stop fails any request in flight. A run re-executes itself under a kernel lock
# (lockf on macOS, flock on Linux), released even if the holder is killed. The
# lock lives outside node_modules, so a reinstall can't replace it mid-run.
if [ "$1" != --locked ]; then
  if [ "$1" != --stop-daemons ]; then
    f=$(jq -r '.tool_input.file_path // empty')
    [ -n "$f" ] && [ -f "$f" ] || exit 0
    # Gitignored files (build output, scratch) are skipped, as the prettier CLI does.
    git check-ignore -q -- "$f" && exit 0
    set -- "$f"
  fi
  lock="${TMPDIR:-/tmp}/format-daemons-$(printf %s "$PWD" | cksum | cut -d' ' -f1).lock"
  command -v lockf >/dev/null && exec lockf -ks "$lock" "$0" --locked "$@"
  command -v flock >/dev/null && exec flock "$lock" "$0" --locked "$@"
  set -- --locked "$@"
fi
shift

# eslint_d and prettierd keep their tools loaded between edits; a cold start
# costs seconds.
eslint_d() { node node_modules/eslint_d/bin/eslint_d.js "$@"; }
prettierd() { PRETTIERD_LOCAL_PRETTIER_ONLY=1 node node_modules/@fsouza/prettierd/bin/prettierd "$@"; }

if [ "$1" = --stop-daemons ]; then
  # prettierd has no idle timeout and never reloads prettier, so each session
  # starts fresh. Stopping is a no-op when neither is running.
  prettierd stop
  eslint_d stop
  exit 0
fi
f=$1

# prettierd prints errors to stdout, so only a successful, changed result is
# written back.
run_prettier() {
  # prettierd never reloads prettier, so an install newer than the last check
  # (npm rewrites node_modules/.package-lock.json on every install) stops it and
  # the next call starts it on the installed version.
  if [ node_modules/.package-lock.json -nt node_modules/.prettierd-lockfile-stamp ]; then
    prettierd stop >/dev/null &&
      touch -r node_modules/.package-lock.json node_modules/.prettierd-lockfile-stamp
  fi
  out=$(mktemp) || return
  trap 'rm -f "$out"' EXIT
  if prettierd "$1" <"$1" >"$out" && ! cmp -s "$out" "$1"; then
    cat "$out" >"$1"
  fi
}

case "$f" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs)
    eslint_d --fix "$f"
    run_prettier "$f"
    ;;
  *.json|*.md|*.css)
    run_prettier "$f"
    ;;
esac
