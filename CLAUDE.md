# Notes pour Claude Code

Contexte de travail sur ce depot. Le `README.md` couvre la mise en route ;
ce fichier retient ce qui se redecouvre difficilement.

## Structure

Monorepo npm workspaces : `packages/*`, `api`, `webapp`. **`bot/` est
volontairement exclu** — il a ses propres `node_modules` avec des modules
natifs (`canvas`) qu'une remontee de dependances casserait. Ne pas l'ajouter
aux workspaces sans verifier que `canvas` se recompile.

Il consomme malgre tout le package partage, par une dependance `file:` :
`"@anubis/shared": "file:../packages/shared"`. Toute installation dans `bot/`
doit passer `--ignore-scripts`, sinon npm tente de recompiler `canvas` — qui
est deja casse (binaire compile pour une autre ABI Node) et ferait echouer
l'installation entiere. `canvas` n'est utilise nulle part dans le code actuel.

## Le package partage a deux visages

`@anubis/shared` expose deux points d'entree distincts, et la distinction est
essentielle :

- `@anubis/shared` — types et petites constantes, **sans aucune dependance**,
  donc importable depuis le navigateur.
- `@anubis/shared/prisma` — le client Prisma genere, **serveur uniquement**.
  L'importer depuis Angular embarquerait le moteur de base dans le bundle.

Consequences pratiques :

- L'API compile en `moduleResolution: "Node"` (node10), qui **ignore le champ
  `exports`**. C'est pourquoi `packages/shared/package.json` porte un
  `typesVersions` pointant vers `generated/client/index.d.ts`. Sans lui, tous
  les modeles Prisma disparaissent du typage et l'API ne compile plus.
- Angular resout `@anubis/shared` par un `paths` vers **les sources**
  (`../packages/shared/src/index.ts`), pas vers `dist/`. Modifier un contrat
  se repercute immediatement, sans rebuild du package.
- Les enums existent en double : dans `schema.prisma` et dans
  `src/enums.ts`. Toute modification doit etre reportee **dans les deux**.

## Base de donnees

- `npm run db:generate` apres toute modification de `schema.prisma`, sinon le
  client Prisma reste en retard sur le schema.
- La CLI Prisma charge `.env` toute seule ; un script lance via `tsx` ou `node`
  ne le fait pas — d'ou le `--env-file=.env` du script `seed`.
- `DATABASE_URL` doit etre une **URL litterale**. Celle de `bot/.env.dev`
  utilise des interpolations `${DB_USER}` que dotenvx resout au runtime et que
  Prisma ne comprend pas.
- Sous Windows, ne pas ecrire `.env`, `migration_lock.toml` ni les `.sql` avec
  `Set-Content -Encoding utf8` : PowerShell 5.1 ajoute un BOM que Prisma et
  dotenv refusent.
- `user_levels` appartient au bot. Sa creation est en `CREATE TABLE IF NOT
  EXISTS` dans la migration initiale, pour ne pas ecraser les donnees d'XP
  d'une base existante. Garder cette forme si la migration est regeneree.

## API

- Le guard JWT est **global** : toute route est fermee par defaut, l'ouverture
  passe par `@Public()`.
- Les permissions se declarent avec `@RequirePermissions(...)`, jamais par un
  `if` sur le role dans un service.
- `jwt.sign` recoit `expiresIn` **en secondes** (nombre). La forme chaine
  ("15m") ne passe pas le typage de `@nestjs/jwt`.
- Un seul endroit ecrit du SQL a la main : `MembersService.search`, parce que
  la recherche agrege avertissements, sanctions et activite puis trie et pagine
  dessus. Les colonnes de tri passent par une table blanche (`SORT_COLUMNS`) —
  elles sont interpolees en clair dans la requete, jamais parametrees.
- Les `BigInt` de PostgreSQL (`xp`, `total_characters`, identifiants
  auto-incrementes) doivent etre convertis explicitement dans les mappers.
  `main.ts` pose un `BigInt.prototype.toJSON` en filet, pas en solution.

## Bot

Le bot alimente la base ; il ne lit jamais l'API. Il ecrit via le meme client
Prisma que l'API (`src/prisma.js`), pas en SQL a la main.

- Deux collecteurs dans `src/collectors/` : `referentiel.js` (serveur, roles,
  salons, membres, historiques) et `activite.js` (compteurs de messages).
  `xp.js` expose l'instance unique du systeme d'XP — commandes et evenements
  doivent partager le meme buffer, sinon `/rank` lit une valeur en retard.
- **Deux modes complementaires** : une synchronisation complete au demarrage
  (`synchroniserServeur`) et des evenements incrementaux. Le premier est
  indispensable — rien de ce qui se passe bot eteint ne genere d'evenement, et
  c'est ainsi que les departs manques sont rattrapes.
- `message_stats` porte des cles etrangeres vers `guilds`, `discord_users` et
  `channels`. D'ou `garantirContexte()`, appele avant toute ecriture
  d'activite, avec un cache memoire pour ne pas reverifier a chaque message.
- Les compteurs vivent en memoire entre deux vidages. `index.js` intercepte
  `SIGINT`/`SIGTERM` pour les ecrire avant de quitter ; retirer ce filet perd
  jusqu'a une quinzaine de secondes d'activite a chaque redemarrage.
- `GuildMembers` est un **intent privilegie** : sans activation dans le portail
  developpeur Discord, la connexion echoue. `MESSAGE_CONTENT` reste desactive —
  aucun texte n'est stocke, et `totalCharacters` reste donc a zero (la longueur
  moyenne affichee sur la fiche membre aussi). C'est attendu, pas un bug.
- Les jours sont calcules en **UTC** et `weekday` compte a partir de lundi
  (`(getUTCDay() + 6) % 7`), pas de dimanche comme JavaScript.
- Les suppressions de roles et de salons sont **logiques** (`deletedAt`) :
  l'historique des membres et les statistiques les referencent encore.

## Dashboard

- Composants standalone, signaux, `ChangeDetectionStrategy.OnPush` partout.
- Les lignes de `mat-table` arrivent **typees `any`** dans les templates : un
  dictionnaire d'etiquettes indexe depuis un template doit etre declare
  `Record<string, string>`, pas `Record<MonEnum, string>`.
- `*appHasPermission` masque une action ; il ne la protege pas. La regle qui
  compte est celle de l'API.
- Les graphiques passent tous par `shared/charts/` : `chart-options.ts` fabrique
  les options, `chart-palette.ts` fournit les couleurs. La palette
  categorielle est **validee** pour la vision des couleurs dans les deux modes,
  et son ordre fait partie de la validation — ne pas y ajouter une quatrieme
  teinte sans revalider. Au-dela de trois series, preferer des petits multiples.
  Une seule teinte quand la couleur ne code rien (c'est l'axe qui nomme les
  categories).

## Verifier

```bash
npm run build
```

Construit shared, l'API puis le dashboard. C'est le controle qui attrape le
plus de regressions, notamment les erreurs de template Angular qui
n'apparaissent qu'a la compilation.
