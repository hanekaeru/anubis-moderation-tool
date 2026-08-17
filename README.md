# Anubis

Bot Discord et dashboard de modération.

```
anubis/
├─ bot/               Bot discord.js — collecte les évènements et les écrit en base
├─ api/               API NestJS — seul composant qui expose PostgreSQL
├─ webapp/            Dashboard Angular 20 (Material + ECharts)
└─ packages/shared/   Schéma Prisma et contrats TypeScript partagés
```

Angular ne parle jamais directement à PostgreSQL : le dashboard appelle l'API,
qui seule détient les identifiants de la base. `packages/shared` définit une
seule fois chaque type de donnée, dont l'API, le bot et le dashboard héritent —
c'est ce qui évite qu'ils divergent au fil des ajouts.

Pour comprendre l'organisation du projet avant d'y toucher, lire
[`ARCHITECTURE.md`](./ARCHITECTURE.md). Pour déployer,
[`DEPLOYMENT.md`](./DEPLOYMENT.md).

## Prérequis

- **Node.js 22.12 ou plus** — l'API dépend de `sanitize-html` ≥ 2.17.5, dont la
  chaîne de dépendances est en ESM pur et exige cette version au minimum.
- PostgreSQL 14 ou supérieur.

## Mise en route

```bash
npm install
```

Créer `api/.env` à partir de `api/.env.example`, `bot/.env` à partir de
`bot/.env.example`, et `packages/shared/.env` avec au minimum `DATABASE_URL`.
Ces fichiers sont ignorés par git.

Générer deux secrets **différents** pour les jetons :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Puis préparer la base :

```bash
npm run db:generate
npm run db:deploy
npm run db:seed
```

Le seed crée le serveur et un compte propriétaire, et affiche **une seule fois**
son mot de passe. Ajouter `-- --demo` pour peupler la base de données de
démonstration (membres, activité, sanctions, tickets).

Le bot vit hors des workspaces npm : ses dépendances s'installent à part, et
**après** `npm run build`, dont il consomme la sortie.

```bash
npm ci --prefix bot
```

## Lancer

```bash
npm run dev
```

Démarre l'API sur `http://localhost:3000/api`, le dashboard sur
`http://localhost:4200` et le bot Discord, en parallèle. Le serveur de
développement Angular relaie `/api` vers l'API : le navigateur ne voit qu'une
seule origine, ce qui évite toute question de CORS et de cookies tiers en local.

Séparément :

```bash
npm run api:dev
npm run web:dev
npm run bot:dev
```

## Scripts

| Commande               | Effet                                                       |
| ---------------------- | ----------------------------------------------------------- |
| `npm run dev`          | API, dashboard et bot en parallèle                          |
| `npm run build`        | Client Prisma, puis shared, l'API et le dashboard           |
| `npm test`             | Tests de `packages/shared` et de l'API                      |
| `npm run bot:build`    | Compile le bot (après `npm run build`)                      |
| `npm run db:generate`  | Régénère le client Prisma après modification du schéma      |
| `npm run db:migrate`   | Crée une migration à partir du schéma (développement)       |
| `npm run db:deploy`    | Applique les migrations existantes                          |
| `npm run db:seed`      | Compte propriétaire (`-- --demo` pour les données de démo)  |
| `npm run db:studio`    | Explorateur de base Prisma                                  |

Les tests du bot vivent à part : `npm run test --prefix bot`.

## Vérifier avant de livrer

`npm run build` est le contrôle qui attrape le plus de régressions — notamment
les erreurs de template Angular, qui n'apparaissent qu'à la compilation. La
séquence complète, celle que rejoue la CI :

```bash
npm ci && npm run build && npm test && npm ci --prefix bot && npm run test --prefix bot && npm run bot:build
```

## Comptes

Il n'y a **pas d'inscription publique**, par construction : aucune route de
l'API ne crée de compte sans authentification. Les accès se créent depuis
_Comptes du staff_, qui génère un mot de passe provisoire affiché une seule
fois. Son titulaire doit le remplacer à sa première connexion.

Quatre rôles, du plus restreint au plus large : `VIEWER` (lecture),
`MODERATOR` (avertissements, sanctions, notes, tickets), `ADMIN` (+ gestion des
comptes et journal d'audit), `OWNER` (tout). Les droits sont exprimés en
permissions fines dans `packages/shared/src/permissions.ts` ; le rôle ne fait
que les distribuer, et la page _Permissions_ permet de s'écarter de la matrice
par défaut, rôle par rôle.

Chaque compte peut activer une **double authentification** (TOTP). Le
déploiement entier peut la couper par `TWO_FACTOR_ENABLED=false` — un
interrupteur d'urgence, jamais un réglage de confort : voir
[`CLAUDE.md`](./CLAUDE.md).

## Choix structurants

**Le contenu des messages n'est presque jamais stocké.** Le bot n'écrit que des
agrégats : un compteur par membre, par canal et par jour (`message_stats`), plus
un profil cumulé par créneau horaire (`member_activity_profiles`). Deux
exceptions assumées, parce qu'elles n'ont pas d'équivalent agrégé : les messages
des **salons de ticket**, archivés pour que la conversation reste consultable
après la fermeture du salon, et le message qui a **déclenché une règle
d'automodération**, conservé comme pièce du journal d'audit.

**L'access token ne quitte jamais la mémoire.** Il n'est écrit ni dans
`localStorage` ni dans `sessionStorage` : un script injecté ne peut pas le lire.
La session survit à un rechargement grâce à un refresh token en cookie httpOnly,
qui tourne à chaque usage. Rejouer un jeton déjà consommé révoque toute la
famille de jetons et force une reconnexion.

**Toute route de l'API est protégée par défaut.** Le guard JWT est global ;
l'accès libre passe par un `@Public()` explicite. Oublier un guard ferme
l'accès au lieu de l'ouvrir.

**Le bot ne lit jamais l'API.** Les deux briques se parlent par la base. Une
action posée depuis le dashboard laisse une colonne `discordSyncedAt` à `null` ;
le bot repasse toutes les cinq secondes appliquer ce qui attend, puis l'horodate.

**Le dashboard n'administre qu'un serveur**, dont l'identifiant vient de
`GUILD_ID`. La colonne `guild_id` existe partout en base et tout passe par
`GuildContextService` : passer à plusieurs serveurs ne demanderait de changer
que ce service et d'ajouter un paramètre de route.

## Points d'attention

- **`bot/` n'est pas dans les workspaces npm.** Il a ses propres
  `node_modules` et son propre `package-lock.json`, et consomme le package
  partagé par une dépendance `file:`. Il doit donc être installé et construit
  **après** `npm run build`.
- **Les enums existent en double** : dans `packages/shared/prisma/schema.prisma`
  et dans `packages/shared/src/enums.ts`. Toute modification doit être reportée
  dans les deux — voir [`CHECKLIST-SCHEMA.md`](./CHECKLIST-SCHEMA.md).
- **Le client Prisma est un artefact généré**, absent du dépôt. Sur un clone
  neuf, l'API ne compile pas tant que `npm run db:generate` n'a pas tourné —
  c'est pourquoi `npm run build` le lance en premier.

## Ajouter une fonctionnalité

L'ordre qui évite les allers-retours :

1. `packages/shared/prisma/schema.prisma` — le modèle, puis `npm run db:migrate`
2. `packages/shared/src/dto/` — le contrat échangé, et son enum miroir dans
   `enums.ts` si besoin
3. `packages/shared/src/permissions.ts` — la permission associée
4. `api/src/<module>/` — service, contrôleur, DTO de validation
5. `webapp/src/app/core/api/` — la méthode du client HTTP
6. `webapp/src/app/features/<page>/` — l'écran, en route paresseuse dans
   `app.routes.ts`, et son entrée dans `NAV_SECTIONS` (`layout/shell/shell.ts`)
7. `bot/` — le collecteur ou la tâche de synchronisation, si l'effet doit
   atteindre Discord
