import { randomUUID } from "node:crypto";
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TOOL_CATALOG } from "../../src/mcp/toolCatalog";
import {
	type McpServerInfo,
	type McpServerStatus,
	STOPPED_MCP_SERVER_INFO,
} from "../../src/mcp/types";
import type { RendererBridge } from "./rendererBridge";

const SERVER_NAME = "openscreen";
const SERVER_VERSION = "0.1.0";
const MCP_PATH = "/mcp";

interface FrameToolResponse {
	__mcpContent?: "image";
	mimeType?: string;
	dataBase64?: string;
}

function asToolResult(toolName: string, data: unknown): CallToolResult {
	if (
		data &&
		typeof data === "object" &&
		(data as FrameToolResponse).__mcpContent === "image" &&
		typeof (data as FrameToolResponse).dataBase64 === "string"
	) {
		const frame = data as FrameToolResponse;
		return {
			content: [
				{
					type: "image",
					data: frame.dataBase64 as string,
					mimeType: frame.mimeType ?? "image/png",
				},
			],
		};
	}

	const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
	return {
		content: [{ type: "text", text }],
		structuredContent:
			typeof data === "object" && data !== null
				? (data as Record<string, unknown>)
				: { value: data },
		_meta: { tool: toolName },
	};
}

function buildToolUrl(port: number): string {
	return `http://127.0.0.1:${port}${MCP_PATH}`;
}

export class McpHttpServer {
	private readonly bridge: RendererBridge;
	private httpServer: http.Server | null = null;
	private sdkServer: McpServer | null = null;
	private transport: StreamableHTTPServerTransport | null = null;
	private port: number | null = null;
	private status: McpServerStatus = "stopped";
	private errorMessage: string | null = null;
	private connectedClients = 0;
	private listeners = new Set<(info: McpServerInfo) => void>();

	constructor(bridge: RendererBridge) {
		this.bridge = bridge;
	}

	getInfo(): McpServerInfo {
		if (this.status === "stopped") return STOPPED_MCP_SERVER_INFO;
		return {
			status: this.status,
			url: this.port !== null ? buildToolUrl(this.port) : null,
			port: this.port,
			connectedClients: this.connectedClients,
			errorMessage: this.errorMessage,
		};
	}

	onChange(listener: (info: McpServerInfo) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit() {
		const info = this.getInfo();
		for (const listener of this.listeners) listener(info);
	}

	async start(): Promise<McpServerInfo> {
		if (this.status === "running" || this.status === "starting") return this.getInfo();

		this.status = "starting";
		this.errorMessage = null;
		this.emit();

		try {
			this.sdkServer = new McpServer(
				{ name: SERVER_NAME, version: SERVER_VERSION },
				{ capabilities: { tools: {} } },
			);
			this.registerTools(this.sdkServer);

			this.transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => randomUUID(),
			});
			await this.sdkServer.connect(this.transport);

			this.httpServer = http.createServer((req, res) => this.handleHttp(req, res));
			await new Promise<void>((resolve, reject) => {
				const server = this.httpServer;
				if (!server) {
					reject(new Error("http server missing"));
					return;
				}
				server.once("error", reject);
				server.listen(0, "127.0.0.1", () => {
					server.off("error", reject);
					const address = server.address();
					if (address && typeof address === "object") {
						this.port = address.port;
					}
					resolve();
				});
			});

			this.status = "running";
			this.emit();
			return this.getInfo();
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
			this.status = "error";
			this.emit();
			await this.stop();
			throw error;
		}
	}

	async stop(): Promise<void> {
		if (this.httpServer) {
			await new Promise<void>((resolve) => {
				this.httpServer?.close(() => resolve());
			});
			this.httpServer = null;
		}
		if (this.transport) {
			try {
				await this.transport.close();
			} catch {
				// closing a never-opened transport is fine
			}
			this.transport = null;
		}
		if (this.sdkServer) {
			try {
				await this.sdkServer.close();
			} catch {
				// already closed
			}
			this.sdkServer = null;
		}
		this.port = null;
		this.connectedClients = 0;
		if (this.status !== "error") {
			this.status = "stopped";
			this.errorMessage = null;
		}
		this.emit();
	}

	private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse) {
		const remoteAddress = req.socket.remoteAddress ?? "";
		console.log(`[mcp] ${req.method} ${req.url} from ${remoteAddress}`);

		if (!isLoopbackAddress(remoteAddress)) {
			res.writeHead(403, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "forbidden" }));
			return;
		}

		// DNS rebinding defense: only accept requests whose Host header points
		// at a loopback hostname. A malicious site that rebinds its domain to
		// 127.0.0.1 would send its own domain in Host, and gets rejected here.
		if (!isLoopbackHostHeader(req.headers.host, this.port)) {
			console.log(`[mcp] 403 bad host header: ${req.headers.host}`);
			res.writeHead(403, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "bad-host" }));
			return;
		}

		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

		// MCP's HTTP transport spec mandates OAuth 2.1 with Dynamic Client
		// Registration. Claude Code probes these endpoints before /mcp; we
		// answer with a stub flow so the handshake completes. Loopback
		// binding remains the only real protection.
		if (this.handleOAuthStub(req, res, url)) return;

		if (url.pathname !== MCP_PATH) {
			console.log(`[mcp] 404 ${url.pathname}`);
			res.writeHead(404, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "not found" }));
			return;
		}

		this.connectedClients += 1;
		this.emit();
		res.on("close", () => {
			this.connectedClients = Math.max(0, this.connectedClients - 1);
			this.emit();
		});

		try {
			await this.transport?.handleRequest(req, res);
		} catch (error) {
			if (!res.headersSent) {
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
			}
		}
	}

	private handleOAuthStub(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
		const baseUrl = `http://${req.headers.host ?? "127.0.0.1"}`;

		// Authorization Server Metadata + OpenID Connect discovery.
		if (
			req.method === "GET" &&
			(url.pathname === "/.well-known/oauth-authorization-server" ||
				url.pathname === "/.well-known/openid-configuration")
		) {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					issuer: baseUrl,
					authorization_endpoint: `${baseUrl}/authorize`,
					token_endpoint: `${baseUrl}/token`,
					registration_endpoint: `${baseUrl}/register`,
					response_types_supported: ["code"],
					grant_types_supported: ["authorization_code"],
					code_challenge_methods_supported: ["S256", "plain"],
					token_endpoint_auth_methods_supported: ["none"],
				}),
			);
			return true;
		}

		// Dynamic Client Registration. Echo the request's redirect_uris back
		// (clients validate they got what they sent); ignore everything else.
		if (req.method === "POST" && url.pathname === "/register") {
			void readJsonBody(req)
				.then((body: Record<string, unknown>) => {
					const redirectUris = Array.isArray(body.redirect_uris)
						? (body.redirect_uris as string[])
						: [];
					res.writeHead(201, { "content-type": "application/json" });
					res.end(
						JSON.stringify({
							client_id: "openscreen-local",
							client_id_issued_at: Math.floor(Date.now() / 1000),
							redirect_uris: redirectUris,
							token_endpoint_auth_method: "none",
							grant_types: ["authorization_code"],
							response_types: ["code"],
						}),
					);
				})
				.catch((error: unknown) => {
					console.error("[mcp] /register body read failed:", error);
					res.writeHead(400, { "content-type": "application/json" });
					res.end(JSON.stringify({ error: "invalid_request" }));
				});
			return true;
		}

		// Authorization "consent" page. We don't actually ask the user; the
		// page renders briefly with a branded loader and then redirects to
		// the client's callback URL with a fixed code.
		if (req.method === "GET" && url.pathname === "/authorize") {
			const redirectUri = url.searchParams.get("redirect_uri");
			const state = url.searchParams.get("state");
			if (!redirectUri) {
				res.writeHead(400, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "invalid_request" }));
				return true;
			}
			const redirect = new URL(redirectUri);
			redirect.searchParams.set("code", "openscreen-auth-code");
			if (state) redirect.searchParams.set("state", state);
			res.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
			});
			res.end(renderAuthorizePage(redirect.toString()));
			return true;
		}

		// Token exchange. We return a fixed bearer token; the MCP endpoint
		// doesn't verify it.
		if (req.method === "POST" && url.pathname === "/token") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					access_token: "openscreen-access-token",
					token_type: "Bearer",
					expires_in: 31_536_000,
				}),
			);
			return true;
		}

		// Protected resource metadata (some clients probe this first).
		if (req.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					resource: baseUrl,
					authorization_servers: [baseUrl],
				}),
			);
			return true;
		}

		return false;
	}

	private registerTools(server: McpServer) {
		for (const tool of TOOL_CATALOG) {
			const handler = async (args: unknown): Promise<CallToolResult> => {
				try {
					const data = await this.bridge.invoke(tool.name, args);
					return asToolResult(tool.name, data);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return {
						content: [{ type: "text" as const, text: `Error: ${message}` }],
						isError: true,
					};
				}
			};
			// The SDK's registerTool generics infer per-call, but our catalog is a
			// runtime list of heterogeneous schemas. Cast to the loose handler shape;
			// schema validation still happens inside the SDK before our handler runs.
			server.registerTool(
				tool.name,
				{ description: tool.description, inputSchema: tool.schema.shape },
				handler as Parameters<typeof server.registerTool>[2],
			);
		}
	}
}

function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function renderAuthorizePage(redirectUrl: string): string {
	const safeUrl = escapeHtmlAttribute(redirectUrl);
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Openscreen — Authorizing</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="refresh" content="0;url=${safeUrl}" />
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
      background: radial-gradient(circle at 30% 20%, #1a1a1f 0%, #09090b 70%);
      color: #e4e4e7;
      display: grid; place-items: center;
      padding: 24px;
    }
    .card {
      width: min(420px, 100%);
      background: #111114;
      border: 1px solid #27272a;
      border-radius: 16px;
      padding: 32px 28px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      text-align: center;
    }
    .badge {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 4px 10px; border-radius: 999px;
      background: rgba(52, 178, 123, 0.12);
      color: #34B27B;
      font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
    }
    .badge::before {
      content: ""; width: 6px; height: 6px; border-radius: 50%;
      background: #34B27B; box-shadow: 0 0 0 4px rgba(52,178,123,0.18);
    }
    h1 { font-size: 22px; margin: 18px 0 6px; font-weight: 600; letter-spacing: -0.01em; }
    p { font-size: 14px; margin: 0; color: #a1a1aa; line-height: 1.5; }
    .spinner {
      width: 28px; height: 28px; margin: 24px auto 8px;
      border: 2px solid #27272a;
      border-top-color: #34B27B;
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
    }
    .fallback {
      margin-top: 20px; font-size: 12px; color: #71717a;
    }
    .fallback a { color: #34B27B; text-decoration: none; }
    .fallback a:hover { text-decoration: underline; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <main class="card">
    <span class="badge">Openscreen MCP</span>
    <h1>Authorizing your client</h1>
    <p>Returning you to the connecting app. This only takes a moment.</p>
    <div class="spinner" aria-hidden="true"></div>
    <p class="fallback">If you aren't redirected, <a href="${safeUrl}">continue manually</a>.</p>
  </main>
  <script>window.location.replace(${JSON.stringify(redirectUrl)});</script>
</body>
</html>`;
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			const raw = Buffer.concat(chunks).toString("utf-8");
			if (!raw) {
				resolve({});
				return;
			}
			try {
				const parsed = JSON.parse(raw);
				resolve(parsed && typeof parsed === "object" ? parsed : {});
			} catch (error) {
				reject(error);
			}
		});
		req.on("error", reject);
	});
}

function isLoopbackHostHeader(host: string | undefined, expectedPort: number | null): boolean {
	if (!host || expectedPort === null) return false;
	// Host header is either "host" or "host:port". Strip the port and validate
	// both halves: hostname must be a loopback name and port must match.
	const lastColon = host.lastIndexOf(":");
	const hostname = lastColon === -1 ? host : host.slice(0, lastColon);
	const portStr = lastColon === -1 ? "" : host.slice(lastColon + 1);
	if (portStr && Number(portStr) !== expectedPort) return false;
	const normalized = hostname.toLowerCase();
	return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "[::1]";
}

function isLoopbackAddress(address: string): boolean {
	if (!address) return false;
	if (address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1") return true;
	return address.startsWith("127.") || address.startsWith("::ffff:127.");
}
