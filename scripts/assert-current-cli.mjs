#!/usr/bin/env node
/**
 * Guard for npm scripts that shell out to the Prisma CLI, which can't import
 * the check itself. `npm run db:push` runs this first.
 *
 * Usage: node scripts/assert-current-cli.mjs <label> <path> [path...]
 */
import { assertCheckoutCurrent } from "./lib/assert-current.mjs";

const [label, ...paths] = process.argv.slice(2).filter((a) => a !== "--allow-stale");
assertCheckoutCurrent(paths.length ? paths : ["prisma/schema.prisma"], label || "This command");
