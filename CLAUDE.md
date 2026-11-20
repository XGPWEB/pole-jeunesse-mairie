# Pôle Jeunesse — Mairie de Nogent-sur-Marne

Monorepo contenant l'application mobile Expo et l'interface web d'administration Next.js.

## Architecture monorepo (npm workspaces)

```
app-pole-jeunesse/
├── package.json              # Root workspace
├── apps/
│   ├── mobile/               # App Expo (React Native)
│   └── admin/                # App Next.js 16 (interface admin + API)
└── packages/
    └── shared/               # Types, données JSON, couleurs partagés
```

## Apps

### apps/mobile — Application mobile Expo

- **Framework** : React Native + Expo SDK 54
- **Routing** : Expo Router v6 (file-based, nested layouts)
- **Langage** : TypeScript strict
- **Données** : API de l'admin via `lib/api.ts` (Bearer, jeton dans expo-secure-store) — plus de fixtures JSON dans les parcours
- **Icons** : `@expo/vector-icons` (Ionicons)

```
apps/mobile/
  app/
    _layout.tsx              # Root Stack
    index.tsx                # Sélection du profil
    (jeune)/                 # Tab navigator Jeune/Famille
    (animateur)/             # Tab navigator Animateur
  components/ui/             # Atomes réutilisables
  data/                      # Données JSON de démo
  constants/colors.ts
  types/index.ts
  hooks/
```

### apps/admin — Interface d'administration Next.js 16

- **Framework** : Next.js 16 (App Router, `src/proxy.ts` remplace `middleware.ts`) ; React 19.1.0 aligné sur Expo
- **Langage** : TypeScript strict
- **UI** : Tailwind CSS, palette violet (#6B1A6E) + bleu marine (#1B3870)
- **Données** : PostgreSQL (`scripts/init-db.sql`, qui inclut les migrations 2026-10)
- **Port** : 3000

Pages disponibles : dashboard, espaces, activités, jeunes, présences, actualités, communication, paramètres

### packages/shared — Types et données partagés

- `types/index.ts` — Interfaces TypeScript (Espace, Activite, Jeune, Actualite, PresenceRecord…)
- `constants/colors.ts` — Palette couleurs Nogent
- `data/*.json` — Données de démo

## Profils utilisateurs

| Profil | Accès |
|--------|-------|
| **Jeune / Famille** | Accueil, Planning, Inscription, Actualités |
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
- Les données locales sont dans `data/*.json`, importées via les hooks
- Les types sont centralisés dans `types/index.ts`

## Commandes

```bash
# Depuis la racine
npm run mobile       # Lancer l'app Expo
npm run admin        # Lancer l'admin Next.js (port 3000)
npm run admin:build  # Build de production admin

# Directement dans les workspaces
cd apps/mobile && npx expo start
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

# Mobile (apps/mobile)
npm run typecheck && npm run test

# Garde-fou de déploiement (racine)
bash scripts/test-check-deploy-secrets.sh
```

Playwright refuse toute URL non locale ; `setup-test-db.sh` ne détruit que des
bases `pole_jeunesse_test*` / `pole_jeunesse_e2e*` sur un serveur local.

## Roadmap (post-prototype)

- [ ] Backend API (Node.js + PostgreSQL ou Supabase)
- [ ] Authentification sécurisée (JWT / SSO mairie)
- [ ] Notifications push réelles (Expo Notifications + FCM)
- [ ] Export PDF/Excel des présences (bilans CAF)
- [ ] Module de messagerie interne animateurs
- [ ] Tableau de bord statistiques fréquentation
