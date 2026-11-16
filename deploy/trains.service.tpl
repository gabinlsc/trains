# Généré par deploy.sh depuis deploy/trains.service.tpl : ne pas modifier à la main.
[Unit]
Description=Rails de France (API)
Documentation=https://@DOMAIN@
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=@APP_USER@
Group=@APP_USER@
# Le lien « current » est résolu à chaque démarrage : un restart suffit à
# basculer sur une nouvelle release.
WorkingDirectory=@APP_DIR@/current/apps/server
EnvironmentFile=@ENV_FILE@
ExecStart=@NODE_BIN@ --enable-source-maps dist/main.js
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
KillSignal=SIGTERM

# Logs JSON sur la sortie standard, collectés par journald.
StandardOutput=journal
StandardError=journal
SyslogIdentifier=trains

# Durcissement : le service ne peut écrire que dans ses données et ses logs.
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes
RestrictNamespaces=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LockPersonality=yes
SystemCallArchitectures=native
CapabilityBoundingSet=
AmbientCapabilities=
UMask=0027
ReadWritePaths=@DATA_DIR@ @LOG_DIR@
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
