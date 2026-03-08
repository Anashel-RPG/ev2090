/**
 * Category 7: R2 Storage Tools
 *
 * list_r2, read_r2, write_r2, delete_r2
 */

import type { Env } from "../types";
import { Logger } from "../logger";
import { getR2Bucket } from "./api-client";

export async function handleR2Storage(
  toolName: string,
  args: Record<string, unknown>,
  env: Env,
  logger: Logger
): Promise<unknown> {
  switch (toolName) {
    case "list_r2":
      return listR2(args, env, logger);
    case "read_r2":
      return readR2(args, env, logger);
    case "write_r2":
      return writeR2(args, env, logger);
    case "delete_r2":
      return deleteR2(args, env, logger);
    default:
      throw new Error(`Unknown r2-storage tool: ${toolName}`);
  }
}

async function listR2(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const bucketName = (args.bucket as string) || "data";
  const prefix = args.prefix as string | undefined;
  const limit = Math.min((args.limit as number) || 50, 500);

  logger.tool("list_r2", `bucket=${bucketName} prefix=${prefix || "(none)"}`);

  const bucket = getR2Bucket(env, bucketName);
  const listed = await bucket.list({ prefix, limit });

  return {
    objects: listed.objects.map((obj) => ({
      key: obj.key,
      sizeBytes: obj.size,
      lastModified: obj.uploaded.toISOString(),
    })),
    truncated: listed.truncated,
  };
}

async function readR2(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const bucketName = (args.bucket as string) || "data";
  const key = args.key as string;
  if (!key) throw new Error("'key' is required");

  logger.tool("read_r2", `bucket=${bucketName} key=${key}`);

  const bucket = getR2Bucket(env, bucketName);
  const object = await bucket.get(key);

  if (!object) {
    return { error: `Object not found: ${key}`, bucket: bucketName };
  }

  const contentType = object.httpMetadata?.contentType || "";
  const isJson = contentType.includes("json") || key.endsWith(".json");

  if (isJson) {
    const text = await object.text();
    try {
      return { key, content: JSON.parse(text) };
    } catch {
      return { key, content: text.slice(0, 5000), truncated: text.length > 5000 };
    }
  }

  // Binary file — metadata only
  return { key, sizeBytes: object.size, contentType, lastModified: object.uploaded.toISOString() };
}

async function writeR2(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const bucketName = (args.bucket as string) || "data";
  const key = args.key as string;
  const content = args.content as string;
  const contentType = (args.contentType as string) || "application/json";

  if (!key) throw new Error("'key' is required");
  if (!content) throw new Error("'content' is required");

  logger.tool("write_r2", `bucket=${bucketName} key=${key}`);

  const bucket = getR2Bucket(env, bucketName);

  // Try to parse as JSON for pretty storage
  let body: string;
  try {
    const parsed = JSON.parse(content);
    body = JSON.stringify(parsed, null, 2);
  } catch {
    body = content;
  }

  await bucket.put(key, body, { httpMetadata: { contentType } });

  return { ok: true, message: `Written ${key} to ${bucketName} (${body.length} bytes).` };
}

async function deleteR2(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const bucketName = (args.bucket as string) || "data";
  const key = args.key as string;

  if (!key) throw new Error("'key' is required");

  logger.tool("delete_r2", `bucket=${bucketName} key=${key}`);

  const bucket = getR2Bucket(env, bucketName);
  await bucket.delete(key);

  return { ok: true, message: `Deleted ${key} from ${bucketName}.` };
}
