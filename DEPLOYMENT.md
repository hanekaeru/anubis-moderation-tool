# Déploiement d'Anubis en production

Guide complet pour déployer le bot, l'API et le dashboard sur un serveur, avec
redéploiement automatique à chaque push sur `master`.

Architecture retenue : **un VPS + Docker + Coolify**. C'est la combinaison la
plus utilisée aujourd'hui pour ce type de projet (un process qui doit tourner
en continu — le bot — combiné à une API et un frontend), parce qu'elle
reproduit ce que tu connais déjà (un serveur que tu contrôles entièrement)
tout en remplaçant le déploiement manuel par une automatisation complète.

## Vue d'ensemble

```mermaid
flowchart TB
    subgraph GitHub
        M[branche master]
        S[branche staging - optionnel]
    end

    M -- webhook push --> C
    S -- webhook push --> C

    subgraph VPS["VPS (Ubuntu 24.04)"]
        subgraph Coolify["Coolify"]
            C[Orchestrateur de déploiement]
            T[Traefik - reverse proxy + HTTPS auto]
        end
        subgraph Stack["Stack Docker (docker-compose)"]
            API[api - NestJS]
            WEB[webapp - Nginx statique]
            BOT[bot - discord.js]
        end
        PG[(PostgreSQL - ressource managée Coolify)]
    end

    C -- build & déploie --> Stack
    T -- moderation.tondomaine.com/ --> WEB
    T -- moderation.tondomaine.com/api --> API
    API --> PG
    BOT --> PG
    WEB -.->|appels relatifs /api/*| T
```

Points clés à retenir avant de commencer :

- **Un seul nom de domaine** pour `webapp` et `api` : le frontend appelle
  l'API en chemin relatif (`/api/...`) et le cookie de refresh token est posé
  en `sameSite: lax` sans attribut `domain`. Séparer `api.` et `app.` sur des
  sous-domaines différents casserait l'authentification. On route donc
  `/api/*` vers le conteneur API et le reste vers le conteneur webapp, **sur
  le même domaine**.
- **Le bot n'expose aucun port** : c'est un simple process en tâche de fond,
  sans route HTTP, sans domaine.
- **PostgreSQL** tourne comme ressource gérée par Coolify (sauvegardes et UI
  incluses), pas dans le `docker-compose.yml` applicatif — pour ne jamais
  perdre les données lors d'un redéploiement de la stack.
- Coolify permet de dupliquer la stack pour un **environnement staging** relié
  à une autre branche : c'est la réponse concrète à « choisir quelle branche
  déployer ».

---

## 0. Vocabulaire rapide

- **VPS** : un serveur Linux loué à l'heure/au mois, sur lequel tu as un accès
  root complet (contrairement à un hébergement mutualisé).
- **Reverse proxy** : un service qui reçoit tout le trafic HTTPS entrant et le
  redistribue vers le bon conteneur selon le domaine/chemin demandé (ici,
  Traefik, installé automatiquement par Coolify).
- **Image / conteneur Docker** : une image est un paquet figé de l'application
  (code + dépendances + runtime) ; un conteneur est une instance de cette
  image en cours d'exécution.
- **Webhook** : une notification HTTP que GitHub envoie automatiquement à
  Coolify à chaque push, qui déclenche le redéploiement.
- **Coolify** : plateforme open-source auto-hébergée (gratuite) qui donne une
  interface web façon Heroku/Vercel — build, déploiement, domaines, HTTPS,
  variables d'environnement, logs, rollback — installée sur ton propre VPS.

---

## 1. Choisir et provisionner un VPS

Recommandation : **Hetzner Cloud**, offre `CX22` (2 vCPU / 4 Go RAM / 40 Go
disque, ~4-5 €/mois) — bon rapport qualité/prix, datacenters en Europe.
Alternatives équivalentes : OVH, Contabo, DigitalOcean, Scaleway.

4 Go de RAM minimum est important : Coolify (Traefik + sa propre base) +
PostgreSQL + API + bot tournent en même temps sur la même machine.

1. Créer un compte chez l'hébergeur choisi.
2. Générer une paire de clés SSH si tu n'en as pas :
    ```bash
    ssh-keygen -t ed25519 -C "anubis-deploy"
    ```
3. Créer le serveur avec :
    - Image : **Ubuntu 24.04 LTS**
    - Ta clé SSH publique ajoutée à la création (pas de mot de passe)
4. Noter l'adresse IP publique du serveur.

---

## 2. Nom de domaine et DNS

1. Acheter un nom de domaine (Gandi, OVH, Namecheap, Cloudflare Registrar —
   n'importe lequel convient, aucune contrainte technique ici).
2. Chez le fournisseur DNS (souvent le registrar lui-même, ou Cloudflare si tu
   veux profiter de son DNS gratuit), créer un enregistrement :
    ```
    Type: A
    Nom:  moderation            (ou le sous-domaine de ton choix)
    Valeur: <IP publique du VPS>
    TTL: automatique
    ```
    Résultat : `moderation.tondomaine.com` pointe vers le VPS.
3. Vérifier la propagation (peut prendre de quelques minutes à quelques
   heures) :
    ```bash
    nslookup moderation.tondomaine.com
    ```

---

## 3. Sécuriser le serveur

Connexion initiale :

```bash
ssh root@<IP_VPS>
```

### 3.1 Utilisateur non-root

```bash
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

### 3.2 Durcir SSH

Dans `/etc/ssh/sshd_config` :

```
PermitRootLogin no
PasswordAuthentication no
```

```bash
systemctl restart sshd
```

À partir d'ici, se connecter avec `ssh deploy@<IP_VPS>`.

### 3.3 Pare-feu

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8000/tcp   # dashboard Coolify (temporaire, voir étape 5)
sudo ufw enable
```

### 3.4 Mises à jour automatiques (recommandé)

```bash
sudo apt update && sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## 4. Installer Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy
```

Se déconnecter/reconnecter pour que l'appartenance au groupe `docker` soit
prise en compte, puis vérifier :

```bash
docker --version
docker compose version
```

---

## 5. Installer Coolify

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

L'installateur affiche l'URL du tableau de bord à la fin, du type
`http://<IP_VPS>:8000`. Ouvrir cette URL, créer le compte administrateur au
premier accès.

Optionnel mais recommandé : donner un sous-domaine à Coolify lui-même (ex.
`coolify.tondomaine.com`, même principe DNS qu'à l'étape 2) et l'activer dans
_Settings → Domain_ pour y accéder en HTTPS plutôt que par IP:8000. Une fois
fait, retirer la règle `ufw allow 8000/tcp` : seul le port 443 restera
nécessaire.

---

## 6. Connecter GitHub à Coolify

Dans Coolify : _Sources → Add → GitHub App_. Suivre l'assistant : il crée une
GitHub App sur ton compte/organisation, à installer sur le repo `anubis`
(ou tous tes repos). C'est la méthode recommandée par Coolify — elle gère les
webhooks et les permissions automatiquement (par opposition à une simple clé
de déploiement, qu'il faudrait recréer manuellement pour l'auto-déploiement).

---

## 7. Créer la base PostgreSQL

Dans Coolify : _New Resource → Database → PostgreSQL_.

- Version : 16 (ou la version installée en local — cohérence avec `schema.prisma`)
- Générer un mot de passe fort (Coolify le propose automatiquement)
- Activer les **sauvegardes automatiques** (_Backups_ → planifier une
  fréquence quotidienne, cible S3-compatible si tu en as une, sinon stockage
  local sur le VPS en attendant)

Noter la chaîne de connexion **interne** fournie par Coolify (du type
`postgres://user:pass@<nom-service>:5432/postgres`) : c'est la valeur de
`DATABASE_URL` pour l'API et le bot. Pas besoin de l'exposer publiquement.

> ⚠️ **Coolify n'a pas un réseau Docker unique.** Chaque ressource a le sien.
> Cette base étant une ressource _distincte_ de la stack applicative, `api` et
> `bot` ne peuvent pas résoudre son nom d'hôte tant qu'ils ne sont pas
> rattachés au même réseau. Symptôme : `PrismaClientInitializationError ...
P1001 — Can't reach database server at <nom-service>:5432`, sur l'API **et**
> sur le bot, alors que la webapp démarre normalement.
>
> Le `docker-compose.yml` (§ 8.6) rattache donc `api` et `bot` au réseau
> partagé `coolify`. Vérifier son nom exact sur le VPS avant de déployer :
>
> ```bash
> docker network ls
> ```
>
> S'il ne s'appelle pas `coolify`, corriger le nom dans le compose. Activer
> aussi _Connect To Predefined Network_ dans les réglages de la ressource
> Coolify si l'option est proposée : les deux mécanismes visent le même but,
> et l'interface évolue régulièrement.
>
> Pour diagnostiquer un cas concret, comparer les réseaux des deux conteneurs :
>
> ```bash
> docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' NOM_CONTENEUR
> ```
>
> S'il n'y a aucun réseau commun entre le conteneur PostgreSQL et le conteneur
> `api`, c'est exactement ce problème.

---

## 8. Dockeriser les trois services

Ces fichiers sont à créer **dans le repo** (ils seront donc versionnés et
utilisés par Coolify au moment du build). Le contexte de build est la racine
du repo pour les trois, parce que `bot/` et `api/`/`webapp/` dépendent tous de
`packages/shared`.

### 8.1 `.dockerignore` (racine du repo)

```
node_modules
**/node_modules
**/dist
**/generated
.git
*.env
*.env.*
!api/.env.example
!bot/.env.example
```

### 8.2 `api/Dockerfile`

```dockerfile
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY api/package.json api/package.json
COPY webapp/package.json webapp/package.json
RUN npm ci

COPY packages/shared packages/shared
COPY api api

# `prisma generate` exige que DATABASE_URL existe au moment du parsing du
# schema, meme sans connexion reelle : valeur factice, ecrasee au runtime.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npm run build --workspace @anubis/shared \
    && npm run generate --workspace @anubis/shared \
    && npm run build --workspace @anubis/api

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/api/dist ./api/dist
COPY --from=build /repo/api/package.json ./api/package.json

EXPOSE 3000
CMD ["node", "api/dist/main.js"]
```

### 8.3 `webapp/Dockerfile`

Angular résout `@anubis/shared` vers les **sources** TypeScript (voir
CLAUDE.md), donc pas besoin de compiler `shared` pour ce build — seulement de
fournir son dossier `src/`.

```dockerfile
FROM node:22-bookworm-slim AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY api/package.json api/package.json
COPY webapp/package.json webapp/package.json
RUN npm ci

COPY packages/shared packages/shared
COPY webapp webapp
RUN npm run build --workspace @anubis/webapp

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/webapp/dist/webapp/browser /usr/share/nginx/html
COPY webapp/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

### 8.4 `webapp/nginx.conf`

Fallback SPA indispensable : sans lui, un rechargement de page sur une route
Angular (`/members/42` par ex.) renvoie une 404 de Nginx au lieu de
`index.html`.

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 8.5 `bot/Dockerfile`

`bot/` n'est pas un workspace npm : on construit `packages/shared` seul, puis
on installe `bot/` (TypeScript, comme `api/` et `webapp/` — voir CLAUDE.md
pour l'historique de `canvas`, retire des dependances lors de la migration).

```dockerfile
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

COPY packages/shared packages/shared
WORKDIR /repo/packages/shared
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npm install && npm run build && npm run generate

WORKDIR /repo
COPY bot bot
WORKDIR /repo/bot
RUN npm install && npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=build /repo/packages/shared /repo/packages/shared
COPY --from=build /repo/bot /repo/bot

WORKDIR /repo/bot
# Les variables sont injectees directement par Coolify (voir docker-compose.yml
# plus bas) : aucun fichier .env dans l'image, meme mecanisme que api/.
CMD ["node", "dist/index.js"]
```

### 8.6 `docker-compose.yml` (racine du repo)

C'est ce fichier que Coolify détecte et utilise pour créer les trois services
d'un coup, comme une seule ressource « Docker Compose ».

Le bloc `networks` est le point qui fait échouer la plupart des premiers
déploiements : sans lui, `api` et `bot` ne voient pas la base (voir
l'avertissement de l'étape 7).

```yaml
networks:
    coolify:
        external: true

services:
    api:
        build:
            context: .
            dockerfile: api/Dockerfile
        restart: unless-stopped
        # `default` doit rester explicite : des qu'on nomme un reseau, Compose
        # cesse d'attacher le service au reseau par defaut de la stack.
        networks: [default, coolify]
        environment:
            NODE_ENV: production
            PORT: 3000
            # Vide, volontairement : Traefik route `/api/*` vers ce conteneur en
            # retirant le prefixe. Si l'API le remettait, chaque route attendrait
            # `/api/api/...` et repondrait 404. En local, la variable est absente et
            # le prefixe `api` par defaut s'applique.
            API_GLOBAL_PREFIX: ""
            DATABASE_URL: ${DATABASE_URL}
            GUILD_ID: ${GUILD_ID}
            JWT_ACCESS_SECRET: ${JWT_ACCESS_SECRET}
            JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
            ACCESS_TOKEN_TTL: 15m
            REFRESH_TOKEN_TTL_DAYS: 7
            CORS_ORIGINS: https://${APP_DOMAIN}
            COOKIE_SECURE: "true"
            MAX_FAILED_LOGINS: 5
            LOCKOUT_MINUTES: 15
            # Laisse a "true" en production. A "false", le second facteur n'est
            # plus demande, y compris aux comptes qui l'ont active.
            TWO_FACTOR_ENABLED: ${TWO_FACTOR_ENABLED:-true}

    webapp:
        build:
            context: .
            dockerfile: webapp/Dockerfile
        restart: unless-stopped

    bot:
        build:
            context: .
            dockerfile: bot/Dockerfile
        restart: unless-stopped
        networks: [default, coolify]
        environment:
            NODE_ENV: production
            DATABASE_URL: ${DATABASE_URL}
            BOT_TOKEN: ${BOT_TOKEN}
            CLIENT_ID: ${CLIENT_ID}
            GUILD_HOST_ID: ${GUILD_HOST_ID}
```

`webapp` n'est volontairement pas rattaché au réseau `coolify` : il ne sert
que des fichiers statiques et ne parle jamais à la base ni à l'API — c'est le
navigateur qui appelle `/api`, via Traefik.

Les valeurs `${...}` sont injectées par Coolify à partir des variables
d'environnement définies dans son interface (étape suivante) — rien de secret
n'est écrit en clair dans ce fichier versionné.

**Avant de pousser ces fichiers**, construis-les en local pour vérifier qu'ils
compilent (je n'ai pas Docker disponible dans cet environnement pour les
tester à ta place) :

```bash
docker build -f api/Dockerfile -t anubis-api .
docker build -f webapp/Dockerfile -t anubis-webapp .
docker build -f bot/Dockerfile -t anubis-bot .
```

---

## 9. Créer la ressource dans Coolify

1. _New Resource_ : l'écran propose deux colonnes, **Git Based** (Public
   repo / Private repo avec GitHub App / Private repo avec Deploy Key) et
   **Docker Based** (Dockerfile / Docker Compose Empty / Docker Image).
   Choisir **Git Based → Private Repository (with GitHub App)** — c'est la
   GitHub App connectée à l'étape 6. Ne pas prendre _Docker Compose Empty_ :
   cette option crée une ressource autonome où le YAML est collé à la main,
   sans lien avec le repo ni redéploiement automatique au push.
2. Sélectionner le repo `anubis` et la branche `master`. Coolify détecte
   `docker-compose.yml` à la racine et bascule automatiquement le build pack
   sur « Docker Compose ».
3. **Domaines** (_Configuration → Domains_, un par service exposé) :
    - `webapp` → `https://moderation.tondomaine.com`
    - `api` → `https://moderation.tondomaine.com/api` (Coolify traduit ce
      chemin en règle de routage Traefik `PathPrefix(/api)` ; vérifie ce
      comportement dans l'interface au moment de la config, elle évolue
      régulièrement — sinon un label Traefik personnalisé fait la même chose)

    > ⚠️ **Traefik retire le préfixe `/api` avant de transmettre.** C'est le
    > comportement normal d'un routage par chemin, mais l'API applique aussi son
    > propre préfixe : elle attendrait `/api/api/...` et répondrait **404 sur
    > toutes les routes**. Symptôme : la page de connexion s'affiche
    > normalement, mais rien ne se passe au chargement ni à la connexion, et la
    > console du navigateur montre `POST /api/auth/refresh → 404`.
    >
    > Pour confirmer, ouvrir `https://ton-domaine/api/health`. Si la réponse est
    > `{"statusCode":404,"message":"Cannot GET /health","path":"/health"}`,
    > c'est exactement ce cas : le JSON prouve que l'API répond bien (donc le
    > routage et la base fonctionnent), et `"path":"/health"` montre que le
    > préfixe a été retiré en route.
    >
    > Le `docker-compose.yml` règle ça avec `API_GLOBAL_PREFIX: ""` sur le
    > service `api`. En local la variable est absente et le préfixe `api` par
    > défaut s'applique — le navigateur, lui, appelle `/api/...` dans les deux
    > cas.
    - `bot` → aucun domaine, aucun port exposé

4. **Variables d'environnement** (_Configuration → Environment Variables_),
   à saisir une fois, valeurs jamais commitées :
    - `DATABASE_URL` (fournie par la ressource PostgreSQL créée à l'étape 7)
    - `GUILD_ID`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (générer avec la
      commande du README), `APP_DOMAIN=moderation.tondomaine.com`
    - `BOT_TOKEN`, `CLIENT_ID`, `GUILD_HOST_ID` (les identifiants Discord et
      la base de prod du bot — memes noms que dans `bot/.env.example`, jamais
      committes)
    - `TWO_FACTOR_ENABLED` : **facultative**, et à laisser absente en
      production (la valeur par défaut vaut `true`). La poser à `false` coupe
      le second facteur pour tout le déploiement, _y compris pour les comptes
      qui l'avaient activé_ — c'est un interrupteur d'urgence, pas un réglage
      de confort. Les secrets déjà enregistrés ne sont pas effacés : la
      remettre à `true` rend la protection sans reconfiguration.
5. **Webhook** : Coolify l'a déjà enregistré côté GitHub via la GitHub App de
   l'étape 6 — chaque push sur `master` redéploiera automatiquement.
6. **Commande post-déploiement** sur le service `api` (_Configuration →
   Post-deployment Command_) :
    ```
    npm run db:deploy
    ```
    Applique les migrations Prisma en attente après chaque déploiement, avant
    de basculer le trafic. `npm run db:seed` n'est **volontairement pas**
    automatisé (il ne doit tourner qu'une fois) — à lancer manuellement via le
    terminal intégré de Coolify sur le conteneur `api` lors de la toute
    première mise en production.
7. Lancer le premier déploiement manuellement (_Deploy_), puis vérifier les
   logs de chaque service dans l'onglet correspondant.

---

## 10. Intégration continue (GitHub Actions)

Coolify s'occupe du déploiement ; GitHub Actions sert de garde-fou en amont,
pour qu'aucun code cassé n'atteigne `master`. À créer dans
`.github/workflows/ci.yml` :

```yaml
name: CI

on:
    pull_request:
        branches: [master]
    push:
        branches: [master]

jobs:
    build:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - uses: actions/setup-node@v4
              with:
                  node-version: 22
                  cache: npm
            - run: npm ci
            - run: npm run build
```

Puis, dans les réglages GitHub du repo (_Settings → Branches → Branch
protection rules_ sur `master`), cocher _Require status checks to pass before
merging_ et sélectionner ce workflow. Résultat : tout ce qui atteint `master`
a déjà été buildé avec succès, et Coolify ne fait que déployer du code déjà
validé.

---

## 11. Environnement de staging (choisir la branche à déployer)

Pour répondre précisément à « pouvoir choisir quelle branche déployer » :
dans Coolify, **une ressource = une branche**. Pour un environnement de test
séparé :

1. Créer une branche `staging` sur le repo.
2. _New Resource → Application → Docker Compose_, même repo, branche
   `staging` cette fois.
3. Lui donner un autre sous-domaine (`staging.tondomaine.com`) et une base
   PostgreSQL distincte (nouvelle ressource, ou schéma séparé).
4. Merger dans `staging` pour tester avant de merger dans `master` (qui
   déploie en production).

---

## 12. Sauvegardes et restauration

- Sauvegardes automatiques déjà activées à l'étape 7 (Coolify → ressource
  PostgreSQL → _Backups_). Vérifier régulièrement qu'une restauration
  fonctionne réellement (_Backups → Restore_ sur un environnement de test) —
  une sauvegarde jamais restaurée n'est qu'une hypothèse.
- Pour une sauvegarde manuelle ponctuelle :
    ```bash
    docker exec <container_postgres> pg_dump -U <user> <db> > backup.sql
    ```

---

## 13. Observabilité minimale

- Logs : onglet _Logs_ de chaque service dans Coolify (streaming en direct).
- Healthcheck : Coolify redémarre automatiquement un conteneur qui plante
  (`restart: unless-stopped` dans le compose). Pour un healthcheck HTTP actif
  sur l'API, ajouter dans `docker-compose.yml` :

    ```yaml
    healthcheck:
        test:
            [
                "CMD",
                "node",
                "-e",
                "require('http').get('http://localhost:3000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1))",
            ]
        interval: 30s
        timeout: 5s
        retries: 3
    ```

    `/api/health` est public et vérifie la base : il renvoie 503 quand elle est
    injoignable. C'est précisément le cas de figure qui fait échouer un premier
    déploiement — le conteneur serait marqué « unhealthy » au lieu de boucler en
    redémarrages silencieux.

- Alerting : Coolify peut notifier par e-mail/Discord/Slack en cas d'échec de
  déploiement (_Notifications_ dans les réglages du projet) — utile ici
  puisque le projet a déjà un serveur Discord administré.

---

## Checklist récapitulative

- [ ] VPS provisionné (Ubuntu 24.04, ≥ 4 Go RAM), clé SSH configurée
- [ ] Nom de domaine acheté, enregistrement DNS `A` vers l'IP du VPS
- [ ] Utilisateur non-root créé, `root` désactivé en SSH, mot de passe SSH désactivé
- [ ] Pare-feu configuré (22, 80, 443)
- [ ] Docker installé
- [ ] Coolify installé, compte admin créé, domaine du dashboard configuré
- [ ] GitHub App connectée à Coolify
- [ ] Ressource PostgreSQL créée, sauvegardes automatiques activées
- [ ] `.dockerignore`, `api/Dockerfile`, `webapp/Dockerfile`, `webapp/nginx.conf`, `bot/Dockerfile`, `docker-compose.yml` ajoutés au repo et testés en local
- [ ] Ressource Docker Compose créée dans Coolify, branche `master`
- [ ] Domaines configurés (`/` → webapp, `/api` → api, rien pour bot)
- [ ] Variables d'environnement saisies dans Coolify (aucun secret commité)
- [ ] Commande post-déploiement `npm run db:deploy` configurée sur `api`
- [ ] Premier déploiement manuel réussi, logs vérifiés
- [ ] `npm run db:seed` exécuté une fois manuellement (compte owner initial)
- [ ] Workflow GitHub Actions ajouté, branch protection sur `master`
- [ ] (optionnel) Environnement `staging` créé sur une branche séparée
- [ ] Restauration de sauvegarde testée au moins une fois

---

## Alternatives écartées (pour référence)

- **PaaS managé (Railway, Render)** : plus rapide à démarrer, aucun serveur à
  gérer, mais coût qui grimpe avec l'usage et mal adapté à un process
  « always-on » comme le bot (facturé en continu). Pertinent si tu préfères
  ne jamais toucher à un serveur, quitte à payer plus.
- **GitHub Actions + déploiement SSH manuel** (sans Coolify) : total contrôle,
  tout versionné en YAML, mais aucune interface de gestion (logs, rollback,
  domaines, secrets) — à écrire et maintenir soi-même. Pertinent seulement si
  tu préfères éviter toute dépendance à un outil tiers, même auto-hébergé.
