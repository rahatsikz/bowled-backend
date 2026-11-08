FROM node:24-slim

RUN corepack enable pnpm && \
    corepack prepare pnpm@12.18.0 activate

WORKDIR /app

# Copy root manifests so pnpm can resolve workspace deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./

# Install (workspace installs; no root lockfile needed here)
RUN corepack pnpm install --frozen-lockfile

# Copy source
COPY packages/api/package.json packages/api/tsconfig.json packages/api/src/ ./

EXPOSE 3000
CMD ["tsx", "packages/api/src/index.ts"]