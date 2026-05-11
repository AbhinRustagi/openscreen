import { useEffect, useMemo, useRef } from "react";
import { createToolHandlers, type McpEditorControls } from "./toolHandlers";
import type { McpInvokeRequest, McpInvokeResponse } from "./types";

interface McpToolHostProps {
	controls: McpEditorControls;
}

export function McpToolHost({ controls }: McpToolHostProps) {
	// Keep a stable reference so the handler map below is built exactly once.
	const controlsRef = useRef(controls);
	controlsRef.current = controls;

	const stableControls: McpEditorControls = useMemo(
		() => ({
			getState: () => controlsRef.current.getState(),
			pushState: (patch) => controlsRef.current.pushState(patch),
			getMedia: () => controlsRef.current.getMedia(),
			getCurrentTimeMs: () => controlsRef.current.getCurrentTimeMs(),
			getDurationMs: () => controlsRef.current.getDurationMs(),
			getIsPlaying: () => controlsRef.current.getIsPlaying(),
			seekMs: (t) => controlsRef.current.seekMs(t),
			captureSourceFrame: (t) => controlsRef.current.captureSourceFrame(t),
			captureRenderedFrame: (t) => controlsRef.current.captureRenderedFrame(t),
			exportProject: (args) => controlsRef.current.exportProject(args),
		}),
		[],
	);

	const handlers = useMemo(() => createToolHandlers(stableControls), [stableControls]);

	useEffect(() => {
		const off = window.electronAPI.mcp.onInvoke(async (request: McpInvokeRequest) => {
			const reply = (response: McpInvokeResponse) => window.electronAPI.mcp.reply(response);
			const handler = (handlers as Record<string, (params: unknown) => unknown>)[request.tool];
			if (!handler) {
				reply({
					correlationId: request.correlationId,
					ok: false,
					error: `unknown tool: ${request.tool}`,
				});
				return;
			}
			try {
				const data = await handler(request.params);
				reply({ correlationId: request.correlationId, ok: true, data });
			} catch (error) {
				reply({
					correlationId: request.correlationId,
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		});
		return off;
	}, [handlers]);

	return null;
}
