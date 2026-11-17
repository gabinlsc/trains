# Déploiement

Rails de France se déploie sur un serveur Ubuntu ou Debian par une seule
commande, `sudo bash deploy.sh`, aussi bien pour la première installation
que pour les mises à jour. Le script est idempotent : le relancer sans
changement ne modifie rien.

Il cohabite avec les sites déjà hébergés sur le serveur. Il n'écrit que :

| Chemin                                      | Contenu                                       |
| ------------------------------------------- | --------------------------------------------- |
| `/opt/trains/`                              | dépôt, releases, lien `current`               |
| `/var/lib/trains/`                          | base SQLite, sauvegardes, données, tuiles     |
| `/var/log/trains/`                          | journaux de déploiement                       |
| `/etc/trains/trains.env`                    | secrets et configuration du service           |
| `/etc/trains/deploy.conf`                   | surcharges du script (facultatif, manuel)     |
| `/etc/systemd/system/trains.service`        | unité systemd                                 |
| `/etc/nginx/sites-available/trains.glsc.fr` | vhost (+ lien dans `sites-enabled`)           |
| `/etc/nginx/conf.d/trains-ratelimit.conf`   | zone `limit_req` (contexte `http`)            |
| `/home/trains/`                             | cache pnpm, clé de déploiement le cas échéant |

Aucun autre vhost n'est modifié, `nginx.conf` non plus.

## Prérequis

1. Un serveur Ubuntu 22.04+ ou Debian 12+, avec un accès root et au moins
   5 Go libres.
2. Un enregistrement DNS **A** `trains` → IP publique du serveur dans la zone
   `glsc.fr` (et **AAAA** si le serveur a une IPv6). Vérification :

   ```bash
   dig +short trains.glsc.fr
   ```

3. Les ports 80 et 443 ouverts (le script ajoute la règle `Nginx Full` si
   `ufw` est actif, sans toucher aux autres règles).
4. Une adresse e-mail pour Let's Encrypt, déclarée dans
   `/etc/trains/deploy.conf` :

   ```bash
   sudo install -d -m 755 /etc/trains
   echo 'CERTBOT_EMAIL=admin@example.org' | sudo tee /etc/trains/deploy.conf
   ```

Sans DNS conforme ou sans e-mail, le site est servi en HTTP et le script
l'indique ; il suffit de le relancer une fois le DNS propagé.

## Premier déploiement

```bash
git clone https://github.com/gabinlsc/trains.git
cd trains
sudo bash deploy.sh
```

Le script peut aussi être lancé seul, sans clone préalable : il clone alors
lui-même le dépôt dans `/opt/trains/repo`.

```bash
curl -fsSLO https://raw.githubusercontent.com/gabinlsc/trains/main/deploy.sh
sudo bash deploy.sh
```

### Dépôt privé

Si le dépôt n'est pas accessible anonymement, le script génère une clé de
déploiement dédiée (`/home/trains/.ssh/trains_deploy`), affiche la clé
publique et l'URL où l'ajouter (`Settings → Deploy keys`, lecture seule),
puis s'arrête avec le code 2. Une fois la clé ajoutée, relancer la même
commande : le déploiement reprend.

### Ce que fait le script

1. **Pré-vérifications** : root, Ubuntu/Debian, espace disque, DNS du
   domaine comparé à l'IP publique (HTTPS sauté si différent, sans échec).
2. **Dépendances** : `git`, `curl`, `build-essential`, `sqlite3`, `nginx`,
   `certbot`… installées seulement si absentes. Node.js 22 via NodeSource
   **uniquement** si la version présente est plus ancienne ; si une autre
   version majeure est déjà installée, les services qui l'utilisent sont
   listés et une confirmation est demandée (`--yes` pour l'automatiser).
   pnpm est fourni par corepack.
3. **Utilisateur** système `trains`, sans shell de connexion.
4. **Accès au dépôt** (voir ci-dessus).
5. **Release** : le commit cible est extrait dans
   `/opt/trains/releases/<horodatage>-<sha>`, puis `pnpm install
--frozen-lockfile` et `pnpm build` y sont lancés. Si le commit est déjà en
   service, cette étape est sautée. En cas d'échec, la release incomplète est
   supprimée et le service n'est pas touché.
6. **Données** : pipeline de données ouvertes (régénéré seulement si
   `DATA_VERSION` change) puis fond de carte (extrait France de Protomaps,
   refait au-delà de 90 jours). Un échec ici n'interrompt pas le
   déploiement : la génération précédente reste en service, ou l'API passe
   en mode dégradé, et le script le signale.
7. **Secrets** : `/etc/trains/trains.env` (mode 600, `root:trains`) est créé
   au premier lancement avec un `SESSION_SECRET` aléatoire. Il n'est jamais
   écrasé ; seules les clés manquantes sont ajoutées.
8. **Port** : premier port libre à partir de 3070, persisté dans le fichier
   d'environnement.
9. **Base** : sauvegarde `sqlite3 .backup` compressée, rotation sur 14
   sauvegardes, puis migrations.
10. **Bascule** du lien `/opt/trains/current` (atomique), puis unité systemd
    durcie (`ProtectSystem=strict`, écriture limitée aux données et aux
    logs) et redémarrage.
11. **Nginx** : vhost régénéré, `nginx -t` **avant** rechargement ; en cas
    d'échec, la version précédente est restaurée et rien n'est rechargé.
12. **HTTPS** : `certbot --nginx` si aucun certificat valide n'existe et que
    le DNS est correct ; vérification du timer de renouvellement.
13. **Pare-feu** : vérification `ufw`.
14. **Santé** : `GET /api/health` en local puis via Nginx. En cas d'échec,
    **rollback automatique** vers la release précédente, puis sortie en
    erreur avec les dernières lignes du journal du service.
15. **Résumé** : URL, version, commit, port, chemins et commandes utiles.

## Mises à jour

```bash
sudo bash /opt/trains/current/deploy.sh
```

Le script récupère le dernier commit de la branche (`main` par défaut),
construit une nouvelle release à côté de l'ancienne et ne bascule qu'après
un build réussi. Les 5 dernières releases sont conservées (`KEEP_RELEASES`).

## Options et configuration

| Option        | Effet                                                      |
| ------------- | ---------------------------------------------------------- |
| `--skip-ssl`  | ne pas demander de certificat                              |
| `--skip-data` | ne pas générer les données ni télécharger le fond de carte |
| `--rollback`  | revenir à la release précédente                            |
| `--status`    | état du service, release courante, santé                   |
| `--yes`       | répondre oui aux confirmations                             |
| `--help`      | aide                                                       |

Variables surchargeables, par ordre de priorité croissante : valeurs en tête
du script, `/etc/trains/deploy.conf`, environnement (`sudo -E`).

| Variable        | Défaut                                   |
| --------------- | ---------------------------------------- |
| `DOMAIN`        | `trains.glsc.fr`                         |
| `REPO_URL`      | `https://github.com/gabinlsc/trains.git` |
| `BRANCH`        | `main`                                   |
| `APP_USER`      | `trains`                                 |
| `APP_DIR`       | `/opt/trains`                            |
| `DATA_DIR`      | `/var/lib/trains`                        |
| `PORT`          | vide : premier port libre dès 3070       |
| `CERTBOT_EMAIL` | vide : pas de certificat                 |
| `KEEP_RELEASES` | `5` (minimum 2)                          |

Le port effectif est celui de `/etc/trains/trains.env`. Pour le changer,
modifier ce fichier puis relancer le script (le vhost suit).

## Si une autre application impose une version de Node.js

Le script refuse de remplacer Node.js sans confirmation. Si une application
existante a besoin d'une version plus ancienne, ne pas confirmer : installer
plutôt Node.js 22 à part (par exemple dans `/opt/node22`), le placer en
tête du `PATH` pour l'exécution du script, puis relancer. L'unité systemd
utilise le binaire trouvé au moment du déploiement.

```bash
sudo env PATH=/opt/node22/bin:$PATH bash deploy.sh
```

## Rollback

```bash
sudo bash /opt/trains/current/deploy.sh --rollback
```

Le lien `current` revient à la release précédente et le service redémarre.
La base n'est **pas** restaurée : les migrations sont conçues pour rester
compatibles avec la release précédente. Pour revenir aussi sur les données :

```bash
sudo systemctl stop trains
sudo ls -1t /var/lib/trains/backups/
gunzip -c /var/lib/trains/backups/trains-AAAAMMJJ-HHMMSS.sqlite.gz | sudo -u trains tee /var/lib/trains/trains.sqlite >/dev/null
sudo rm -f /var/lib/trains/trains.sqlite-wal /var/lib/trains/trains.sqlite-shm
sudo systemctl start trains
```

## Sauvegardes

Une sauvegarde cohérente (`sqlite3 .backup`, compatible WAL) est faite avant
chaque migration, dans `/var/lib/trains/backups/`, avec rotation sur 14
fichiers. Pour une sauvegarde hors serveur, synchroniser ce répertoire (par
exemple avec `restic` ou `rsync` dans une tâche cron).

## Dépannage

| Symptôme                          | Piste                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Le script s'arrête avec le code 2 | ajouter la clé de déploiement affichée, puis relancer                                                           |
| « Confirmation requise »          | une autre version de Node.js est présente : relire l'avertissement, puis relancer en interactif ou avec `--yes` |
| HTTPS ignoré                      | vérifier `dig +short trains.glsc.fr` et `CERTBOT_EMAIL`                                                         |
| « Configuration Nginx invalide »  | `sudo nginx -t` ; le vhost précédent a été restauré                                                             |
| Healthcheck en échec, rollback    | `journalctl -u trains -n 100` ; vérifier `/etc/trains/trains.env`                                               |
| Port occupé                       | changer `PORT` dans `/etc/trains/trains.env` et relancer                                                        |
| Santé « degraded »                | données absentes : relancer sans `--skip-data`                                                                  |

Commandes utiles :

```bash
journalctl -u trains -f                       # logs JSON du service
sudo bash /opt/trains/current/deploy.sh --status
ls /var/log/trains/                           # journaux de déploiement
curl -s http://127.0.0.1:3070/api/health      # santé, sans passer par Nginx
```

## Test du script

`deploy/test/run.sh` rejoue un déploiement complet dans un conteneur Ubuntu
24.04 avec systemd : installation, deuxième exécution sans aucun
changement de configuration, mise à jour vers un nouveau commit, puis
rollback. La CI l'exécute sur chaque PR (job `deploy-test`), avec
`--skip-ssl --skip-data`.

```bash
bash deploy/test/run.sh   # nécessite Docker
```
