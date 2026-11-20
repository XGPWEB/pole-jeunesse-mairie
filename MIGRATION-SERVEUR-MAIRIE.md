# Migration vers le serveur de la mairie — novembre 2026

Objectif : faire tourner Pôle Jeunesse sur le serveur de la mairie, **avec une
base remise à zéro** (sans les données saisies pour la démonstration), en
gardant le VPS actuel (`<ANCIEN_VPS>`, adresse dans deploy.env) intact jusqu'à la validation.

## Ce que devient chaque donnée

| Conservé | Vidé |
|---|---|
| Comptes **admin / superadmin** uniquement (pour se connecter et recréer l'équipe) | **Comptes animateurs** (et leurs liens d'agenda PIJ) |
| Espaces (Collégiens, Lycéens, PIJ, CLAS) | Fiches jeunes et contacts |
| Paramètres, thème, textes RGPD | Inscriptions, pointages, présences |
| Véhicule (Renault Trafic — défini dans le code) | Activités, événements, sorties, projets |
| | Actualités, notifications |
| | Congés, demandes de récupération |
| | Réservations du véhicule |
| | PIJ : accueils, dossiers, RDV, missions |
| | Statistiques et fréquentation (calculées depuis les tables ci-dessus), archives CAF |
| | Journal d'audit, monitoring, tentatives de connexion |

Le script refuse de s'exécuter s'il ne reste aucun compte admin actif. Après la
remise à zéro, recréer les comptes de l'équipe depuis la page Équipe (chacun
reçoit son e-mail de création). Le texte « référent » affiché sur chaque espace
est un champ libre : le mettre à jour dans la page Espaces si besoin.

La remise à zéro est faite par `scripts/remise-a-zero.sh`, qui appelle
`apps/admin/scripts/remise-a-zero-2026-11.sql`. Sans `--confirmer`, elle ne
fait qu'une **simulation** (affiche les comptes de lignes puis annule).

---

## 1. À obtenir de la DSI avant le jour J

- [ ] **Système** : Ubuntu 22.04/24.04 ou Debian 12, 2 vCPU, 4 Go RAM, 40 Go disque.
- [ ] **Accès SSH** par clé (root ou compte avec `sudo`) depuis le Mac. Envoyer la clé **publique** `<votre clé>.pub` (jamais la privée).
- [ ] **Droit d'installer** : Node.js 24 (NodeSource), PostgreSQL 15+, Nginx, PM2, certbot.
- [ ] **Réseau** : ports 80 et 443 ouverts depuis Internet (l'app mobile des jeunes y accède) ; sortie vers Internet autorisée (SMTP, API IDFM, Let's Encrypt, npm).
- [ ] **Nom de domaine** : on garde `jeunessenogent.cloud` (seul l'enregistrement DNS change) ou un sous-domaine mairie (voir § 6).
- [ ] **Certificat SSL** : Let's Encrypt possible, ou certificat fourni par la DSI.
- [ ] **Messagerie** : SMTP de la mairie à utiliser pour les e-mails (création de compte, mot de passe oublié, alertes) ? hôte, port, identifiants.
- [ ] **Sauvegardes** : la DSI sauvegarde-t-elle le serveur ? Sinon, prévoir où mettre la copie hors-site (aujourd'hui : NAS qui vient chercher les sauvegardes).
- [x] **LE HUB** : connexion avec l'agenda PIJ **mise en attente** (décision du 20/11/2026), voir § 2 bis.

## 2. Préparer le serveur de la mairie

Depuis le Mac (remplacer `MAIRIE` par `root@<ip>`) :

```bash
ssh -i "$SSH_KEY" MAIRIE
```

Sur le serveur :

```bash
apt update && apt install -y postgresql nginx certbot python3-certbot-nginx curl gzip msmtp
curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt install -y nodejs
npm install -g pm2
timedatectl set-timezone Europe/Paris
```

Base de données (mot de passe long, à générer et noter dans le coffre) :

```bash
sudo -u postgres createuser --pwprompt pj_admin
sudo -u postgres createdb -O pj_admin pole_jeunesse
```

Secrets : recopier **par SSH** `/opt/pj-secrets.env` et `/opt/pj-smtp.env` depuis le VPS actuel, puis adapter `DATABASE_URL` (nouveau mot de passe). Garder `chmod 600`. Générer un **nouveau** `JWT_SECRET` (`openssl rand -hex 48`) : tout le monde devra se reconnecter, ce qui est voulu.

## 2 bis. LE HUB en attente

La synchronisation de l'agenda PIJ avec LE HUB n'est **pas activée** sur le
serveur de la mairie. Aucune modification de code n'est nécessaire : la route
`/api/pij/hub/rdv` répond 404 tant que les deux variables suivantes sont
absentes de `/opt/pj-secrets.env`.

- En recopiant `/opt/pj-secrets.env` depuis le VPS, **retirer** les lignes
  `HUB_SYNC_SECRET=` et `HUB_SYNC_TENANT_ID=`.
- Contrôle après déploiement : `curl -s -o /dev/null -w '%{http_code}\n' https://<domaine>/api/pij/hub/rdv` doit afficher `404`.
- L'agenda PIJ fonctionne normalement : les RDV se saisissent dans l'application,
  et l'abonnement iCalendar (Outlook) n'est pas concerné.

Pour reconnecter LE HUB plus tard :
1. générer un nouveau secret (`openssl rand -hex 32`, 32 caractères minimum) ;
2. l'ajouter dans `/opt/pj-secrets.env` avec `HUB_SYNC_TENANT_ID=nogent`, puis relancer `bash deploy.sh` (la configuration PM2 est régénérée à partir de ce fichier) ;
3. donner le même secret et la nouvelle adresse (`https://<domaine>/api/pij/hub/rdv`) à LE HUB ;
4. vérifier : la route répond `403` sans le secret ; un RDV pris dans LE HUB apparaît avec le badge « Pris dans LE HUB ».

## 3. Copier la base actuelle (la veille ou le jour J)

On copie la base complète, puis on la remet à zéro **sur le serveur de la
mairie**. Le VPS actuel n'est pas modifié : c'est le retour arrière.

```bash
# Dump sur le VPS actuel
ssh -i "$SSH_KEY" root@<ANCIEN_VPS> 'set -a; . /opt/pj-secrets.env; set +a; pg_dump "$DATABASE_URL" | gzip > /root/pj-migration.sql.gz'
# Transfert direct VPS → Mac → mairie (le fichier contient des données personnelles)
scp -i "$SSH_KEY" root@<ANCIEN_VPS>:/root/pj-migration.sql.gz /tmp/
scp -i "$SSH_KEY" /tmp/pj-migration.sql.gz MAIRIE:/root/
# Restauration sur le serveur de la mairie
ssh -i "$SSH_KEY" MAIRIE 'set -a; . /opt/pj-secrets.env; set +a; gunzip -c /root/pj-migration.sql.gz | psql "$DATABASE_URL" -v ON_ERROR_STOP=1'
```

Puis supprimer les copies intermédiaires : `rm /tmp/pj-migration.sql.gz` sur le Mac et `/root/pj-migration.sql.gz` sur les deux serveurs **après validation**.

## 4. Remettre à zéro (sur le serveur de la mairie)

```bash
bash scripts/remise-a-zero.sh MAIRIE
```

Lire la simulation : vérifier les nombres de lignes, le nombre d'animateurs et d'espaces conservés. Puis :

```bash
bash scripts/remise-a-zero.sh MAIRIE --confirmer
```

Le script sauvegarde d'abord la base (`/opt/backups/pj-db/pj-avant-remise-a-zero-<date>.sql.gz`), vide les tables, met les archives CAF de côté et redémarre l'application.

## 5. Déployer l'application sur le nouveau serveur

Dans `deploy.env` (non versionné) :

```
VPS_IP=<ip du serveur mairie>
VPS_USER=root
SSH_KEY=$HOME/.ssh/<votre clé>
```

```bash
bash deploy.sh
```

`deploy.sh` contrôle Node, les secrets et le schéma, lance les tests, livre la version, installe la sauvegarde nocturne (2 h) et la supervision (toutes les 5 min).

Ensuite, le certificat (si le DNS pointe déjà vers le nouveau serveur) :

```bash
certbot --nginx -d jeunessenogent.cloud
bash deploy.sh   # régénère la conf Nginx HTTPS maintenant que le certificat existe
```

⚠️ `scripts/reinitialiser-mot-de-passe.sh` vise encore l'ancienne IP en dur : à modifier après la bascule.

## 6. Bascule DNS

**Si on garde `jeunessenogent.cloud`** (recommandé) : baisser le TTL à 300 s la veille, puis changer l'enregistrement A vers l'IP de la mairie. L'app mobile et les e-mails continuent de fonctionner sans modification.

**Si nouveau domaine** : à adapter avant la livraison —
- `apps/mobile/eas.json` (`EXPO_PUBLIC_API_URL`) puis nouvelle build et publication de l'app ;
- `ALLOWED_ORIGIN` et `APP_BASE_URL` dans `/opt/pj-secrets.env` ;
- liens dans `apps/admin/src/app/animateurs/emailService.ts` et `AnimateursClient.tsx` ;
- `deploy.sh` (URL de supervision, conf Nginx, adresses d'alerte) ;
- liens d'abonnement à l'agenda PIJ : à redonner aux animateurs.

## 7. Vérifications après bascule

- [ ] `https://<domaine>/api/health` répond avec la bonne version.
- [ ] Connexion admin + 2FA ; connexion d'un animateur.
- [ ] Tableau de bord : 0 jeune, 0 activité, statistiques à zéro ; espaces et équipe présents.
- [ ] Créer une fiche jeune test, une inscription, un pointage, puis les supprimer.
- [ ] App mobile : connexion et planning.
- [ ] E-mail « mot de passe oublié » reçu.
- [ ] Le lendemain : `ls -lt /opt/backups/pj-db | head` montre la sauvegarde de 2 h.
- [ ] Contrôle global : `ssh MAIRIE 'bash -s' < scripts/controle-serveur.sh`.

## 8. Retour arrière

Tant que le VPS actuel n'est pas arrêté : remettre l'enregistrement DNS sur
`<ANCIEN_VPS>`. Garder le VPS au moins **2 semaines** après la bascule, puis
le résilier après une dernière sauvegarde et la suppression des données
personnelles qu'il contient.
