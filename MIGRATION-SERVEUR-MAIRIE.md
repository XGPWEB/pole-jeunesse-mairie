# Migration vers le serveur de la mairie

Objectif : faire tourner Pôle Jeunesse (version **2.14.0** ou suivante) sur un
serveur de la mairie, **avec une base remise à zéro** (sans les données saisies
pour la démonstration), sous une **nouvelle adresse de la ville**, en gardant
l'hébergement actuel intact jusqu'à la validation.

Pôle Jeunesse est une **application web** utilisée depuis un navigateur sur
ordinateur (administration et animateurs). Il n'y a pas d'application mobile.

## Décisions prises

| Sujet | Décision |
|---|---|
| Données | Base remise à zéro : on ne garde que la configuration et les comptes administrateurs |
| Adresse | Nouvelle adresse de la ville, par exemple `polejeunesse.ville-nogentsurmarne.fr` (à confirmer avec la DSI) ; l'ancienne adresse n'est pas reprise |
| Code | Dépôt public `XGPWEB/pole-jeunesse-mairie`, sans historique ni données de démonstration |
| Mises à jour | Aujourd'hui `deploy.sh` depuis le Mac ; à terme, déploiement depuis GitHub par un runner installé sur le serveur (si la DSI l'accepte) |
| Synchronisations externes de l'agenda PIJ | Désactivées (aucune variable de synchronisation sur le nouveau serveur) |

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

La remise à zéro est faite par `scripts/remise-a-zero.sh`, qui appelle
`apps/admin/scripts/remise-a-zero-2026-11.sql`. Sans `--confirmer`, elle ne
fait qu'une **simulation** (affiche les nombres de lignes puis annule). Avec
`--confirmer`, elle sauvegarde d'abord la base. Elle refuse de s'exécuter s'il
ne reste aucun compte administrateur actif.

Après la remise à zéro, recréer les comptes de l'équipe depuis la page Équipe
(l'application génère identifiant et mot de passe, et propose de les envoyer par
e-mail). Le texte « référent » de chaque espace est un champ libre, à mettre à
jour dans la page Espaces.

---

## 1. À obtenir de la DSI

Questions envoyées à la DSI ; cocher au fur et à mesure des réponses.

- [ ] **Système** : Ubuntu 22.04/24.04 ou Debian 12 ; 2 vCPU, 4 Go RAM, 40 Go disque au minimum ; serveur dédié ou partagé.
- [ ] **Installation** : droit d'installer Node.js 24 (NodeSource), PostgreSQL 15+, Nginx, PM2, certbot — ou installation par la DSI.
- [ ] **Accès SSH** par clé (root ou compte `sudo`), à travers le VPN de la mairie. Envoyer la clé **publique** (`<votre clé>.pub`), jamais la privée.
- [ ] **Déploiement depuis GitHub** : accord pour un runner GitHub Actions sur le serveur (connexion sortante HTTPS vers github.com, aucun port entrant).
- [ ] **Accès des utilisateurs** : depuis l'extérieur de la mairie (ports 80/443 ouverts depuis Internet) ou seulement en interne / par VPN.
- [ ] **Sortie Internet** du serveur : mises à jour, SMTP, API Île-de-France Mobilités, Let's Encrypt, npm, GitHub.
- [ ] **Pare-feu / reverse proxy** de la mairie devant le serveur.
- [ ] **Adresse** : sous-domaine de la ville (ex. `polejeunesse.ville-nogentsurmarne.fr`), qui gère les DNS.
- [ ] **Certificat** : Let's Encrypt (nécessite un accès depuis Internet) ou certificat de la mairie (ex. `*.ville-nogentsurmarne.fr`).
- [ ] **Messagerie** : SMTP de la mairie (hôte, port, compte d'envoi) pour les identifiants des animateurs, le mot de passe oublié et les alertes.
- [ ] **Sauvegardes** : sauvegarde du serveur par la DSI ; emplacement pour une copie des sauvegardes hors du serveur.
- [ ] **Supervision** : outil de la DSI où ajouter le contrôle `https://<adresse>/api/health`.
- [ ] **RGPD** : information du DPO / fiche du registre des traitements (données de mineurs, renseignements sanitaires).

## 2. À faire dans le code avant la mise en service

- [ ] **Adresse configurable.** L'ancienne adresse est encore écrite en dur :
  liens des e-mails (`apps/admin/src/app/animateurs/emailService.ts`), page
  Équipe (`AnimateursClient.tsx`), valeurs par défaut CORS et réinitialisation de
  mot de passe, et dans `deploy.sh` (configuration Nginx, chemin du certificat,
  URL de supervision, adresses d'alerte). À remplacer par un réglage unique lu
  sur le serveur (`APP_BASE_URL`), une fois l'adresse confirmée.
- [ ] **Certificat** : adapter la partie Nginx de `deploy.sh` si la DSI fournit
  son propre certificat au lieu de Let's Encrypt.
- [ ] **Déploiement GitHub** (si accepté) : workflow de déploiement et runner.
  En attendant, `deploy.sh` depuis le Mac fonctionne à travers le VPN.
- [ ] **Audit final** avant mise en service.

## 3. Préparer le serveur

Depuis le Mac (remplacer `MAIRIE` par `root@<ip>`, ou le compte fourni) :

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

Base de données (mot de passe long, à générer et à noter dans le coffre) :

```bash
sudo -u postgres createuser --pwprompt pj_admin
sudo -u postgres createdb -O pj_admin pole_jeunesse
```

### Secrets

Créer `/opt/pj-secrets.env` **à neuf** (`chmod 600`), avec uniquement :

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | `postgresql://pj_admin:<mot de passe>@localhost:5432/pole_jeunesse` |
| `JWT_SECRET` | **nouveau** : `openssl rand -base64 48` (tout le monde devra se reconnecter, c'est voulu) |
| `APP_BASE_URL` | `https://<adresse>` |
| `ALLOWED_ORIGIN` | `https://<adresse>` |
| `IDFM_API_KEY` | reprise de l'hébergement actuel |
| `INTERNAL_MONITORING_SECRET` | nouveau : `openssl rand -hex 32` |

Ne recopier **aucune autre variable** de l'ancien fichier : en particulier,
aucune variable de synchronisation de l'agenda PIJ (la route correspondante
répond alors 404).

Créer `/opt/pj-smtp.env` (`chmod 600`) avec les paramètres SMTP de la mairie :
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`,
`MAIL_ADMIN`.

## 4. Copier la base actuelle (la veille ou le jour J)

On copie la base complète, puis on la remet à zéro **sur le serveur de la
mairie** : l'hébergement actuel n'est pas modifié, c'est le retour arrière.

```bash
# Dump sur l'hébergement actuel
ssh -i "$SSH_KEY" root@<ANCIEN_SERVEUR> 'set -a; . /opt/pj-secrets.env; set +a; pg_dump "$DATABASE_URL" | gzip > /root/pj-migration.sql.gz'
# Transfert ancien serveur → Mac → mairie (le fichier contient des données personnelles)
scp -i "$SSH_KEY" root@<ANCIEN_SERVEUR>:/root/pj-migration.sql.gz /tmp/
scp -i "$SSH_KEY" /tmp/pj-migration.sql.gz MAIRIE:/root/
# Restauration sur le serveur de la mairie
ssh -i "$SSH_KEY" MAIRIE 'set -a; . /opt/pj-secrets.env; set +a; gunzip -c /root/pj-migration.sql.gz | psql "$DATABASE_URL" -v ON_ERROR_STOP=1'
```

Après validation, supprimer les copies intermédiaires : `/tmp/pj-migration.sql.gz`
sur le Mac et `/root/pj-migration.sql.gz` sur les deux serveurs.

## 5. Remettre à zéro (sur le serveur de la mairie)

```bash
bash scripts/remise-a-zero.sh MAIRIE
```

Lire la simulation : nombres de lignes, comptes administrateurs conservés, nombre
d'espaces. Puis :

```bash
bash scripts/remise-a-zero.sh MAIRIE --confirmer
```

Le script sauvegarde la base (`/opt/backups/pj-db/pj-avant-remise-a-zero-<date>.sql.gz`),
vide les tables, met les archives CAF de côté et redémarre l'application.

## 6. Déployer l'application

Dans `deploy.env` (à la racine du dépôt, non versionné) :

```
VPS_IP=<ip du serveur mairie>
VPS_USER=root
SSH_KEY=$HOME/.ssh/<votre clé>
```

```bash
bash deploy.sh
```

`deploy.sh` contrôle Node, les secrets et le schéma de la base, lance les tests,
livre la version, installe la sauvegarde nocturne (2 h) et la supervision
(toutes les 5 min). `scripts/reinitialiser-mot-de-passe.sh` et
`scripts/remise-a-zero.sh` lisent aussi `deploy.env`.

Certificat Let's Encrypt (une fois le DNS en place, si le serveur est joignable
depuis Internet) :

```bash
certbot --nginx -d <adresse>
bash deploy.sh   # régénère la configuration Nginx HTTPS
```

## 7. Mise en service

1. La DSI fait pointer `<adresse>` vers le serveur.
2. Vérifications ci-dessous.
3. Création des comptes de l'équipe, envoi des identifiants.
4. Communication de la nouvelle adresse à l'équipe. Les liens d'abonnement à
   l'agenda PIJ (Outlook) sont à recréer par chaque utilisateur concerné.

## 8. Vérifications

- [ ] `https://<adresse>/api/health` répond avec la bonne version.
- [ ] Connexion admin (+ 2FA si activée) ; connexion d'un animateur, qui ne voit que ses rubriques.
- [ ] Tableau de bord : 0 jeune, 0 activité, statistiques à zéro ; espaces présents.
- [ ] Créer une fiche jeune test, une inscription, un pointage, puis les supprimer.
- [ ] E-mail de création de compte et « mot de passe oublié » reçus, avec des liens vers la **nouvelle** adresse.
- [ ] Le lendemain : `ls -lt /opt/backups/pj-db | head` montre la sauvegarde de 2 h.
- [ ] Contrôle global : `ssh MAIRIE 'bash -s' < scripts/controle-serveur.sh`.

## 9. Retour arrière

L'hébergement actuel reste en service, inchangé, sous son ancienne adresse :
en cas de problème, l'équipe continue à l'utiliser le temps de corriger. Le
garder au moins **2 semaines** après la mise en service, puis le résilier après
une dernière sauvegarde et la suppression des données personnelles qu'il
contient.

## Essayer en local

```bash
cd apps/admin && npx next dev --hostname 127.0.0.1 --port 3001
```

Avec une base PostgreSQL locale et `apps/admin/.env.local` (`DATABASE_URL`,
`JWT_SECRET`, `TZ=Europe/Paris`). Voir le README, section « Installation locale ».
