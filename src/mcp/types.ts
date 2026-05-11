export type McpServerStatus = "stopped" | "starting" | "running" | "error";

export interface McpServerInfo {
	status: McpServerStatus;
	url: string | null;
	port: number | null;
	connectedClients: number;
	errorMessage: string | null;
}

export const STOPPED_MCP_SERVER_INFO: McpServerInfo = {
	status: "stopped",
	url: null,
	port: null,
	connectedClients: 0,
	errorMessage: null,
};

export type McpToolCategory =
	| "read"
	| "frame"
	| "zoom"
	| "trim"
	| "speed"
	| "annotation"
	| "canvas"
	| "playback"
	| "export";

export interface McpToolDisplayInfo {
	name: string;
	description: string;
	category: McpToolCategory;
}

export interface McpInvokeRequest {
	correlationId: string;
	tool: string;
	params: unknown;
}

export type McpInvokeResult = { ok: true; data: unknown } | { ok: false; error: string };

export type McpInvokeResponse = McpInvokeResult & { correlationId: string };
