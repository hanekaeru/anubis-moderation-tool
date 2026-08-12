# Anubis

Bot Discord et dashboard de moderation.

```
anubis/
├─ bot/               Bot discord.js — collecte les evenements et les ecrit en base
├─ api/               API NestJS — seul composant qui expose PostgreSQL
├─ webapp/            Dashboard Angular 20 (Material + ECharts)
└─ packages/shared/   Schema Prisma et contrats TypeScript partages
```

Angular ne parle jamais directement a PostgreSQL : le dashboard appelle l'API,
qui seule detient les identifiants de la base. `packages/shared` definit une
seule fois chaque type de donnee, dont l'API et le dashboard heritent — c'est ce
qui evite qu'ils divergent au fil des ajouts.

## Prerequis

- Node.js 20.19+, 22.12+ ou 24 (voir la remarque plus bas)
- PostgreSQL 14 ou superieur

## Mise en route

```bash
npm install
```

Creer `api/.env` a partir de `api/.env.example`, et `packages/shared/.env` avec
au minimum `DATABASE_URL`. Les deux fichiers sont ignores par git.

Generer deux secrets **differents** pour les jetons :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Puis preparer la base :

```bash
npm run db:generate
npm run db:deploy
npm run db:seed
```

Le seed cree le serveur et un compte proprietaire, et affiche **une seule fois**
son mot de passe. Ajouter `-- --demo` pour peupler la base de donnees de
demonstration (membres, activite, sanctions, tickets).

## Lancer

```bash
npm run dev
```

Demarre l'API sur `http://localhost:3000/api` et le dashboard sur
`http://localhost:4200`. Le serveur de developpement Angular relaie `/api` vers
l'API : le navigateur ne voit qu'une seule origine, ce qui evite toute question
de CORS et de cookies tiers en local.

Separement :

```bash
npm run api:dev
npm run web:dev
```

## Scripts

| Commande              | Effet                                                      |
| --------------------- | ---------------------------------------------------------- |
| `npm run dev`         | API et dashboard en parallele                              |
| `npm run build`       | Construit shared, puis l'API, puis le dashboard            |
| `npm run db:generate` | Regenere le client Prisma apres modification du schema     |
| `npm run db:migrate`  | Cree une migration a partir du schema (developpement)      |
| `npm run db:deploy`   | Applique les migrations existantes                         |
| `npm run db:seed`     | Compte proprietaire (`-- --demo` pour les donnees de demo) |
| `npm run db:studio`   | Explorateur de base Prisma                                 |

## Comptes

Il n'y a **pas d'inscription publique**, par construction : aucune route de
l'API ne cree de compte sans authentification. Les acces se creent depuis
_Comptes du staff_, qui genere un mot de passe provisoire affiche une seule
fois. Son titulaire doit le remplacer a sa premiere connexion.

Quatre roles, du plus restreint au plus large : `VIEWER` (lecture),
`MODERATOR` (avertissements, sanctions, notes, tickets), `ADMIN` (+ gestion des
comptes et journal d'audit), `OWNER` (tout). Les droits sont exprimes en
permissions fines dans `packages/shared/src/permissions.ts` ; le role ne fait
que les distribuer.

## Choix structurants

**Le contenu des messages n'est pas stocke.** Le bot n'ecrit que des agregats :
un compteur par membre, par canal et par jour (`message_stats`), plus un profil
cumule par creneau horaire (`member_activity_profiles`). Cela suffit a tous les
graphiques d'activite, garde la base petite, et evite de concentrer des donnees
personnelles qu'il faudrait ensuite securiser et purger.

**L'access token ne quitte jamais la memoire.** Il n'est ecrit ni dans
`localStorage` ni dans `sessionStorage` : un script injecte ne peut pas le lire.
La session survit a un rechargement grace a un refresh token en cookie httpOnly,
qui tourne a chaque usage. Rejouer un jeton deja consomme revoque toute la
famille de jetons et force une reconnexion.

**Toute route de l'API est protegee par defaut.** Le guard JWT est global ;
l'acces libre passe par un `@Public()` explicite. Oublier un guard ferme
l'acces au lieu de l'ouvrir.

**Le dashboard n'administre qu'un serveur**, dont l'identifiant vient de
`GUILD_ID`. La colonne `guild_id` existe partout en base et tout passe par
`GuildContextService` : passer a plusieurs serveurs ne demanderait de changer
que ce service et d'ajouter un parametre de route.

## Points d'attention

- **Node 26 n'est pas supporte par Angular CLI 20.** Le build fonctionne
  aujourd'hui mais n'est pas garanti. Pour un environnement stable, utiliser
  Node 22 LTS ou 24.
- **`bot/` n'est pas dans les workspaces npm.** Il a ses propres
  `node_modules`, dont des modules natifs (`canvas`) qu'une remontee de
  dependances casserait. Pour lui donner acces au client Prisma partage :
  `npm install ../packages/shared` depuis `bot/`, puis remplacer ses requetes
  `pg` au fur et a mesure.
- **`bot/package.json:10`** : le script `refresh-prod` pointe sur `.prod.dev`
  au lieu de `.env.prod`.
- **Ce que le bot doit encore ecrire** pour que le dashboard soit complet :
  `guilds`, `discord_users`, `members`, `roles`, `member_roles`,
  `member_role_events`, `identity_events`, `channels`, `message_stats`,
  `member_activity_profiles`, `voice_sessions`, `tickets` et `ticket_events`.
  Les tables existent et l'interface les lit deja ; sans alimentation, les
  ecrans concernes affichent leur etat vide.

## Ajouter une fonctionnalite

L'ordre qui evite les allers-retours :

1. `packages/shared/prisma/schema.prisma` — le modele, puis `npm run db:migrate`
2. `packages/shared/src/dto/` — le contrat echange, et son enum miroir dans
   `enums.ts` si besoin
3. `packages/shared/src/permissions.ts` — la permission associee
4. `api/src/<module>/` — service, controleur, DTO de validation
5. `webapp/src/app/core/api/` — la methode du client HTTP
6. `webapp/src/app/features/<page>/` — l'ecran, en route paresseuse dans
   `app.routes.ts`
