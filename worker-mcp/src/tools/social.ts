/**
 * Category 9: Social Tools
 *
 * read_chat, send_chat, read_board, post_board
 */

import type { Env } from "../types";
import { Logger } from "../logger";
import { callChatDO, callBoardDO } from "./api-client";

export async function handleSocial(
  toolName: string,
  args: Record<string, unknown>,
  env: Env,
  logger: Logger
): Promise<unknown> {
  switch (toolName) {
    case "read_chat":
      return readChat(args, env, logger);
    case "send_chat":
      return sendChat(args, env, logger);
    case "read_board":
      return readBoard(args, env, logger);
    case "post_board":
      return postBoard(args, env, logger);
    default:
      throw new Error(`Unknown social tool: ${toolName}`);
  }
}

async function readChat(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  logger.tool("read_chat", "Fetching messages");

  const messages = (await callChatDO(env, "/history")) as unknown[];
  const limit = Math.min((args.limit as number) || 7, 10);

  return {
    messages: (messages as any[]).slice(-limit),
  };
}

async function sendChat(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const text = args.text as string;
  const nickname = (args.nickname as string) || "SYSTEM";

  if (!text) throw new Error("'text' is required");
  if (text.length > 500) throw new Error("Message too long (max 500 chars)");

  logger.tool("send_chat", `as "${nickname}": ${text.slice(0, 50)}...`);

  await callChatDO(env, "/message", {
    method: "POST",
    body: { nickname, text },
  });

  return { ok: true, message: `Sent as "${nickname}": ${text.slice(0, 80)}` };
}

async function readBoard(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const planet = args.planet as string;
  if (!planet) throw new Error("'planet' is required");

  const limit = Math.min((args.limit as number) || 20, 50);

  logger.tool("read_board", `planet=${planet}`);

  const notes = await callBoardDO(env, "/notes", {
    query: { planet, limit },
  });

  return {
    planet,
    notes,
  };
}

async function postBoard(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const planet = args.planet as string;
  const text = args.text as string;
  const nickname = (args.nickname as string) || "STATION BULLETIN";

  if (!planet) throw new Error("'planet' is required");
  if (!text) throw new Error("'text' is required");
  if (text.length > 280) throw new Error("Note too long (max 280 chars)");

  logger.tool("post_board", `planet=${planet} as "${nickname}"`);

  await callBoardDO(env, "/notes", {
    method: "POST",
    body: { nickname, text, planet },
  });

  return { ok: true, message: `Posted to ${planet} board as "${nickname}": ${text.slice(0, 80)}` };
}
