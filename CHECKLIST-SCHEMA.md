# Checklist — modifier le schema Prisma (ou autre chose de partage)

Aide-memoire des commandes et verifications a faire dans l'ordre. Le detail
du "pourquoi" est dans `CLAUDE.md`.

## 1. Modifier `packages/shared/prisma/schema.prisma`

- [ ] Editer le modele/champ dans `packages/shared/prisma/schema.prisma`.
- [ ] Si le champ touche un enum : le reporter aussi dans
      `packages/shared/src/enums.ts` (les enums existent **en double**,
      Prisma ne genere pas ce fichier).
- [ ] Si un modele existant est cense preexister en base sans etre ecrase
      (ex. `user_levels`, gere par le bot) : garder un `CREATE TABLE IF NOT
      EXISTS` dans la migration correspondante si elle est regeneree.
- [ ] Formater le schema :

  ```bash
  npm run format --workspace @anubis/shared
  ```

## 2. Generer la migration + le client Prisma

```bash
npm run db:migrate      # prisma migrate dev — cree la migration SQL et regenere le client
npm run db:generate     # prisma generate seul, si le client doit etre regenere sans nouvelle migration
```

- [ ] Verifier le `.sql` genere sous `packages/shared/prisma/migrations/`.
- [ ] **Windows** : ne jamais reecrire `migration_lock.toml` ou un `.sql` avec
      `Set-Content -Encoding utf8` (PowerShell 5.1 ajoute un BOM que Prisma
      refuse). Laisser Prisma les ecrire lui-meme.
- [ ] `DATABASE_URL` doit etre une URL litterale dans le `.env` utilise par la
      CLI Prisma (pas d'interpolation `${DB_USER}` type dotenvx — celle du
      bot n'est pas utilisable telle quelle par Prisma).

## 3. Rebuild du package partage

```bash
npm run build --workspace @anubis/shared
```

- [ ] Verifier que `packages/shared/package.json` a toujours un
      `typesVersions` pointant vers `generated/client/index.d.ts` (sinon les
      modeles Prisma disparaissent du typage cote API, qui compile en
      `moduleResolution: Node`).

## 4. Repercuter le changement cote API

- [ ] Adapter les services/DTO/mappers qui utilisent le(s) champ(s) modifie(s).
- [ ] Si un champ est un `BigInt` Postgres (xp, total_characters, id
      auto-incremente) : verifier qu'il est **converti explicitement** dans
      les mappers avant de sortir en JSON (le filet global sur
      `BigInt.prototype.toJSON` dans `main.ts` n'est pas une solution).
- [ ] Si le changement touche la recherche membres : `MembersService.search`
      est le seul endroit qui ecrit du SQL a la main — verifier la table
      blanche `SORT_COLUMNS` si une colonne triable est ajoutee/retiree.
- [ ] Nouvelle route/champ expose : verifier `@Public()` / `@RequirePermissions(...)`
      (le guard JWT est global, fermeture par defaut).

## 5. Repercuter le changement cote Bot

Le bot ecrit en base via le meme client Prisma (`src/prisma.js`), jamais en
SQL brut.

- [ ] Verifier les collecteurs concernes : `src/collectors/referentiel.js`
      (serveur, roles, salons, membres, historiques) et
      `src/collectors/activite.js` (compteurs de messages).
- [ ] Si le champ est touche par la sync complete **et** les evenements
      incrementaux, mettre a jour les deux chemins (`synchroniserServeur` et
      le handler d'evenement correspondant).
- [ ] Si le champ touche `message_stats` : verifier `garantirContexte()`
      (cles etrangeres vers `guilds`, `discord_users`, `channels`).
- [ ] Reinstaller les dependances du bot si `@anubis/shared` a change de
      forme (nouveaux champs generes, etc.) :

  ```bash
  npm install --prefix bot --ignore-scripts
  ```

  `--ignore-scripts` est **obligatoire** : sans lui, npm tente de recompiler
  `canvas` (module natif casse, ABI incompatible) et l'installation entiere
  echoue. `canvas` n'est utilise nulle part dans le code actuel.

## 6. Repercuter le changement cote Dashboard (Angular)

- [ ] `@anubis/shared` est resolu par `paths` vers **les sources**
      (`../packages/shared/src/index.ts`), pas `dist/` — pas besoin de
      rebuild pour que le typage se mette a jour, mais **ne jamais importer
      `@anubis/shared/prisma`** depuis le webapp (embarquerait le moteur
      Prisma dans le bundle).
- [ ] Si un enum modifie est utilise dans un template pour indexer un
      dictionnaire d'etiquettes : le typer `Record<string, string>` (les
      lignes de `mat-table` arrivent `any` dans les templates).
- [ ] Si un champ modifie alimente un graphique : passer par
      `shared/charts/` (`chart-options.ts` + `chart-palette.ts`), ne pas
      ajouter de teinte a la palette categorielle sans la revalider pour la
      vision des couleurs.
- [ ] Une regle d'acces (`*appHasPermission`) ne fait que masquer une action
      dans l'UI — s'assurer que la regle equivalente existe cote API.

## 7. Verification finale

```bash
npm run build
```

Construit shared, l'API puis le dashboard dans l'ordre — c'est le controle
qui attrape le plus de regressions (notamment les erreurs de template
Angular qui n'apparaissent qu'a la compilation).

## Autres commandes utiles

```bash
npm run db:studio        # ouvrir Prisma Studio sur la base configuree
npm run db:deploy        # prisma migrate deploy (production / CI)
npm run db:seed          # tsx --env-file=.env prisma/seed.ts (le --env-file est obligatoire)
```
