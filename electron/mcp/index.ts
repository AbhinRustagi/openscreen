import { RendererBridge } from "./rendererBridge";
import { McpHttpServer } from "./server";

let bridge: RendererBridge | null = null;
let server: McpHttpServer | null = null;

export function getMcpBridge(): RendererBridge {
	if (!bridge) {
		bridge = new RendererBridge();
		bridge.registerReplyListener();
	}
	return bridge;
}

export function getMcpServer(): McpHttpServer {
	if (!server) {
		server = new McpHttpServer(getMcpBridge());
	}
	return server;
}
