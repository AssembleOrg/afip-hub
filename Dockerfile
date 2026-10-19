# Imagen oficial de Playwright (Ubuntu noble + Node + Chromium y sus libs),
# igual que multas-next. Antes era node:20-alpine con puppeteer: el Chrome que
# baja puppeteer es glibc y en Alpine (musl) no arranca → todos los PDFs 500.
# El tag DEBE coincidir con "playwright" en package.json (1.62.1).
FROM mcr.microsoft.com/playwright:v1.62.1-noble AS base

# Los navegadores ya vienen en la imagen (/ms-playwright).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN corepack enable && \
    corepack prepare pnpm@10.10.0 --activate

WORKDIR /app

# Copy package files
COPY package.json ./
COPY pnpm-lock.yaml* ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Generate Prisma Client
# DATABASE_URL is required by prisma.config.ts but not used during generate
# Using a dummy value for build time
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN pnpm prisma generate

# Copy source code
COPY . .

# Build the application
RUN pnpm build

# Production stage
FROM mcr.microsoft.com/playwright:v1.62.1-noble AS production

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# servicios1.afip.gov.ar (WSFE) negocia DHE con clave de 1024 bits; el Node de
# esta imagen corre con SECLEVEL=2 y corta el handshake ("dh key too small").
ENV NODE_OPTIONS=--tls-cipher-list=DEFAULT:@SECLEVEL=1

# tini como PID 1: cosecha los procesos huérfanos de Chromium (sin él quedan
# zombies ocupando PIDs hasta agotar pids.max del contenedor).
RUN apt-get update && \
    apt-get install -y --no-install-recommends tini && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json ./
COPY pnpm-lock.yaml* ./

# Install pnpm and production dependencies
RUN corepack enable && \
    corepack prepare pnpm@10.10.0 --activate && \
    pnpm install --frozen-lockfile --prod

# Copy Prisma schema and config (needed for runtime)
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Copy generated Prisma client from build stage
COPY --from=base /app/generated ./generated

# Copy built application
COPY --from=base /app/dist ./dist

# Expose port
EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["pnpm", "start:prod"]
