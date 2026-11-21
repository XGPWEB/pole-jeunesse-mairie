# Pôle Jeunesse — Nogent-sur-Marne

Application web de gestion du Pôle Jeunesse de Nogent-sur-Marne : suivi des
jeunes, des activités, des présences et des sorties, avec un tableau de bord
pour l'administration et une interface dédiée aux animateurs. Elle s'utilise
depuis un navigateur sur ordinateur ; il n'y a pas d'application mobile.

🌐 **Adresse** : celle du serveur de la mairie, définie par `APP_BASE_URL` dans
`/opt/pj-secrets.env` (aucune adresse n'est écrite dans le code).

> Ce dépôt repart de zéro pour la mise en service sur le serveur de la mairie
> (novembre 2026) : sans historique, sans données de démonstration. Les
> documents d'audit et de revue cités en commentaire dans certains scripts et
> tests sont conservés dans le dépôt d'origine, privé. Migration :
> [MIGRATION-SERVEUR-MAIRIE.md](MIGRATION-SERVEUR-MAIRIE.md).

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Installation locale](#installation-locale)
- [Variables d'environnement](#variables-denvironnement)
- [Base de données](#base-de-données)
- [Tests](#tests)
- [Déploiement](#déploiement)
- [Sécurité](#sécurité)
- [Conventions de code](#conventions-de-code)

---

## Fonctionnalités

### Espace administration (`/admin`)

| Module | Description |
|---|---|
| **Tableau de bord** | Vue d'ensemble, alertes (anniversaires, fins de contrat), inscriptions en attente |
| **Jeunes** | Fiches complètes, contacts d'urgence, autorisations (sortie, photo, soins), import CSV |
| **Animateurs** | Création de comptes, rôles, envoi des identifiants par email |
| **Activités** | Planification, places disponibles, inscriptions et liste d'attente |
| **Présences / Pointages** | Accueil libre et pointage par activité, saisie manuelle |
| **Sorties** | Organisation, participants, liste d'attente, demandes de modification |
| **Projets** | Suivi de projets avec budget |
| **Véhicules** | Calendrier de réservation du Renault Trafic, détection de conflits |
| **Actualités / Événements** | Publication, épinglage, ciblage par espace |
| **Notifications** | Messages vers les animateurs (ciblés ou globaux) |
| **Statistiques** | Répartition par sexe, âge, secteur, espace, jour, mois ; bilan CAF |
| **Fréquentation** | Export Excel de la fréquentation annuelle |
| **Espaces** | Gestion des espaces d'accueil |
| **Apparence** | Personnalisation du thème (couleurs, logo, modules visibles) |
| **RGPD** | Outils de conformité et gestion des données personnelles |

### Espace animateur (`/animateur`)

Vue restreinte à l'espace assigné : tableau de bord, activités, jeunes,
présences, sorties, projets, véhicules, statistiques, profil personnel.

### Espaces d'accueil

`collegiens` · `lyceens` · `pij` (Point Information Jeunesse) · `clas`
(Contrat Local d'Accompagnement à la Scolarité)

---

## Architecture

Monorepo npm workspaces.

```
app-pole-jeunesse/
├── apps/
│   ├── admin/          # Application web Next.js 16 (App Router)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (admin)/admin/       # Pages administration
│   │   │   │   ├── (animateur)/animateur/  # Pages animateurs
│   │   │   │   └── api/                 # Routes API
│   │   │   ├── lib/                     # auth, db, dates, audit…
│   │   │   ├── components/
│   │   │   └── proxy.ts                 # Contrôle d'accès par rôle et rubrique
│   │   ├── scripts/                     # Migrations SQL
│   │   └── __tests__/                   # Tests vitest
└── deploy.sh           # Script de déploiement VPS
```

### Stack technique

- **Web** : Next.js 16 (App Router, output `standalone`), React 19, TypeScript, Tailwind CSS
- **Base de données** : PostgreSQL 15 (driver `pg`, pool de connexions)
- **Authentification** : JWT HS256 (`jose`) en cookie `httpOnly`, bcrypt, TOTP (`otpauth`)
- **Emails** : `nodemailer` (SMTP)
- **Exports** : `xlsx`
- **Tests** : Vitest (unitaires) · Playwright (e2e)

### Multi-tenant

Toutes les tables métier portent une colonne `tenant_id`. Chaque requête est
filtrée par le tenant de la session, ce qui permet d'héberger plusieurs
structures sur la même instance.

---

## Prérequis

- **Node.js 24 LTS** (`nvm install && nvm use`, version majeure fixée dans `.nvmrc`, la même que sur le serveur)
- **PostgreSQL 15**
- npm 10+

---

## Installation locale

```bash
git clone https://github.com/XGPWEB/pole-jeunesse-mairie.git
cd pole-jeunesse-mairie
npm install
```

Créer la base de données :

```bash
createdb pole_jeunesse
psql -v ON_ERROR_STOP=1 -d pole_jeunesse -f apps/admin/scripts/init-db.sql
```

Configurer l'environnement (voir section suivante), puis lancer :

```bash
npm run admin      # Application web  → http://localhost:3001
```

---

## Variables d'environnement

Créer `apps/admin/.env.local` à partir de `.env.example`.

> ⚠️ Ce fichier ne doit **jamais** être commité — il est exclu par `.gitignore`.

| Variable | Requis | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://user:password@localhost:5432/pole_jeunesse` |
| `JWT_SECRET` | ✅ | Chaîne aléatoire longue. **Obligatoire en production** : l'application refuse de démarrer sans. |
| `SMTP_HOST` | | Serveur SMTP sortant |
| `SMTP_PORT` | | `465` (SSL) ou `587` (STARTTLS) |
| `SMTP_SECURE` | | `true` pour le port 465 |
| `SMTP_USER` / `SMTP_PASS` | | Identifiants SMTP |
| `MAIL_FROM` | | Adresse expéditeur affichée |
| `MAIL_ADMIN` | | Destinataire des alertes |
| `IDFM_API_KEY` | | API Île-de-France Mobilités (recherche d'itinéraires) |
| `ALLOWED_ORIGIN` | | Origine autorisée pour les en-têtes CORS |
| `TZ` | | `Europe/Paris` (voir [Conventions](#dates-et-fuseau-horaire)) |

---

## Base de données

22 tables. Schéma initial : `apps/admin/scripts/init-db.sql`.

**Migrations disponibles** (à appliquer dans l'ordre sur une base existante) :

| Fichier | Objet |
|---|---|
| `init-db.sql` | Schéma complet |
| `security-migration.sql` | Révocation de session, 2FA TOTP |
| `multi-tenant-migration.sql` | Ajout de `tenant_id` |
| `migration-espaces-v2.sql` | Refonte des espaces |
| `superadmin-migration.sql` | Rôle super-administrateur |
| `migration-pij-2026-10.sql` | Module PIJ (registre d'accueil et dossiers suivis) — à appliquer avant de déployer le module |
| `migration-pij-agenda-2026-10.sql` | Agenda PIJ (rendez-vous, liens d'abonnement iCalendar) — après la précédente, avant de déployer l'agenda |
| `migration-pij-missions-2026-10.sql` | Journal des missions des dossiers permis (reprend les heures déjà saisies) — avant de déployer le journal |
| `migration-fiche-sante-2026-10.sql` | Renseignements sanitaires des fiches jeunes (santé, vaccins, médecin, assurance, autorisations AGORA, édition « Fiche santé ») — avant de déployer la lecture des fiches AGORA |

**Sauvegardes en production** : `pg_dump` quotidien (2h00), rétention 7 jours,
plus une copie hors-site sur NAS via rsync.

---

## Tests

```bash
npm test --workspace=apps/admin          # Vitest
npm run test:watch --workspace=apps/admin
npm run test:e2e --workspace=apps/admin  # Playwright
```

Les tests unitaires couvrent l'authentification (signature/vérification JWT,
expiration, billets 2FA) et les actions de suppression (intégrité référentielle,
gardes d'autorisation).

> Les tests sont **bloquants au déploiement** : `deploy.sh` s'interrompt si un
> test échoue.

---

## Déploiement

```bash
bash deploy.sh
```

Le script enchaîne les étapes suivantes :

1. **Pré-contrôles sur le serveur** — secrets, schéma de la base et branche de Node
   (celle de `.nvmrc`), en lecture seule. `deploy.sh` n'installe ni ne met à
   jour Node : un changement de version de Node se fait à part, voir
   [`PROCEDURE-NODE.md`](PROCEDURE-NODE.md)
2. **Tests unitaires** — bloquants
3. **Build** Next.js en mode `standalone`
4. **Archives** — application, fichiers statiques, données
5. **Préparation du VPS** — PM2, scripts de sauvegarde et de
   supervision, tâches cron
6. **Installation** par `scripts/deploy-release.sh`, exécuté sur le serveur :
   - la nouvelle version est extraite dans **son propre répertoire**
     (`/opt/pj-releases/<version>-<commit>-<date>/`), avec sa configuration PM2 ;
   - `/opt/pole-jeunesse-admin` est un **lien** vers la version en service ; la
     bascule consiste à le déplacer, puis à redémarrer ;
   - la livraison n'est réussie que si `/api/health` répond et annonce **la
     version, le commit et l'identifiant de release attendus** ;
   - sinon le script **revient seul à la version précédente**, et ne le déclare
     fait que si l'application annonce l'identité de cette version ;
   - la version précédente complète est conservée après une réussite.
7. **Nginx** — configuration et rechargement

Les données écrites sur disque par l'application (archives CAF) vivent dans
`/opt/pj-shared/data`, commun à toutes les versions.

### Retour arrière

**Automatique** : si la nouvelle version ne démarre pas, répond en erreur ou
n'annonce pas la bonne version, `deploy.sh` affiche « VERSION DÉFAILLANTE —
retour arrière OK » et l'ancienne version est de nouveau en service. Ne pas
taguer la version ; corriger puis relancer.

**Manuel**, pour une version qui démarre bien mais se révèle mauvaise à l'usage :

```bash
bash deploy.sh --retour-arriere
```

Rien n'est construit ni transféré : le serveur repasse sur l'autre version
conservée, avec la configuration qui était la sienne. Relancer la commande
revient à la version quittée.

**Une bascule n'est jamais déduite d'un lien déplacé ni d'une simple réponse
saine.** Si PM2 ne redémarre rien, c'est l'ancien processus qui répond : le
script exige donc que l'application annonce l'identité de la version visée
(version, commit, et identifiant de release quand le build l'annonce). Chaque
version garde la sienne dans `<version>/.pj/identite`.

| Code de `--retour-arriere` | Signification |
|---|---|
| 0 | version précédente en service, identité vérifiée |
| 1 | retour **non effectué** : la version de départ est en service, le lien et la configuration la désignent |
| 3 | état non confirmé : intervention requise |

Après une livraison défaillante, `deploy.sh` distingue de même « retour arrière
OK » (vérifié) de « SITE À VÉRIFIER » (code 3) : dans ce dernier cas aucune
version n'est renommée ni supprimée, et le message dit laquelle répond.

Une version installée avant ce contrôle n'a pas de fichier d'identité : le
script le reconstitue d'après le nom de son répertoire
(`<version>-<commit>-<date>-<heure>`), sinon d'après la version inscrite dans
son `apps/admin/package.json`. S'il n'y parvient pas, il refuse de basculer
vers elle ; on peut alors l'écrire à la main :

```bash
printf 'version=2.1.6\ncommit=62f196c\nrelease=avant-releases\nsante_release=0\norigine=manuel\n' > /opt/pj-releases/<version>/.pj/identite
```

Un retour arrière ne touche **pas à la base de données**. Si la version quittée
avait demandé une migration, vérifier dans le suivi de la livraison que
l'ancienne version fonctionne avec le schéma migré (c'est le cas des
migrations d'octobre 2026, toutes additives).

**En dernier recours**, si `deploy.sh` affiche « SITE À VÉRIFIER » :

```bash
ssh root@<serveur>
pm2 status ; ls -l /opt/pole-jeunesse-admin /opt/pj-releases
# choisir une version complète (pas un dossier .echec), puis :
ln -sfn /opt/pj-releases/<version> /opt/pole-jeunesse-admin
cp /opt/pj-releases/<version>/.pj/ecosystem.config.js /opt/pj-ecosystem.config.js
pm2 startOrRestart /opt/pj-ecosystem.config.js --update-env
curl -s http://127.0.0.1:3000/api/health   # doit annoncer la version choisie
```

Si PM2 refuse ou ne répond pas : `pm2 status`, `pm2 logs pole-jeunesse-admin`,
et en dernier ressort `pm2 delete pole-jeunesse-admin` puis
`pm2 start /opt/pj-ecosystem.config.js`.

Le mécanisme se teste sans serveur : `bash scripts/test-deploy-release.sh`.

### Contrôles d'exploitation

Deux scripts se lancent depuis le poste de développement et s'exécutent sur le
serveur. Aucun ne modifie la base en service.

```bash
ssh root@<serveur> 'bash -s' < scripts/controle-serveur.sh
```

Constat en lecture seule : écoute réseau de l'application, pare-feu, versions
installées et leur identité, contraintes en base, sauvegardes. N'affiche aucun
secret ni aucune donnée personnelle.

```bash
ssh root@<serveur> 'sudo -u postgres bash -s' < scripts/test-restauration-sauvegarde.sh
```

Restaure la sauvegarde la plus récente dans une base **jetable**, mesure le
temps de restauration, contrôle ce qui a été restauré, compare avec la base en
service (lecture seule), puis supprime la base jetable. À refaire de temps en
temps : une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde
éprouvée.

```bash
ssh root@<serveur> 'bash -s' < scripts/controle-couverture-sauvegardes.sh
```

Constat en lecture seule de ce que couvrent les sauvegardes : pour chaque
élément nécessaire à la reconstruction du serveur (données sur disque, secrets,
configuration Nginx et PM2, certificats), dit s'il existe et s'il figure dans
une archive. N'affiche aucun secret, n'extrait aucune archive. L'état constaté
et la procédure de reconstruction sont dans les documents d'audit (dépôt d'origine, privé).

La sauvegarde de chaque nuit (`/opt/scripts/backup-db.sh`, écrit par
`deploy.sh`) produit deux fichiers dans `/opt/backups/pj-db` : le dump de la
base (`pj-<date>.sql.gz`) et l'archive des fichiers de l'application
(`pj-data-<date>.tar.gz`, soit `/opt/pj-shared/data`, dont les archives CAF).
Les deux sont conservés sept jours. Pour restaurer les fichiers :
`tar -xzf pj-data-<date>.tar.gz -C /opt/pj-shared`. Ce script se teste en
local, sur une base jetable, par `bash scripts/test-backup-db.sh`.

```bash
bash scripts/test-reprise-isolee.sh <fichier.sql.gz>
```

Celui-ci se lance **ailleurs que sur le serveur** (poste de développement,
machine de recette), sur une copie de sauvegarde : restauration dans une base
jetable locale, rejeu des migrations manquantes, contrôle du schéma et de
l'intégrité, puis démarrage de l'application sur la base restaurée et parcours
représentatifs avec un compte temporaire créé dans la copie. Il mesure le temps
de reprise. La sauvegarde contient des données personnelles : la supprimer du
poste après l'essai.

### Infrastructure de production

- **PM2**, un seul processus, redémarrage automatique, limite mémoire 512 Mo ;
  l'application est configurée pour n'écouter que sur `127.0.0.1`. La
  configuration demande le mode `fork` ; le processus créé avant octobre 2026
  tourne encore en mode `cluster`, PM2 ne changeant pas de mode sur un simple
  redémarrage (sans effet avec un seul processus)
- **Nginx** en reverse proxy, SSL Let's Encrypt, en-têtes de sécurité (HSTS,
  X-Frame-Options, CSP, Referrer-Policy)
- **Supervision** : `GET /api/health` vérifié toutes les 5 minutes, alerte email
  en cas d'indisponibilité

### Gestion des secrets

Aucun identifiant n'est présent dans le dépôt. En production, les secrets sont
lus depuis des fichiers `chmod 600` sur le serveur (`/opt/pj-secrets.env`,
`/opt/pj-smtp.env`) et injectés dans la configuration PM2 au déploiement.
`deploy.sh` échoue explicitement si ces fichiers sont absents.

---

## Sécurité

- **Authentification** : JWT HS256 en cookie `httpOnly` + `secure` + `sameSite`,
  validité 30 jours (durée actuelle, à valider avec la DSI)
- **Révocation de session** : colonne `session_invalidated_at` vérifiée à chaque
  requête ; la déconnexion et le changement de mot de passe invalident toutes
  les sessions actives
- **2FA TOTP** pour les comptes administrateurs (compatible Google Authenticator)
- **Limitation du débit** sur la connexion et la réinitialisation de mot de passe,
  indexée sur `X-Real-IP` (posé par Nginx, non falsifiable)
- **Contrôle d'accès** vérifié à trois niveaux : middleware, routes API et server
  actions — chacun revalide le rôle plutôt que de faire confiance à la couche
  précédente
- **Journal d'audit** : connexions, échecs, changements de mot de passe,
  modifications de profil, activation/désactivation du 2FA
- **Mots de passe** hachés avec bcrypt ; comparaison à temps constant même sur
  compte inexistant, afin d'empêcher l'énumération de comptes

---

## Conventions de code

Ces règles découlent de bugs réellement rencontrés en production. Les respecter
évite de les reproduire.

### Dates et fuseau horaire

Le serveur est en UTC, les utilisateurs en `Europe/Paris`.

```js
// ❌ Renvoie TOUJOURS la date UTC — donc la veille entre 00 h et 02 h à Paris
const today = new Date().toISOString().split('T')[0];

// ✅ Utiliser le helper local
import { todayLocal, toLocalDateStr } from '@/lib/dates';
const today = todayLocal();
```

`TZ=Europe/Paris` est défini dans la configuration PM2 pour que les getters
locaux (`getDate()`, `getDay()`…) renvoient l'heure de Paris. **Cela ne corrige
pas `toISOString()`**, qui reste en UTC en toutes circonstances.

### Colonnes `DATE` en PostgreSQL

Toujours convertir en texte dans les `SELECT`, sinon la valeur est sérialisée en
`"2026-06-15T00:00:00.000Z"` et casse les comparaisons de chaînes côté client.

```sql
SELECT date::text AS date, date_naissance::text AS "dateNaissance" FROM …
```

### Identifiants

```js
import { randomUUID } from 'crypto';
const id = `act-${randomUUID()}`;   // ✅
const id = `act-${Date.now()}`;     // ❌ collision si deux créations simultanées
```

### Gestion des erreurs

Ne jamais laisser un `catch` muet : une erreur avalée est invisible dans les
logs et rend le diagnostic très coûteux.

```js
} catch (err) {
  console.error('[api/activites]', err);
  return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
}
```

---

## Licence

Projet privé — Ville de Nogent-sur-Marne.

## Versions et releases

Le paquet racine et l'interface d'administration portent **un seul numéro de version** `MAJOR.MINOR.PATCH`.

| Incrément | Quand | Exemple |
|---|---|---|
| `patch` | correction compatible | `2.1.0` → `2.1.1` |
| `minor` | ajout compatible (nouvelle fonctionnalité, nouvel écran…) | `2.1.1` → `2.2.0` |
| `major` | changement incompatible (API, format de données, migration ou variable d'environnement désormais exigée…) | `2.2.0` → `3.0.0` |

- **Source de vérité** : le fichier [`VERSION`](VERSION). Les champs `version` des `package.json` et du `package-lock.json` en sont des copies, synchronisées uniquement par [`scripts/version.mjs`](scripts/version.mjs).
- **Historique** : [`CHANGELOG.md`](CHANGELOG.md), en français, avec une section « À venir » pour ce qui est fusionné mais pas encore versionné.
- **Identification d'une version livrée** : un tag Git annoté `vX.Y.Z` sur le commit validé de `main`. Seul le tag fait foi.
- **Version affichée** : chaque build embarque sa version et son commit (suffixé de « -modifié » s'il a été construit avec des modifications non commitées). Visible en pied de menu, sur la page Monitoring et dans `/api/health`.
- **Contrôle automatique** : `node scripts/version.mjs check` (exécuté en CI) échoue si `VERSION`, les `package.json`, le `package-lock.json` et `CHANGELOG.md` ne concordent pas.

### Publier une version

1. Sur une branche à partir de `main` à jour : `node scripts/version.mjs patch` (ou `minor`, `major`, `X.Y.Z`).
2. Dans `CHANGELOG.md`, déplacer le contenu de « À venir » sous `## [X.Y.Z]`.
3. `node scripts/version.mjs check`, puis les vérifications de la section précédente ; commit, pull request, fusion.
4. Déployer (`deploy.sh`), vérifier que `/api/health` renvoie la version attendue.
5. Tag annoté sur le commit déployé, puis release GitHub avec la section du changelog :

   ```bash
   git tag -a vX.Y.Z -m "Pôle Jeunesse X.Y.Z" <commit>
   ```

   ```bash
   git push origin vX.Y.Z
   ```

   ```bash
   gh release create vX.Y.Z --verify-tag --title "Pôle Jeunesse X.Y.Z" --notes-file <section du changelog> --latest
   ```

## Monitoring

Page **Monitoring** de l'administration (réservée aux administrateurs de la commune exploitante, `MONITORING_OWNER_TENANT`, `nogent` par défaut) : journal des erreurs du serveur et du navigateur, des quotas de tentatives épuisés et des échecs signalés par les scripts du serveur. Un courriel part à `MAIL_ADMIN` au plus une fois par type toutes les 30 minutes.

- Point d'entrée unique : `logMonitoringEvent()` dans `apps/admin/src/lib/monitoring.ts`. Il ne lève jamais : un journal en panne ne casse pas la requête qui signale.
- Les erreurs serveur sont captées par `apps/admin/src/instrumentation.ts`. Convention à respecter dans tout nouveau `catch` : `console.error('[api/ma-route]', err)` — c'est cette étiquette entre crochets qui fait de la trace un événement.
- Scripts du serveur : définir `INTERNAL_MONITORING_SECRET` (32 caractères au moins) dans `/opt/pj-secrets.env` pour que la sauvegarde et le contrôle de la copie NAS signalent leurs échecs au journal. Sans ce secret, la route interne répond 404 et seuls les courriels existants partent.
- La surveillance de disponibilité reste celle du serveur (`check-health.sh` toutes les 5 minutes) : une application arrêtée ne peut pas écrire dans son propre journal.
