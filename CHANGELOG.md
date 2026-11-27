# Changelog

Toutes les évolutions notables de Pôle Jeunesse (interface d'administration `apps/admin`, application mobile `apps/mobile`, paquet partagé) sont consignées ici. Elles partagent **un seul numéro de version**, défini dans le fichier [`VERSION`](VERSION) à la racine.

Le format s'inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et la numérotation suit [SemVer](https://semver.org/lang/fr/) :

- **PATCH** (`2.1.x`) : correction compatible ;
- **MINOR** (`2.x.0`) : ajout compatible ;
- **MAJOR** (`x.0.0`) : changement incompatible (API, format de données, configuration ou migration exigée…).

Rubriques possibles dans chaque version : *Ajouté*, *Modifié*, *Corrigé*, *Sécurité*, *Supprimé*. Une date n'est inscrite qu'au moment où la version est effectivement validée et taguée ; la procédure est décrite dans le README, section « Versions et releases ».

## [À venir]

## [2.15.1]

### Corrigé

- **Déploiement : l'adresse du site n'était pas transmise à l'application.** `APP_BASE_URL` était contrôlée et utilisée par Nginx, mais absente de la configuration PM2 : en production, « mot de passe oublié » et l'envoi des identifiants échouaient (« APP_BASE_URL manquant »). `ALLOWED_ORIGIN` et `MONITORING_OWNER_TENANT` sont désormais transmises aussi. Test de déploiement ajouté.

## [2.15.0]

### Ajouté

- **Adresse du site configurable** : l'adresse vient d'un seul réglage du serveur, `APP_BASE_URL` (`/opt/pj-secrets.env`), et n'est plus écrite dans le code ni dans `deploy.sh` (courriels, lien de réinitialisation, CORS, Nginx, supervision). Le contrôle des secrets l'exige, sous la forme `https://<domaine>`.
- **Certificat au choix** : Let's Encrypt par défaut, ou le certificat fourni par la mairie (`SSL_CERTIFICAT` et `SSL_CLE`). Le contrôle des secrets vérifie la clé et la validité du certificat, et la configuration Nginx précédente est rétablie si la nouvelle est refusée.
- Profil et fiche d'un agent : mention d'information RGPD (responsable, finalité, base légale, données, destinataires, conservation, droits et contact du DPO, réclamation à la CNIL), tirée du registre des traitements, dont la liste des données des comptes est complétée.
- Registre RGPD : coordonnées du délégué à la protection des données mutualisé d'Infocom 94 (courriel, téléphone, adresse, affichée sur la page RGPD). La date de désignation et le numéro CNIL, non vérifiés, sont à compléter.

### Sécurité

- Sessions : fermeture après 10 minutes sans action, avec un avertissement une minute avant, et reconnexion obligatoire chaque jour (24 heures au plus après la connexion) au lieu de 30 jours. Les sessions ouvertes avant la mise à jour sont fermées.
- Mots de passe : 12 caractères au minimum au lieu de 8, pour tout nouveau mot de passe.

### Corrigé

- Courriels : l'expéditeur vient de `MAIL_FROM` et non plus du compte de connexion SMTP, qui peut être un identifiant technique sur la messagerie de la mairie ; sans adresse d'expédition valide, l'envoi échoue avec un message explicite.
- Courriel d'identifiants : la signature affiche l'adresse d'expédition au lieu d'une ancienne adresse écrite en dur.
- Page Équipe : retrait des messages « copie envoyée à … », faux (aucune copie n'était envoyée).

## [2.14.0]

### Sécurité

- **Connexion par jeton retirée.** Elle n'existait que pour l'application mobile, retirée en 2.13.0. Seul le cookie de session sécurisé (`httpOnly`) permet désormais de se connecter ; un jeton présenté dans l'en-tête `Authorization: Bearer` est ignoré. Le serveur offre ainsi une porte d'entrée de moins.

### Supprimé

- **API de l'application mobile** : `POST /api/auth/mobile/login` et `GET /api/jeunes/[id]/fiche`. L'interface web ne les utilisait pas et ne change pas.

## [2.13.0]

### Supprimé

- **Application mobile.** Pôle Jeunesse s'utilise uniquement depuis un navigateur sur ordinateur : l'application Expo / React Native (`apps/mobile`), le paquet partagé qu'elle seule utilisait (`packages/shared`), sa configuration et ses tests sont retirés du dépôt. L'interface web ne change pas.

### Sécurité

- **Plus aucune alerte `npm audit`**, dépendances de développement comprises : 699 paquets en moins avec l'outillage Expo, et mise à jour de `vite` et `postcss-selector-parser`.

## [2.12.5]

### Sécurité

- **PostCSS 8.5.33 pour toutes les dépendances.** Une ancienne version restait utilisée au build par Tailwind et autoprefixer. Corrige une injection dans le CSS produit et des lectures de fichiers via `sourceMappingURL` (GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849). Plus aucune alerte `npm audit` sur l'interface d'administration.

## [2.12.4]

### Sécurité

- **Next.js 16.4.6.** Corrige des failles de Next.js 16.0.0 à 16.4.4 : fuite et empoisonnement de cache entre utilisateurs avec `use cache`, injection et divulgation de réponses entre clients dans une application auto-hébergée, exposition de cookies HttpOnly sur les routes Edge, contournement du refus des SVG dans l'optimisation d'images (GHSA-mfr8-8qww-v76h, GHSA-vc7v-qv4w-wrv8, GHSA-pc58-hwjq-p385, GHSA-rhh4-g77r-r9qj, GHSA-f3mh-rxg3-f5g2, GHSA-7qx7-33qx-rqx2).

### Supprimé

- **Données de démonstration.** Plus aucun fichier JSON de démonstration dans le dépôt ni dans le code (`lib/data.ts` ne lit plus de fichier) ; `rgpd.json` ne contient plus de demandes de droits ni de consentements.

### Ajouté

- **Remise à zéro de la base avant mise en service** (`scripts/remise-a-zero.sh`, simulation par défaut, sauvegarde automatique) et guide de migration vers le serveur de la mairie (`MIGRATION-SERVEUR-MAIRIE.md`).

## [2.12.3]

### Corrigé

- **Agenda PIJ : pas de rendez-vous après 19:00.** L'informatrice termine sa journée à 19:00 : un rendez-vous doit désormais finir au plus tard à cette heure, à la création comme à la modification (message clair sinon), et le formulaire l'indique sous « Heure de fin ». Les rendez-vous pris depuis l'application externe de réservation suivent la même limite, appliquée par celle-ci.

## [2.12.2]

### Corrigé

- **Agenda PIJ : pas de pointage avant l'heure du rendez-vous.** Un rendez-vous ne peut plus être marqué « honoré » ou « absent » avant son heure de début (heure de Paris). Un rendez-vous pris par un jeune dans l'application externe de réservation et pointé « honoré » à l'avance y faisait valider sa présence dès l'heure venue, même s'il ne venait pas. La fiche n'affiche les boutons de pointage qu'une fois le rendez-vous commencé (avec l'heure à partir de laquelle c'est possible), et le formulaire grise ces deux statuts pour un rendez-vous à venir. « Prévu » et « Annulé » restent possibles à tout moment.

## [2.12.1]

### Corrigé

- **Agenda PIJ : un rendez-vous annulé depuis l'application externe de réservation ne peut plus être pointé.** Depuis une fiche restée ouverte, on pouvait encore marquer « honoré » un rendez-vous qui venait d'y être annulé : il réapparaissait alors dans l'agenda. Le pointage est désormais refusé, avec un message invitant à recharger la page, et la fiche d'un tel rendez-vous l'indique sans bouton de pointage.

## [2.12.0]

### Modifié

- **Agenda PIJ : plus de rendez-vous qui se chevauchent.** Une seule informatrice reçoit : un rendez-vous qui chevauche un autre rendez-vous non annulé (y compris ceux pris depuis l'application externe de réservation) est refusé, avec le créneau déjà occupé dans le message (« chevauche le rendez-vous de Léa D. (14:00 – 14:30) »). Deux rendez-vous dos à dos (14:00–14:30 puis 14:30–15:00) restent possibles, un rendez-vous annulé libère son créneau, et deux saisies simultanées sur le même créneau ne peuvent pas passer toutes les deux.
- **Créneaux avec heure de début et de fin.** Le formulaire demande l'heure de début et l'heure de fin (au lieu d'une durée à choisir) ; déplacer le début décale la fin en gardant la durée. Le calendrier, la liste des prochains rendez-vous et la fiche affichent le créneau complet.

## [2.11.0]

### Ajouté

- **Agenda PIJ : synchronisation avec une application externe de réservation.** Les rendez-vous PIJ pris, déplacés ou annulés par les jeunes dans cette application apparaissent dans l'agenda, avec une mention sur la fiche. Ils se pointent ici (« Marquer honoré », « Marquer absent ») et le pointage lui est reporté ; leur date, leur heure et leur annulation restent gérées par l'application externe. En retour, elle lit l'agenda pour ne plus proposer les créneaux déjà pris par l'équipe.
- **Route de synchro `/api/pij/hub/rdv`** (lecture et écriture), réservée au serveur de l'application externe : secret partagé `HUB_SYNC_SECRET` (32 caractères au moins) et commune `HUB_SYNC_TENANT_ID`, à définir dans `/opt/pj-secrets.env`. Sans eux, la route répond 404. Elle ne renvoie ni nom complet, ni téléphone, ni notes.

### Sécurité

- **Next.js 16.4.3 et nodemailer 10.2.1.** Corrige une exécution de code à distance sans authentification et un déni de service dans Next.js (16.0.0 à 16.4.0), et une injection de destinataires dans l'analyse des adresses de nodemailer (jusqu'à 10.1.3).

### Migration

- **`migration-pij-hub-2026-10.sql`** (colonne `pij_rdv.hub_id` et index unique `uq_pij_rdv_hub`) : à appliquer avant le déploiement ; `check-deploy-schema.sh` l'exige.

## [2.10.3]

### Sécurité

- **Envoi d'identifiants : plus d'essais illimités de mot de passe.** L'envoi vérifie que le mot de passe transmis est celui du compte : cette vérification est désormais limitée à 5 essais par 15 minutes et par compte, sur le même compteur que Mon profil, la double authentification et la fiche du titulaire. Alterner les écrans ne donne pas d'essais supplémentaires, et une réussite n'efface pas les échecs précédents. Retour de revue de Codex du 20 octobre ; rapport : `REVUE-CLAUDE-2026-10-20.md`.

### Corrigé

- **« Réinitialisation demandée » (page Équipe) : un mot de passe non enregistré n'est plus proposé à la transmission.** Si l'enregistrement est refusé, l'écran l'indique et ne propose plus de communiquer le mot de passe à la main ; ce secours ne s'affiche que si le mot de passe est bien enregistré et que seul le courriel a échoué. Tests navigateur ajoutés.

## [2.10.2]

### Corrigé

- **Création d'un compte : « Le mot de passe doit contenir au moins un caractère spécial ».** Depuis la 2.10.1, les comptes créés par un administrateur respectent la politique de mot de passe, mais le mot de passe proposé par l'écran ne la respectait qu'environ 4 fois sur 10 : la création échouait le plus souvent. Il est désormais toujours conforme (12 caractères, majuscule, minuscule, chiffre et caractère spécial, tirage cryptographique), à la création comme pour « Générer » et la réinitialisation depuis la page Équipe. Test E2E de création ajouté.

### Modifié

- **Node 24 LTS pour le développement, la CI et les livraisons.** `.nvmrc` passe à 24 et la CI le lit. `deploy.sh` n'installe et ne met plus jamais à jour Node : il vérifie avant tout que le serveur tourne sur la branche de `.nvmrc` et s'arrête sinon. Le changement de version de Node du serveur se fait à part, par `scripts/mettre-a-jour-node.sh` (dépôt NodeSource existant et même clé, version exacte du paquet, needrestart neutralisé, `pm2 update`, retour automatique au paquet de départ), rejoué en CI par `scripts/test-mettre-a-jour-node.sh`. Le serveur est passé à Node 24.22.0 le 20 octobre ; déroulé et procédure : `PROCEDURE-NODE.md`.

## [2.10.1]

### Sécurité

- **Audit du 19 octobre (S01–S12), porté sur la 2.10.0 :** bons de commande contrôlés par leur contenu (PDF, PNG, JPEG, WEBP, 5 Mo), anciens fichiers non conformes servis en téléchargement neutre ; fermeture des contournements de rubriques (identifiant contenant une extension d’image, fiche détaillée d’un jeune, envoi de notifications, réinitialisation administrative, flux iCalendar PIJ) ; un admin sans « gère les droits » crée des comptes dont le menu est borné par le sien ; politique de mot de passe commune aux actions administratives ; traces `ACCOUNT_CREATED` / `ACCOUNT_UPDATED` dans la transaction. Rapport : `AUDIT-2026-10-19.md`.
- **Récupération des comptes :** changer son adresse e-mail, dans Mon profil comme sur sa propre fiche, exige le mot de passe actuel ; les changements de secret ou d’adresse révoquent les sessions et les anciens liens ; les émissions simultanées de liens sont sérialisées et l’adresse destinataire est relue sous verrou.
- **Courriels d’identifiants :** destinataire pris sur la fiche (et non dans la requête), mêmes protections que la réinitialisation, mot de passe envoyé identique à celui enregistré, contenu échappé. Les écrans enregistrent le mot de passe avant de l’afficher, le copier ou l’envoyer.
- **Défense en profondeur :** les routes API vérifient elles-mêmes les rubriques lues en base, en plus du proxy ; mutations API d’une origine navigateur étrangère refusées ; `unsafe-eval` retiré de la CSP de production, `object-src 'none'` ajouté ; `tar` 7.5.22 et `shell-quote` 1.12.0. Contre-revue : `REVUE-CLAUDE-2026-10-19.md`.

## [2.10.0]

### Modifié

- **Les administrateurs quittent l'équipe d'animation.** Ils supervisent et ne font pas partie des effectifs : la page Équipe › Animateurs ne liste plus que les animateurs, et les administrateurs ont leur propre page, Administration › Administrateurs, visible seulement du compte qui gère les droits. Leur fiche et le formulaire de création n'ont plus d'espace assigné, de type de contrat ni de date d'embauche. Ils ne sont plus proposés comme animateur référent d'une activité, ni dans la saisie des congés, ni comptés dans les animateurs d'un espace. Demande de Xavier.

## [2.9.1]

### Modifié

- **Page Équipe : animateurs et administrateurs séparés, réglage des accès plus simple.** Deux onglets (Animateurs, Administrateurs), chacun avec son bouton de création ; une colonne « Accès au menu » (« Menu complet » ou « 4 rubriques sur 11 »). Sur la fiche, un interrupteur par rubrique avec une ligne d'explication, des profils types (Animateur collège / lycée, Informateur PIJ, Tout le menu) et l'aperçu du menu que verra la personne. Le choix animateur / administrateur quitte ce bloc : il devient un bouton « Passer administrateur » / « Repasser animateur » dans « Gestion du compte ». Retours de Xavier sur la 2.9.0.

## [2.9.0]

### Ajouté

- **Accès au menu réglable compte par compte.** Page Animateurs, à la création comme sur la fiche d'un compte : choix du rôle (animateur ou administrateur) et une case par rubrique du menu latéral (20 côté admin, 11 côté animateur ; le tableau de bord reste toujours accessible). Une rubrique décochée disparaît du menu et est refusée côté serveur (pages, routes API, server actions). Les comptes existants gardent tout leur accès. Seul le compte marqué « gère les droits » (posé par la migration sur `xavier.gerinette`) choisit le rôle et les rubriques ; les autres admins ayant la rubrique Animateurs créent des animateurs au menu complet et modifient les fiches, sans toucher aux droits ni au compte de Xavier. Personne ne peut changer ses propres accès, son rôle ou son statut. Un compte dont on change les accès doit se reconnecter. **Migration à appliquer avant le déploiement : `apps/admin/scripts/migration-rubriques-2026-10.sql`** (contrôlée par `check-deploy-schema.sh`).

## [2.8.2]

### Corrigé

- **« Mot de passe oublié » : le lien de réinitialisation arrive de nouveau par e-mail.** Tout compte (animateur, admin ou superadmin) dont la fiche porte une adresse reçoit directement à cette adresse un lien à usage unique, valable 30 minutes. Sans adresse, les admins de la structure sont prévenus, comme avant. Le compte superadmin était oublié : sa demande partait vers une structure sans admin et se perdait sans bruit.

## [2.8.1]

### Corrigé

- **Tableau de bord : les quatre cartes « Répartition par espace » ont la même présentation.** La carte PIJ portait une ligne de légende de plus que les autres, ce qui décalait sa barre. La légende (« Personnes reçues ou suivies par le PIJ ») passe en info-bulle au survol de la carte.

## [2.8.0]

### Ajouté

- **Actualités : les événements passés sont archivés d'eux-mêmes.** Une actualité de catégorie « Événement » quitte la liste dès le lendemain de sa date : elle n'apparaît plus dans la page Actualités, ni dans le fil et le compteur du tableau de bord, ni sur le tableau de bord des animateurs. Rien n'est supprimé : un filtre « Archives » les regroupe, et il suffit de modifier la date ou la catégorie pour remettre une actualité à l'affiche. Les autres catégories (info, annonce, urgence…) ne s'archivent pas. Pour un événement, le champ de date s'intitule désormais « Date de l'événement » : c'est elle qui déclenche l'archivage — une annonce saisie avec sa date de publication plutôt que celle de l'événement serait archivée trop tôt.

### Corrigé

- **Actualités : un seul filtre « Événement ».** Les actualités saisies à deux époques (« Evenement » et « evenement ») donnaient deux filtres du même nom ; ils sont réunis. Les libellés de la page retrouvent leurs accents.

## [2.7.0]

### Modifié

- **Tableau de bord : la carte PIJ compte enfin les jeunes du PIJ.** Dans « Répartition par espace », la carte PIJ restait à 0 : elle ne comptait que les fiches jeunes, alors que le PIJ tient son propre registre. Elle affiche maintenant le nombre de personnes distinctes reçues à l'accueil ou suivies dans un dossier (permis, chantier, bourse), auxquelles s'ajoutent les éventuelles fiches jeunes rattachées au PIJ ; une même personne venue plusieurs fois ne compte qu'une fois. Le chiffre « Jeunes inscrits » ne change pas : il reste le nombre de fiches jeunes. Les barres des cartes comparent désormais les espaces entre eux.

## [2.6.2]

### Corrigé

- **Nouveau jeune : l'espace n'est plus présélectionné à l'aveugle.** Le formulaire proposait d'office le premier espace de la liste par ordre alphabétique — le CLAS. Tant que tout se saisissait à la main, on le corrigeait au passage ; depuis que la fiche AGORA remplit le reste, des jeunes ont été enregistrés en CLAS sans que personne l'ait choisi, et ils n'apparaissaient pas dans « Pointer un jeune », réservé aux Collégiens et Lycéens. Désormais aucun espace n'est choisi d'avance quand la commune en a plusieurs : après lecture d'une fiche AGORA, l'application propose celui qui correspond à l'âge du jeune (d'après la tranche d'âge des espaces) et le signale ; sinon le champ reste à remplir, surligné, et l'enregistrement attend ce choix. Les jeunes déjà rangés par erreur sont à corriger à la main (« Modifier la fiche »).

## [2.6.1]

### Corrigé

- **Lecture de la fiche santé AGORA : un régime alimentaire n'est plus pris pour un contact.** AGORA n'imprime la rubrique « Régime(s) alimentaire(s) » que pour les jeunes qui ont un régime ; elle se trouve juste sous les contacts, et ses lignes (« Sans porc ») étaient ajoutées aux contacts de la famille. La fiche santé est maintenant découpée rubrique par rubrique, d'après les titres : le régime va dans « Régimes alimentaires », une rubrique « Allergie(s) » dans les allergies, et une rubrique médicale que l'application ne connaît pas est reportée avec son titre dans « Maladies / traitements » plutôt que perdue ou mal rangée. Les fiches déjà enregistrées avec un faux contact sont à corriger à la main (retirer le contact, saisir le régime).

## [2.6.0]

### Ajouté

- **Nouveau jeune : la fiche se remplit à partir des éditions AGORA.** En haut du formulaire (création et modification), « Choisir les fiches AGORA » accepte la *fiche enfant* et la *fiche santé* en PDF, ensemble ou séparément. L'application les lit et remplit identité, date et lieu de naissance, adresse, scolarité, responsables et contacts (téléphones, courriel), autorisations, allergies, maladies, régimes, vaccins, médecin traitant et assurance. Rien n'est enregistré tant que la personne n'a pas vérifié et validé ; l'espace et le quartier restent à choisir. Les deux PDF sont conservés avec la fiche (« Imprimer la fiche AGORA », « Imprimer la fiche santé »). Une fiche qui concerne un autre jeune que celui en cours de saisie est refusée. Le numéro de sécurité sociale et les données d'allocataire présents sur ces éditions ne sont pas repris. Une image ou un PDF numérisé ne peut pas être lu : il peut être joint, les champs restent à saisir.
- **Fiche jeune : rubrique Santé.** Allergies, maladies et traitements, régimes, vaccins avec date du dernier rappel, médecin traitant, assurance, hospitalisation, lieu de naissance, et trois autorisations reprises d'AGORA (mesures d'urgence, sortir seul, sortir avec un mineur de plus de 11 ans) qui distinguent « Non » de « Non renseigné ». L'autorisation jusqu'ici libellée « Fiche sanitaire » s'appelle désormais « Soins bénins », ce qu'elle a toujours désigné.
- **Sorties : fiches sanitaires des participants, à la demande.** Un bouton « Fiches sanitaires » (liste et détail des sorties, et sur la fiche sortie imprimable) ouvre une page à part : une feuille A4 par participant confirmé, composée depuis sa fiche. Rien ne s'imprime d'office et la fiche sortie ne change pas : l'animateur décoche les jeunes dont il a déjà la fiche, puis imprime les autres.

Exige la migration `migration-fiche-sante-2026-10.sql`, à appliquer avant la mise en service.

## [2.5.0]

### Modifié

- **Menu latéral rangé par familles.** Le menu de l'administration alignait 21 entrées sans regroupement, outils du quotidien et réglages rares mêlés. Il est désormais rangé en cinq familles titrées — Jeunes, Programme, Équipe, Bilans, Communication — et les réglages (espaces, apparence, RGPD, paramètres, monitoring) sont repliés sous une ligne « Administration », qui s'ouvre d'un clic. Les émojis sont remplacés par des pictogrammes au trait, tous du même style ; quelques libellés sont raccourcis (« Sorties », « Projets », « Véhicule », « Notifications ») ; le nom de la personne connectée et la déconnexion sont réunis en bas. Le menu des animateurs suit les mêmes familles. L'ordre des entrées est maintenant fixe : on ne peut plus les faire glisser, mais chacun peut toujours masquer celles dont il ne se sert pas (« Personnaliser le menu » pour un administrateur, « Mon profil » pour un animateur) ; les entrées déjà masquées le restent.

## [2.4.1]

### Modifié

- **Module PIJ : l'onglet « BAFA » est retiré de la rubrique Dossiers**, à la demande du PIJ. Restent Permis de conduire, Chantiers jeunes et Bourses. Le BAFA demeure un objet de demande dans le registre d'accueil et dans les statistiques. Aucune donnée n'est supprimée.

## [2.4.0]

### Ajouté

- **Dossiers permis : journal des missions réalisées.** Jusqu'ici un dossier permis portait un seul chiffre « déjà réalisé » et un texte libre, qu'il fallait réécrire en passant par « Modifier » : aucune trace de ce qui avait été fait, ni quand, ni par qui. La fiche du dossier comporte maintenant une rubrique « Missions réalisées » : on y ajoute directement une mission (date, intitulé, nombre d'heures), sans ouvrir la modification. Les heures se déduisent aussitôt des heures à réaliser, la barre d'avancement et la liste suivent, et chaque ligne garde le nom de la personne qui l'a saisie et la date de saisie. Une mission saisie par erreur peut être retirée ; ses heures reviennent au reste à faire. Les heures déjà enregistrées sur les dossiers existants sont reprises comme première ligne du journal : aucun total ne change. Mêmes droits que le reste du module. Exige la migration `migration-pij-missions-2026-10.sql`, à appliquer avant la mise en service.

## [2.3.3]

### Modifié

- **Module PIJ : liste des jeunes resserrée, fiche en grand.** Retour d'usage du 2026-10-09 : les noms étaient trop gros, la fiche coincée dans une colonne étroite, et une liste de cent noms aurait été pénible à parcourir. La présentation est inversée, à la manière d'un carnet d'adresses : à gauche une liste étroite, un nom par ligne (avec l'âge et une pastille de couleur pour l'état), classée de A à Z avec un repère par lettre et une barre de lettres pour sauter directement à une initiale ; à droite la fiche du jeune sur toute la largeur restante, avec ses rubriques côte à côte sur grand écran. La liste et la fiche défilent chacune dans leur cadre, sans faire bouger la page. La recherche est placée au-dessus de la liste ; on peut aussi classer par dernière visite. Même présentation pour les dossiers (permis, chantiers, bourses, BAFA).

## [2.3.2]

### Corrigé

- **Import du tableur PIJ : le fichier Excel se choisit directement.** L'import n'acceptait qu'un copier-coller ou un fichier CSV : choisir le classeur `.xlsx` lui-même, geste le plus naturel, échouait. On clique désormais sur « Choisir le fichier Excel du PIJ » : la bonne feuille (Accueil ou Permis de conduire) est repérée et vérifiée toute seule, l'application annonce ce qu'elle va importer et les lignes qu'elle refuse, puis n'enregistre qu'après confirmation. Le classeur est lu sur le poste de la personne qui importe ; il n'est pas envoyé au serveur. Le collage d'une feuille reste possible. Un fichier qui n'est pas un classeur, ou un ancien `.xls`, est refusé avec une explication.

## [2.3.1]

### Modifié

- **Module PIJ : nouvelle mise en page, plus lisible.** Le module passe de sept onglets à quatre rubriques — Accueil, Dossiers, Agenda, Statistiques ; permis, chantiers, bourses et BAFA se choisissent à l'intérieur de « Dossiers ». Le registre d'accueil et les dossiers ne sont plus de larges tableaux à faire défiler : une liste compacte à gauche (nom, âge, objets, état, avancement des heures pour un permis) et, à droite, la fiche de la personne choisie, qui se lit puis se modifie au même endroit, avec les boutons toujours visibles. Les objets de la demande et les orientations se choisissent par pastilles. Le registre se filtre aussi par état et par objet. L'agenda montre le calendrier à gauche et, à droite, les prochains rendez-vous regroupés par jour ou la fiche du rendez-vous ouvert. Les statistiques gagnent deux chiffres clés (demandes finalisées, demandes en cours). Aucun changement des données ni des droits.

## [2.3.0]

### Ajouté

- **Agenda des rendez-vous du PIJ, connectable à Outlook.** Nouvel onglet « Agenda » dans le module PIJ : calendrier du mois, liste des prochains rendez-vous, fiche de rendez-vous (date, heure, durée, jeune choisi dans le registre d'accueil ou saisi librement, objet, lieu, notes, statut prévu / honoré / absent / annulé). Mêmes droits que le reste du module : saisie réservée aux administrateurs et aux informateurs PIJ, consultation pour les autres animateurs. Le bouton « Connecter à Outlook » crée un lien d'abonnement personnel au format iCalendar : Outlook affiche alors les rendez-vous du PIJ et les relit tout seul ; le même lien pourra servir au HUB. Le lien vaut mot de passe : il n'est affiché qu'une fois, peut être remplacé ou supprimé à tout moment, et cesse de fonctionner si le compte est suspendu ou quitte le PIJ. Ce qui part vers Outlook est volontairement réduit — prénom, initiale du nom, objet et lieu ; ni nom complet, ni téléphone, ni notes. La synchronisation va de l'application vers Outlook, pas l'inverse. Exige la migration `migration-pij-agenda-2026-10.sql`, à appliquer avant la mise en service.

## [2.2.0]

### Ajouté

- **Module PIJ : le tableur de suivi du Point Information Jeunesse passe dans l'application.** Nouvelle entrée « PIJ » au menu, avec un onglet par feuille du classeur : registre d'accueil (identité, coordonnées, quartier, objets de la demande, prochain rendez-vous, orientation, suivi, état), permis de conduire (montant attribué, heures à réaliser, déjà réalisées, heures restantes calculées), chantiers jeunes, bourses et BAFA. L'onglet Statistiques recalcule les tableaux de la feuille « STATS » — nombre de jeunes et de dossiers, répartitions par sexe, objet, âge, quartier, commune, état et orientation — pour l'année choisie. **La saisie est réservée aux administrateurs et aux informateurs PIJ** (comptes dont l'espace assigné est « PIJ ») ; les animateurs des autres espaces consultent sans pouvoir créer, modifier ni supprimer, et le serveur refuse toute tentative. Les données déjà saisies dans le tableur se reprennent par le bouton « Importer du tableur » (administrateurs, onglets Accueil et Permis de conduire) : on colle la feuille copiée depuis Excel, l'application annonce ce qui sera importé et les lignes qu'elle refuse, puis n'enregistre qu'après confirmation ; relancer un import ne crée pas de doublon. Exige la migration `migration-pij-2026-10.sql`, à appliquer avant la mise en service : le déploiement s'arrête si elle manque.

### Corrigé

- **Monitoring : plus de fausse alerte quand une page est quittée pendant son chargement.** Le 2026-10-08, une alerte « Erreur serveur — rendu /admin/presences » est partie alors que rien n'était en panne : le navigateur avait simplement fermé ou rechargé la page avant la fin de son affichage. Ce cas n'est plus journalisé ni signalé par courriel.

## [2.1.10]

### Ajouté

- **Sauvegarde des fichiers de l'application, dont les archives CAF.** La sauvegarde de chaque nuit ne contenait que la base de données : les fichiers que l'application écrit sur le serveur (archives CAF notamment) n'étaient dans aucune sauvegarde et auraient été perdus avec le serveur. Ils sont désormais archivés chaque nuit à côté de la base, conservés sept jours comme elle, et un échec déclenche la même alerte. Prend effet à la première sauvegarde nocturne qui suit la mise en service de cette version.

### Corrigé

- **Suppression d'un compte : la trace est garantie.** Depuis la 2.1.9, la suppression était validée avant d'être inscrite au journal d'audit ; si cette inscription échouait, le compte disparaissait sans trace. La suppression et sa trace sont désormais enregistrées ensemble ou pas du tout : si le journal ne peut pas être écrit, le compte n'est pas supprimé.

## [2.1.9]

### Corrigé

- **Suppression d'un compte désormais tracée.** Le 2026-10-07, cinq comptes supprimés dans la journée n'avaient laissé aucune trace au journal d'audit. Chaque suppression y inscrit maintenant qui l'a faite, quel compte a été retiré, son rôle et la date.

## [2.1.8]

### Corrigé

- **Retour arrière : plus de faux succès.** Revue du 2026-10-07 (R1) : si le gestionnaire de processus ne redémarrait pas l'application, un retour à la version précédente pouvait être annoncé réussi alors que la version de départ tournait toujours. Une bascule — livraison ou retour arrière — n'est désormais déclarée faite que si le site annonce bien l'identité de la version visée ; sinon le script le dit, ne range aucune version à tort et laisse le serveur dans un état cohérent. Sans changement visible pour les utilisateurs.

### Modifié

- **Envoi des fichiers vers le serveur** : il reprend désormais là où il s'est arrêté après une coupure de connexion, et le fichier reçu est contrôlé avant toute installation. Trois mises en production de suite avaient échoué à cette étape le 2026-10-07, sans effet sur le site.

## [2.1.7]

### Modifié

- **Mise en production plus sûre.** Audit du 2026-10-07 (A6) : chaque version est désormais installée dans son propre répertoire sur le serveur. La livraison n'est validée que si le site répond et annonce bien la version attendue ; sinon l'ancienne version est remise en service automatiquement. La version précédente est conservée entière, et `bash deploy.sh --retour-arriere` permet d'y revenir à la main. Sans changement visible pour les utilisateurs.

### Sécurité

- **Serveur d'application joignable par Nginx uniquement.** Il n'écoute plus que sur l'adresse locale du serveur.
- **Pièce « fiche AGORA » : seuls les PDF et les images sont acceptés.** Audit du 2026-10-07 (A1) : le contrôle du format n'existait que dans le navigateur, et une requête fabriquée pouvait enregistrer une page HTML, ensuite ouverte sur le site avec la session de la personne qui la consultait. Le serveur vérifie désormais le contenu réel du fichier (PDF, PNG, JPEG, WEBP) et sa taille, à la création comme à la modification. Une pièce non conforme déjà enregistrée n'est plus affichée : elle est proposée en téléchargement.

### Corrigé

- **Contacts d'urgence d'un jeune préservés en cas d'erreur.** Audit du 2026-10-07 (A2) : une modification de fiche qui échouait en cours de route pouvait effacer les contacts existants. La fiche, sa pièce AGORA et ses contacts sont maintenant enregistrés ensemble ou pas du tout ; l'erreur est signalée au monitoring.
- **Réservations de véhicules.** Audit du 2026-10-07 (A3) : une réservation pouvait se terminer avant d'avoir commencé (retour la veille du départ, ou à 9 h pour un départ à 18 h le même jour), ce qui faussait la détection des conflits. Dates et heures sont maintenant contrôlées ; les réservations de plusieurs jours et le retour non renseigné restent possibles.
- **Espace d'un jeune.** Audit du 2026-10-07 (A4) : la liste des espaces du formulaire était figée à quatre valeurs. Elle reprend désormais les espaces réels de la structure, y compris ceux créés depuis la page Espaces, et un jeune ne peut plus être rattaché à l'espace d'une autre structure.
- **Import CSV des jeunes.** Audit du 2026-10-07 (A5) : les espaces créés depuis l'interface étaient refusés, et une date inexistante (31 février) faisait échouer tout l'import. La colonne `espace` accepte l'identifiant ou le nom d'un espace de la structure, et une date invalide n'écarte plus que sa ligne.
- **Pièce AGORA de plus de 750 Ko.** L'enregistrement aboutissait à une page d'erreur alors que le formulaire annonce 5 Mo ; la limite réelle est désormais bien de 5 Mo.

## [2.1.6]

### Modifié

- **Maintenance des dépendances** : bibliothèque de double authentification (`otpauth` 9.5.2) et outil de build des styles (`postcss` 8.5.28) mis à jour — correctifs uniquement, sans changement visible. Un test automatique instable (journalisation du quota de tentatives) a été fiabilisé.

## [2.1.5]

### Modifié

- **Maintenance des dépendances** : pilote PostgreSQL (`pg` 8.23.1) et bibliothèque des jetons de session (`jose` 6.2.12) mis à jour — correctifs uniquement, sans changement visible. Outil de test `vitest` passé en version 5. Dependabot ne propose plus Babel (application mobile) ni de saut majeur pour Tailwind CSS.

## [2.1.4]

### Modifié

- **Tableau de bord allégé.** Suite au « Chargement lent » du 2026-10-07 (4,3 s sur `/admin/dashboard`) : la page relisait en entier les activités, sorties, inscriptions et actualités à chaque affichage et à chaque rafraîchissement automatique. Elle ne demande plus à la base que ce qu'elle affiche (compteurs et éléments à venir), la session n'est vérifiée qu'une fois par affichage au lieu de trois, et le coût ne grandit plus avec l'historique. Les chiffres affichés sont inchangés.
- **Maintenance des dépendances** : types de `nodemailer` et actions de la CI mis à jour ; Dependabot ne propose plus les dépendances de l'application mobile (hors service) ni de saut majeur pour `@types/node` et TypeScript. Sans effet sur le site.

## [2.1.3]

### Corrigé

- **Tableau de bord remplacé par une page « 500 » après une coupure réseau.** Vu le 2026-10-07 sur `/admin/dashboard` (« network error ») : le rafraîchissement automatique des pages, lancé toutes les 10 secondes, avait été coupé en plein transfert. Une coupure de connexion affiche désormais « Connexion interrompue » et la page se recharge seule au retour du réseau, sans signalement au monitoring. Le rafraîchissement automatique est suspendu tant que l'onglet est masqué ou le poste hors ligne, ce qui allège aussi le serveur.

## [2.1.2]

### Corrigé

- **Monitoring : faux « Chargement lent » écarté.** Vu le 2026-10-07 sur `/login` (14,5 s) : un robot avait attendu 11 s dans sa redirection http → https, alors que le serveur répondait en quelques millisecondes. La durée est désormais mesurée depuis la requête de la page finale, redirections exclues, et les navigateurs pilotés par un programme (robots, sondes, tests automatisés) ne signalent plus rien.

## [2.1.1]

### Modifié

- **Menu d'administration** : pictogramme de l'entrée Monitoring remplacé par un gyrophare (🚨).

## [2.1.0]

Première version numérotée et taguée. L'interface affichait jusque-là « v2.0 » en dur ; les versions antérieures n'ont ni tag ni entrée ici.

### Ajouté

- **Versionnement** : fichier `VERSION` comme source de vérité, `scripts/version.mjs` (`check`, `patch`, `minor`, `major`), contrôle en CI. La version et le commit du build sont affichés en pied de menu, sur l'écran de connexion, sur la page Monitoring et dans `/api/health`.
- **Monitoring — journal de bugs** (administration › Monitoring) : répartition par type, journal chronologique, filtre 7 / 30 / 90 jours, suppression d'une entrée. Sont journalisés :
  - les erreurs du serveur (routes, actions, rendu des pages, promesses rejetées) ;
  - les erreurs du navigateur (JavaScript, page qui ne s'affiche pas, réponse 5xx d'une API, chargement de plus de 4 secondes) ;
  - les quotas de tentatives épuisés (connexion, mot de passe oublié, code de double authentification) ;
  - les échecs signalés par les scripts du serveur (sauvegarde de la base, copie NAS), via un secret partagé optionnel `INTERNAL_MONITORING_SECRET`.
- **Alerte par courriel** à `MAIL_ADMIN` pour tout nouvel événement, au plus une fois par type toutes les 30 minutes.
- **Favicon** au logo Pôle Jeunesse.
- **Fiche détaillée d'un jeune pour le mobile** (`GET /api/jeunes/{id}/fiche`) : contacts, autorisations, observations, limités à la commune.
- **Contrôles avant déploiement** dans `deploy.sh` : secrets, schéma de la base (migrations obligatoires), version de Node, réponse de l'application après redémarrage.
- **Tests** d'intégration sur PostgreSQL réel, E2E locaux et CI (administration, mobile, garde-fous de déploiement).

### Modifié

- **Next.js 13 → 16.3.8**, React aligné sur 19.1.0 ; `middleware.ts` devient `proxy.ts`.
- **Réinitialisation de mot de passe** : lien à usage unique avec expiration, au lieu d'un nouveau mot de passe envoyé d'office.
- **Double authentification** : activation et rotation séparées, le changement de facteur exige le mot de passe et le facteur actuel.
- **Déconnexion et changements de rôle, de statut ou de mot de passe** : ferment désormais toutes les sessions du compte, durablement.
- **Suppression d'un jeune** : libère ses places et promeut le premier en liste d'attente, comme un désistement.

### Corrigé

- Budget d'un projet jamais enregistré depuis le formulaire ; projet et budget écrits ensemble ou pas du tout.
- Solde de récupération pouvant devenir négatif sous validations simultanées.
- Doubles inscriptions, doubles promotions et dépassements de capacité (activités et sorties).
- Dates de congé inversées ; congé issu d'une récupération modifiable hors de son parcours.
- Présences mobiles affichées comme enregistrées sans l'être ; absences converties en présences ; date de pointage décalée autour de minuit.
- `deploy.sh` : restes d'un ancien build masquant le nouveau (site en erreur 502), Node 18 utilisé pour le build.

### Sécurité

- Cloisonnement entre communes sur toutes les écritures (activités, pointages, présences, notifications, sorties, projets).
- Billets de double authentification provisoires refusés sur toutes les opérations protégées ; rôle, commune et statut relus en base à chaque requête.
- Envoi de courriels : certificat du serveur vérifié, TLS 1.2 minimum, STARTTLS obligatoire sur 587 et 25.
- Lien de réinitialisation jamais envoyé à une adresse commune à toutes les structures.
- Déploiement refusé si `JWT_SECRET` est absent, court ou une valeur de remplacement.
- Relances automatiques de requêtes SQL réservées aux lectures.

### Migrations à appliquer avant de démarrer cette version

Dans l'ordre, après sauvegarde : `migration-securite-2026-10.sql`, `migration-integrite-2026-10.sql`, `migration-participants-fk-2026-10.sql` (après `diagnostic-participants-orphelins.sql`), `migration-monitoring-2026-10.sql`. `deploy.sh` s'arrête si l'une manque.
