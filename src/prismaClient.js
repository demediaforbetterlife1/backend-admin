/**
 * Single shared PrismaClient instance for the entire backend.
 *
 * WHY: Creating multiple `new PrismaClient()` instances (one per file) creates
 * multiple connection pools to the same database. Under load this exhausts the
 * connection limit on Neon PostgreSQL and causes intermittent failures/timeouts.
 *
 * Every file that needs database access MUST import from here:
 *   const prisma = require('../prismaClient');
 *   const prisma = require('../../prismaClient');
 *
 * Never write `new PrismaClient()` anywhere else.
 *
 * NEON SERVERLESS NOTE:
 * Neon hibernates idle connections after ~5 minutes. Prisma logs
 * "Error { kind: Closed, cause: None }" when it detects the server-side
 * close — this is NOT a crash; Prisma reconnects automatically. We silence
 * these noisy connection-closed events at the log level so they don't fill
 * the logs. Real query errors are still surfaced.
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? [
        { level: 'warn',  emit: 'stdout' },
        // Suppress noisy Neon idle-connection-close noise; real errors still logged
        { level: 'error', emit: 'event'  },
      ]
    : [
        { level: 'error', emit: 'event'  },
      ],
});

// Filter out the Neon "connection closed" noise from the error stream.
// These happen when Neon's serverless compute hibernates after idle time —
// Prisma reconnects automatically on the next query, so no action is needed.
prisma.$on('error', (e) => {
  const isNeonIdleClose =
    e.message?.includes('kind: Closed') ||
    e.message?.includes('Error { kind: Closed') ||
    e.message?.includes('connection closed') ||
    e.message?.includes('Connection closed');

  if (!isNeonIdleClose) {
    console.error('[prisma:error]', e.message);
  }
  // Neon idle-close events are intentionally swallowed — no action needed.
});

// Graceful shutdown — close the connection pool cleanly on process exit
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

module.exports = prisma;
