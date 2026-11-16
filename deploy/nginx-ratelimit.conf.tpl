# Généré par deploy.sh : zones de limitation de débit de Rails de France.
# Ce fichier est inclus dans le contexte http par /etc/nginx/nginx.conf.
limit_req_zone $binary_remote_addr zone=trains_api:10m rate=20r/s;
limit_req_status 429;
