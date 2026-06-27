import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { v7 as uuid } from 'uuid';

export const externalSourceProvider = pgEnum('external_source_provider', [
  'POLYMARKET',
  'KALSHI',
  'MANUAL',
]);

export const marketStatus = pgEnum('market_status', [
  'OPEN',
  'CLOSED',
  'RESOLVED',
]);

export const parlayStatus = pgEnum('parlay_status', ['ACTIVE', 'LOST', 'WON']);

export const providerSyncJobType = pgEnum('provider_sync_job_type', [
  'CATALOG',
  'ODDS',
  'STATUS',
  'FULL',
]);

export const providerSyncRunStatus = pgEnum('provider_sync_run_status', [
  'RUNNING',
  'SUCCESS',
  'PARTIAL_FAILURE',
  'FAILURE',
]);

export const user = pgTable('user', {
  id: text()
    .primaryKey()
    .$defaultFn(() => uuid()),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().default(false).notNull(),
  image: text(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}).enableRLS();

export const session = pgTable('session', {
  id: text()
    .primaryKey()
    .$defaultFn(() => uuid()),
  expiresAt: timestamp().notNull(),
  token: text().notNull().unique(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp()
    .$onUpdate(() => new Date())
    .notNull(),
  ipAddress: text(),
  userAgent: text(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
}).enableRLS();

export const account = pgTable('account', {
  id: text()
    .primaryKey()
    .$defaultFn(() => uuid()),
  accountId: text().notNull(),
  providerId: text().notNull(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  accessTokenExpiresAt: timestamp(),
  refreshTokenExpiresAt: timestamp(),
  scope: text(),
  password: text(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
}).enableRLS();

export const verification = pgTable('verification', {
  id: text()
    .primaryKey()
    .$defaultFn(() => uuid()),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp().notNull(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}).enableRLS();

export const userProfile = pgTable('user_profile', {
  id: text()
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  username: text().unique(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}).enableRLS();

export const externalMarket = pgTable(
  'external_market',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => uuid()),
    sourceProvider: externalSourceProvider().notNull(),
    sourceMarketId: text().notNull(),
    title: text().notNull(),
    description: text(),
    category: text(),
    status: marketStatus().notNull().default('OPEN'),
    closeTime: timestamp(),
    resolveTime: timestamp(),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => ({
    sourceMarketUnique: uniqueIndex('external_market_source_market_unique').on(
      table.sourceProvider,
      table.sourceMarketId
    ),
  })
).enableRLS();

export const externalOutcome = pgTable('external_outcome', {
  id: text()
    .primaryKey()
    .$defaultFn(() => uuid()),
  marketId: text()
    .notNull()
    .references(() => externalMarket.id, { onDelete: 'cascade' }),
  label: text().notNull(),
  externalId: text(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}).enableRLS();

export const externalPriceSnapshot = pgTable('external_price_snapshot', {
  id: text()
    .primaryKey()
    .$defaultFn(() => uuid()),
  marketId: text()
    .notNull()
    .references(() => externalMarket.id, { onDelete: 'cascade' }),
  outcomeId: text()
    .notNull()
    .references(() => externalOutcome.id, { onDelete: 'cascade' }),
  sourceProvider: externalSourceProvider().notNull(),
  probability: numeric({ precision: 12, scale: 6 }).notNull(),
  price: numeric({ precision: 12, scale: 6 }).notNull(),
  timestamp: timestamp().notNull(),
  fetchedAt: timestamp().notNull(),
  payloadHash: text().notNull(),
  payloadVersion: integer().notNull().default(1),
  createdAt: timestamp().defaultNow().notNull(),
}).enableRLS();

export const paperPortfolio = pgTable('paper_portfolio', {
  userId: text()
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  cashBalance: real().notNull().default(1000),
  positions: jsonb().notNull().default([]),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}).enableRLS();

export const parlayTeam = pgTable('parlay_team', {
  id: text()
    .primaryKey()
    .$defaultFn(() => uuid()),
  name: text().notNull(),
  createdByUserId: text()
    .notNull()
    .references(() => userProfile.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}).enableRLS();

export const parlayTeamMember = pgTable(
  'parlay_team_member',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => uuid()),
    teamId: text()
      .notNull()
      .references(() => parlayTeam.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => userProfile.id, { onDelete: 'cascade' }),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (table) => ({
    teamUserUnique: uniqueIndex('parlay_team_member_team_user_unique').on(
      table.teamId,
      table.userId
    ),
  })
).enableRLS();

export const parlayTeamParlay = pgTable('parlay_team_parlay', {
  id: text()
    .primaryKey()
    .$defaultFn(() => uuid()),
  teamId: text()
    .notNull()
    .references(() => parlayTeam.id, { onDelete: 'cascade' }),
  startedByUserId: text()
    .notNull()
    .references(() => userProfile.id, { onDelete: 'cascade' }),
  status: parlayStatus().notNull().default('ACTIVE'),
  claimableAmount: real().notNull().default(0),
  settledAmount: real().notNull().default(0),
  settledAt: timestamp(),
  transferredToUserId: text().references(() => userProfile.id, {
    onDelete: 'set null',
  }),
  lossSequence: integer(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}).enableRLS();

export const parlayTeamParlayShare = pgTable('parlay_team_parlay_share', {
  id: text()
    .primaryKey()
    .$defaultFn(() => uuid()),
  parlayId: text()
    .notNull()
    .references(() => parlayTeamParlay.id, { onDelete: 'cascade' }),
  teamId: text()
    .notNull()
    .references(() => parlayTeam.id, { onDelete: 'cascade' }),
  addedByUserId: text()
    .notNull()
    .references(() => userProfile.id, { onDelete: 'cascade' }),
  positionId: text().notNull(),
  sequence: integer().notNull(),
  placedAt: timestamp().notNull(),
  cardTitle: text().notNull(),
  marketId: text(),
  optionLabel: text().notNull(),
  side: text().notNull(),
  shares: real().notNull(),
  stake: real().notNull(),
  entryPrice: real().notNull(),
  createdAt: timestamp().defaultNow().notNull(),
}).enableRLS();

export const parlayTeamParlayClaim = pgTable(
  'parlay_team_parlay_claim',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => uuid()),
    parlayId: text()
      .notNull()
      .references(() => parlayTeamParlay.id, { onDelete: 'cascade' }),
    teamId: text()
      .notNull()
      .references(() => parlayTeam.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => userProfile.id, { onDelete: 'cascade' }),
    amount: real().notNull(),
    claimedAt: timestamp().defaultNow().notNull(),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (table) => ({
    parlayUserUnique: uniqueIndex(
      'parlay_team_parlay_claim_parlay_user_unique'
    ).on(table.parlayId, table.userId),
  })
).enableRLS();

export const providerSyncRun = pgTable('provider_sync_run', {
  id: text()
    .primaryKey()
    .$defaultFn(() => uuid()),
  sourceProvider: externalSourceProvider().notNull(),
  jobType: providerSyncJobType().notNull(),
  status: providerSyncRunStatus().notNull().default('RUNNING'),
  startedAt: timestamp().notNull(),
  finishedAt: timestamp(),
  durationMs: integer(),
  attemptedCount: integer().notNull().default(0),
  successCount: integer().notNull().default(0),
  failureCount: integer().notNull().default(0),
  lagSeconds: integer(),
  staleMarketCount: integer(),
  errorRate: numeric({ precision: 7, scale: 4 }),
  metadata: jsonb(),
  errorMessage: text(),
}).enableRLS();

export const providerDeadLetter = pgTable('provider_dead_letter', {
  id: text()
    .primaryKey()
    .$defaultFn(() => uuid()),
  sourceProvider: externalSourceProvider().notNull(),
  jobType: providerSyncJobType().notNull(),
  syncRunId: text().references(() => providerSyncRun.id, {
    onDelete: 'set null',
  }),
  externalRef: text(),
  reason: text().notNull(),
  payload: jsonb().notNull(),
  payloadHash: text().notNull(),
  payloadVersion: integer().notNull().default(1),
  createdAt: timestamp().defaultNow().notNull(),
}).enableRLS();

/**
 * EXAMPLE: Note table - DELETE when building your own features
 *
 * This table demonstrates the schema pattern. To remove:
 * 1. Delete this table definition
 * 2. Run `pnpm --filter @starter/backend drizzle:push` to sync
 * 3. Delete packages/backend/src/services/note/ directory
 * 4. Delete apps/web/src/server/note/ directory
 * 5. Update the dashboard to remove notes example
 */
export const note = pgTable('note', {
  id: text()
    .primaryKey()
    .$defaultFn(() => uuid()),
  title: text().notNull(),
  content: text(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}).enableRLS();
