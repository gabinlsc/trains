#!/usr/bin/env bash
# Hook pre-commit : vérifie le formatage des seuls fichiers indexés.
set -Eeuo pipefail

mapfile -t files < <(git diff --cached --name-only --diff-filter=ACMR)
# Rien d'indexé (amend du seul message, commit vide) : rien à vérifier.
((${#files[@]} == 0)) && exit 0
exec pnpm exec prettier --check --ignore-unknown --no-error-on-unmatched-pattern "${files[@]}"
