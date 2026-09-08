#!/bin/sh
# PostToolUse hook (Edit|Write|NotebookEdit): eslint --fix + prettier --write
# on the just-edited file, mirroring the lint-staged pairing in package.json.
command -v node >/dev/null 2>&1 || { [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; }

cd "$CLAUDE_PROJECT_DIR" || exit 0

f=$(jq -r '.tool_input.file_path // empty')
[ -n "$f" ] && [ -f "$f" ] || exit 0

run_prettier() { node node_modules/prettier/bin/prettier.cjs --write "$1"; }

case "$f" in
  *.ts|*.tsx)
    node node_modules/eslint/bin/eslint.js --fix "$f"
    run_prettier "$f"
    ;;
  *.json|*.md|*.css)
    run_prettier "$f"
    ;;
esac
