# Version de Node.js du serveur

Cette procédure change **uniquement la version de Node.js** du VPS. Elle ne livre aucune nouvelle version de l'application : celle qui est en service continue de tourner, sous le nouveau Node.

Elle se fait **à part d'une livraison**. Si Node changeait pendant une livraison, le retour arrière relancerait l'ancienne version de l'application sous un Node jamais essayé avec elle. C'est le risque R5 de `REVUE-CLAUDE-2026-10-19.md`.

`deploy.sh` ne touche jamais à Node. Avant toute livraison, il vérifie que le serveur tourne sur la branche de `.nvmrc` (24) ; sinon, il s'arrête sans rien modifier.

## État au 20 octobre 2026

**Le serveur tourne sous Node 24.22.0** (paquet `24.22.0-1nodesource1`), avec la 2.10.1. Le dépôt NodeSource suit `node_24.x`.

Ce passage a eu lieu le 20 octobre avec la première version du script, et il ne s'est pas déroulé comme prévu :
- **needrestart a relancé PM2.** Pendant l'installation, needrestart (le service Ubuntu qui relance les services après une mise à jour) a relancé `pm2-root.service`, en concurrence avec `pm2 update`. L'application n'a pas répondu dans les 90 secondes, et le script a conclu à un échec.
- **Le retour à Node 20 n'a pas eu lieu.** Le script s'appuyait sur une préférence APT (« épingle ») qu'apt a ignorée. NodeSource pose déjà `/etc/apt/preferences.d/nodejs` (priorité 600), et apt n'applique que la première préférence qui correspond à un paquet. Or, sans priorité supérieure à 1000, apt ne redescend jamais sous la version installée.
- **L'application a redémarré sous Node 24 et y répond normalement.** Le dépôt et les préférences ont été remis en cohérence à la main (`node_24.x`, épingle supprimée), puis la liste PM2 a été enregistrée avec `pm2 save`.

Le script actuel corrige ces deux défauts :
- il installe une **version exacte** (`nodejs=<version>`), y compris pour revenir en arrière, quelles que soient les préférences APT ;
- il **neutralise needrestart** pendant l'installation.

Le banc d'essai reproduit désormais ces règles d'apt : rejoué sur la première version du script, il échoue sur 12 cas.

Si le serveur héberge d'autres applications avec leur propre démon PM2 et leur propre Node, ni le script ni `pm2 update` ne les touchent : ils agissent seulement sur `/usr/bin/node` et `/root/.pm2`.

## Changer de branche (par exemple, une future Node 26)

À faire un jour calme, hors période d'inscriptions, avec 20 minutes devant soi. Les commandes se lancent depuis le Mac, dans le clone à jour du dépôt (`~/pj-correctifs-2.10`).

### 1. Regarder l'état du serveur (lecture seule)

```sh
ssh -i "$SSH_KEY" root@<SERVEUR> 'node --version; pm2 --version; dpkg-query -W nodejs; grep -H nodesource /etc/apt/sources.list.d/*; ls -l /usr/share/keyrings/ /etc/apt/keyrings/ 2>/dev/null | grep -i nodesource; ls /etc/apt/preferences.d/'
```

Attendu :
- un seul fichier NodeSource (aujourd'hui `/etc/apt/sources.list.d/nodesource.sources`), contenant `node_<branche actuelle>.x` et `Signed-By: /usr/share/keyrings/nodesource.gpg` ;
- la clé présente à ce chemin.

Conserver cette sortie.

### 2. Changer de branche

```sh
ssh -i "$SSH_KEY" root@<SERVEUR> "bash -s -- <branche>" < scripts/mettre-a-jour-node.sh
```

Le script :
1. vérifie que l'application répond sainement **avant** de commencer ;
2. fait passer le dépôt NodeSource existant à `node_<branche>.x`, avec la **même clé**, déjà installée : il n'exécute pas `curl | bash` et n'importe aucune nouvelle clé ;
3. installe la version la plus récente de cette branche, en la désignant exactement, sans que needrestart relance quoi que ce soit, puis relance PM2 et l'application avec `pm2 update` ;
4. ne conclut au succès que si `node`, le processus PM2 et `/api/health` (même version, même commit qu'avant) sont cohérents ; sinon il **réinstalle le paquet exact de départ**, remet le dépôt d'origine et le dit.

Pendant la relance par PM2, le site est indisponible quelques secondes.

### 3. Vérifier à la main

- Ouvrir `<adresse du site>/admin`, se connecter, ouvrir une fiche jeune et la page Équipe.
- `ssh -i "$SSH_KEY" root@<SERVEUR> 'node --version; pm2 status; pm2 logs pole-jeunesse-admin --lines 30 --nostream'`
- Le lendemain, vérifier que la sauvegarde de 2 h a bien tourné (`ls -lt /opt/backups/pj-db | head -3`) et que la page Monitoring ne signale rien.

### 4. Mettre `.nvmrc` à jour

Seulement après les étapes 2 et 3, dans une PR à part. Les livraisons suivantes seront construites avec cette branche.

## Revenir à Node 20

```sh
ssh -i "$SSH_KEY" root@<SERVEUR> "bash -s -- 20" < scripts/mettre-a-jour-node.sh
```

Le mécanisme et les contrôles sont les mêmes ; la version 20 la plus récente est installée. Une fois le serveur revenu sur Node 20, le `deploy.sh` de cette version refuse de livrer. Il faut alors livrer depuis un commit dont `.nvmrc` vaut 20 (par exemple le tag `v2.10.1`), ou remettre `.nvmrc` à 20.

## Si le script annonce « INTERVENTION REQUISE »

Le retour automatique a lui-même échoué : rien n'est réparé tout seul. L'application peut toutefois répondre ; c'était le cas le 20 octobre.

1. Faire l'état des lieux :
   ```sh
   ssh -i "$SSH_KEY" root@<SERVEUR> 'node --version; curl -s http://127.0.0.1:3000/api/health; echo; pm2 status; grep URIs /etc/apt/sources.list.d/nodesource.sources; ls /etc/apt/preferences.d/; apt-cache policy nodejs | head -3'
   ```
2. Si l'application répond normalement, garder le Node en place et remettre le dépôt en cohérence avec lui : dans `/etc/apt/sources.list.d/nodesource.sources`, `URIs` doit désigner `node_<majeure de node --version>.x`. Lancer ensuite `apt-get update`, puis `pm2 save`.
3. Sinon, réinstaller à la main la version de départ affichée par le script (`paquet …`) :
   1. remettre `node_<ancienne>.x` dans le fichier NodeSource ;
   2. lancer `apt-get update`, puis `NEEDRESTART_SUSPEND=1 apt-get install -y --allow-downgrades nodejs=<version exacte>` ;
   3. lancer `pm2 update`, puis `pm2 save`.
4. Contrôler `curl -s http://127.0.0.1:3000/api/health` sur le serveur.
