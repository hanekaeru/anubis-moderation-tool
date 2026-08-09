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
