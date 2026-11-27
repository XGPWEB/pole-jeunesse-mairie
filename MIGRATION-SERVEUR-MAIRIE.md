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
| Mises à jour | `deploy.sh` lancé depuis le Mac, à travers le VPN de la mairie. Pas de déploiement automatique depuis GitHub : le dépôt étant public, aucun runner GitHub n'est installé sur le serveur |
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
- [ ] **Accès des utilisateurs** : depuis l'extérieur de la mairie (ports 80/443 ouverts depuis Internet) ou seulement en interne / par VPN.
- [ ] **Sortie Internet** du serveur : mises à jour, SMTP, API Île-de-France Mobilités, Let's Encrypt, npm.
- [ ] **Pare-feu / reverse proxy** de la mairie devant le serveur.
- [ ] **Adresse** : sous-domaine de la ville (ex. `polejeunesse.ville-nogentsurmarne.fr`), qui gère les DNS.
- [ ] **Certificat** : Let's Encrypt (nécessite un accès depuis Internet) ou certificat de la mairie (ex. `*.ville-nogentsurmarne.fr`).
- [ ] **Messagerie** : SMTP de la mairie (hôte, port, compte d'envoi) pour les identifiants des animateurs, le mot de passe oublié et les alertes.
- [ ] **Sauvegardes** : sauvegarde du serveur par la DSI ; emplacement pour une copie des sauvegardes hors du serveur.
- [ ] **Supervision** : outil de la DSI où ajouter le contrôle `https://<adresse>/api/health`.
- [ ] **RGPD** : information du DPO / fiche du registre des traitements (données de mineurs, renseignements sanitaires).

## 2. À faire dans le code avant la mise en service

- [x] **Adresse configurable.** Plus aucune adresse écrite en dur : l'application
  (courriels, réinitialisation de mot de passe, CORS, page Équipe) et `deploy.sh`
  (Nginx, chemin du certificat Let's Encrypt, supervision) lisent `APP_BASE_URL`
  dans `/opt/pj-secrets.env`. Les alertes partent vers `MAIL_ADMIN` depuis
  `MAIL_FROM` (`/opt/pj-smtp.env`). Reste à y mettre l'adresse confirmée par la DSI.
- [x] **Certificat** : `deploy.sh` accepte les deux cas, sans modification du
  code. Par défaut, Let's Encrypt (`certbot`). Si la DSI fournit son certificat,
  renseigner `SSL_CERTIFICAT` et `SSL_CLE` dans `/opt/pj-secrets.env` (voir
  « Certificat » en section 6). Le contrôle des secrets vérifie que la clé
  correspond au certificat et qu'il n'est pas expiré ; Nginx est rétabli dans sa
  configuration précédente si la nouvelle est refusée.
- [x] **Comptes** (audit du 2026-11-20) : session fermée après 10 minutes
  d'inactivité, reconnexion chaque jour, mots de passe de 12 caractères au
  minimum. Les mots de passe existants restent valables jusqu'au prochain
  changement ; tout le monde doit se reconnecter après la mise à jour.
- [x] **Information RGPD des agents** sur leur profil et leur fiche. Le registre
  (`apps/admin/src/data/rgpd.json`) est à faire relire par le DPO.
- [ ] **Double authentification obligatoire** pour les administrateurs (encore
  facultative).
- [ ] **Audit final** avant mise en service.

## 3. Préparer le serveur

Depuis le Mac, connecté au VPN de la mairie (remplacer `MAIRIE` par `root@<ip>`, ou le compte fourni) :

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
| `SSL_CERTIFICAT`, `SSL_CLE` | **seulement si la DSI fournit le certificat** : chemins absolus du certificat (chaîne complète, PEM) et de sa clé privée, ex. `/etc/ssl/pole-jeunesse/fullchain.pem` et `/etc/ssl/pole-jeunesse/privkey.pem`. Les deux ou aucun ; sans eux, Let's Encrypt. |
| `APP_BASE_URL` | `https://<adresse>` — **obligatoire**, en minuscules, sans « / » final. Seule source de l'adresse : liens des courriels, configuration Nginx et certificat, supervision. `deploy.sh` refuse de déployer sans elle. |
| `IDFM_API_KEY` | reprise de l'hébergement actuel |
| `INTERNAL_MONITORING_SECRET` | nouveau : `openssl rand -hex 32` |

Ne recopier **aucune autre variable** de l'ancien fichier : en particulier,
aucune variable de synchronisation de l'agenda PIJ (la route correspondante
répond alors 404).

Créer `/opt/pj-smtp.env` (`chmod 600`) avec les paramètres SMTP de la mairie :
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`,
`MAIL_ADMIN`.

`MAIL_FROM` est l'adresse d'expédition de **tous** les courriels de l'application
(identifiants, mot de passe oublié, alertes) ; elle apparaît aussi dans la
signature. Elle doit appartenir au domaine de la ville et être autorisée en
envoi par le serveur SMTP de la mairie : un courriel `@ville-nogentsurmarne.fr`
envoyé par un autre serveur (Gmail…) part en indésirables ou est refusé.

**Adresse de l'administrateur : `x.gerinette@ville-nogentsurmarne.fr`, pour tout.**
Sur le serveur de la mairie, tout ce qui est destiné à l'administrateur part
vers cette seule adresse :

| Quoi | Réglage |
|---|---|
| Alertes du monitoring de l'application (erreurs serveur, 1 par type toutes les 30 min) | `MAIL_ADMIN` |
| Alertes du serveur : site injoignable, sauvegarde manquante ou en échec, copie des sauvegardes hors serveur | `MAIL_ADMIN` (scripts installés par `deploy.sh`, envoi par msmtp) |
| Lien « mot de passe oublié » du compte `xavier.gerinette` | e-mail de **sa fiche**, en base (voir section 7) |

```bash
MAIL_ADMIN=x.gerinette@ville-nogentsurmarne.fr
```

La démo (jeunessenogent.cloud) garde son adresse actuelle : ces réglages
sont propres à chaque serveur et ne passent ni par GitHub ni par le miroir.

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

### Certificat

Tant qu'aucun certificat n'est en place, `deploy.sh` pose une configuration
HTTP simple. Ensuite, selon la réponse de la DSI :

**Let's Encrypt** (le serveur doit être joignable depuis Internet sur le port 80,
DNS en place) :

```bash
certbot --nginx -d <adresse>
bash deploy.sh   # régénère la configuration Nginx HTTPS
```

**Certificat fourni par la mairie** (ex. `*.ville-nogentsurmarne.fr`) : le
déposer sur le serveur, clé lisible par root seulement, puis l'indiquer dans
`/opt/pj-secrets.env` :

```bash
install -d -m 700 /etc/ssl/pole-jeunesse
install -m 644 fullchain.pem /etc/ssl/pole-jeunesse/fullchain.pem   # certificat + intermédiaires
install -m 600 privkey.pem   /etc/ssl/pole-jeunesse/privkey.pem
printf 'SSL_CERTIFICAT=/etc/ssl/pole-jeunesse/fullchain.pem\nSSL_CLE=/etc/ssl/pole-jeunesse/privkey.pem\n' >> /opt/pj-secrets.env
```

puis `bash deploy.sh` depuis le Mac. Le renouvellement est alors à la charge
de la DSI (le contrôle des secrets avertit à moins de 30 jours de l'expiration) ;
demander que `/etc/ssl/pole-jeunesse` soit compris dans la sauvegarde du serveur.

## 7. Mise en service

1. La DSI fait pointer `<adresse>` vers le serveur.
2. **Changer l'adresse de la fiche administrateur.** La base est une copie de
   celle de la démo : le compte `xavier.gerinette` arrive avec l'adresse de la
   démo. Dans l'application : Administration › Administrateurs › fiche de Xavier
   GERINETTE, e-mail = `x.gerinette@ville-nogentsurmarne.fr`, enregistrer.
   Sans cela, le lien « mot de passe oublié » part vers l'ancienne adresse.
3. Vérifications ci-dessous.
4. Création des comptes de l'équipe, envoi des identifiants.
5. Communication de la nouvelle adresse à l'équipe. Les liens d'abonnement à
   l'agenda PIJ (Outlook) sont à recréer par chaque utilisateur concerné.

## 8. Vérifications

- [ ] `https://<adresse>/api/health` répond avec la bonne version.
- [ ] Connexion admin (+ 2FA si activée) ; connexion d'un animateur, qui ne voit que ses rubriques.
- [ ] Tableau de bord : 0 jeune, 0 activité, statistiques à zéro ; espaces présents.
- [ ] Créer une fiche jeune test, une inscription, un pointage, puis les supprimer.
- [ ] E-mail de création de compte et « mot de passe oublié » reçus, avec des liens vers la **nouvelle** adresse.
- [ ] Tout arrive sur `x.gerinette@ville-nogentsurmarne.fr` :
  - « mot de passe oublié » depuis l'écran de connexion avec `xavier.gerinette` ;
  - une alerte de monitoring : `ssh MAIRIE 'grep ^MAIL_ADMIN= /opt/pj-smtp.env'`
    affiche cette adresse, puis `ssh MAIRIE 'echo test | msmtp x.gerinette@ville-nogentsurmarne.fr'`
    (même chemin que les alertes du serveur) ;
  - aucune adresse de la démo (`@pressweb.fr`) dans `/opt/pj-smtp.env` ni sur la fiche.
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
