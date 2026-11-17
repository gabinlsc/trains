#!/usr/bin/env bash
# Test de bout en bout de deploy.sh dans un conteneur Ubuntu 24.04 + systemd.
#
#   bash deploy/test/run.sh
#
# Scénario : premier déploiement, relance à l'identique (idempotence),
# mise à jour vers un nouveau commit, puis rollback. Le dépôt testé est le
# commit courant (HEAD), poussé dans un dépôt nu monté dans le conteneur.
set -Eeuo pipefail

ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
IMAGE=trains-deploy-test
CONTAINER=trains-deploy-test
WORK="$(mktemp -d)"
BRANCH=ci-deploy

cleanup() {
  local code=$?
  if ((code != 0)); then
    echo "::group::Diagnostic" >&2
    docker exec "$CONTAINER" journalctl -u trains -n 80 --no-pager >&2 || true
    docker exec "$CONTAINER" bash -c 'tail -n 80 /var/log/trains/deploy-*.log' >&2 || true
    echo "::endgroup::" >&2
  fi
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
  exit "$code"
}
trap cleanup EXIT

fail() {
  echo "ÉCHEC : $*" >&2
  exit 1
}

in_box() { docker exec "$CONTAINER" bash -c "$1"; }

deploy() {
  docker exec -e REPO_URL=/srv/repo.git -e BRANCH="$BRANCH" -e KEEP_RELEASES=3 \
    "$CONTAINER" bash /srv/deploy.sh --skip-ssl --skip-data --yes "$@"
}

fingerprint() {
  in_box 'sha256sum /etc/systemd/system/trains.service /etc/nginx/sites-available/trains.glsc.fr \
    /etc/nginx/conf.d/trains-ratelimit.conf /etc/trains/trains.env; readlink -f /opt/trains/current'
}

echo "▶ Préparation du dépôt de test"
git init --quiet --bare "$WORK/repo.git"
git -C "$ROOT" push --quiet "$WORK/repo.git" "HEAD:refs/heads/${BRANCH}"
cp "$ROOT/deploy.sh" "$WORK/deploy.sh"

echo "▶ Démarrage du conteneur systemd"
docker build --quiet -t "$IMAGE" "$ROOT/deploy/test" >/dev/null
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" --privileged --cgroupns=host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock \
  -v "$WORK/repo.git:/srv/repo.git" -v "$WORK/deploy.sh:/srv/deploy.sh:ro" \
  "$IMAGE" >/dev/null
for _ in $(seq 1 30); do
  state="$(docker exec "$CONTAINER" systemctl is-system-running 2>/dev/null || true)"
  [[ "$state" == running || "$state" == degraded ]] && break
  sleep 1
done
echo "  systemd : ${state:-inconnu}"

echo "▶ Premier déploiement"
deploy
first="$(fingerprint)"

echo "▶ Deuxième exécution (idempotence)"
deploy
second="$(fingerprint)"
[[ "$first" == "$second" ]] || fail "la deuxième exécution a modifié la configuration :
$(diff <(echo "$first") <(echo "$second") || true)"
[[ "$(in_box 'ls /opt/trains/releases | wc -l')" == 1 ]] || fail "une seule release attendue"
[[ "$(in_box 'ls /var/lib/trains/backups | wc -l')" == 0 ]] ||
  fail "aucune sauvegarde attendue sans changement de release"
[[ "$(in_box 'systemctl show trains -p NRestarts --value')" == 0 ]] || fail "redémarrages inattendus"
[[ "$(in_box 'grep -c ^SESSION_SECRET= /etc/trains/trains.env')" == 1 ]] ||
  fail "SESSION_SECRET dupliqué"
[[ "$(in_box 'stat -c %a:%U:%G /etc/trains/trains.env')" == "600:root:trains" ]] ||
  fail "droits du fichier d'environnement incorrects"

echo "▶ Vérifications du service"
in_box 'systemctl is-active --quiet trains' || fail "service inactif"
in_box 'systemctl show trains -p User --value' | grep -qx trains || fail "le service ne tourne pas en trains"
port="$(in_box 'sed -n "s/^PORT=//p" /etc/trains/trains.env')"
[[ "$port" == 3070 ]] || fail "port attendu 3070, obtenu ${port}"
health="$(in_box 'curl -fsS -H "Host: trains.glsc.fr" http://127.0.0.1/api/health')"
[[ "$health" == *'"status":"degraded"'* ]] || fail "santé inattendue : ${health}"
headers="$(in_box 'curl -fsSI -H "Host: trains.glsc.fr" http://127.0.0.1/')"
grep -qi "^content-security-policy: default-src 'self'" <<<"$headers" || fail "CSP absente sur /"
[[ "$(grep -ci '^content-security-policy' <<<"$headers")" == 1 ]] || fail "CSP en double"
in_box 'curl -fsS -H "Host: trains.glsc.fr" http://127.0.0.1/une/route/spa' | grep -q '<div id="app">' ||
  fail "fallback SPA absent"
in_box 'nginx -t 2>/dev/null' || fail "configuration Nginx invalide"
worker="$(in_box 'ls /opt/trains/current/apps/web/dist/assets/ | grep -m1 "\.mjs$"' || true)"
if [[ -n "$worker" ]]; then
  in_box "curl -fsSI -H 'Host: trains.glsc.fr' http://127.0.0.1/assets/${worker}" |
    grep -qi '^content-type: text/javascript' || fail "worker .mjs servi avec un mauvais type MIME"
fi
deploy --status >/dev/null || fail "--status en échec"

echo "▶ Données publiées"
# Génération factice : vérifie la chaîne complète (droits, Nginx, santé).
in_box 'install -d -o trains -g trains /var/lib/trains/data/2026.01.1 &&
  echo "{\"dataVersion\":\"2026.01.1\",\"generatedAt\":\"2026-01-01T00:00:00.000Z\",\"sources\":[],\"outputs\":[]}" \
    >/var/lib/trains/data/2026.01.1/manifest.json &&
  ln -sfn 2026.01.1 /var/lib/trains/data/current && touch /var/lib/trains/data/.lock'
data_headers="$(in_box 'curl -fsSI -H "Host: trains.glsc.fr" http://127.0.0.1/data/current/manifest.json')"
grep -qi '^cache-control: no-cache' <<<"$data_headers" || fail "manifeste courant mis en cache"
grep -qi '^content-type: application/json' <<<"$data_headers" || fail "type MIME du manifeste"
in_box 'curl -fsSI -H "Host: trains.glsc.fr" http://127.0.0.1/data/2026.01.1/manifest.json' |
  grep -qi 'immutable' || fail "données versionnées sans cache permanent"
[[ "$(in_box 'curl -s -o /dev/null -w "%{http_code}" -H "Host: trains.glsc.fr" http://127.0.0.1/data/.lock')" == 404 ]] ||
  fail "fichier caché servi"
in_box 'curl -fsS http://127.0.0.1:3070/api/health' | grep -q '"data":{"status":"ok","version":"2026.01.1"}' ||
  fail "la santé ne voit pas les données publiées"

echo "▶ Mise à jour vers un nouveau commit"
git clone --quiet --branch "$BRANCH" "$WORK/repo.git" "$WORK/clone"
git -C "$WORK/clone" -c user.name=test -c user.email=test@example.invalid \
  commit --quiet --allow-empty -m "test: commit de mise à jour"
git -C "$WORK/clone" push --quiet origin "$BRANCH"
new_sha="$(git -C "$WORK/clone" rev-parse --short=7 HEAD)"
deploy
[[ "$(in_box 'ls /opt/trains/releases | wc -l')" == 2 ]] || fail "deux releases attendues"
in_box 'curl -fsS http://127.0.0.1:3070/api/health' | grep -q "\"commit\":\"${new_sha}\"" ||
  fail "la nouvelle release n'est pas servie"

echo "▶ Release défectueuse : rollback automatique"
before="$(in_box 'readlink -f /opt/trains/current')"
printf '\nprocess.exit(1);\n' >>"$WORK/clone/apps/server/src/main.ts"
git -C "$WORK/clone" -c user.name=test -c user.email=test@example.invalid \
  commit --quiet -am "test: release qui plante au démarrage"
git -C "$WORK/clone" push --quiet origin "$BRANCH"
if deploy >"$WORK/broken.log" 2>&1; then fail "le déploiement d'une release défectueuse aurait dû échouer"; fi
grep -q 'Rollback automatique' "$WORK/broken.log" || fail "rollback automatique absent"
grep -q 'Release précédente rétablie' "$WORK/broken.log" || fail "release précédente non rétablie"
[[ "$(in_box 'readlink -f /opt/trains/current')" == "$before" ]] ||
  fail "current ne pointe pas sur la release saine"
in_box 'curl -fsS http://127.0.0.1:3070/api/health' | grep -q "\"commit\":\"${new_sha}\"" ||
  fail "la release saine ne répond plus"

echo "▶ Rollback"
deploy --rollback
[[ "$(in_box 'readlink -f /opt/trains/current')" == "$(echo "$first" | tail -1)" ]] ||
  fail "le rollback n'est pas revenu à la première release"
in_box 'curl -fsS http://127.0.0.1:3070/api/health' | grep -q '"database":{"status":"ok"' ||
  fail "service KO après rollback"

echo "✔ deploy.sh validé : installation, idempotence, mise à jour et rollback."
