# Généré par deploy.sh depuis deploy/nginx-vhost.conf.tpl : ne pas modifier à
# la main, toute modification serait écrasée au prochain déploiement.
# Seul ce fichier concerne Rails de France ; aucun autre vhost n'est touché.

@REDIRECT_BLOCK@
server {
@LISTEN@
    server_name @DOMAIN@;
@TLS@
    root @APP_DIR@/current/apps/web/dist;
    index index.html;
    charset utf-8;
    server_tokens off;

    # Imports GeoJSON de réseaux complets.
    client_max_body_size 10m;

    access_log /var/log/nginx/trains.access.log;
    error_log /var/log/nginx/trains.error.log warn;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_min_length 1024;
    gzip_types application/json application/geo+json application/javascript text/javascript
               text/css image/svg+xml application/manifest+json text/plain;
@BROTLI@
    # Assets fingerprintés par Vite : cache permanent.
    location /assets/ {
        try_files $uri =404;
        # Liste complète : « types » remplace la table globale dans ce bloc.
        # Le worker de MapLibre est un module .mjs, refusé par le navigateur
        # s'il n'est pas servi comme JavaScript.
        types {
            text/javascript js mjs;
            text/css css;
            application/json json map;
            image/svg+xml svg;
            image/png png;
            image/webp webp;
            image/jpeg jpg jpeg;
            font/woff2 woff2;
        }
        add_header Cache-Control "public, max-age=31536000, immutable" always;
@SECURITY_HEADERS@
    }

    # Fond de carte et données : servis depuis DATA_DIR, requêtes Range
    # gérées nativement par Nginx (lecture partielle des .pmtiles).
    location /tiles/ {
        alias @DATA_DIR@/tiles/;
        types {
            application/vnd.pmtiles pmtiles;
            application/json json;
            application/x-protobuf pbf;
            image/png png;
        }
        default_type application/octet-stream;
        # La compression casserait les requêtes Range.
        gzip off;
        etag on;
        add_header Cache-Control "public, max-age=86400" always;
        add_header Accept-Ranges bytes always;
@SECURITY_HEADERS@
    }

    # Données publiées par le pipeline. Un dossier par version : contenu
    # immuable, donc cache permanent ; « current » pointe sur la version en
    # service et ne doit jamais être mis en cache.
    location ^~ /data/. {
        return 404;
    }

    location ^~ /data/current/ {
        alias @DATA_DIR@/data/current/;
        types {
            application/json json;
            application/geo+json geojson;
            application/octet-stream bin;
            image/png png;
        }
        gzip_types application/json application/geo+json application/octet-stream;
        add_header Cache-Control "no-cache" always;
@SECURITY_HEADERS@
    }

    location ^~ /data/ {
        alias @DATA_DIR@/data/;
        types {
            application/json json;
            application/geo+json geojson;
            application/octet-stream bin;
            image/png png;
        }
        gzip_types application/json application/geo+json application/octet-stream;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
@SECURITY_HEADERS@
    }

    # L'API pose ses propres en-têtes de sécurité : aucun add_header ici.
    location /api/ {
@LIMIT_REQ@
        proxy_pass http://127.0.0.1:@PORT@;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Connection "";
        proxy_connect_timeout 5s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location = /ws {
        proxy_pass http://127.0.0.1:@PORT@;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }

    location = /index.html {
        add_header Cache-Control "no-cache" always;
@SECURITY_HEADERS@
    }

    # Application monopage : toute route inconnue renvoie index.html.
    location / {
        try_files $uri /index.html;
        add_header Cache-Control "no-cache" always;
@SECURITY_HEADERS@
    }
}
