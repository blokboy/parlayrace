/**
 * Re-exports Drizzle query operators so packages that depend on `@starter/backend`
 * (e.g. `apps/web`) can build `where` clauses without taking a direct dependency
 * on `drizzle-orm`, which is only installed inside this package.
 */
export { and, asc, desc, eq, gte, inArray, lt, lte, ne, or, sql } from 'drizzle-orm';
