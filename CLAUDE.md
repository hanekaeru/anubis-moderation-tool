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

Son code applicatif vit **entierement dans `bot/src/`** — `commands/`,
`events/`, `collectors/`, `handlers/`, `tasks/`, `utils/`. Seuls les points
d'entree restent a la racine : `index.ts`, `refresh.ts`, `delete_command.ts`.
Deux consolidations ont amene la : `bot/utils/` a fusionne avec
`bot/src/utils/` (et `xp_manager.ts` est devenu `xpManager.ts`, pour suivre la
casse du dossier), puis `commands/` et `events/` ont rejoint `src/`.

`commands/` et `events/` sont **decouverts par balayage de dossier** au
demarrage (`src/loadCommands.ts`, `src/loadEvents.ts`) : y deposer un fichier
suffit a l'enregistrer. Corollaire a garder en tete — **`tsc` ne verifie rien
de ce chemin**. Les deux loaders resolvent `path.join(__dirname, "commands")`
et `path.join(__dirname, "events")` ; deplacer l'un des dossiers compile
parfaitement et ne casse qu'au demarrage. Apres tout deplacement, verifier
autrement qu'au build :

```bash
node -e 'require("./bot/dist/src/loadCommands.js").loadCommands().size'
```

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
- Sous Windows, ne pas ecrire `.env`, `migration_lock.toml`, les `.sql` **ni
  les `package.json`** avec PowerShell : `Get-Content` relit en ANSI et
  `Set-Content -Encoding utf8` reecrit avec un BOM. Les deux ensemble ont deja
  mis un BOM et des « â€” » dans le `package.json` racine (commit `69656f8`,
  repare depuis). npm s'en accommode, **Prisma non** : lance depuis la racine,
  il relit ce fichier et meurt sur « Unexpected token ».
- **Les migrations s'appliquent au demarrage du conteneur `api`** (`CMD` de
  `api/Dockerfile`), avant l'API et chainees par `&&`. Elles dependaient d'une
  commande post-deploiement saisie a la main dans Coolify, et deux mises en
  production ont livre un client Prisma en avance sur la base — 500 sur toutes
  les routes touchant une colonne neuve. Une migration en echec empeche
  desormais l'API de demarrer : un conteneur qui boucle se voit tout de suite,
  une API qui sert des 500 sur la moitie de ses routes peut passer inapercue.
  La commande part de `packages/shared` (sous-shell), comme `npm run
  db:deploy`, pour ne pas dependre du `package.json` racine.
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
- **Double authentification** (`auth/totp.ts`, `auth/two-factor.service.ts`) :
  TOTP RFC 6238 ecrit a la main, verrouille par les vecteurs de test de la RFC
  (`totp.spec.ts`) — trente lignes valent mieux qu'une dependance de plus dans
  le chemin d'authentification. Quatre points ont chacun une raison d'etre :
  - le **jeton de defi** remis entre les deux facteurs est signe d'un secret
    **derive de `JWT_REFRESH_SECRET`**, jamais de `jwt.accessSecret` : signe du
    second, il passerait la strategie JWT et ouvrirait toute l'API sans que le
    code ait ete presente — le garde n'y verrait qu'un `sub` valide.
  - `totpLastCounter` retient le dernier pas de temps accepte et tout pas
    anterieur ou egal est refuse. Sans lui, un code lu par-dessus l'epaule reste
    utilisable pendant la minute et demie de la fenetre de tolerance.
  - le secret est enregistre a la **preparation**, mais `totpEnabledAt` seul
    fait foi : activer des la generation fermerait un compte dont le QR n'a
    jamais ete scanne. Un code errone au second facteur compte comme un echec de
    connexion, sinon ce serait le seul endroit de l'API ou l'on peut essayer
    indefiniment.
  - `password.ts` existe pour rompre un cycle : `AuthService` depend de
    `TwoFactorService`, qui a besoin du hachage argon2. Passer par
    `AuthService.hashPassword` ferait s'importer les deux services l'un l'autre.
  Le telephone perdu **avec** les codes de secours n'a qu'une issue :
  `POST /app-users/:id/double-authentification/reinitialisation`, qui exige
  `sessions:revoke` en plus de `users:write` — donc le proprietaire seul.
- **`TWO_FACTOR_ENABLED`** (defaut `true`) coupe la double authentification sur
  tout le deploiement : le second facteur n'est plus demande **y compris aux
  comptes qui l'avaient active**, et `prepare`/`enable`/`regenerate` repondent
  403. Trois choix a garder :
  - le reglage vit dans **l'environnement, pas en base** : un bouton
    « desactiver la double authentification » dans le dashboard serait la
    premiere chose que chercherait un compte administrateur compromis.
  - `disable` reste ouverte malgre la coupure — sinon un compte protege avant
    celle-ci garderait un secret en base sans aucun moyen de s'en defaire.
  - les secrets ne sont **jamais effaces** : remettre `true` rend la protection
    sans que personne ait a rescanner un QR. C'est aussi pourquoi
    `TwoFactorStatus` distingue `available` (le serveur) de `enabled` (le
    compte), et pourquoi `main.ts` reaffiche l'avertissement a chaque
    demarrage : une desactivation de test oubliee survit sinon a la mise en
    production sans que personne ne s'en apercoive.
- L'access token porte `sid`, la **famille** de refresh tokens dont il est issu.
  C'est ce qui permet a la page « Sessions actives » de reconnaitre la session
  appelante : le cookie de refresh est limite au chemin `/api/auth` et
  n'atteint aucune autre route. Une session **est** une famille, pas un jeton —
  la rotation en cree un nouveau a chaque rafraichissement.
- `OWNER_ONLY_PERMISSIONS` (`packages/shared/src/permissions.ts`) recense les
  droits volontairement absents de la matrice : le proprietaire les recoit par
  `Object.values(Permission)`. `permissions.spec.ts` verifie qu'aucun n'a glisse
  dans `ADMIN_PERMISSIONS` — l'heritage etant cumulatif, l'oubli serait
  silencieux.
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
- **Bareme de points** (`moderation-points.service.ts`) : la base range le
  bareme en colonnes nommees, l'API l'expose en dictionnaires indexes par
  l'enum — la traduction vit dans ce service, et nulle part ailleurs. Trois
  points a garder :
  - le bareme ne donne qu'un **defaut** : `warnings.points` et
    `sanctions.points` sont copies a la creation puis figes. Un bareme
    retroactif ferait bouger tous les scores du serveur d'un seul reglage,
    sans rien laisser dans le journal d'audit.
  - le score de la fiche membre ne compte que l'**actif** (ni revoque, ni
    expire). `MembersService` partage ses predicats entre `countersFor` et
    `moderationScoreFor` : les dupliquer laisserait la fiche annoncer « 2
    avertissements actifs » a cote d'un score calcule sur un autre ensemble.
  - le bot lit le meme bareme (`src/collectors/moderationPoints.ts`, cache
    30s) : sans cela une sanction posee depuis Discord ne pesserait pas
    autant que la meme sanction posee depuis le dashboard.
- `SanctionsService.revoke` refuse de lever une sanction `EXPIRED` (expulsion
  deja executee, timeout/shadowban deja arrive a echeance) : il n'y a rien a
  rejouer cote Discord, et le laisser passer donnait une fausse impression de
  levee reelle.
- **L'auteur d'une levee vit dans deux colonnes exclusives** :
  `Sanction.revokedById` (compte dashboard) et `Sanction.revokedByDiscordId`
  (moderateur Discord, pose par `/unban`, `/unmute`, `/unshadowban` et par
  l'ingestion du journal d'audit). Meme couple que
  `ModerationAttachment.uploadedById`/`uploadedByDiscordId`, et meme mapper :
  `toActorRef(row.revokedByDiscord, row.revokedBy)`. N'en lire qu'une laissait
  la moitie des levees s'afficher sans auteur — la moitie venue de Discord,
  c'est-a-dire la plus courante. Les avertissements n'ont pas d'equivalent :
  ils ne se levent que depuis la webapp.
- **`Sanction.automodIncidentId`** relie une sanction automatique a l'incident
  qui l'a provoquee. C'est ce qui permet d'afficher le message incrimine
  partout ou la sanction apparait (fiche membre, liste, chronologie,
  `/casier`) : il est supprime de Discord des le declenchement, et
  `AutomodIncident.messageContent` en est alors la seule trace. Sans ce lien,
  un timeout automatique n'annonce que « Automod : Filtre de mots ».

## Bot

Le bot alimente la base ; il ne lit jamais l'API. Il ecrit via le meme client
Prisma que l'API (`src/prisma.ts`), pas en SQL a la main. Comme `api/`, il est
en TypeScript (`npm run build` compile vers `dist/`, `npm run start:dev` pour
le dev avec rechargement).

- Deux collecteurs dans `src/collectors/` : `referentiel.ts` (serveur, roles,
  salons, membres, historiques) et `activite.ts` (compteurs de messages).
  `xp.ts` expose l'instance unique du systeme d'XP — commandes et evenements
  doivent partager le meme buffer, sinon `/rank` lit une valeur en retard.
  Encore faut-il **consulter** ce buffer : `getXp` additionne la valeur en base
  et ce qui n'a pas encore ete vide, sans quoi l'instance partagee ne servait a
  rien.
- **Courbe d'XP** (`packages/shared/src/xp.ts`, depuis l'ajout de la page
  Experience) : `xpRequiredForLevel(n) = 50·n·(n+1)`. Elle a quitte
  `src/utils/xpManager.ts` — l'API calcule les paliers de recompense et le
  dashboard affiche la progression, une formule recopiee a trois endroits
  finirait par diverger et un membre verrait un niveau different selon l'ecran.
  `XPManager` y delegue, ses methodes statiques restent le point d'entree du bot.
  Ce n'est pas un nouveau bareme — l'ancienne table codee en dur
  (0, 100, 300, 600, 1000) **etait deja** cette progression, mais arretee au
  niveau 4 : au-dela, `/rank` annoncait « niveau maximal atteint » a tous les
  habitues. La forme close ne deplace donc personne, elle retire le plafond.
  L'inversion se fait en forme close elle aussi, avec une correction d'un cran
  pour les arrondis flottants sur les paliers exacts — `xpLevels.spec.ts`
  verrouille les deux proprietes sur mille niveaux.
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
  `/unshadowban`) est detecte dans `src/events/guildMemberUpdate.ts`
  (`suivreShadowbanManuel`), sur le meme principe que le timeout : comparaison
  de l'etat des roles avant/apres, filtre sur les entrees d'audit
  `MemberRoleUpdate` qui touchent precisement le role de shadowban.
- **Le shadowban met les autres roles de cote** (`shadowban_role_backups`,
  `src/collectors/shadowbanRole.ts`). Ce n'est pas un confort : les permissions
  de plusieurs roles s'**additionnent**, et un seul role portant une
  autorisation explicite (`SendMessages` accorde salon par salon, comme en ont
  souvent les roles de confiance) annule les refus poses sur celui de
  shadowban — la restriction ne restreignait alors rien. Quatre points a
  garder :
  - **trois familles de roles ne sont jamais retirees** — geres par une
    integration (bot, boost), places au-dessus du plus haut role du bot, et
    `@everyone`. Discord refuserait la modification, et comme
    `member.roles.set` est un appel unique, un seul de ces roles dans le lot
    ferait echouer le shadowban entier au lieu de l'appliquer.
  - `roles.set` plutot qu'un `add` suivi de N `remove` : le membre ne traverse
    ainsi aucun etat ou il aurait perdu ses roles sans porter encore la
    restriction.
  - la sauvegarde s'ecrit **avant** de toucher a Discord et ne s'efface
    qu'**apres** que Discord a accepte la levee. Dans les deux cas l'erreur
    penche du meme cote : une ligne en trop se rejoue sans dommage, des roles
    retires sans trace sont perdus pour de bon.
  - le chemin manuel (role pose ou retire a la main dans le client) rejoue la
    mise de cote et la restitution depuis `suivreShadowbanManuel`. Sans cela ce
    serait le seul moyen d'obtenir un shadowban qui ne restreint rien, et
    `/unshadowban` le seul chemin de retour pour les roles.
  L'existence d'une ligne signifie « il reste quelque chose a restituer », rien
  d'autre : l'historique du passage vit dans `member_role_events`. Un membre
  parti puis revenu pendant son shadowban retrouvera donc a la levee les roles
  qu'il avait avant — Discord ne les lui a pas rendus a son retour, la
  sauvegarde si.
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
- **`MessageUpdate` ne veut pas dire « edition ».** Discord reutilise le meme
  evenement pour annoncer la resolution de l'apercu d'un lien (Tenor, Giphy,
  toute URL), un epinglage ou une suppression d'apercu — envoyer un GIF
  remontait ainsi dans les logs comme une modification, et gonflait
  `editedCount`. Le depart se fait sur **`editedTimestamp`**, seul pose par une
  vraie edition. Un second garde est necessaire malgre tout : l'apercu du lien
  *ajoute par une edition* declenche un `MessageUpdate` de plus, celui-la avec
  un `editedTimestamp` deja renseigne. C'est le contenu identique qui le
  trahit — comparaison faite seulement si l'ancien message etait en cache, son
  `content` valant `null` quand il est partiel.
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
  utilisable comme filtre de recherche. `roles.is_separator` suit la meme
  regle (absent de l'`update` de `upsertRole`) : il marque les roles
  separateurs, **seuls roles que la fiche membre permet d'ajouter**
  (`POST /members/:userId/separators`, `member-roles:write`, appliques par
  `src/tasks/memberRoleRequests.ts`). La borne n'est pas cosmetique : la
  permission est ouverte aux moderateurs, et sans elle la fiche deviendrait une
  porte d'attribution de n'importe quel role. L'API et le bot la verifient
  chacun.
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
- **Le panneau de ticket porte un bouton, pas un select.** Le sujet et la
  gravite se choisissent dans une modale, or `showModal` est refuse apres tout
  accuse de reception — et c'etait justement le `deferUpdate()` qui remettait
  l'ancien select a son placeholder (`deferReply()` laissait le menu bloque sur
  la derniere valeur, bug historique). Un bouton n'a aucun etat a
  reinitialiser, le probleme disparait. **Consequence : un panneau poste avant
  ce changement ne repond plus, il faut rejouer `/create_ticket_panel`.** Un
  cooldown memoire de 30s par utilisateur (`lastOpenAttempt`) protege du spam
  de clics ; il n'est pose qu'apres les refus (limite atteinte, aucun sujet
  configure), qui n'ont rien coute et ne doivent pas faire patienter.
- **Sujets, gravite et limite d'ouverture** (`ticket_subjects`,
  `ticket_config`) : le sujet choisi est **copie** dans `Ticket.subject` en plus
  d'etre reference par `subjectId` — renommer un sujet ne doit pas reecrire
  l'intitule des tickets deja traites, meme raison que le bareme de points.
  Chaque sujet porte une `TicketCategory` : le membre choisit un libelle
  precis, le dashboard filtre et compte par grande famille. La limite est
  verifiee **deux fois**, avant d'ouvrir la modale (ne pas faire remplir un
  formulaire pour le refuser) et a la soumission (elle a pu se remplir
  entre-temps). L'absence de ligne `TicketConfig` vaut **un** ticket, le
  comportement d'avant le reglage — pas « aucune limite ».
- **Prise en charge depuis Discord** (`/prefix_ticket`, bouton « Prendre le
  ticket ») : le salon passe de `ticket-0001` a `prefixe-pseudo-0001`. Quatre
  points a garder :
  - `claimTicket` filtre sur `claimedByDiscordId: null` **dans le `where` de
    l'`updateMany`** et se lit a son `count` : deux moderateurs qui cliquent en
    meme temps ne doivent ni se voler le ticket, ni declencher deux renommages
    — Discord n'en accepte que **deux par tranche de dix minutes et par salon**.
  - sans prefixe, le bouton **refuse** et renvoie vers `/prefix_ticket`. Le
    deduire du pseudo donnerait des noms incoherents avec ceux que le
    moderateur a deja poses.
  - le prefixe est normalise **a l'enregistrement** (`slugifyChannelPart`,
    partage), pas a l'usage : Discord mettrait de toute facon le nom en
    minuscules, et le moderateur doit voir tout de suite le « hane » qui sera
    reellement pose. Le dashboard, qui edite le meme champ, applique la meme
    normalisation.
  - la prise en charge pose `firstResponseAt` si elle manquait : c'est bien le
    moment ou le staff se saisit du ticket, et le delai affiche par le
    dashboard ne mesurait rien tant que le moderateur n'avait pas ecrit.
  L'auteur d'une prise vit dans deux colonnes exclusives, `claimedById`
  (dashboard) et `claimedByDiscordId` (Discord) — meme couple et meme mapper
  `toActorRef` que `Sanction.revokedById`.
- **Qui le bot interpelle** (`src/utils/mentions.ts`, cles de `config_guild`) :
  les roles du serveur sont declares une fois sous `MOD_ROLE`, `ADMIN_ROLE`,
  `STAFF_ROLE`, `SUPPORT_ROLE` (`GuildRoleKey`, partage) ; `ALERT_MENTION_ROLE`
  designe lequel est interpelle quand le staff doit venir — ouverture d'un
  ticket, signalement depuis un salon vocal — et `LOG_MENTION_MEMBERS` decide
  si les journaux mentionnent les membres. **Un seul reglage pour les deux
  appels** : c'est la meme equipe qu'on derange, et en separer deux inviterait
  a n'en configurer qu'un. Rien de
  tout cela n'est en base typee : les cles vivent dans `config_guild`, comme les
  salons de logs, ce qui evite une migration a chaque role que le serveur
  voudra nommer. Quatre points a garder :
  - **la mention vit dans le contenu du message, jamais dans l'embed**. Discord
    n'envoie aucune notification pour une mention posee dans un embed : elle
    n'y surligne qu'un nom. C'est pourquoi la mention de role d'ouverture de
    ticket est un `content`, et pourquoi le reglage des journaux ne change
    visuellement que du surlignage.
  - **le role mentionne recoit l'acces au salon du ticket**, en plus de ceux
    qui portent `ModerateMembers`. Appeler une equipe dans un salon qu'elle ne
    voit pas serait pire que ne pas l'appeler.
  - `LOG_MENTION_MEMBERS` est **le seul reglage du depot dont le defaut ne
    reproduit pas le comportement anterieur** : absent, il vaut « ne pas
    mentionner ». Un salon vocal anime produit une entree par arrivee et par
    depart, et l'identifiant reste ecrit dans les deux cas — c'est lui qui
    permet de retrouver un compte renomme, et il survit au depart du membre.
  - l'API **refuse** de mentionner une cle de role dont l'identifiant n'est pas
    renseigne (meme exigence que le salon dedie des annonces d'XP), mais le bot
    revalide : la table se modifie aussi a la main depuis la page
    Configurations. Cache de 30s, comme l'automod.
- **Un ticket ferme disparait de la liste de salons de son ouvreur** :
  `setOpenerAccess` retire `ViewChannel` avec `SendMessages`, la ou l'ancien
  `setOpenerCanWrite` ne coupait que l'ecriture. Le laisser lire jusqu'a la
  suppression du salon revenait a garder ouvert, de son point de vue, un ticket
  que le staff considere clos. La reouverture rend les deux droits.
- **Preuves de sanction** (`/preuve`, `src/handlers/evidenceInteractions.ts`) :
  la modale porte a la fois le select des sanctions et les deux zones de
  fichiers — possible parce que les modales Discord acceptent depuis
  discord.js 14.23 des composants autres que du texte, via `LabelBuilder`
  (`setStringSelectMenuComponent`, `setFileUploadComponent`) et
  `ModalBuilder.addLabelComponents` (**5 labels au maximum**). Cote reception,
  `interaction.fields.getUploadedFiles(customId)` rend les pieces jointes.
  Trois points ont chacun une raison d'etre :
  - la commande **ne peut pas differer sa reponse** : `showModal` est refuse
    apres un `deferReply`, donc la lecture des sanctions doit tenir dans les
    trois secondes de l'interaction. C'est le handler de la modale, lui, qui
    defere avant de telecharger les fichiers.
  - la sanction est **relue avec son `guildId`** avant l'ecriture : l'identifiant
    vient du `customId`, c'est-a-dire du client, et ne prouve rien.
  - `upsertUser` est appele avant l'insertion : `uploaded_by_discord_id` porte
    une cle etrangere vers `discord_users`, et un moderateur jamais croise par
    le referentiel ferait echouer le depot entier.
  - **Discord ne fait respecter `maxValues` que zone par zone** : les deux
    zones de fichiers laissent donc toujours proposer `2 ×
    MAX_MODERATION_ATTACHMENTS`, et aucun reglage de la modale ne peut
    l'empecher. D'ou le plafond rappele dans les deux descriptions, et surtout
    le **refus global** du depot quand il deborde plutot qu'une troncature :
    garder les premiers fichiers venus revenait a laisser le bot decider
    quelles preuves comptent, en jetant les dernieres de la liste — donc les
    sensibles, systematiquement.
  Le marqueur `spoiler` de `ModerationAttachment` ne **restreint aucun acces** —
  qui voit la decision voit la piece. Il n'evite qu'un affichage subi, et la
  webapp ne memorise pas le devoilement : revenir sur la fiche remet le voile.
  La liste blanche des types acceptes vit dans `@anubis/shared`
  (`MODERATION_ATTACHMENT_CONTENT_TYPES`) parce que trois chemins la
  verifient — API (seule a faire foi), dashboard et bot.
- **Synchronisation Discord** (`src/events/ready.ts`) : un seul `setInterval` a
  5s (`DISCORD_SYNC_INTERVAL_MS`, reduit de 30s) enchaine les rattrapages
  sanctions, tickets et anti-raid. Meme patron partout : une ecriture web
  laisse `discordSyncedAt` a `null`, une action posee par le bot lui-meme le
  pose immediatement (elle vient d'appliquer l'effet elle-meme, rien a
  rattraper). Voir `Sanction.discordSyncedAt`, `Ticket.discordSyncedAt`
  (`src/tasks/ticketSync.ts`), `RaidIncident.discordSyncedAt`
  (`src/collectors/raid.ts`) et `EmbedMessage.discordSyncedAt`
  (`src/tasks/embedSync.ts`). Un **second** `setInterval`, a 5 minutes, porte
  le rattrapage des paliers d'XP : il relit toute la table au-dessus du plus
  bas palier, et rien ne l'exige plus souvent.
- **Messages composes** (`src/tasks/embedSync.ts`) : `messageId` renseigne et
  statut `QUEUED` signifie « corrige l'existant », `messageId` a `null`
  signifie « publie ». Le message n'est republie que si Discord ne le retrouve
  plus — il a alors ete supprime a la main. Un echec pose quand meme
  `discordSyncedAt` (avec `status: FAILED` et `lastError`) : sans cela, un
  message refuse serait rejoue toutes les cinq secondes indefiniment, et c'est
  au staff de le remettre en file apres correction. **Supprimer la ligne depuis
  le dashboard ne supprime pas le message sur Discord** : ce qui a ete lu par le
  serveur ne se reprend pas d'un clic.
- **Paliers d'XP** (`src/collectors/xpRewards.ts`) : `applyForMember` est
  appelee a la montee de niveau depuis `messageCreate`, et `reconcileGuild`
  repasse periodiquement. Le second n'est pas un filet pour le premier — l'XP ne
  monte que bot allume, une montee genere donc toujours son evenement. Il sert
  au cas qu'aucun evenement ne couvre : **un palier ajoute depuis le
  dashboard**, dont les beneficiaires n'ont aucune raison de changer de niveau
  bientot. `replacePrevious` se lit sur le palier **atteint**, pas sur chacun :
  c'est lui qui decrit le rang courant du membre. Les roles places au-dessus du
  bot dans la hierarchie sont ecartes avant l'appel (`comparePositionTo`), parce
  que l'erreur de Discord ne dit pas lequel des roles du lot a echoue.
- **Annonce des montees de niveau** (`src/collectors/xpAnnounce.ts`,
  `xp_config`) : reglage **par serveur**, pas par membre — une preference
  individuelle supposerait un stockage cote Discord que le bot n'a aucun moyen
  de recueillir. Quatre modes (salon courant, salon dedie, message prive,
  aucune annonce), plus la mention du membre et un gabarit de texte. Trois
  points a garder :
  - **l'absence de ligne ne vaut pas « pas d'annonce »**. Les defauts de la
    table reproduisent exactement le comportement d'avant le reglage, et la
    migration ne pre-remplit rien : un serveur qui n'ouvre jamais la page ne
    doit voir aucun changement. Le bot, l'API et le dashboard partagent donc
    les memes valeurs de repli.
  - le rendu du gabarit vit dans `@anubis/shared`
    (`renderXpLevelUpMessage`) : le bot envoie et le dashboard previsualise par
    la meme fonction, sans quoi l'apercu finirait par mentir. `{recompenses}`
    porte la **phrase entiere**, pas la seule liste de roles — c'est ce qui la
    fait disparaitre proprement quand la montee ne debloque rien.
  - `DEDICATED_CHANNEL` exige son salon **a l'enregistrement** (l'API refuse la
    requete). Un salon devenu introuvable ensuite ne bascule donc **pas** sur
    le salon courant : le staff avait justement demande que les annonces n'y
    aillent pas. Une erreur en console, et rien d'autre.
  Le reglage n'a pas de `discordSyncedAt` : il ne decrit rien a rejouer sur
  Discord, seulement la facon de rediger la prochaine annonce. Le bot le relit
  a chaque montee de niveau, avec le meme cache de 30s que l'automod.
- **Salons sans experience** (`XpConfig.blockedChannelIds`) : salons de
  commandes, tickets, bacs a sable. Trois points a garder :
  - le test se pose **apres** l'activite et l'automod : un salon sans XP reste
    compte dans les statistiques et reste modere. Le poser plus haut
    reviendrait a ne plus rien y surveiller.
  - il se pose **avant** le cooldown : consommer le delai d'attente dans un
    salon qui ne rapporte rien priverait le membre de son gain suivant
    ailleurs.
  - le salon d'un fil est **son parent**. Bloquer un salon de tickets doit
    bloquer les fils qui s'y ouvrent, sans quoi la liste serait a refaire a
    chaque fil cree.
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
  **`WORD_FILTER` accepte des expressions regulieres** (`settings.patterns`) en
  plus de sa liste de mots. Le point sensible est le **retour arriere
  catastrophique** : une expression comme `(a+)+` fige la boucle d'evenements
  du bot pour tout le serveur, et Node n'offre aucun moyen d'interrompre une
  expression partie trop loin. La defense est donc **a l'ecriture**, pas a
  l'usage — `validateWordFilterPatterns` (partage) compile chaque expression,
  borne leur nombre et leur longueur, et rejette les quantificateurs
  imbriques ; l'API refuse la requete, le dashboard le signale avant l'envoi.
  Cote bot, les expressions sont compilees une fois et mises en cache sous une
  cle qui inclut `updatedAt`, pour qu'un changement du dashboard fasse tomber
  l'entree sans attendre un redemarrage.
  L'incident est ecrit **avant** la suppression du message, et son identifiant
  est passe a `createSanction` (`automodIncidentId`) : la sanction pourra
  ainsi montrer ce qui a ete ecrit, alors que le message n'existe plus. La
  suppression n'a lieu que pour une action autre que `LOG_ONLY` — un timeout
  automatique implique donc toujours la suppression, il n'existe pas d'action
  « exclure sans supprimer ». **`WORD_FILTER` arrive pre-regle sur
  `LOG_ONLY`** : tant que la regle n'est pas passee a « Supprimer et exclure
  temporairement » depuis le dashboard, elle ne supprime rien et ne sanctionne
  personne.
  `ATTACHMENT_SPAM` est distinct de `SPAM_RATE` parce que les deux ne voient
  pas la meme chose : dix images en **un seul** message ne comptent que pour un
  message et passeraient sous un seuil de debit. Son compteur porte donc sur
  les fichiers, integrations d'images comprises. Les deux regles de flux
  arrivent pre-reglees sur une exclusion de 5 minutes
  (`DEFAULT_AUTOMOD_ACTIONS`), mais **toujours desactivees** : les defauts
  remplissent le formulaire, ils n'activent rien. Les fenetres glissantes sont
  **purgees au declenchement** — sans cela les horodatages deja au-dessus du
  seuil y restent et chaque message suivant rouvre un incident et une sanction
  pour la meme inondation.
- **Roles appliques a la levee de quarantaine**
  (`QuarantineConfig.releaseAddRoleIds` / `releaseRemoveRoleIds`, regles depuis
  le dashboard) : ils valent pour les **deux** chemins de levee — le bouton
  d'acceptation et le deblocage depuis la webapp — parce que les deux passent
  par `appliquerRolesDeLevee`. Trois points a garder :
  - **un seul `roles.set`**, jamais un `remove` suivi d'un `add` : entre les
    deux appels le membre a quitte la quarantaine sans porter encore le role
    qui ouvre le serveur, et un echec a mi-chemin l'y laisse pour de bon.
  - un role **gere par une integration ou place au-dessus du bot** est ignore,
    pas fatal. Comme `roles.set` est un appel unique, l'inclure ferait echouer
    la levee entiere pour un role qui n'aurait de toute facon pas bouge ; celui
    a retirer est donc **laisse dans le lot** pour que Discord n'y voie aucun
    changement. Un avertissement en console, sinon un role configure qui ne
    s'applique jamais passe pour un bug du bouton.
  - les listes sont **remplacees en bloc** par l'API, jamais fusionnees :
    envoyer `[]` est le seul moyen de vider un reglage, et une absorption
    partielle laisserait un role retire du dashboard continuer d'etre pose.
- **Verification Battle.net** (`api/src/verification/`,
  `src/handlers/quarantineInteractions.ts`) : seconde etape facultative de la
  quarantaine (`QuarantineConfig.battlenetRequired`). Le membre clique un
  bouton, l'API le renvoie chez Blizzard en OAuth2, le retour ecrit un
  `BattlenetAccount` et pose `QuarantineStatus.battlenetVerifiedAt`. Ce qui
  compte, dans l'ordre :
  - **le `state` est ce qui protege la route**, pas l'authentification : le
    callback est `@Public()` par necessite, le membre n'a evidemment pas de
    compte dashboard. Il est donc tire au hasard cryptographique cote bot,
    **jamais derive de l'identifiant Discord**, et consomme une seule fois
    (`updateMany` filtre sur `consumedAt: null`, lu a son `count`) **avant**
    l'echange du code. La consequence assumee : un echec reseau chez Blizzard
    oblige a recliquer. C'est le bon sens de l'erreur — un `state` rejouable
    laisserait relire un retour intercepte.
  - il vit **en base et non en memoire** : le bot le pose, l'API le consomme,
    et ce sont deux conteneurs distincts.
  - **l'unicite fait tout le travail**. Se connecter a Battle.net ne prouve
    rien en soi : un compte Blizzard est gratuit et se cree en deux minutes. Ce
    qui casse les multicomptes, c'est le refus d'un `sub` deja lie a un autre
    membre — d'ou la double unicite (`battlenet_id` en cle primaire, `user_id`
    unique) et le signalement `BATTLENET_DUPLICATE` au staff.
  - la cle est le **`sub` d'OAuth, jamais le BattleTag** : un BattleTag se
    change depuis le compte Blizzard, `sub` non. `battletag` n'est qu'une copie
    d'affichage, derriere la permission `battlenet:read` (admin) — savoir qu'un
    membre est verifie releve de la moderation courante, lire son identite
    Blizzard non.
  - **aucun jeton Blizzard n'est conserve** : un seul appel a `/userinfo` juste
    apres l'echange, puis on jette. Rien a rafraichir, rien a faire fuiter.
  - **aucun scope n'est demande** : sans scope, `/userinfo` rend deja `sub` et
    `battletag`. Demander `wow.profile` afficherait un ecran de consentement
    plus intimidant pour une donnee inutilisee. **Overwatch n'a aucune API
    officielle Blizzard** — l'enrichissement passerait forcement par un
    scraper tiers, sur le BattleTag deja verifie, et hors de ce chemin.
  Le trio `BATTLENET_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` vit dans
  l'environnement de l'API, et `PUBLIC_API_URL` dans celui du bot (l'URL
  **exterieure** : le bot compose un lien, il n'appelle jamais l'API).
  Les trois manquants, la fonctionnalite se declare indisponible — et le
  dashboard le signale en rouge si `battlenetRequired` est malgre tout a
  `true`, parce que c'est la panne la plus couteuse : les arrivants acceptent
  le reglement puis restent bloques sur une etape qui ne peut pas aboutir.
- **La quarantaine a deux etapes, et chacune porte ses roles.**
  `quarantineStage` (`@anubis/shared`) est l'arbitre partage entre le bot (qui
  applique), l'API (qui expose) et le dashboard (qui affiche) : les trois
  doivent s'accorder sur ce que « libere » veut dire, sinon un membre
  apparaitrait bloque dans la liste alors que le bot lui a tout ouvert. Quatre
  points a garder :
  - **le role de quarantaine ne part qu'a `CLEARED`**. Le retirer des
    l'acceptation reviendrait a n'avoir aucune seconde etape.
  - `battlenetRequired` a `false` rend **exactement** le comportement d'avant :
    l'acceptation libere, et une verification faite quand elle etait encore
    exigee ne libere personne toute seule.
  - une **levee manuelle** (`releasedAt`) passe outre toutes les etapes. Le
    bouton existe pour les cas ou la verification ne peut pas aboutir ; l'y
    soumettre le viderait de son sens. **La date fait foi, pas l'auteur** :
    `releasedById` et `releasedByDiscordId` passent a `null` quand le compte
    disparait, et une levee ne doit pas s'annuler parce qu'un compte du
    dashboard a ete supprime.
  - la levee complete **retire les roles intermediaires** en plus de poser les
    siens : les laisser ferait cohabiter « en attente de verification » et
    l'acces complet sur la meme fiche.
  Le rattrapage (`synchroniserQuarantaines`) filtre sur le seul
  `discordSyncedAt: null`, sans condition sur `acceptedAt` : une verification
  faite avant l'acceptation laisse `acceptedAt` a `null` et doit remonter
  malgre tout. Rien n'y echappe — l'arrivee et les clics posent la date
  eux-memes.

  **La liste du dashboard (`listActive`) degrossit en base, et ce filtre doit
  garder tout ce qui peut encore etre bloque.** Il ecartait autrefois toute
  ligne acceptee et synchronisee : un membre ayant accepte le reglement sans
  s'etre verifie restait bloque sur Discord, invisible sur le dashboard, et
  personne ne pouvait le debloquer. Le test unitaire ne l'avait pas vu, son
  mock renvoyant la ligne quel que soit le `where` — d'ou un test qui verifie
  le `where` lui-meme.

  **Le role de quarantaine se manipule aussi a la main dans le client**
  (`suivreQuarantaineManuelle`, `src/events/guildMemberUpdate.ts`). Le retirer
  enregistre une levee (`releasedByDiscordId`, `discordSyncedAt: null` pour que
  le rattrapage pose les roles de levee) ; le reposer remet toutes les etapes a
  zero et retire les roles que la quarantaine avait donnes — sans quoi le role
  « membre » continuerait d'ouvrir le serveur. Le bot pose ce role a chaque
  arrivee et le retire a chaque levee : ses propres changements sont ecartes
  par l'audit log, et deux gardes evitent de le lire dans les cas courants
  (arrivee de moins d'une minute, membre deja libere en base).

  **Un role gere par Discord passe outre la quarantaine, et c'est assume.**
  Entre roles, Discord fait toujours passer l'autorisation avant le refus : un
  salon ouvert au role de boost l'est aussi a un arrivant qui boost. Le bot ne
  le corrige pas — un verrouillage par permissions de membre a ete ecrit puis
  retire a la demande du proprietaire. La parade retenue est cote serveur : le
  role de boost n'ouvre **rien**, c'est un role bonus pose a la main qui donne
  acces aux salons reserves, et l'annonce de boost (`{moderation}`, voir
  « Arrivees, departs et boosts ») previent l'equipe qu'elle a ce role a
  donner. Ne pas reintroduire le verrouillage sans le lui demander.

- **Arrivees, departs et boosts** (`src/collectors/welcome.ts`,
  `welcome_config`) : meme fonctionnement que l'annonce des montees de niveau —
  reglage par serveur relu avec un cache de 30s, rendu par
  `renderWelcomeMessage` (`@anubis/shared`) que l'apercu du dashboard emploie
  aussi. Quatre points a garder :
  - **tout est coupe par defaut** et la migration ne pre-remplit rien. Un
    message active sans salon est refuse par l'API.
  - **un nouveau boost se lit en base**, pas sur l'ancien etat du membre : un
    membre hors cache arrive partiel, sans `premiumSince`, et chaque mise a jour
    d'un booster passerait pour un nouveau boost. `boostingSince` n'est pose que
    s'il manquait, et c'est le compte de lignes touchees qui decide de
    l'annonce. Corollaire : la date est **effacee** a la fin du boost et au
    retour du membre (`guildMemberAdd`), sinon son boost suivant passerait sous
    silence. Un boost survenu bot eteint est absorbe sans annonce par la
    synchronisation du demarrage.
  - **pas de bienvenue pendant un confinement anti-raid** (incident sans
    `resolvedAt`) : cinquante comptes arrives en une minute feraient cinquante
    messages. Departs et boosts continuent.
  - `{moderation}` mentionne le role d'alerte de « Rôles & mentions », le meme
    que pour les tickets et les signalements vocaux. Sans role choisi, le jeton
    rend vide et la page le signale en rouge.
- **Esport** (`src/tasks/esportSync.ts`, `api/src/esport/`,
  `features/esport/`) : le staff compose une semaine de matchs, l'envoie, la
  corrige ; le score d'un match termine s'affiche dans le recapitulatif, corrige
  en place. L'**annonce de resultat**, un message distinct, est **facultative**
  (`EsportMatch.announceResult`, case decochee par defaut dans « Terminer ») :
  le proprietaire ne voulait pas d'un nouveau message a chaque score saisi. Le
  bot ne ramasse que les matchs coches ou deja annonces — un message deja
  publie reste corrige si la case est decochee ensuite, le retirer restant une
  decision d'administrateur. Meme patron que les messages composes — `messageId` a
  `null` publie, renseigne corrige, introuvable republie — mais avec deux
  cycles : `EsportWeek.discordSyncedAt` pour le recapitulatif,
  `EsportMatch.resultSyncedAt` pour le resultat. Cinq points a garder :
  - **les deux rendus vivent dans `@anubis/shared`**
    (`buildEsportWeekEmbeds`, `buildEsportResultEmbed`) : le bot les envoie, le
    dashboard les previsualise, l'API mesure leur taille **dans la
    transaction**, apres l'ecriture, et refuse un match qui ferait deborder les
    6000 caracteres plutot que de laisser le bot echouer a la publication. Le
    recapitulatif est **un message a plusieurs embeds** : les 6000 caracteres
    portent sur leur somme (`esportEmbedsSize`), et Discord n'en accepte que
    dix par message.
  - **tout se raisonne a l'heure de Paris** (`ESPORT_TIME_ZONE`,
    `src/timezone.ts`) : la saisie, le regroupement par jour et l'appartenance
    d'un match a sa semaine. Un match du dimanche 23 h 30 n'est pas de la
    semaine suivante, meme s'il l'est en UTC. Sur Discord, les heures partent
    en horodatage `<t:…:t>` et chacun les lit dans son fuseau.
  - **une journee esport finit a 06:00** (`ESPORT_DAY_START`,
    `esportDayKey`/`esportWeekStart`) : les matchs nord-americains du dimanche
    se jouent a 1 h lundi, heure de Paris, et doivent rester dans la journee du
    dimanche et dans sa semaine — une semaine va donc du lundi 06:00 au lundi
    suivant 05:59, appel PandaScore compris. Ces matchs portent un 🌙. La
    saisie suit la meme logique : on choisit une journee puis une heure, et
    « dimanche, 01:00 » est converti en lundi 01:00 (`esportCalendarDay`). Le
    calcul se fait sur l'heure **locale**, jamais en retranchant six heures a
    l'instant : la nuit du changement d'heure tomberait du mauvais cote.
  - **un embed par region** (`EsportMatch.region`, codes de `ESPORT_REGIONS`),
    tous dans le meme message — jamais un message par region, qui multiplierait
    les messages a publier, corriger et retirer, et les notifications. Les
    regions suivent l'ordre de `ESPORT_REGIONS`, « 🎮 Autres » en dernier ;
    dans chaque embed, un champ par journee. Chaque embed porte son en-tete
    (titre de la semaine en `author`, region en titre, dates), l'introduction
    n'est que sur le premier et le pied que sur le dernier. Chaque region a sa
    couleur, modifiable (`EsportConfig.regionColors`, qui ne garde que les
    ecarts au defaut). Sans aucune region dans la semaine, un embed unique comme
    avant. A l'import, la region est reconnue dans l'intitule de la serie
    (`detectEsportRegion`).
    **Ce que toute la region partage va dans la description de son embed**
    (competition sans le nom de la region, format, stream) : le staff trouvait
    le recapitulatif trop dense quand chaque ligne repetait « OWCS North
    America Stage 3 · FT3 · Stream ». Une ligne ne garde que l'heure, les
    equipes et ce qui lui est propre. Le nom d'un evenement international
    (« World Finals ») n'est jamais raccourci.
  - **le spoiler se resout match par match** : `EsportMatch.spoiler` a `null`
    suit `EsportConfig.spoilerScores`. Sous spoiler, le vainqueur l'est aussi
    et le logo du gagnant n'est pas affiche — il trahirait le resultat avant le
    clic.
  - **seul un administrateur retire un message** (`esport:manage`,
    `removalRequestedAt` / `resultRemovalRequestedAt`). Supprimer une semaine,
    un match ou rouvrir un match depuis le dashboard ne touche jamais a
    Discord ; un match rouvert puis termine de nouveau **corrige** son annonce
    au lieu d'en poster une seconde.
  - une equipe deja utilisee est **archivee**, jamais supprimee : les semaines
    passees doivent continuer de l'afficher. Modifier une equipe remet en file
    les recapitulatifs publies de la semaine en cours et des suivantes, pas
    ceux du passe.
  Les formats distinguent **BO** et **FT** (`EsportMatch.format`) : l'OWCS se
  joue en « premier a trois » (FT3), que PandaScore ecrit `match_type:
  first_to`. `bestOf` reste le nombre de manches dans les deux cas.

  **Import PandaScore** (`api/src/esport/esport-import.service.ts`,
  `pandascore.client.ts`, `features/esport/import-dialog.ts`) : il preremplit,
  il ne decide rien. Le proprietaire veut garder la main — **ne jamais ajouter
  d'appel planifie, de creation de match ni de publication automatique**.
  Cinq points a garder :
  - **trois couches distinctes**. Le cache (`pandascore_matches`, la reponse
    brute) n'est jamais modifie par le staff ; la semaine en recoit des
    **copies** que le staff corrige librement ; seul un nouvel import, coche
    explicitement avec ses differences affichees, ecrase une copie — et jamais
    son score, son spoiler ni ses messages.
  - **un appel par semaine** : `/ow/matches` filtre par ligue et par
    `range[scheduled_at]` ramene matchs a venir, en cours et termines. Il part
    a l'ouverture de l'import d'une semaine jamais recuperee, ou sur
    « Actualiser », refuse a moins de deux minutes du precedent
    (`pandascore_fetches`, `PANDASCORE_REFRESH_COOLDOWN_MS`). L'import lui-meme
    lit le cache, jamais PandaScore : on importe ce qu'on a vu.
  - **`scheduled_at`, jamais `begin_at`** (l'heure reelle de lancement), et
    aucun score avant `status: finished` — PandaScore ecrit 0 - 0 d'avance.
    Le score n'est qu'une **proposition** dans « Terminer », qui reste le seul
    chemin vers une annonce de resultat.
  - les equipes se reconnaissent par **`pandascoreId`**, puis par nom pour
    relier une equipe saisie a la main avant l'import (elle garde son emoji et
    son logo). Le logo importe est la version **sombre** quand elle existe :
    Discord est le plus souvent en theme sombre.
  - **la source est citee** (« Source : PandaScore », `PANDASCORE_SOURCE_LABEL`)
    au pied de tout embed qui affiche un match importe — condition de
    reutilisation de leurs donnees. Le rendu le fait seul, a partir de
    `pandascoreId`.
  `PANDASCORE_TOKEN` vit dans l'environnement de l'API, jamais en base ; absent,
  le bouton d'import disparait et la saisie manuelle reste entiere — c'est le
  chemin qui doit marcher le jour ou la source tombe.
- **Ce qui n'est PAS rattrape automatiquement.** Le patron `discordSyncedAt`
  couvre sanctions, avertissements (message prive), tickets, anti-raid,
  quarantine (etapes et levees), signalements de compte, concours et messages
  composes. Il reste **un** reglage du dashboard sans effet automatique sur
  Discord, a savoir avant de chercher un bug : le **message de reglement de
  quarantaine** n'est publie que par `/quarantaine-message`. Modifier le texte,
  le libelle d'un bouton, ou **activer la verification Battle.net** (qui ajoute
  un second bouton) ne touche pas au message deja poste — il faut rejouer la
  commande, qui est prevue pour et remplace le precedent.
- **Annonce de verification Battle.net** (`src/tasks/battlenetNotice.ts`) :
  journal de moderation **et** message prive au membre, declenches par
  `BattlenetAccount.discordSyncedAt`. Trois points a garder :
  - le declencheur est la ligne du **lien**, pas le statut de quarantaine. Ce
    dernier repasse a `discordSyncedAt: null` pour d'autres raisons (une levee
    manuelle), et l'annonce serait alors renvoyee a chaque fois. Une ligne
    `battlenet_accounts` n'est creee qu'une fois par compte Blizzard, et le
    bloc `update` de l'upsert ne touche pas a la date — une reverification
    rafraichit le BattleTag sans reannoncer.
  - le journal ne porte **pas le BattleTag**. Il est reserve a
    `battlenet:read` (administrateurs) dans le dashboard, or le salon de logs
    est lu par toute l'equipe : l'y ecrire contournerait la permission. Ce qui
    releve du travail courant, c'est que l'etape a ete franchie.
  - le message prive dit ce qui **reste a faire** : il annonce un acces ouvert
    seulement si `quarantineStage` vaut `CLEARED`. Le promettre a quelqu'un qui
    n'a pas encore accepte le reglement l'enverrait chercher des salons qu'il ne
    voit pas.
  Les deux envois passent par un `Promise.allSettled` : des messages prives
  fermes ne doivent pas priver le staff de sa trace, ni l'inverse. La date est
  posee **meme quand les deux echouent**, meme raison que `warningNotice`.
- **Alertes de compte signale** (`src/tasks/accountFlagAlerts.ts`) :
  `accountSurveillance` alerte a l'arrivee et pose `discordSyncedAt` dans le
  meme appel — il n'a rien a rattraper. La tache ne ramasse donc que ce qui
  vient de l'API, qui n'a aucun acces a Discord : aujourd'hui une verification
  Battle.net refusee pour compte deja lie. La date est posee **meme quand
  l'envoi echoue**, meme raison que `warningNotice`, et la migration
  **retro-remplit les lignes existantes** avec leur `created_at` — sans quoi le
  premier passage aurait re-alerte tous les comptes signales depuis la mise en
  service.
- **Notification d'avertissement** (`src/tasks/warningNotice.ts`) : `/warn`
  previent le membre lui-meme et pose `discordSyncedAt` dans la foulee ;
  `POST /warnings` laisse `null` et la tache envoie le message prive. La date
  est posee **meme quand l'envoi echoue** (membre parti, messages prives
  fermes) : sans cela l'avertissement reviendrait toutes les cinq secondes.
  La migration qui a ajoute la colonne **retro-remplit les lignes existantes**
  avec leur `created_at` — sans quoi le premier passage aurait envoye un
  message prive a tous les membres jamais avertis.
- **Rappels du staff** (`/rappel`, `src/tasks/reminders.ts`) : en base et non
  en memoire, un `setTimeout` ne survivrait pas a un redeploiement. Le delai
  se saisit en forme compacte (`2h`, `1h30`, `3j`) via `parseCompactDelay`
  (`packages/shared/src/duration.ts`), qui **refuse toute saisie qu'il ne
  comprend pas entierement** : poser un rappel a une heure inattendue est pire
  que le refuser. Livraison en message prive, repli sur le salon d'origine.
- **`/clear`** : `bulkDelete` refuse les messages de plus de 14 jours, la
  commande le dit plutot que de laisser remonter une erreur opaque. Avec
  l'option `membre`, elle relit 100 messages pour en trouver N de cette
  personne. Une suppression de masse ne laissant **aucune trace sur Discord**,
  elle ecrit systematiquement dans le salon de logs de moderation.
- **Anti-raid** (`src/collectors/raid.ts`) : fenetre glissante d'arrivees en
  memoire par serveur. Le confinement ne verrouille que les salons
  **effectivement ouverts** au moment du declenchement, et ne memorise que
  ceux-la (`lockedChannelIds`) pour les rouvrir a l'identique — jamais un
  salon deja restreint manuellement avant le raid. Le declenchement
  automatique applique l'effet Discord immediatement (le bot y a deja
  acces) ; un declenchement ou une resolution demandes depuis la webapp
  laissent `discordSyncedAt` a `null` et attendent le prochain passage de la
  tache periodique.
- **Rangs des salons vocaux temporaires** (`src/collectors/voiceHubs.ts`,
  `voice_hub_ranks`, `voice_hub_platforms`) : le proprietaire choisit un rang et
  une plateforme depuis le panneau du salon ; le **rang seul** deplace le salon.
  Un salon de creation choisit d'abord **comment ses salons se rangent**
  (`VoiceHub.placementMode`) :
  - `FIXED_CATEGORY` — ils restent groupes dans la categorie d'accueil du hub
    (« Partie Rapide »), et la modale ne propose ni rang ni deplacement. C'est
    `chargerOptions` qui vide la liste des rangs, meme si le dashboard en garde
    de configures : un select sans effet se lit comme un bug.
  - `RANK_CATEGORY` — ils atterrissent dans la categorie d'accueil
    (« En attente »), puis le rang les range ailleurs.

  **Toute categorie manquante est creee**, jamais exigee : `landingCategoryId`
  et `VoiceHubRank.categoryId` sont facultatifs et **reecrits par le bot** apres
  coup. `garantirCategorieNommee` cherche dans cet ordre — identifiant retenu,
  puis nom, puis creation : chercher par nom avant de creer evite de doubler une
  categorie faite a la main, et fait que deux hubs partageant le meme nom
  d'accueil partagent la categorie. Renommer la categorie d'accueil depuis le
  dashboard **efface l'identifiant retenu**, sans quoi le bot continuerait
  d'utiliser l'ancienne. Quatre autres points a garder :
  - le rang et la plateforme vivent dans le **sujet** du salon (« voice
    status »), jamais dans son nom. Discord n'accepte que **deux renommages par
    tranche de dix minutes et par salon** : dans le nom, corriger son rang puis
    sa plateforme atteindrait le plafond du premier coup, et le troisieme essai
    resterait bloque dix minutes sans erreur lisible. C'est aussi pourquoi la
    modale ne propose plus le nom du tout.
  - **le sujet porte une composition d'equipe, plus un texte libre.** Le
    proprietaire declare trois nombres — les places deja prises en tank, DPS et
    support — et le sujet rend « 🛡️ 1/2 · ⚔️ 2/2 · 💉 0/2 ». Le « sur combien »
    vient du **salon de creation** (`tankSlots`, `dpsSlots`, `supportSlots`,
    plus un emoji par role) : il ne depend pas du salon mais du mode de jeu, un
    5v5 ne portant qu'un tank. Quatre points a garder :
    - **Discord plafonne une modale a cinq champs.** Rang, plateforme et les
      trois roles l'occupent entierement : c'est ce qui a fait sortir la limite
      de places, qui se regle desormais par salon de creation. Un role regle a
      0 place n'a pas de champ et disparait du sujet — « 0/0 » se lirait comme
      une equipe complete.
    - **tous les champs vides effacent la ligne des roles**, un seul rempli met
      les autres a zero. C'est le seul chemin de retour vers un sujet sans
      composition : sans lui le premier remplissage serait definitif.
    - une place **au-dela du total est refusee**, jamais ramenee au plafond :
      « 3 tanks sur 2 » est une faute de frappe, et la corriger en silence
      afficherait un chiffre que personne n'a saisi.
    - `voiceTeamSlots` et `renderVoiceStatus` (`@anubis/shared`) composent la
      ligne pour le bot comme pour l'apercu du dashboard. Le jeton de gabarit
      est `{roles}` ; `{sujet}`, l'ancien texte libre, est accepte et **rendu
      vide** — la migration a reecrit les gabarits existants, mais le champ
      reste modifiable a la main depuis le dashboard.
  - **chaque option du sujet existe en deux jetons** : `{rang}` rend « 🥇 Or »
    et `{rang-icone}` rend « 🥇 » ; de meme pour `{plateforme}` et
    `{plateforme-icone}`. Le sujet est court et Discord le tronque sans
    prevenir : retirer les libelles est ce qui permet d'y faire tenir la
    composition d'equipe. Les deux formes se melangent librement et l'ordre
    reste celui du gabarit. Un jeton reduit **retombe sur le libelle quand
    l'option n'a pas d'emoji** : rendre vide serait coherent avec son nom, mais
    ferait disparaitre le rang du sujet sans que personne ne comprenne
    pourquoi. Le dashboard liste les quatre jetons avec un exemple de rendu —
    une enumeration entre accolades ne dit pas ce que chacun produit.
  - le sujet n'existe pas dans discord.js 14.27 : l'appel part en brut sur
    `PUT /channels/:id/voice-status`, et demande la permission
    `SetVoiceChannelStatus` — ajoutee a `permissionsManquantes`, sans quoi la
    personnalisation ne laisse aucune trace visible.
  - `setParent` recoit **`lockPermissions: false`**. Synchroniser les
    permissions sur la categorie d'arrivee effacerait les surcharges du salon :
    le verrou du panneau sauterait a chaque changement de rang, et l'acces
    garanti du proprietaire avec lui.
  - **le sujet est refuse a `@everyone`** (`accesDeBase`). Discord laisse par
    defaut tout occupant ecrire le « voice status » depuis le client, et le
    panneau devenait decoratif : le rang, la plateforme et la composition se
    faisaient ecraser par du texte libre — celui-la meme qu'on avait retire de
    la modale. Le bot se le rend explicitement (sans quoi il ne pourrait plus
    poser le sujet qu'il compose) et les roles portant `ModerateMembers` le
    gardent. Les salons nes avant ce refus sont repares au rattrapage du
    demarrage par `garantirSujetReserve`.
  - **le bouton « Expulser » ne touche pas a la moderation**
    (`src/collectors/voiceConfig.ts`, table `voice_config`). Tout porteur de
    `ModerateMembers` est protege **sans configuration** — c'est deja le
    marqueur qui ouvre les salons de ticket, et sans ce defaut la protection ne
    vaudrait rien tant que personne n'aurait rempli la liste. `protectedRoleIds`
    couvre le reste : un role a proteger sans pouvoir de moderation. Les
    proteges sont **retires du select**, pas refuses apres coup — proposer un
    nom pour repondre « non » invite a reessayer et apprend qui est moderateur
    — et la verification est **rejouee a la soumission**, l'identifiant venant
    du client.
  - une categorie pleine (**50 salons**) fait echouer le deplacement en 50035 :
    le compte est verifie avant, et le rang **n'est alors pas enregistre**. Une
    ligne annoncant un rangement que Discord n'a jamais fait ferait deplacer le
    salon plus tard par le rattrapage du demarrage, sans que personne ne l'ait
    demande.
  Retirer un rang depuis le dashboard ne deplace **pas** les salons qui le
  portaient (`ON DELETE SET NULL`) : ils restent ou ils sont jusqu'au prochain
  choix de leur proprietaire. Le rattrapage du demarrage
  (`reconcilierSalons`), lui, remet chaque salon dans la categorie attendue et
  recree celle qui aurait ete supprimee a la main pendant l'arret. `renderVoiceStatus` (`@anubis/shared`) compose le
  sujet pour le bot et pour l'apercu du dashboard — meme raison que
  `renderXpLevelUpMessage`.

  **Les categories de rangement se referment toutes seules**
  (`nettoyerCategoriesVides`). Elles naissent a la demande et rien ne les
  effacait : un serveur finissait avec autant de categories vides que de rangs
  jamais rejoues. Trois points a garder :
  - **seules les categories que le bot gere sont concernees**, c'est-a-dire
    celles dont l'identifiant est retenu dans `VoiceHubRank.categoryId` ou
    `VoiceHub.landingCategoryId`. Une categorie faite a la main ne lui
    appartient pas, meme vide, meme homonyme — et `PARTIES_CATEGORY_NAME`, qui
    porte les salons de creation, n'est jamais visee.
  - l'identifiant retenu est **efface dans le meme mouvement**, sinon le bot
    continuerait de viser une categorie disparue au lieu de laisser
    `garantirCategorieNommee` la recreer au prochain salon.
  - l'appel se fait aux seuls moments ou une categorie peut devenir vide :
    depart du dernier occupant, suppression manuelle d'un salon temporaire,
    purge, et rattrapage du demarrage. `oublierSalon` renvoie desormais un
    booleen pour que `channelDelete` ne parcoure pas les categories a chaque
    salon supprime sur le serveur.

- **Concours** (`src/collectors/giveaway.ts`, `src/commands/giveaway/giveaway.ts`) :
  participation par reaction, meme patron `discordSyncedAt` que les sanctions.
  Le **statut** dit ce qui reste a faire quand `discordSyncedAt` est `null` :
  `SCHEDULED` = jamais publie, `RUNNING` = embed a corriger (edition web),
  `CANCELLED` = message a barrer, `ENDED` = nouveau tirage demande. Trois
  points ont chacun une raison d'etre :
  - `GuildMessageReactions` est **non privilegie mais indispensable** : sans
    lui, `messageReactionAdd` n'est jamais livre — meme piege silencieux que
    `GuildModeration`. Il faut **en plus** les partials `Message`, `Reaction`
    et `User` : une reaction posee sur un message anterieur au dernier
    demarrage arrive sur un message hors cache, et discord.js ecarte
    l'evenement sans rien dire. `messageDelete`/`messageUpdate` recoivent donc
    eux aussi des messages partiels ; tous deux s'arretaient deja sur
    `!message.author`.
  - les participations sont enregistrees **deux fois** : au fil de l'eau par
    les evenements, et par relecture complete des reactions au moment du
    tirage (`reconcileEntries`). Le second rattrape ce qui s'est passe bot
    eteint — une participation manquee au tirage est une participation perdue.
  - un emoji personnalise est reconnu **par son identifiant**, jamais par son
    nom : un emoji renomme casserait la comparaison.
- **Surveillance de comptes** (`src/collectors/accountSurveillance.ts`) :
  calculee a l'arrivee, **avant** l'upsert de `guildMemberAdd.ts` qui
  ecraserait `Member.leftAt` (necessaire pour detecter un retour rapide).
  Jamais de sanction automatique — uniquement un `AccountFlag` par signal
  declenche et une alerte consolidee au staff.

## Dashboard

- Composants standalone, signaux, `ChangeDetectionStrategy.OnPush` partout.
- **Espacement : une echelle, declaree dans `styles.scss`, et rien d'autre.**
  Sept jetons `--space-1` a `--space-7` (4 a 48 px), et la regle qui les
  gouverne est l'**echelle de proximite** — l'ecart croit avec la distance
  semantique, et un niveau ne vaut jamais autant que celui du dessus : a
  l'interieur d'un element (4), entre elements d'une suite (8), entre controles
  d'un groupe (12), entre freres d'un bloc (16), entre blocs d'une carte (24),
  entre sections d'une page (32), entre regions (48). Quatre consequences :
  - **le rythme vertical d'une page vient de `.page > * + *`**, declare une
    seule fois. Une page ne remet pas `margin-top: 24px` sur ses sections :
    c'est ainsi qu'on se retrouvait avec trois ecarts differents d'un ecran a
    l'autre. Elle peut en declarer un **autre**, pas le meme.
  - une carte respire a `--space-5` dedans et se separe de sa voisine a
    `--space-6` : l'exterieur toujours plus grand que l'interieur, sinon le
    groupe cesse de se lire comme un groupe. Le selecteur global porte **deux
    classes** (`.mat-mdc-card .mat-mdc-card-content`) parce que les styles de
    `mat-card` sont injectes apres cette feuille — a specificite egale, le
    rembourrage de Material de 16 px l'emportait sans rien signaler.
  - **un texte suivi ne depasse jamais `--measure`** (72ch). Un sous-titre
    etire sur 1400 px reste illisible quelle que soit la place autour : l'oeil
    perd la ligne en revenant a la marge.
  - la densite Material est a **`-1`**, pas `-2`. Le cran le plus serre mettait
    les boutons a 32 px et les lignes de table a 44 px. C'est le seul reglage
    qui agit sur toutes les pages a la fois — le changer se voit partout.
- **Les listes d'identifiants se saisissent par `shared/validators/snowflake-list.ts`.**
  Le dashboard n'a pas de selecteur de roles ni de salons — simplification
  assumee. Ce qui manquait, c'est de **dire ce qui ne va pas** : une faute de
  frappe partait jusqu'a l'API, qui refusait la requete entiere sans designer
  le fautif. Le message nomme donc le premier identifiant invalide, et le
  separateur est tolerant (virgule, point-virgule, espace) parce qu'on colle
  souvent une liste venue d'ailleurs.
- **Un `mat-error` ne s'affiche que si le controle du champ est en erreur.**
  Un validateur pose sur le `FormGroup` (deux mots de passe qui doivent
  correspondre) laisse chaque champ valide aux yeux de Material, et le message
  reste invisible — on pouvait cliquer « Enregistrer » indefiniment sans
  savoir ce qui bloquait. Le validateur de groupe doit donc **poser l'erreur
  sur le controle concerne**, en ne touchant qu'a sa propre cle pour ne pas
  effacer un `required`. Les formulaires longs y ajoutent un resume de la
  raison du blocage, juste au-dessus du bouton : le `mat-error` peut etre hors
  de l'ecran au moment du clic.
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
- La barre laterale est decoupee en **sections titrees** (`NAV_SECTIONS` dans
  `layout/shell/shell.ts`). Le filtre par permission s'applique aux entrees,
  puis les sections restees vides sont retirees : un intertitre sans rien
  dessous renseignerait un compte en lecture seule sur les pages qu'il n'a pas
  le droit de voir.
- **Securite** (`features/security/{automod,raid,account-flags}`) : les
  identifiants de role (`exemptRoleIds`, `alertRoleId`) sont saisis en texte
  libre (snowflakes separes par des virgules), pas via un selecteur de
  roles — simplification assumee, aucun `RolesApi` de liste simple n'existe
  encore cote webapp. La page Automod construit un `FormGroup` par regle
  dont les champs `settings` dependent du type (`@switch` dans le template) ;
  les six formes possibles sont documentees dans
  `packages/shared/src/dto/automod.ts` (`AutomodRuleSettings`). Meme
  simplification pour les paliers d'XP (`features/xp/`) : `roleId` en texte
  libre, et pour **Rôles & mentions** (`features/admin/mentions/`).
- **Rôles & mentions** (`features/admin/mentions/`) : la page est gardee par
  `LOGS_WRITE` **en lecture comme en ecriture**, y compris la route et l'entree
  de barre laterale. C'est le seul endroit du dashboard ou un `GET` est ferme
  par une permission d'ecriture : la page n'existe que pour changer qui le bot
  interpelle, il n'y a rien a y consulter pour soi, et le proprietaire l'a
  voulue reservee aux administrateurs. Son apercu passe par
  `renderMemberReference` (`@anubis/shared`), la fonction qu'emploie le bot —
  meme raison que `renderXpLevelUpMessage`.
- **Messages** (`features/embeds/`) : l'apercu reproduit le rendu de Discord sur
  un **fond sombre fixe dans les deux themes** du dashboard — un apercu qui
  change de couleur avec le theme mentirait sur ce que verra le serveur. Le
  formulaire vit hors du graphe de signaux : `toSignal(form.valueChanges)` est
  ce qui redessine l'apercu en `OnPush`, sans quoi il resterait fige. Le
  decompte de caracteres n'est pas decoratif : la limite de 6000 de Discord
  porte sur la **somme** de tous les champs, et un embed dont chaque champ tient
  dans sa propre limite peut malgre tout etre refuse
  (`embedCharacterCount`, partage avec l'API).
- **Sessions actives** (`features/admin/sessions/`) : une ligne par famille de
  refresh tokens, pas par jeton. La session courante est reconnue par le `sid`
  de l'access token et **ne peut pas etre fermee depuis cette page** : le cookie
  resterait pose et l'interface afficherait une session que le serveur a
  fermee — c'est le bouton « Se deconnecter » de l'en-tete qui fait cela
  proprement.
- **Wiki** (`features/wiki/`) : l'editeur riche
  (`shared/components/rich-text-editor.ts`) est **TipTap en mode headless** —
  il ne fournit aucune interface, la barre d'outils est faite de boutons
  Material. Un editeur livre avec son theme (Quill, CKEditor) aurait impose
  son apparence au milieu d'une application entierement Material. Quatre
  points s'y sont averes non negociables :
  - l'instance se cree dans `afterNextRender` (TipTap exige un element du DOM)
    et se detruit dans `ngOnDestroy` — ProseMirror pose des ecouteurs sur le
    document, qui survivraient a la fermeture de la page.
  - ProseMirror vit **hors d'Angular** : aucun de ses changements ne declenche
    de detection. Le signal `revision`, incremente a chaque transaction, est ce
    qui garde les boutons de la barre en phase en `OnPush`.
  - les boutons portent `(mousedown)="$event.preventDefault()"` : sans lui, le
    bouton prend le focus a l'enfoncement et replie la selection.
  - `link` se configure **dans** `StarterKit` : la v3 l'embarque deja, et
    ajouter `@tiptap/extension-link` a cote enregistre deux fois la meme
    extension (« Duplicate extension names found »).
  Le HTML des articles est nettoye **cote API** (`api/src/wiki/wiki-content.ts`,
  liste blanche `sanitize-html`), et repasse par le sanitizer d'Angular a
  l'affichage via `[innerHTML]`. La premiere passe fait foi ; la seconde couvre
  une donnee ecrite avant que la regle n'existe. `sanitize-html` **n'est plus
  epingle en 2.14** : l'avis GHSA-vccv-cmxp-4j9h impose au minimum 2.17.5, dont
  la chaine de dependances (`htmlparser2` v10+) est en **ESM pur**. Deux
  consequences a garder en tete :
  - la bibliotheque declare `engines: node >= 22.12` et compte sur
    `require(ESM)`. Les images Docker et la CI sont en `node:22`, donc au-dela
    de 22.12 — mais retrograder la version de Node casserait le demarrage de
    l'API, pas seulement les tests.
  - Jest ne transforme pas `node_modules` par defaut. D'ou le
    `transformIgnorePatterns` de `api/package.json`, ecrit
    `^(?!.*sanitize-html).*node_modules` : la forme naive
    `node_modules/(?!sanitize-html)` **ne marche pas**, parce que le chemin
    contient un second `node_modules` imbrique (`sanitize-html/node_modules/
    htmlparser2/...`) sur lequel la negation retombe. Le `allowJs` passe a
    `ts-jest` va avec.
  `contentText` (texte nu) double `contentHtml` parce que la recherche doit
  porter sur les mots, pas sur le balisage. Le slug ne suit **jamais** le
  titre apres creation : il vit dans les URL que l'equipe se partage.

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

La CI (`.github/workflows/ci.yml`) enchaine exactement cette sequence, tests
compris :

```bash
npm ci && npm run build && npm test && npm ci --prefix bot && npm run test --prefix bot && npm run bot:build
```
