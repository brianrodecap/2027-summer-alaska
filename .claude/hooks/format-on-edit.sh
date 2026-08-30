#!/bin/sh
# PostToolUse hook (Edit|Write|NotebookEdit): eslint --fix + prettier --write
# on the just-edited file, mirroring the lint-staged pairing in package.json.
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"

cd "$CLAUDE_PROJECT_DIR" || exit 0

f=$(jq -r '.tool_input.file_path // empty')
[ -n "$f" ] && [ -f "$f" ] || exit 0

case "$f" in
  *.ts|*.tsx)
    npx eslint --fix "$f"
    npx prettier --write "$f"
    ;;
  *.json|*.md|*.css)
    npx prettier --write "$f"
    ;;
esac
