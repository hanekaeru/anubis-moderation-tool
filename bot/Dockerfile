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
