/**
 * EV 2090 MCP Server — MCPSession Durable Object
 *
 * Handles WebSocket, SSE, and HTTP POST JSON-RPC transports.
 * Each session maintains its auth scope for tool filtering.
 */

import { DurableObject } from "cloudflare:workers";
import type { Env, MCPRequest, MCPResponse, MCPScope } from "./types";
import { Logger } from "./logger";
import { validateRequest } from "./auth";
import { isAllowedOrigin, getCorsHeaders } from "./security";
import { toolDefinitionsForScope, handleToolCall } from "./tools/index";

export class MCPSession extends DurableObject<Env> {
  private logger: Logger;
  private sessionId: string;
  private socketScopes = new WeakMap<WebSocket, MCPScope>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sessionId = ctx.id.toString().slice(0, 8);
    this.logger = new Logger(env.LOG_LEVEL || "info", this.sessionId);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    // SSE transport (matches /sse or root with SSE Accept header)
    if (request.method === "GET" && (
      url.pathname === "/sse" ||
      (url.pathname === "/" && (request.headers.get("Accept") || "").includes("text/event-stream"))
    )) {
      return this.handleSSE(request);
    }

    // Ping (must be before POST catch-all)
    if (url.pathname === "/ping" && request.method === "GET") {
      return new Response(JSON.stringify({ pong: true }), {
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(request.headers.get("Origin")),
        },
      });
    }

    // HTTP POST JSON-RPC (Streamable HTTP transport — catches all POST paths)
    if (request.method === "POST") {
      return this.handleHttpPost(request);
    }

    return new Response("Method not allowed", { status: 405 });
  }

  // ── WebSocket transport ──

  private async handleWebSocket(request: Request): Promise<Response> {
    const origin = request.headers.get("Origin");
    if (origin && !isAllowedOrigin(origin)) {
      return new Response("Forbidden: Invalid origin", { status: 403 });
    }

    const authResult = validateRequest(request, this.env);
    if (!authResult.authorized) {
      return new Response(authResult.error || "Unauthorized", { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    this.socketScopes.set(server, authResult.scope);

    this.logger.connect(`scope=${authResult.scope}`);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    if (typeof message !== "string") return;

    try {
      const request = JSON.parse(message) as MCPRequest;
      const scope = this.socketScopes.get(ws) || "none";

      if (scope === "none") {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id || 0,
            error: {
              code: -32600,
              message: "Unauthorized: No valid API key",
            },
          })
        );
        return;
      }

      this.logger.request(request.method, request.id);
      const response = await this.handleMCPRequest(request, scope);
      ws.send(JSON.stringify(response));
      this.logger.response(request.id, !response.error);
    } catch {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          error: { code: -32700, message: "Parse error" },
        })
      );
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.socketScopes.delete(ws);
    this.logger.disconnect();
  }

  // ── SSE transport ──

  private async handleSSE(request: Request): Promise<Response> {
    const authResult = validateRequest(request, this.env);
    if (!authResult.authorized) {
      return new Response(authResult.error || "Unauthorized", { status: 401 });
    }

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Send initial connection event
    writer.write(
      encoder.encode(
        `event: open\ndata: ${JSON.stringify({ sessionId: this.sessionId })}\n\n`
      )
    );

    this.logger.connect(`SSE scope=${authResult.scope}`);

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...getCorsHeaders(request.headers.get("Origin")),
      },
    });
  }

  // ── HTTP POST JSON-RPC transport ──

  private async handleHttpPost(request: Request): Promise<Response> {
    const authResult = validateRequest(request, this.env);
    if (!authResult.authorized) {
      return Response.json(
        {
          jsonrpc: "2.0",
          id: 0,
          error: { code: -32600, message: authResult.error },
        },
        { status: 401 }
      );
    }

    let body: MCPRequest;
    try {
      body = (await request.json()) as MCPRequest;
    } catch {
      return Response.json(
        {
          jsonrpc: "2.0",
          id: 0,
          error: { code: -32700, message: "Parse error" },
        },
        { status: 400 }
      );
    }

    this.logger.request(body.method, body.id);
    const response = await this.handleMCPRequest(body, authResult.scope);
    this.logger.response(body.id, !response.error);

    return Response.json(response);
  }

  // ── MCP protocol handler ──

  private async handleMCPRequest(
    request: MCPRequest,
    scope: MCPScope
  ): Promise<MCPResponse> {
    const { method, id, params } = request;

    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: { listChanged: true } },
            serverInfo: {
              name: "ev2090-mcp",
              version: this.env.WORKER_VERSION || "1.0.0",
            },
          },
        };

      case "notifications/initialized":
        return { jsonrpc: "2.0", id, result: {} };

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: { tools: toolDefinitionsForScope(scope) },
        };

      case "tools/call":
        return this.handleToolsCall(id, params, scope);

      case "resources/list":
        return { jsonrpc: "2.0", id, result: { resources: [] } };

      case "prompts/list":
        return { jsonrpc: "2.0", id, result: { prompts: [] } };

      case "ping":
        return { jsonrpc: "2.0", id, result: { pong: true } };

      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  }

  // ── Tool dispatch ──

  private async handleToolsCall(
    id: string | number,
    params: Record<string, unknown> | undefined,
    scope: MCPScope
  ): Promise<MCPResponse> {
    const toolName = params?.name as string;
    const toolArgs = (params?.arguments as Record<string, unknown>) || {};

    if (!toolName) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: "Missing tool name" },
      };
    }

    this.logger.tool(toolName, `Executing (scope: ${scope})`);

    try {
      const result = await handleToolCall(
        toolName,
        toolArgs,
        this.env,
        this.logger,
        scope
      );

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text:
                typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2),
            },
          ],
        },
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Internal error";
      this.logger.toolError(toolName, message);

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: true, message }, null, 2),
            },
          ],
          isError: true,
        },
      };
    }
  }
}
