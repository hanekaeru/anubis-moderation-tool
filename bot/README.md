# Bot Anubis

Bot Discord du projet [Anubis](../README.md). Il observe le serveur, écrit ce
qu'il voit en base, applique les décisions prises depuis le dashboard et répond
aux commandes slash. **Il ne lit jamais l'API** : les deux briques se parlent
par la base de données.

## Particularités

- **Hors des workspaces npm.** `bot/` a ses propres `node_modules` et son
  `package.json`. Il consomme le package partagé par une dépendance `file:`
  (`"@anubis/shared": "file:../packages/shared"`), qui doit donc être construit
  avant lui.
- **TypeScript**, comme l'API et le dashboard : `npm run build` compile vers
  `dist/`, `npm run start:dev` recharge à chaud via nodemon.
- Tout le code applicatif vit dans `src/` (`commands/`, `events/`,
  `collectors/`, `handlers/`, `tasks/`, `utils/`). Seuls les points d'entrée
  restent à la racine : `index.ts`, `refresh.ts`, `delete_command.ts`.
- `commands/` et `events/` sont découverts par **balayage du dossier** au
  démarrage (`src/loadCommands.ts`, `src/loadEvents.ts`) : y déposer un fichier
  suffit à l'enregistrer, mais le compilateur ne vérifie pas ce chemin — une
  erreur de dossier ne se voit qu'au lancement.

## Mise en route

Depuis la racine du dépôt, le package partagé doit exister d'abord :

```bash
npm run build
```

Puis, depuis `bot/` :

```bash
npm install
```

Copier `.env.example` en `.env` et renseigner au minimum `BOT_TOKEN`,
`CLIENT_ID`, `GUILD_HOST_ID` et `DATABASE_URL`.

## Scripts

| Commande            | Effet                                                        |
| ------------------- | ------------------------------------------------------------ |
| `npm run build`     | Compile TypeScript vers `dist/`                              |
| `npm run start:dev` | Développement, avec rechargement à chaud                     |
| `npm start`         | Lance `dist/index.js` en lisant `.env` s'il existe           |
| `npm run refresh`   | Publie les commandes slash auprès de l'API Discord           |
| `npm run delete`    | Supprime une commande slash déjà publiée                     |
| `npm test`          | Jest, sur les specs de `src/`                                |

## Intents Discord

Trois réglages doivent être actifs dans le portail développeur, faute de quoi
des évènements ne sont **jamais livrés, sans la moindre erreur** :

- `GuildMembers` — intent **privilégié**, à activer explicitement ; sans lui la
  connexion échoue.
- `MessageContent` — intent **privilégié** ; nécessaire au suivi des tickets.
- `GuildModeration` et `GuildMessageReactions` — non privilégiés, mais sans eux
  `guildBanAdd`/`guildBanRemove` et `messageReactionAdd` ne remontent pas.

La permission Discord « Voir le journal d'audit » est nécessaire pour attribuer
un auteur aux sanctions posées à la main dans le client.

## Pour aller plus loin

- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — la place du bot dans le projet
- [`../CLAUDE.md`](../CLAUDE.md) — les pièges connus, collecteur par collecteur
