# Ubuntu 24.04 avec systemd comme PID 1 : reproduit un VPS pour tester
# deploy.sh de bout en bout (service, Nginx, healthcheck).
FROM ubuntu:24.04

ENV container=docker \
    DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends systemd systemd-sysv dbus ca-certificates curl git \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* \
 # Le dépôt de test est monté depuis l'hôte, avec un autre propriétaire.
 && git config --system --add safe.directory '*' \
 # L'image de base interdit le démarrage des services : un VPS ne le fait pas.
 && rm -f /usr/sbin/policy-rc.d \
 && systemctl mask getty.target console-getty.service systemd-logind.service \
      systemd-udevd.service systemd-udev-trigger.service systemd-remount-fs.service

STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
