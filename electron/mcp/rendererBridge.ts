import { randomUUID } from "node:crypto";
import { type BrowserWindow, ipcMain } from "electron";
import type { McpInvokeRequest, McpInvokeResponse } from "../../src/mcp/types";

const REPLY_CHANNEL = "mcp:reply";
const INVOKE_CHANNEL = "mcp:invoke";

interface PendingCall {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

/**
 * Routes MCP tool invocations from the main process to the renderer that owns
 * the editor, using correlation IDs to match replies back to the awaiting
 * caller. The bridge has no opinion on tool semantics — it only forwards.
 */
export class RendererBridge {
	private editorWindow: BrowserWindow | null = null;
	private pending = new Map<string, PendingCall>();
	private listenerRegistered = false;

	setEditorWindow(window: BrowserWindow | null) {
		this.editorWindow = window;
		if (!window) {
			this.rejectAll(new Error("editor window is not available"));
		}
	}

	registerReplyListener() {
		if (this.listenerRegistered) return;
		ipcMain.on(REPLY_CHANNEL, (_event, response: McpInvokeResponse) => {
			this.handleReply(response);
		});
		this.listenerRegistered = true;
	}

	async invoke(tool: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
		const window = this.editorWindow;
		if (!window || window.isDestroyed()) {
			throw new Error(
				"The editor window is not open. MCP tools can only run while the editor is visible.",
			);
		}

		const correlationId = randomUUID();
		const request: McpInvokeRequest = { correlationId, tool, params };

		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(correlationId);
				reject(new Error(`MCP tool "${tool}" timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			this.pending.set(correlationId, { resolve, reject, timer });
			window.webContents.send(INVOKE_CHANNEL, request);
		});
	}

	private handleReply(response: McpInvokeResponse) {
		const pending = this.pending.get(response.correlationId);
		if (!pending) return;
		this.pending.delete(response.correlationId);
		clearTimeout(pending.timer);

		if (response.ok) {
			pending.resolve(response.data);
		} else {
			pending.reject(new Error(response.error));
		}
	}

	private rejectAll(error: Error) {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}
}
