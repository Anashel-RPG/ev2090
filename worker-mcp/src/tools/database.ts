/**
 * Category 6: D1 Database Raw Access Tools
 *
 * query_db, mutate_db, describe_schema
 *
 * These call the EconomyRegion DO's raw SQL endpoints.
 * query_db enforces SELECT-only. mutate_db allows writes.
 */

import type { Env } from "../types";
import { Logger } from "../logger";
import { callEconomyDO } from "./api-client";

export async function handleDatabase(
  toolName: string,
  args: Record<string, unknown>,
  env: Env,
  logger: Logger
): Promise<unknown> {
  switch (toolName) {
    case "query_db":
      return queryDb(args, env, logger);
    case "mutate_db":
      return mutateDb(args, env, logger);
    case "describe_schema":
      return describeSchema(env, logger);
    default:
      throw new Error(`Unknown database tool: ${toolName}`);
  }
}

async function queryDb(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const sql = (args.sql as string || "").trim();
  const params = args.params ? JSON.parse(args.params as string) : [];
  const limit = Math.min((args.limit as number) || 100, 1000);

  if (!sql) throw new Error("'sql' is required");

  // Enforce SELECT-only; block multi-statement injection via semicolons
  const normalized = sql.toUpperCase().replace(/\s+/g, " ").trim();
  if (!normalized.startsWith("SELECT") && !normalized.startsWith("PRAGMA") && !normalized.startsWith("EXPLAIN")) {
    throw new Error("query_db only allows SELECT, PRAGMA, or EXPLAIN queries. Use mutate_db for writes.");
  }
  if (sql.includes(";")) {
    throw new Error("Multi-statement queries are not allowed.");
  }

  logger.tool("query_db", sql.slice(0, 80));

  // Add LIMIT if not present
  let finalSql = sql;
  if (!normalized.includes("LIMIT")) {
    finalSql = `${sql} LIMIT ${limit}`;
  }

  const result = await callEconomyDO(env, "/raw-query", {
    query: { sql: finalSql, params: JSON.stringify(params) },
  });

  return result;
}

async function mutateDb(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const sql = (args.sql as string || "").trim();
  const params = args.params ? JSON.parse(args.params as string) : [];

  if (!sql) throw new Error("'sql' is required");

  // Block DROP TABLE, DROP INDEX, etc., and multi-statement injection
  const normalized = sql.toUpperCase().replace(/\s+/g, " ").trim();
  if (normalized.startsWith("DROP")) {
    throw new Error("DROP statements are not allowed via MCP. Use the Cloudflare dashboard for schema changes.");
  }
  if (sql.includes(";")) {
    throw new Error("Multi-statement queries are not allowed.");
  }

  logger.tool("mutate_db", sql.slice(0, 80));

  const result = await callEconomyDO(env, "/raw-mutate", {
    method: "POST",
    body: { sql, params },
  });

  return result;
}

async function describeSchema(env: Env, logger: Logger): Promise<unknown> {
  logger.tool("describe_schema", "Fetching SQLite schema");

  const result = await callEconomyDO(env, "/schema");
  return result;
}
