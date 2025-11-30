# Use Node.js 20 LTS
FROM node:20-alpine AS base

# Install pnpm and OpenSSL (required for Prisma)
RUN apk add --no-cache openssl && \
    corepack enable && \
    corepack prepare pnpm@latest --activate

# Set working directory
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
FROM node:20-alpine AS production

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

# Copy package files
COPY package.json ./
COPY pnpm-lock.yaml* ./

# Install pnpm and production dependencies
RUN corepack enable && \
    corepack prepare pnpm@latest --activate && \
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

# Start the application
CMD ["pnpm", "start:prod"]

