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
CMD ["sh", "-c", "(cd packages/shared && node ../../node_modules/prisma/build/index.js migrate deploy) && exec node api/dist/main.js"]
