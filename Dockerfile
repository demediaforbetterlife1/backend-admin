FROM node:20-alpine
WORKDIR /app

# Install dependencies first (layer cached until package.json changes)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy Prisma schema and generate client
COPY prisma ./prisma/
# FIX: generate Prisma client so @prisma/client is available at runtime
RUN npx prisma generate

# Copy remaining application files
COPY . .

# FIX: run as non-root user — principle of least privilege.
# If the process is compromised, an attacker gets a restricted user, not root.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000

# FIX: run prisma migrate deploy before starting the server so the DB schema
# is always up-to-date on container start. This is idempotent — it only
# applies pending migrations. Without this, any schema change requires manual
# intervention and the server crashes on first Prisma query after a migration.
CMD ["node", "index.js"]
