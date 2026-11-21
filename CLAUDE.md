# Pôle Jeunesse — Mairie de Nogent-sur-Marne

Application web (ordinateur) de gestion du Pôle Jeunesse : interface
d'administration et espace animateurs, Next.js + PostgreSQL. Il n'y a **pas**
d'application mobile (retirée en 2.13.0).

## Architecture (npm workspaces)

```
pole-jeunesse-mairie/
├── package.json              # Racine du workspace
├── apps/
│   └── admin/                # App Next.js 16 (interface web + API)
├── scripts/                  # Déploiement, contrôles, remise à zéro
└── deploy.sh                 # Livraison sur le serveur
```

### apps/admin — Interface web Next.js 16

- **Framework** : Next.js 16 (App Router, `src/proxy.ts` remplace `middleware.ts`) ; React 19.1.0
- **Langage** : TypeScript strict
- **UI** : Tailwind CSS, palette violet (#6B1A6E) + bleu marine (#1B3870)
- **Données** : PostgreSQL (`scripts/init-db.sql`, qui inclut les migrations 2026-10)
- **Port** : 3000

Pages disponibles : dashboard, espaces, activités, jeunes, présences, actualités, communication, paramètres

## Profils utilisateurs

| Profil | Accès |
|--------|-------|
| **Administrateur** | Toute l'administration, gestion de l'équipe et des droits |
| **Animateur** | Dashboard, Pointage, Fiches de liaison, Communication |

## Espaces gérés

1. **Collégiens** — 11–15 ans
2. **Lycéens** — 15–18 ans
3. **PIJ** — Point Info Jeunesse (tous âges)
4. **CLAS** — Contrat Local d'Accompagnement à la Scolarité

## Conventions

- Couleur primaire : `#1B3A6B` (bleu marine)
- Couleur accent : `#4A90D9` (bleu clair)
- Couleur succès : `#27AE60`
- Couleur danger : `#E74C3C`
- Couleur warning : `#F5A623`
- Tous les composants exportent `default`
- Aucune donnée de démonstration dans le dépôt : tout vient de PostgreSQL

## Commandes

```bash
# Depuis la racine
npm run admin        # Lancer l'admin Next.js (port 3000)
npm run admin:build  # Build de production admin

# Directement dans le workspace
cd apps/admin && npm run dev
```

## Vérifications (toutes locales — jamais contre la production)

```bash
# Admin (apps/admin)
npm run typecheck
npm run test                     # unitaires
npm run test:integration:setup   # recrée la base jetable pole_jeunesse_test
npm run test:integration         # vrais handlers + vrai PostgreSQL local
npm run build
npm run test:e2e                 # serveur local 127.0.0.1:3100 + base jetable pole_jeunesse_e2e

# Garde-fou de déploiement (racine)
bash scripts/test-check-deploy-secrets.sh
```

Playwright refuse toute URL non locale ; `setup-test-db.sh` ne détruit que des
bases `pole_jeunesse_test*` / `pole_jeunesse_e2e*` sur un serveur local.

## Miroir vers l'application de démonstration

Les évolutions du code se font ici, puis sont reportées dans le dépôt de démo
`~/app-pole-jeunesse` (projet distinct, qui garde ses données et sa partie
mobile) par `scripts/miroir-vers-demo.sh`, sur une branche `miroir/mairie-…`
de la démo, jamais poussée ni fusionnée automatiquement.

- Ne sont jamais reportés : les données (bases, `.env*`, `src/data`), les
  commits `chore: version …`, la doc et les scripts de mise en service.
- Une évolution propre à la mairie porte la ligne `Miroir: non` dans le
  message de commit.

```bash
bash scripts/miroir-vers-demo.sh --simulation   # ce qui serait reporté
bash scripts/miroir-vers-demo.sh                # report ; puis relire et fusionner dans la démo
```

## Mise en service

Migration vers le serveur de la mairie et remise à zéro des données :
`MIGRATION-SERVEUR-MAIRIE.md`, `scripts/remise-a-zero.sh`.
