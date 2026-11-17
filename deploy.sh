#!/usr/bin/env bash
# Déploiement de Rails de France sur un serveur Ubuntu/Debian.
#
#   sudo bash deploy.sh [options]
#
# Premier déploiement comme mises à jour, idempotent. Peut être lancé depuis
# le dépôt ou seul (téléchargé) : il clone alors lui-même le dépôt.
# Voir docs/DEPLOIEMENT.md.
set -Eeuo pipefail
shopt -s nullglob
# Bash ≥ 5.2 : « & » dans un remplacement ${x//a/b} ne doit pas valoir le motif.
shopt -u patsub_replacement 2>/dev/null || true

# ---------------------------------------------------------------------------
# Configuration (surchargeable par /etc/trains/deploy.conf puis par
# l'environnement : `DOMAIN=… sudo -E bash deploy.sh`).
# ---------------------------------------------------------------------------
DEFAULTS=(
  DOMAIN=trains.glsc.fr
  REPO_URL=https://github.com/gabinlsc/trains.git
  BRANCH=main
  APP_USER=trains
  APP_DIR=/opt/trains
  DATA_DIR=/var/lib/trains
  PORT=          # vide : premier port libre à partir de 3070
  CERTBOT_EMAIL= # requis pour obtenir un certificat
  KEEP_RELEASES=5
  LOG_DIR=/var/log/trains
  ENV_FILE=/etc/trains/trains.env
  NODE_MAJOR=22
  ASSUME_YES=0
)

CONF_FILE=/etc/trains/deploy.conf
FIRST_PORT=3070
MIN_FREE_GB=5
BACKUPS_TO_KEEP=14
SERVICE=trains

SKIP_SSL=0
SKIP_DATA=0
ACTION=deploy

# État partagé entre les étapes.
CURRENT_STEP="initialisation"
DNS_OK=0
RELEASE_DIR=""
PREVIOUS_RELEASE=""
RELEASE_CHANGED=1
TARGET_SHA=""
NODE_BIN=""
SCRIPT_SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Journalisation
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m' C_DIM=$'\033[2m' C_BLUE=$'\033[34m' C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m' C_RED=$'\033[31m' C_BOLD=$'\033[1m'
else
  C_RESET='' C_DIM='' C_BLUE='' C_GREEN='' C_YELLOW='' C_RED='' C_BOLD=''
fi

_log() { printf '%s%s%s %s%s%s\n' "$C_DIM" "$(date '+%F %T')" "$C_RESET" "$1" "$2" "$C_RESET"; }
info() { _log "$C_BLUE" "$*"; }
ok() { _log "$C_GREEN" "✔ $*"; }
warn() { _log "$C_YELLOW" "⚠ $*" >&2; }
die() {
  _log "$C_RED" "✖ $*" >&2
  exit 1
}
step() {
  CURRENT_STEP="$1"
  _log "$C_BOLD" "▶ $1"
}

on_error() {
  local code=$1 line=$2 cmd=$3
  _log "$C_RED" "✖ Échec à l'étape « ${CURRENT_STEP} », ligne ${line} (code ${code}) : ${cmd}" >&2
  [[ -n "${LOG_FILE:-}" ]] && _log "$C_RED" "  Journal complet : ${LOG_FILE}" >&2
  exit "$code"
}
trap 'on_error $? $LINENO "$BASH_COMMAND"' ERR

usage() {
  cat <<'USAGE'
Usage : sudo bash deploy.sh [options]

Options :
  --skip-ssl    ne pas demander ni renouveler de certificat HTTPS
  --skip-data   ne pas générer les données ni télécharger le fond de carte
  --rollback    revenir à la release précédente
  --status      afficher l'état du service et de la release courante
  --yes         répondre oui aux confirmations (exécution non interactive)
  --help        afficher cette aide

Configuration : variables en tête du script, /etc/trains/deploy.conf,
puis variables d'environnement (DOMAIN, REPO_URL, BRANCH, APP_USER,
APP_DIR, DATA_DIR, PORT, CERTBOT_EMAIL, KEEP_RELEASES).
USAGE
}

parse_args() {
  while (($# > 0)); do
    case "$1" in
      --skip-ssl) SKIP_SSL=1 ;;
      --skip-data) SKIP_DATA=1 ;;
      --rollback) ACTION=rollback ;;
      --status) ACTION=status ;;
      --yes | -y) ASSUME_YES=1 ;;
      --help | -h)
        usage
        exit 0
        ;;
      *)
        usage >&2
        die "Option inconnue : $1"
        ;;
    esac
    shift
  done
}

# L'environnement l'emporte sur deploy.conf, qui l'emporte sur les défauts.
load_config() {
  local entry var
  local -A from_env=()
  for entry in "${DEFAULTS[@]}"; do
    var="${entry%%=*}"
    if [[ -n "${!var+x}" ]]; then from_env[$var]="${!var}"; fi
  done
  if [[ -f "$CONF_FILE" ]]; then
    # shellcheck source=/dev/null
    source "$CONF_FILE"
  fi
  for var in "${!from_env[@]}"; do printf -v "$var" '%s' "${from_env[$var]}"; done
  for entry in "${DEFAULTS[@]}"; do
    var="${entry%%=*}"
    if [[ -z "${!var+x}" ]]; then printf -v "$var" '%s' "${entry#*=}"; fi
  done
  if ! [[ "$KEEP_RELEASES" =~ ^[0-9]+$ ]] || ((KEEP_RELEASES < 2)); then
    die "KEEP_RELEASES doit être un entier ≥ 2 (rollback)."
  fi
  [[ -z "$PORT" || "$PORT" =~ ^[0-9]+$ ]] || die "PORT invalide : $PORT"
}

setup_logging() {
  mkdir -p "$LOG_DIR"
  chmod 750 "$LOG_DIR"
  LOG_FILE="${LOG_DIR}/deploy-$(date +%Y%m%d-%H%M%S).log"
  # Copie de toute la sortie dans le journal, sans les codes couleur.
  exec > >(tee >(sed -u $'s/\033\\[[0-9;]*m//g' >>"$LOG_FILE")) 2>&1
  info "Journal : ${LOG_FILE}"
}

confirm() {
  local prompt=$1 answer
  if [[ "$ASSUME_YES" == 1 ]]; then return 0; fi
  if [[ ! -t 0 ]]; then
    die "Confirmation requise (« ${prompt} ») : relancer avec --yes ou en interactif."
  fi
  read -r -p "${prompt} [o/N] " answer
  [[ "$answer" =~ ^[oOyY]$ ]]
}

as_app() {
  runuser -u "$APP_USER" -- env HOME="/home/${APP_USER}" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    GIT_TERMINAL_PROMPT=0 "$@"
}

# ---------------------------------------------------------------------------
# 1. Pré-vérifications
# ---------------------------------------------------------------------------
preflight() {
  step "Pré-vérifications"
  ((EUID == 0)) || die "Ce script doit être lancé en root : sudo bash deploy.sh"

  [[ -r /etc/os-release ]] || die "/etc/os-release introuvable : système non pris en charge."
  local os_id os_like os_name
  os_id="$(os_release_field ID)"
  os_like="$(os_release_field ID_LIKE)"
  os_name="$(os_release_field PRETTY_NAME)"
  [[ "$os_id" == ubuntu || "$os_id" == debian || "$os_like" == *debian* ]] ||
    die "Système non pris en charge (${os_name}) : Ubuntu ou Debian requis."
  ok "Système : ${os_name}"

  local free_gb
  free_gb="$(df -BG --output=avail / | tail -1 | tr -dc '0-9')"
  if ((free_gb < MIN_FREE_GB)); then
    warn "Seulement ${free_gb} Go libres sur / (recommandé : ${MIN_FREE_GB} Go)."
  else
    ok "Espace disque : ${free_gb} Go libres"
  fi

  check_dns
}

os_release_field() {
  sed -n "s/^$1=//p" /etc/os-release | tr -d '"' | head -1
}

check_dns() {
  local resolved public_ip
  resolved="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR == 1 { print $1 }' || true)"
  public_ip="$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null ||
    curl -4 -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true)"
  if [[ -z "$resolved" ]]; then
    local target="${public_ip:-}"
    [[ -n "$target" ]] || target="l'IP du serveur"
    warn "${DOMAIN} ne se résout pas. Créer un enregistrement A vers ${target}."
    warn "HTTPS sera ignoré pour ce déploiement."
  elif [[ -z "$public_ip" ]]; then
    warn "IP publique indéterminable : impossible de vérifier le DNS, HTTPS ignoré."
  elif [[ "$resolved" != "$public_ip" ]]; then
    warn "${DOMAIN} pointe vers ${resolved}, mais ce serveur sort avec l'IP ${public_ip}."
    warn "HTTPS sera ignoré tant que le DNS ne correspond pas."
  else
    DNS_OK=1
    ok "DNS : ${DOMAIN} → ${resolved}"
  fi
}

# ---------------------------------------------------------------------------
# 2. Dépendances système
# ---------------------------------------------------------------------------
APT_UPDATED=0
apt_install() {
  local missing=() pkg
  for pkg in "$@"; do
    [[ "$(dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null || true)" == 'install ok installed' ]] ||
      missing+=("$pkg")
  done
  ((${#missing[@]} == 0)) && return 0
  info "Installation : ${missing[*]}"
  if ((APT_UPDATED == 0)); then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    APT_UPDATED=1
  fi
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${missing[@]}"
}

install_dependencies() {
  step "Dépendances système"
  apt_install git curl ca-certificates gnupg openssl build-essential python3 sqlite3 nginx \
    certbot python3-certbot-nginx iproute2 tar
  ok "Paquets système présents"
  install_node
}

install_node() {
  local current_major=0 version=''
  if command -v node >/dev/null 2>&1; then
    version="$(node --version)"
    current_major="${version#v}"
    current_major="${current_major%%.*}"
  fi

  if ((current_major >= NODE_MAJOR)); then
    ok "Node.js ${version} déjà présent"
  else
    if ((current_major > 0)); then
      warn "Node.js ${version} est installé et sera remplacé par Node.js ${NODE_MAJOR}."
      warn "D'autres applications de ce serveur peuvent en dépendre. Services repérés :"
      list_node_consumers >&2
      confirm "Remplacer Node.js ${version} par Node.js ${NODE_MAJOR} ?" ||
        die "Abandon : Node.js ${NODE_MAJOR} est requis. Voir docs/DEPLOIEMENT.md."
    fi
    info "Installation de Node.js ${NODE_MAJOR} (dépôt NodeSource)"
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
      gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
      >/etc/apt/sources.list.d/nodesource.list
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
    ok "Node.js $(node --version) installé"
  fi
  NODE_BIN="$(command -v node)"

  if ! command -v corepack >/dev/null 2>&1; then
    npm install -g --silent corepack
  fi
  corepack enable
  ok "pnpm disponible via corepack"
}

list_node_consumers() {
  local found=0 unit
  for unit in /etc/systemd/system/*.service /lib/systemd/system/*.service; do
    if grep -qE '(^|[/ ])(node|npm|pnpm|yarn|pm2)( |$)' "$unit" 2>/dev/null; then
      printf '    - %s\n' "$(basename "$unit")"
      found=1
    fi
  done
  if command -v pm2 >/dev/null 2>&1; then
    printf '    - processus pm2 (vérifier « pm2 list »)\n'
    found=1
  fi
  ((found == 1)) || printf '    (aucun service systemd utilisant Node.js détecté)\n'
}

# ---------------------------------------------------------------------------
# 3. Utilisateur système et arborescence
# ---------------------------------------------------------------------------
setup_user() {
  step "Utilisateur système et répertoires"
  if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "/home/${APP_USER}" --shell /usr/sbin/nologin \
      --user-group "$APP_USER"
    ok "Utilisateur ${APP_USER} créé"
  fi
  install -d -m 0755 -o "$APP_USER" -g "$APP_USER" "$APP_DIR" "$APP_DIR/releases"
  install -d -m 0750 -o "$APP_USER" -g "$APP_USER" "$DATA_DIR" "$DATA_DIR/data" \
    "$DATA_DIR/tiles" "$DATA_DIR/backups"
  # Nginx (www-data) doit pouvoir lire les tuiles et les données publiées.
  chmod 0755 "$DATA_DIR" "$DATA_DIR/tiles" "$DATA_DIR/data"
  install -d -m 0750 -o "$APP_USER" -g "$APP_USER" "$LOG_DIR"
  install -d -m 0750 -o root -g "$APP_USER" "$(dirname "$ENV_FILE")"
  ok "Arborescence prête"
}

# ---------------------------------------------------------------------------
# 4. Accès au dépôt
# ---------------------------------------------------------------------------
DEPLOY_KEY_NAME=trains_deploy
SSH_HOST_ALIAS=github-trains

github_slug() {
  # https://github.com/owner/repo(.git) ou git@github.com:owner/repo(.git)
  local url=$1
  url="${url%.git}"
  url="${url#https://github.com/}"
  url="${url#git@github.com:}"
  url="${url#"git@${SSH_HOST_ALIAS}:"}"
  printf '%s' "$url"
}

ensure_repo_access() {
  step "Accès au dépôt"
  if as_app git ls-remote --exit-code --heads "$REPO_URL" "$BRANCH" >/dev/null 2>&1; then
    ok "Dépôt accessible : ${REPO_URL}"
    return 0
  fi
  [[ "$REPO_URL" == *github.com* || "$REPO_URL" == *"$SSH_HOST_ALIAS"* ]] ||
    die "Dépôt inaccessible : ${REPO_URL} (branche ${BRANCH})."

  # Dépôt privé : on passe par une clé de déploiement dédiée, en lecture seule.
  local slug ssh_dir key
  slug="$(github_slug "$REPO_URL")"
  ssh_dir="/home/${APP_USER}/.ssh"
  key="${ssh_dir}/${DEPLOY_KEY_NAME}"
  install -d -m 0700 -o "$APP_USER" -g "$APP_USER" "$ssh_dir"
  if [[ ! -f "$key" ]]; then
    as_app ssh-keygen -q -t ed25519 -N '' -C "${APP_USER}@$(hostname)-deploy" -f "$key"
  fi
  if ! grep -qs "^Host ${SSH_HOST_ALIAS}\$" "${ssh_dir}/config"; then
    cat >>"${ssh_dir}/config" <<SSH
Host ${SSH_HOST_ALIAS}
  HostName github.com
  User git
  IdentityFile ${key}
  IdentitiesOnly yes
SSH
  fi
  if ! grep -qs '^github.com ' "${ssh_dir}/known_hosts"; then
    ssh-keyscan -t ed25519 github.com 2>/dev/null >>"${ssh_dir}/known_hosts"
  fi
  chown "$APP_USER:$APP_USER" "${ssh_dir}/config" "${ssh_dir}/known_hosts"
  chmod 0600 "${ssh_dir}/config"

  REPO_URL="git@${SSH_HOST_ALIAS}:${slug}.git"
  if as_app git ls-remote --exit-code --heads "$REPO_URL" "$BRANCH" >/dev/null 2>&1; then
    ok "Dépôt accessible avec la clé de déploiement"
    return 0
  fi

  printf '\n%sLe dépôt est privé : ajoutez cette clé de déploiement (lecture seule) :%s\n\n' \
    "$C_BOLD" "$C_RESET"
  cat "${key}.pub"
  printf '\n  → https://github.com/%s/settings/keys/new\n\n' "$slug"
  printf 'Puis relancez : sudo bash %s\n' "$0"
  exit 2
}

# ---------------------------------------------------------------------------
# 5. Release atomique
# ---------------------------------------------------------------------------
current_release() {
  if [[ -L "$APP_DIR/current" ]]; then readlink -f "$APP_DIR/current"; fi
}

build_release() {
  step "Construction de la release"
  local repo="$APP_DIR/repo" current stamp
  if [[ -d "$repo/.git" ]]; then
    as_app git -C "$repo" remote set-url origin "$REPO_URL"
  else
    rm -rf "$repo"
    as_app git clone --quiet --no-checkout --filter=blob:none "$REPO_URL" "$repo"
  fi
  as_app git -C "$repo" fetch --quiet --prune --force origin \
    "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"
  TARGET_SHA="$(as_app git -C "$repo" rev-parse "origin/${BRANCH}^{commit}")"
  info "Commit cible : ${TARGET_SHA:0:7} (${BRANCH})"

  current="$(current_release)"
  if [[ -n "$current" && -f "$current/.release-sha" && "$(<"$current/.release-sha")" == "$TARGET_SHA" ]]; then
    RELEASE_DIR="$current"
    RELEASE_CHANGED=0
    ok "Release déjà en place pour ce commit : $(basename "$current")"
    return 0
  fi

  stamp="$(date +%Y%m%d%H%M%S)"
  RELEASE_DIR="$APP_DIR/releases/${stamp}-${TARGET_SHA:0:7}"
  as_app mkdir -p "$RELEASE_DIR"
  # shellcheck disable=SC2016 # arguments positionnels du sous-shell, volontairement littéraux
  as_app bash -c 'git -C "$1" archive --format=tar "$2" | tar -x -C "$3"' _ \
    "$repo" "$TARGET_SHA" "$RELEASE_DIR"

  # En cas d'échec de construction, la release incomplète est supprimée et
  # « current » n'a pas bougé.
  # (set -e est inopérant dans une condition : on enchaîne explicitement.)
  if ! (
    cd "$RELEASE_DIR" &&
      as_app env CI=1 GIT_COMMIT="$TARGET_SHA" corepack pnpm install --frozen-lockfile --prefer-offline &&
      as_app env GIT_COMMIT="$TARGET_SHA" NODE_ENV=production corepack pnpm build
  ); then
    rm -rf "$RELEASE_DIR"
    die "Construction échouée : la release courante reste en service."
  fi
  printf '%s\n' "$TARGET_SHA" >"$RELEASE_DIR/.release-sha"
  chown "$APP_USER:$APP_USER" "$RELEASE_DIR/.release-sha"
  ok "Release construite : $(basename "$RELEASE_DIR")"
}

switch_release() {
  local target=$1
  PREVIOUS_RELEASE="$(current_release)"
  if [[ "$PREVIOUS_RELEASE" == "$target" ]]; then return 0; fi
  # Bascule atomique : rename(2) d'un lien temporaire sur « current ».
  ln -sfn "$target" "$APP_DIR/current.tmp"
  mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"
  ok "current → $(basename "$target")"
}

prune_releases() {
  local releases=() current keep i
  current="$(current_release)"
  mapfile -t releases < <(find "$APP_DIR/releases" -mindepth 1 -maxdepth 1 -type d | sort -r)
  keep=0
  for i in "${releases[@]}"; do
    if ((keep < KEEP_RELEASES)) || [[ "$i" == "$current" || "$i" == "$PREVIOUS_RELEASE" ]]; then
      keep=$((keep + 1))
      continue
    fi
    rm -rf "$i"
    info "Ancienne release supprimée : $(basename "$i")"
  done
}

# ---------------------------------------------------------------------------
# 6. Données
# ---------------------------------------------------------------------------
run_data_command() {
  local script=$1
  (
    cd "$RELEASE_DIR" &&
      as_app env DATA_DIR="$DATA_DIR" corepack pnpm --silent --filter @trains/data run "$script"
  )
}

prepare_data() {
  step "Données"
  if ((SKIP_DATA == 1)); then
    warn "Données ignorées (--skip-data) : le service fonctionnera en mode dégradé."
    return 0
  fi
  if [[ ! -f "$RELEASE_DIR/packages/data/package.json" ]]; then
    info "Pas de pipeline de données dans cette version."
    return 0
  fi

  # Une source ouverte indisponible ne doit pas bloquer la mise en production :
  # les données précédentes restent en service, ou l'API passe en mode dégradé.
  local failures=0
  if run_data_command pipeline; then
    ok "Données ouvertes à jour"
  else
    warn "Pipeline de données en échec (voir ci-dessus) : génération précédente conservée."
    failures=$((failures + 1))
  fi

  local free_gb
  free_gb="$(df -BG --output=avail "$DATA_DIR" | tail -1 | tr -dc '0-9')"
  if ((free_gb < MIN_FREE_GB)); then
    warn "Moins de ${MIN_FREE_GB} Go libres : une extraction du fond de carte (≈ 3 Go) pourrait échouer."
  fi
  if run_data_command basemap; then
    ok "Fond de carte à jour"
  else
    warn "Fond de carte non mis à jour (voir ci-dessus) : l'extrait précédent reste servi s'il existe."
    failures=$((failures + 1))
  fi
  ((failures == 0)) || warn "Relancer plus tard : sudo bash ${APP_DIR}/current/deploy.sh"
}

# ---------------------------------------------------------------------------
# 7–8. Secrets et port
# ---------------------------------------------------------------------------
env_get() { { sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null || true; } | tail -1; }

env_ensure() {
  local key=$1 value=$2
  if ! grep -q "^${key}=" "$ENV_FILE"; then
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
    info "Clé ajoutée à $(basename "$ENV_FILE") : ${key}"
  fi
}

port_in_use() { [[ -n "$(ss -ltnH "sport = :$1")" ]]; }

choose_port() {
  local port
  if [[ -n "$PORT" ]]; then return 0; fi
  PORT="$(env_get PORT)"
  if [[ -n "$PORT" ]]; then return 0; fi
  port=$FIRST_PORT
  while port_in_use "$port"; do port=$((port + 1)); done
  PORT=$port
  info "Port libre retenu : ${PORT}"
}

setup_env() {
  step "Secrets et configuration"
  if [[ ! -f "$ENV_FILE" ]]; then
    install -m 0600 -o root -g "$APP_USER" /dev/null "$ENV_FILE"
    printf '# Généré par deploy.sh le %s. Jamais écrasé ; seules les clés\n# manquantes sont ajoutées.\n' \
      "$(date '+%F %T')" >"$ENV_FILE"
    ok "${ENV_FILE} créé"
  fi
  choose_port
  env_ensure NODE_ENV production
  env_ensure HOST 127.0.0.1
  env_ensure PORT "$PORT"
  env_ensure PUBLIC_URL "https://${DOMAIN}"
  env_ensure SESSION_SECRET "$(openssl rand -hex 32)"
  env_ensure DATABASE_PATH "${DATA_DIR}/trains.sqlite"
  env_ensure DATA_DIR "$DATA_DIR"
  env_ensure LOG_LEVEL info
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 0600 "$ENV_FILE"

  # Le port effectif est celui du fichier (une surcharge explicite le signale).
  local persisted
  persisted="$(env_get PORT)"
  if [[ "$persisted" != "$PORT" ]]; then
    warn "PORT=${PORT} demandé mais ${ENV_FILE} contient PORT=${persisted} : modifier ce fichier."
    PORT="$persisted"
  fi
  if port_in_use "$PORT" && ! systemctl is-active --quiet "$SERVICE"; then
    die "Le port ${PORT} est occupé par un autre processus : choisir un autre PORT dans ${ENV_FILE}."
  fi
  ok "Port de l'API : ${PORT}"
}

# ---------------------------------------------------------------------------
# 9. Base de données
# ---------------------------------------------------------------------------
migrate_database() {
  step "Base de données"
  local db backup old
  db="$(env_get DATABASE_PATH)"
  # Release inchangée : aucune nouvelle migration possible, et une sauvegarde
  # superflue ferait sortir de la rotation une sauvegarde utile.
  if ((RELEASE_CHANGED == 0)) && [[ -f "$db" ]]; then
    ok "Release inchangée : base laissée en l'état"
    return 0
  fi
  if [[ -f "$db" ]]; then
    backup="$DATA_DIR/backups/trains-$(date +%Y%m%d-%H%M%S).sqlite"
    sqlite3 "$db" ".backup '${backup}'"
    gzip -f "$backup"
    chown "$APP_USER:$APP_USER" "${backup}.gz"
    ok "Sauvegarde : ${backup}.gz"
    while IFS= read -r old; do rm -f "$old"; done < <(
      find "$DATA_DIR/backups" -maxdepth 1 -name 'trains-*.sqlite.gz' | sort -r |
        tail -n +$((BACKUPS_TO_KEEP + 1))
    )
  fi
  (
    set -a
    # shellcheck source=/dev/null
    source "$ENV_FILE"
    set +a
    cd "$RELEASE_DIR/apps/server"
    as_app env DATABASE_PATH="$DATABASE_PATH" DATA_DIR="$DATA_DIR" NODE_ENV="$NODE_ENV" \
      SESSION_SECRET="$SESSION_SECRET" "$NODE_BIN" dist/migrate.js
  )
  ok "Migrations appliquées"
}

# ---------------------------------------------------------------------------
# 10. systemd
# ---------------------------------------------------------------------------
render() {
  # Remplace les marqueurs @NOM@ par les valeurs passées (NOM=valeur).
  local content pair
  content="$(<"$1")"
  shift
  for pair in "$@"; do content="${content//@${pair%%=*}@/${pair#*=}}"; done
  printf '%s\n' "$content"
}

install_if_changed() {
  # Retourne 0 si le fichier a changé.
  local src=$1 dest=$2
  if [[ -f "$dest" ]] && cmp -s "$src" "$dest"; then
    rm -f "$src"
    return 1
  fi
  install -m 0644 "$src" "$dest"
  rm -f "$src"
}

setup_systemd() {
  step "Service systemd"
  local unit=/etc/systemd/system/${SERVICE}.service tmp
  tmp="$(mktemp)"
  render "$RELEASE_DIR/deploy/trains.service.tpl" \
    "DOMAIN=$DOMAIN" "APP_USER=$APP_USER" "APP_DIR=$APP_DIR" "ENV_FILE=$ENV_FILE" \
    "NODE_BIN=$NODE_BIN" "DATA_DIR=$DATA_DIR" "LOG_DIR=$LOG_DIR" >"$tmp"
  local unit_changed=0
  if install_if_changed "$tmp" "$unit"; then
    systemctl daemon-reload
    unit_changed=1
    ok "Unité ${SERVICE}.service mise à jour"
  fi
  systemctl enable --quiet "$SERVICE"
  if ((RELEASE_CHANGED == 1 || unit_changed == 1)) || ! systemctl is-active --quiet "$SERVICE"; then
    systemctl restart "$SERVICE"
    ok "Service redémarré"
  else
    ok "Service déjà à jour et actif"
  fi
}

# ---------------------------------------------------------------------------
# 11–12. Nginx et HTTPS
# ---------------------------------------------------------------------------
NGINX_SITE=""
cert_path() { printf '/etc/letsencrypt/live/%s/fullchain.pem' "$DOMAIN"; }
has_valid_cert() {
  [[ -f "$(cert_path)" ]] && openssl x509 -checkend 86400 -noout -in "$(cert_path)" >/dev/null 2>&1
}

security_headers() {
  local hsts=$1 indent='        '
  local csp="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' wss://${DOMAIN}; worker-src 'self' blob:; child-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
  printf '%sadd_header Content-Security-Policy "%s" always;\n' "$indent" "$csp"
  printf '%sadd_header X-Content-Type-Options "nosniff" always;\n' "$indent"
  printf '%sadd_header Referrer-Policy "strict-origin-when-cross-origin" always;\n' "$indent"
  printf '%sadd_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;\n' "$indent"
  printf '%sadd_header Cross-Origin-Opener-Policy "same-origin" always;' "$indent"
  if ((hsts == 1)); then
    printf '\n%sadd_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;' "$indent"
  fi
}

# Les directives IPv6 feraient échouer « nginx -t » sur un noyau sans IPv6.
ipv6_available() { [[ -s /proc/net/if_inet6 ]]; }

# Version de Nginx installée (« 1.24.0 »).
nginx_version() { nginx -v 2>&1 | sed -n 's|.*nginx/\([0-9.]*\).*|\1|p'; }

# Vrai si la version installée est au moins celle demandée.
nginx_at_least() {
  local current
  current="$(nginx_version)"
  [[ -n "$current" ]] || return 1
  [[ "$(printf '%s\n%s\n' "$1" "$current" | sort -V | head -n1)" == "$1" ]]
}

listen_lines() {
  local port_spec=$1
  printf '    listen %s;' "$port_spec"
  if ipv6_available; then printf '\n    listen [::]:%s;' "$port_spec"; fi
}

render_vhost() {
  local tls=0 listen redirect='' tls_block='' brotli='' limit_req=''
  has_valid_cert && tls=1
  if ((tls == 1)); then
    # « http2 on » n'existe qu'à partir de Nginx 1.25.1 ; avant (1.24 sur
    # Ubuntu 24.04), HTTP/2 s'active sur la directive listen.
    if nginx_at_least 1.25.1; then
      listen="$(listen_lines '443 ssl')"$'\n    http2 on;'
    else
      listen="$(listen_lines '443 ssl http2')"
    fi
    tls_block="    ssl_certificate $(cert_path);
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;"
    if [[ -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
      tls_block+=$'\n    include /etc/letsencrypt/options-ssl-nginx.conf;'
    fi
    if [[ -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
      tls_block+=$'\n    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;'
    fi
    redirect="server {
$(listen_lines 80)
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}"
  else
    listen="$(listen_lines 80)"
  fi
  if [[ "$(nginx -V 2>&1)" == *brotli* ]] || compgen -G '/etc/nginx/modules-enabled/*brotli*' >/dev/null; then
    brotli=$'    brotli on;\n    brotli_comp_level 5;\n    brotli_types application/json application/geo+json application/javascript text/javascript text/css image/svg+xml;'
  fi
  if [[ -f /etc/nginx/conf.d/trains-ratelimit.conf ]]; then
    limit_req='        limit_req zone=trains_api burst=40 nodelay;'
  fi
  render "$RELEASE_DIR/deploy/nginx-vhost.conf.tpl" \
    "DOMAIN=$DOMAIN" "APP_DIR=$APP_DIR" "DATA_DIR=$DATA_DIR" "PORT=$PORT" \
    "LISTEN=$listen" "TLS=$tls_block" "REDIRECT_BLOCK=$redirect" "BROTLI=$brotli" \
    "LIMIT_REQ=$limit_req" "SECURITY_HEADERS=$(security_headers "$tls")"
}

apply_nginx() {
  local tmp backup
  tmp="$(mktemp)"
  render_vhost >"$tmp"
  if [[ -f "$NGINX_SITE" ]] && cmp -s "$tmp" "$NGINX_SITE"; then
    rm -f "$tmp"
    ok "Vhost inchangé"
    return 0
  fi
  backup="$(mktemp)"
  if [[ -f "$NGINX_SITE" ]]; then cp -p "$NGINX_SITE" "$backup"; else : >"$backup"; fi
  install -m 0644 "$tmp" "$NGINX_SITE"
  rm -f "$tmp"
  ln -sfn "$NGINX_SITE" "/etc/nginx/sites-enabled/${DOMAIN}"
  if ! nginx -t 2>&1; then
    if [[ -s "$backup" ]]; then
      install -m 0644 "$backup" "$NGINX_SITE"
    else
      rm -f "$NGINX_SITE" "/etc/nginx/sites-enabled/${DOMAIN}"
    fi
    rm -f "$backup"
    die "Configuration Nginx invalide : version précédente du vhost restaurée, rien rechargé."
  fi
  rm -f "$backup"
  systemctl reload nginx 2>/dev/null || systemctl restart nginx
  ok "Nginx rechargé"
}

setup_nginx() {
  step "Nginx"
  NGINX_SITE="/etc/nginx/sites-available/${DOMAIN}"
  [[ -d /etc/nginx/sites-available && -d /etc/nginx/sites-enabled ]] ||
    die "Arborescence sites-available/sites-enabled absente : configuration Nginx non standard."
  grep -qE 'include\s+/etc/nginx/sites-enabled/' /etc/nginx/nginx.conf ||
    warn "nginx.conf n'inclut pas sites-enabled : le vhost ne sera pas chargé."
  systemctl is-active --quiet nginx || systemctl start nginx

  local tmp
  if grep -qE 'include\s+/etc/nginx/conf\.d/\*\.conf' /etc/nginx/nginx.conf; then
    tmp="$(mktemp)"
    cp "$RELEASE_DIR/deploy/nginx-ratelimit.conf.tpl" "$tmp"
    install_if_changed "$tmp" /etc/nginx/conf.d/trains-ratelimit.conf || true
  else
    warn "conf.d n'est pas inclus par nginx.conf : limitation de débit Nginx désactivée."
  fi
  apply_nginx
}

setup_https() {
  step "HTTPS"
  if ((SKIP_SSL == 1)); then
    warn "HTTPS ignoré (--skip-ssl)."
    return 0
  fi
  if has_valid_cert; then
    ok "Certificat valide pour ${DOMAIN}"
  elif ((DNS_OK == 0)); then
    warn "DNS non conforme : certificat non demandé. Relancer une fois le DNS propagé."
    return 0
  elif [[ -z "$CERTBOT_EMAIL" ]]; then
    warn "CERTBOT_EMAIL vide : certificat non demandé (définir dans ${CONF_FILE})."
    return 0
  else
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect
    # certbot a modifié le vhost : on le régénère dans sa forme canonique HTTPS.
    apply_nginx
    ok "Certificat obtenu pour ${DOMAIN}"
  fi
  if systemctl is-active --quiet certbot.timer || systemctl is-active --quiet snap.certbot.renew.timer; then
    ok "Renouvellement automatique actif"
  else
    systemctl enable --now certbot.timer 2>/dev/null ||
      warn "Aucun timer de renouvellement certbot actif : vérifier « systemctl list-timers »."
  fi
}

# ---------------------------------------------------------------------------
# 13. Pare-feu
# ---------------------------------------------------------------------------
check_firewall() {
  step "Pare-feu"
  local rules=''
  if command -v ufw >/dev/null 2>&1; then rules="$(ufw status 2>/dev/null || true)"; fi
  if [[ "$rules" != *'Status: active'* ]]; then
    info "ufw inactif : rien à faire."
    return 0
  fi
  if grep -qE '^Nginx Full\s+ALLOW' <<<"$rules" ||
    { grep -qE '^(80|80/tcp)\s+ALLOW' <<<"$rules" && grep -qE '^(443|443/tcp)\s+ALLOW' <<<"$rules"; }; then
    ok "Ports 80 et 443 autorisés"
  else
    # Ajout d'une règle uniquement : les règles existantes restent intactes.
    ufw allow 'Nginx Full' >/dev/null
    ok "Règle « Nginx Full » ajoutée"
  fi
}

# ---------------------------------------------------------------------------
# 14. Healthcheck et rollback automatique
# ---------------------------------------------------------------------------
wait_for_health() {
  local url=$1 attempts=$2 extra=("${@:3}") i body
  for ((i = 1; i <= attempts; i++)); do
    if body="$(curl -fsS --max-time 5 "${extra[@]}" "$url" 2>/dev/null)"; then
      printf '%s' "$body"
      return 0
    fi
    sleep 2
  done
  return 1
}

healthcheck() {
  step "Vérification de santé"
  local body public_url
  local resolve=()
  if ! body="$(wait_for_health "http://127.0.0.1:${PORT}/api/health" 30)"; then
    rollback_after_failure "l'API ne répond pas sur 127.0.0.1:${PORT}"
  fi
  if [[ -n "$TARGET_SHA" && "$body" != *"\"commit\":\"${TARGET_SHA:0:7}\""* ]]; then
    rollback_after_failure "l'API répond mais ne sert pas le commit ${TARGET_SHA:0:7}"
  fi
  ok "API locale : ${body}"

  # Sans DNS conforme, on interroge Nginx localement avec le bon nom d'hôte.
  if has_valid_cert; then
    public_url="https://${DOMAIN}/api/health"
    ((DNS_OK == 1)) || resolve=(--resolve "${DOMAIN}:443:127.0.0.1")
  else
    public_url="http://${DOMAIN}/api/health"
    ((DNS_OK == 1)) || resolve=(--resolve "${DOMAIN}:80:127.0.0.1")
  fi
  if ! wait_for_health "$public_url" 10 "${resolve[@]}" >/dev/null; then
    rollback_after_failure "${public_url} ne répond pas via Nginx"
  fi
  ok "Accès public : ${public_url}"
}

rollback_after_failure() {
  local reason=$1
  _log "$C_RED" "✖ Healthcheck en échec : ${reason}" >&2
  if [[ -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" && "$PREVIOUS_RELEASE" != "$(current_release)" ]]; then
    warn "Rollback automatique vers $(basename "$PREVIOUS_RELEASE")"
    ln -sfn "$PREVIOUS_RELEASE" "$APP_DIR/current.tmp"
    mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"
    # Les plantages en boucle ont pu atteindre la limite de redémarrage de systemd.
    systemctl reset-failed "$SERVICE" 2>/dev/null || true
    systemctl restart "$SERVICE" || true
    if wait_for_health "http://127.0.0.1:${PORT}/api/health" 15 >/dev/null; then
      warn "Release précédente rétablie et en bonne santé."
    else
      _log "$C_RED" "✖ La release précédente ne répond pas non plus : intervention manuelle requise." >&2
    fi
  else
    warn "Aucune release précédente : pas de rollback possible."
  fi
  printf '\n--- journalctl -u %s (50 dernières lignes) ---\n' "$SERVICE" >&2
  journalctl -u "$SERVICE" -n 50 --no-pager >&2 || true
  exit 1
}

# ---------------------------------------------------------------------------
# Actions annexes : --status et --rollback
# ---------------------------------------------------------------------------
show_status() {
  local current port
  current="$(current_release)"
  port="$(env_get PORT)"
  printf '%sRails de France%s\n' "$C_BOLD" "$C_RESET"
  printf '  Release courante : %s\n' "${current:-aucune}"
  if [[ -n "$current" && -f "$current/.release-sha" ]]; then
    printf '  Commit           : %s\n' "$(<"$current/.release-sha")"
  fi
  printf '  Releases         : %s\n' \
    "$({ find "$APP_DIR/releases" -mindepth 1 -maxdepth 1 -type d 2>/dev/null || true; } | wc -l)"
  printf '  Port             : %s\n' "${port:-non configuré}"
  printf '  Service          : %s\n' "$(systemctl is-active "$SERVICE" 2>/dev/null || true)"
  if [[ -n "$port" ]]; then
    printf '  Santé            : %s\n' "$(curl -fsS --max-time 5 "http://127.0.0.1:${port}/api/health" 2>/dev/null || echo 'injoignable')"
  fi
}

rollback() {
  step "Rollback"
  local current releases=() i previous=""
  current="$(current_release)"
  [[ -n "$current" ]] || die "Aucune release en service."
  mapfile -t releases < <(find "$APP_DIR/releases" -mindepth 1 -maxdepth 1 -type d | sort)
  for i in "${!releases[@]}"; do
    if [[ "${releases[$i]}" == "$current" ]] && ((i > 0)); then
      previous="${releases[$((i - 1))]}"
    fi
  done
  [[ -n "$previous" ]] || die "Aucune release antérieure à $(basename "$current")."
  RELEASE_DIR="$previous"
  switch_release "$previous"
  NODE_BIN="$(command -v node)"
  PORT="$(env_get PORT)"
  systemctl restart "$SERVICE"
  TARGET_SHA="$(<"$previous/.release-sha")"
  healthcheck
  ok "Rollback terminé : $(basename "$previous")"
  warn "La base n'est pas restaurée ; sauvegardes disponibles dans ${DATA_DIR}/backups."
}

# ---------------------------------------------------------------------------
# 15. Résumé
# ---------------------------------------------------------------------------
summary() {
  local scheme=http version
  has_valid_cert && scheme=https
  version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$RELEASE_DIR/package.json" | head -1)"
  cat <<SUMMARY

${C_GREEN}${C_BOLD}Déploiement terminé.${C_RESET}

  URL        : ${scheme}://${DOMAIN}
  Version    : ${version:-inconnue}
  Commit     : ${TARGET_SHA:0:7}
  Port API   : ${PORT} (127.0.0.1)
  Release    : ${RELEASE_DIR}
  Données    : ${DATA_DIR}
  Secrets    : ${ENV_FILE}
  Journal    : ${LOG_FILE}

  Logs       : journalctl -u ${SERVICE} -f
  État       : sudo bash ${APP_DIR}/current/deploy.sh --status
  Rollback   : sudo bash ${APP_DIR}/current/deploy.sh --rollback
  Mise à jour: sudo bash ${APP_DIR}/current/deploy.sh
SUMMARY
}

main() {
  parse_args "$@"
  load_config
  case "$ACTION" in
    status)
      show_status
      return 0
      ;;
    rollback)
      ((EUID == 0)) || die "Ce script doit être lancé en root."
      setup_logging
      rollback
      return 0
      ;;
  esac

  setup_logging
  info "Déploiement de ${DOMAIN} (branche ${BRANCH}) depuis ${SCRIPT_SOURCE_DIR}"
  preflight
  install_dependencies
  setup_user
  ensure_repo_access
  build_release
  prepare_data
  setup_env
  migrate_database
  switch_release "$RELEASE_DIR"
  setup_systemd
  setup_nginx
  setup_https
  check_firewall
  healthcheck
  prune_releases
  summary
}

main "$@"
