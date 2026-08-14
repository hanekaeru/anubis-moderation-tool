# Notes pour Claude Code

Contexte de travail sur ce depot. Le `README.md` couvre la mise en route ;
ce fichier retient ce qui se redecouvre difficilement.

## Structure

Monorepo npm workspaces : `packages/*`, `api`, `webapp`. **`bot/` reste
exclu** — il a ses propres `node_modules` et un `package.json` autonome. Il
consomme malgre tout le package partage, par une dependance `file:` :
`"@anubis/shared": "file:../packages/shared"`.

`canvas` (module natif casse, jamais utilise dans le code) a ete retire des
dependances lors de la migration TypeScript du bot : `npm install` dans
`bot/` n'a plus besoin de `--ignore-scripts`. `bot/` est en TypeScript comme
`api/`/`webapp/` (`tsconfig.json` propre, `npm run build` compile vers
`dist/`), mais reste hors des workspaces npm — l'integrer est une decision
separee, non traitee jusqu'ici.

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
  ne le fait pas — d'ou le `--env-file-if-exists=.env` du script `seed`.
  **Le suffixe `-if-exists` est obligatoire** : en conteneur il n'existe aucun
  fichier `.env` (les variables sont injectees directement dans
  l'environnement), et `--env-file` sec fait echouer la commande avant meme
  qu'elle demarre. Meme raison pour les scripts de `bot/`.
- `DATABASE_URL` doit etre une **URL litterale** dans chaque `.env` (`api/`
  et `bot/` pointent vers la meme base en dev). Pas d'interpolation `${...}` :
  ni Prisma ni le flag natif `--env-file` de Node (utilise par `bot/`) ne la
  resolvent.
- Sous Windows, ne pas ecrire `.env`, `migration_lock.toml` ni les `.sql` avec
  `Set-Content -Encoding utf8` : PowerShell 5.1 ajoute un BOM que Prisma et
  dotenv refusent.
- `user_levels` appartient au bot. Sa creation est en `CREATE TABLE IF NOT
EXISTS` dans la migration initiale, pour ne pas ecraser les donnees d'XP
  d'une base existante. Garder cette forme si la migration est regeneree.

## API

- Le prefixe global vient de `API_GLOBAL_PREFIX` (`api` par defaut), il n'est
  plus code en dur. En production il vaut la **chaine vide** : Traefik route
  `/api/*` vers le conteneur en retirant le prefixe, et le remettre ferait
  attendre `/api/api/...` — 404 sur toutes les routes, alors que la page de
  connexion s'affiche normalement. Le navigateur appelle `/api/...` dans les
  deux environnements ; seul le serveur change.
- Le guard JWT est **global** : toute route est fermee par defaut, l'ouverture
  passe par `@Public()`.
- Trois gardes globaux s'enchainent dans cet ordre : debit, authentification,
  mot de passe provisoire, permissions. `PasswordChangeGuard` ferme toute l'API
  tant que `mustChangePassword` est vrai ; seul `AuthController` porte
  `@AllowTemporaryPassword()`, sans quoi un compte neuf ne pourrait jamais
  changer son mot de passe. La redirection Angular n'est qu'un confort.
- **Le login n'annonce jamais un verrouillage ni une desactivation avant
  d'avoir valide le mot de passe.** Le faire permettrait d'enumerer les
  comptes : cinq tentatives suffiraient a distinguer un identifiant existant
  d'un inconnu, ce qui annulerait le hachage factice pose pour egaliser le
  temps de reponse.
- `registerFailedLogin` n'ecrit `lockedUntil` que pour verrouiller. Le remettre
  a `null` dans le cas contraire levait le verrou a la tentative suivante.
- Les refresh tokens sont haches en **HMAC-SHA256** avec `JWT_REFRESH_SECRET`.
  Changer ce secret invalide toutes les sessions.
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
- `SanctionsService.revoke` refuse de lever une sanction `EXPIRED` (expulsion
  deja executee, timeout/shadowban deja arrive a echeance) : il n'y a rien a
  rejouer cote Discord, et le laisser passer donnait une fausse impression de
  levee reelle.

## Bot

Le bot alimente la base ; il ne lit jamais l'API. Il ecrit via le meme client
Prisma que l'API (`src/prisma.ts`), pas en SQL a la main. Comme `api/`, il est
en TypeScript (`npm run build` compile vers `dist/`, `npm run start:dev` pour
le dev avec rechargement).

- Deux collecteurs dans `src/collectors/` : `referentiel.ts` (serveur, roles,
  salons, membres, historiques) et `activite.ts` (compteurs de messages).
  `xp.ts` expose l'instance unique du systeme d'XP — commandes et evenements
  doivent partager le meme buffer, sinon `/rank` lit une valeur en retard.
- **Deux modes complementaires** : une synchronisation complete au demarrage
  (`synchroniserServeur`) et des evenements incrementaux. Le premier est
  indispensable — rien de ce qui se passe bot eteint ne genere d'evenement, et
  c'est ainsi que les departs manques sont rattrapes.
- `message_stats` porte des cles etrangeres vers `guilds`, `discord_users` et
  `channels`. D'ou `garantirContexte()`, appele avant toute ecriture
  d'activite, avec un cache memoire pour ne pas reverifier a chaque message.
- Les compteurs vivent en memoire entre deux vidages. `index.ts` intercepte
  `SIGINT`/`SIGTERM` pour les ecrire avant de quitter ; retirer ce filet perd
  jusqu'a une quinzaine de secondes d'activite a chaque redemarrage.
- Les sanctions posees **a la main dans le client Discord** sont ingerees par
  `src/collectors/discordAudit.ts`. C'est la seule source qui donne l'auteur
  reel : les evenements de passerelle disent ce qui est arrive, jamais qui l'a
  fait. Trois pieges y sont traites, et chacun a coute un bug ailleurs :
  l'audit log est **alimente de facon asynchrone** (d'ou les quatre tentatives
  espacees) ; une meme entree sert a **deux evenements** pour un bannissement
  (`guildBanAdd` et `guildMemberRemove`), d'ou le cache d'entrees consommees ;
  et `MemberUpdate` couvre aussi bien un surnom qu'une exclusion temporaire,
  d'ou le filtre sur la clef `communication_disabled_until`.
- Discord n'a **pas d'evenement d'expulsion** : `guildMemberRemove` couvre le
  depart volontaire, l'expulsion et le bannissement. Seule une entree
  `MemberKick` dans l'audit log permet de trancher.
- Quand l'auteur releve est **le bot lui-meme**, l'ingestion s'arrete : la
  commande a deja enregistre la sanction avec le moderateur reel, la reprendre
  en attribuerait la paternite au bot. `recordExternalSanction` garde en plus
  une fenetre de dedoublonnage d'une minute.
- Le statut `BANNED` n'est **jamais retrograde** en `LEFT` : les deux
  evenements arrivent sans ordre garanti, le filtre `status: { not: BANNED }`
  de `guildMemberRemove` fait converger les deux ordres vers le meme resultat.
- **`SanctionType` ne compte que 4 valeurs** (`TIMEOUT`, `KICK`, `BAN`,
  `SHADOWBAN`) : `VOICE_MUTE` et `SOFTBAN` ont ete retires (aucune commande,
  aucun effet Discord ne les implementait). Le shadowban pose ou retire a la
  main dans le client (attribution/retrait du role, hors `/shadowban` et
  `/unshadowban`) est detecte dans `guildMemberUpdate.ts`
  (`suivreShadowbanManuel`), sur le meme principe que le timeout : comparaison
  de l'etat des roles avant/apres, filtre sur les entrees d'audit
  `MemberRoleUpdate` qui touchent precisement le role de shadowban.
- **La synchronisation webapp -> Discord (`sanctionSync.ts`) doit couvrir tous
  les types, y compris les permanents et les instantanes** — trois pieges
  distincts, chacun a fait qu'une sanction posee depuis la webapp restait
  sans effet reel sur Discord :
  - `findActiveSanctions` ne doit **pas** filtrer sur `expiresAt`. Une
    sanction permanente (`BAN` sans duree, `SHADOWBAN` permanent) a
    `expiresAt = null` ; un filtre `expiresAt > now()` l'exclut pour
    toujours de la file d'application.
  - `BAN` n'a pas de `GuildMember` a retrouver : la personne n'est plus sur le
    serveur. `checkAppliedSanctions`/`checkRevokedSanctions` agissent
    directement via `guild.members.ban()`/`unban()`, sans passer par
    `guild.members.fetch()`.
  - Une sanction instantanee (`KICK`) passe au statut `EXPIRED` **des sa
    creation**, y compris depuis la webapp : elle ne remonte donc jamais via
    `findActiveSanctions` (qui filtre `status: "ACTIVE"`). D'ou
    `findUnappliedInstantSanctions`, une requete separee sur
    `status: "EXPIRED", isApplied: false`.
- `GuildMembers` est un **intent privilegie** : sans activation dans le portail
  developpeur Discord, la connexion echoue. `GuildModeration` ne l'est pas,
  mais sans lui `guildBanAdd`/`guildBanRemove` ne sont **jamais livres** — sans
  la moindre erreur. La lecture de l'audit log demande en plus la permission
  Discord « Voir le journal d'audit » ; sans elle, les sanctions sont
  enregistrees mais sans auteur. `MESSAGE_CONTENT` est **active** (necessaire
  au suivi des tickets, voir plus bas) mais son usage reste discipline :
  `activite.ts` ne persiste toujours que la longueur des messages, jamais leur
  texte — seuls les messages des salons de ticket voient leur contenu ecrit en
  base, par `collectors/tickets.ts`.
- Les jours sont calcules en **UTC** et `weekday` compte a partir de lundi
  (`(getUTCDay() + 6) % 7`), pas de dimanche comme JavaScript.
- Les suppressions de roles et de salons sont **logiques** (`deletedAt`) :
  l'historique des membres et les statistiques les referencent encore.
- `roles.track_history` decide si les mouvements d'un role alimentent la
  chronologie. C'est un **reglage du dashboard, pas une donnee Discord** : il
  est volontairement absent du bloc `update` de `upsertRole`, sinon chaque
  renommage de role et chaque synchronisation complete le remettraient a `true`.
  Le filtre s'applique deux fois — a l'ecriture dans le bot (pas de bruit
  stocke) et a la lecture dans `MembersService.timeline` (ce qui rend le
  reglage retroactif et reversible). `member_roles`, qui porte l'etat courant,
  n'est jamais filtre : un role decoratif doit rester visible sur la fiche et
  utilisable comme filtre de recherche.
- **Tickets** (`src/collectors/tickets.ts`, `src/utils/ticketChannel.ts`,
  `src/handlers/ticketInteractions.ts`) : l'acces aux salons de ticket est
  accorde a tout role portant `ModerateMembers`, la meme permission deja
  verifiee par `/warn`/`/ban` — pas de role dedie a gerer en plus. Un cache
  memoire `channelId -> ticketId` (peuple au demarrage par
  `loadTicketChannelsCache`) evite de requeter la base a chaque message pour
  savoir si un salon est un ticket. Les pieces jointes sont **telechargees et
  stockees en base** (`ticket_attachments.data`, `bytea`) plutot que
  referencees par leur lien CDN Discord, qui peut expirer ou disparaitre a la
  suppression du salon ; un plafond (`MAX_ATTACHMENT_BYTES`, 25 Mo) les ignore
  au-dela sans faire echouer l'enregistrement du message. La suppression d'un
  salon de ticket ne supprime jamais le ticket en base : seul `channelId`
  repasse a `null` (evenement `TRANSCRIPT_ARCHIVED`), pour que la webapp reste
  consultable indefiniment.
- **Select menu de ticket** : `handleTicketOpenSelect` accuse reception avec
  `interaction.deferUpdate()`, jamais `deferReply()`. Seul un accuse de type
  "mise a jour du message d'origine" reinitialise le select a son placeholder
  cote client Discord ; `deferReply()` cree une reponse a part et laisse le
  menu affiche bloque sur la derniere valeur choisie — c'est le bug que ce
  choix corrige. Un cooldown memoire de 30s par utilisateur
  (`lastOpenAttempt`) protege en plus contre le spam de clics.
- **Synchronisation Discord** (`events/ready.ts`) : un seul `setInterval` a
  5s (`DISCORD_SYNC_INTERVAL_MS`, reduit de 30s) enchaine les rattrapages
  sanctions, tickets et anti-raid. Meme patron partout : une ecriture web
  laisse `discordSyncedAt` a `null`, une action posee par le bot lui-meme le
  pose immediatement (elle vient d'appliquer l'effet elle-meme, rien a
  rattraper). Voir `Sanction.discordSyncedAt`, `Ticket.discordSyncedAt`
  (`src/tasks/ticketSync.ts`) et `RaidIncident.discordSyncedAt`
  (`src/collectors/raid.ts`).
- **Automod** (`src/collectors/automod.ts`) : regles mises en cache par
  serveur (TTL 30s) pour eviter une requete DB a chaque message. Une seule
  regle se declenche par message. Le contenu et les pieces jointes du
  message incrimine sont conserves dans `AutomodIncident` **en
  metadonnees seulement** pour les pieces jointes (nom/type/taille, jamais
  les octets) — a la difference des tickets, c'est un journal d'audit, pas
  un archivage a reconsulter. Une sanction `DELETE_AND_TIMEOUT` passe par
  `moderation.createSanction` avec pour `moderatorId` le compte Discord du
  bot lui-meme, upsert une fois au demarrage (`ready.ts`) pour que la
  contrainte de cle etrangere ne casse pas au premier declenchement.
- **Anti-raid** (`src/collectors/raid.ts`) : fenetre glissante d'arrivees en
  memoire par serveur. Le confinement ne verrouille que les salons
  **effectivement ouverts** au moment du declenchement, et ne memorise que
  ceux-la (`lockedChannelIds`) pour les rouvrir a l'identique — jamais un
  salon deja restreint manuellement avant le raid. Le declenchement
  automatique applique l'effet Discord immediatement (le bot y a deja
  acces) ; un declenchement ou une resolution demandes depuis la webapp
  laissent `discordSyncedAt` a `null` et attendent le prochain passage de la
  tache periodique.
- **Surveillance de comptes** (`src/collectors/accountSurveillance.ts`) :
  calculee a l'arrivee, **avant** l'upsert de `guildMemberAdd.ts` qui
  ecraserait `Member.leftAt` (necessaire pour detecter un retour rapide).
  Jamais de sanction automatique — uniquement un `AccountFlag` par signal
  declenche et une alerte consolidee au staff.

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
- **Securite** (`features/security/{automod,raid,account-flags}`) : les
  identifiants de role (`exemptRoleIds`, `alertRoleId`) sont saisis en texte
  libre (snowflakes separes par des virgules), pas via un selecteur de
  roles — simplification assumee, aucun `RolesApi` de liste simple n'existe
  encore cote webapp. La page Automod construit un `FormGroup` par regle
  dont les champs `settings` dependent du type (`@switch` dans le template) ;
  les six formes possibles sont documentees dans
  `packages/shared/src/dto/automod.ts` (`AutomodRuleSettings`).

## Verifier

```bash
npm run build
```

Genere le client Prisma, puis construit shared, l'API et le dashboard. C'est le
controle qui attrape le plus de regressions, notamment les erreurs de template
Angular qui n'apparaissent qu'a la compilation.

La generation vient en premier parce que `packages/shared/generated` est un
**artefact absent du depot** : sur un clone neuf, l'API ne compile pas sans
lui — `@anubis/shared/prisma` reste introuvable et tout le typage Prisma
s'effondre en cascade. C'est ce qui cassait la CI alors que le poste local et
les images Docker passaient.

`bot/` n'etant pas un workspace, il se construit a part — et donc **apres**
`npm run build`, dont il consomme la sortie via sa dependance `file:` :

```bash
npm ci --prefix bot && npm run bot:build
```

La CI (`.github/workflows/ci.yml`) enchaine exactement ces quatre etapes.
