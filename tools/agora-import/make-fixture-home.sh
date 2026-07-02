#!/bin/sh
# Create an isolated HOME containing a small sample of local Claude/Codex
# session logs, preserving the directory shape expected by agora-import.
set -eu

limit=${AGORA_FIXTURE_LIMIT:-50}
source_home=${SOURCE_HOME:-${HOME:-}}

case "${limit}" in
  ''|*[!0-9]*)
    printf '[Agora] AGORA_FIXTURE_LIMIT must be a positive integer.\n' >&2
    exit 1
    ;;
esac
if [ "${limit}" -lt 1 ]; then
  printf '[Agora] AGORA_FIXTURE_LIMIT must be at least 1.\n' >&2
  exit 1
fi
if [ -z "${source_home}" ] || [ ! -d "${source_home}" ]; then
  printf '[Agora] SOURCE_HOME/HOME is not a readable directory.\n' >&2
  exit 1
fi

if [ "${1:-}" ]; then
  fixture_home=$1
  mkdir -p "${fixture_home}"
else
  fixture_home=$(mktemp -d "${TMPDIR:-/tmp}/agora-upload-home.XXXXXX")
fi

list_file=$(mktemp "${TMPDIR:-/tmp}/agora-upload-list.XXXXXX")
trap 'rm -f "${list_file}"' EXIT INT TERM HUP

for rel in ".claude/projects" ".codex/sessions"; do
  root="${source_home}/${rel}"
  if [ -d "${root}" ]; then
    find "${root}" -type f -name '*.jsonl' -size +0c | sort >>"${list_file}"
  fi
done

count=0
while IFS= read -r src; do
  if [ "${count}" -ge "${limit}" ]; then
    break
  fi
  rel=${src#"${source_home}/"}
  dst="${fixture_home}/${rel}"
  mkdir -p "$(dirname "${dst}")"
  cp "${src}" "${dst}"
  count=$((count + 1))
done <"${list_file}"

quote() {
  printf "'"
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}

printf '[Agora] Created isolated HOME with %s session file(s): %s\n' "${count}" "${fixture_home}" >&2
if [ "${count}" -eq 0 ]; then
  printf '[Agora] No non-empty .jsonl sessions were found under %s/.claude/projects or %s/.codex/sessions.\n' "${source_home}" "${source_home}" >&2
  exit 1
fi

printf '\n'
printf 'Run local binary test:\n'
printf '  cd tools/agora-import && HOME='
quote "${fixture_home}"
printf ' AGORA_SESSION_LIMIT=%s AGORA_BASE=... AGORA_PAIR_ID=... AGORA_CODE=... go run .\n' "${limit}"
printf '\n'
printf 'Run downloaded connect command against the fixture:\n'
printf '  curl ... | HOME='
quote "${fixture_home}"
printf ' AGORA_SESSION_LIMIT=%s sh\n' "${limit}"
