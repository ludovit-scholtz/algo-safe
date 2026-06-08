FROM node:22-alpine AS build

WORKDIR /workspace

RUN corepack enable

COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY projects/algo-safe-contracts/package.json projects/algo-safe-contracts/package.json
COPY projects/algo-safe-frontend/package.json projects/algo-safe-frontend/package.json

RUN pnpm install --frozen-lockfile

COPY projects/algo-safe-contracts projects/algo-safe-contracts
COPY projects/algo-safe-frontend projects/algo-safe-frontend

RUN pnpm --filter algo-safe run build-package
RUN pnpm --dir projects/algo-safe-frontend run build

FROM nginx:1.27-alpine AS runtime

COPY projects/algo-safe-frontend/deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/projects/algo-safe-frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]