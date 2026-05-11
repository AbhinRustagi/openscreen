import { useCallback, useEffect, useState } from "react";
import { type McpServerInfo, STOPPED_MCP_SERVER_INFO } from "./types";

export interface McpStatusController {
	info: McpServerInfo;
	start: () => Promise<void>;
	stop: () => Promise<void>;
	isBusy: boolean;
}

export function useMcpStatus(): McpStatusController {
	const [info, setInfo] = useState<McpServerInfo>(STOPPED_MCP_SERVER_INFO);
	const [isBusy, setIsBusy] = useState(false);

	useEffect(() => {
		let mounted = true;
		window.electronAPI.mcp
			.status()
			.then((current) => {
				if (mounted) setInfo(current);
			})
			.catch(() => {
				// Initial status read can fail if the main-process handler isn't ready
				// yet; the onStatusChanged subscription below will fill in the gap.
			});

		const off = window.electronAPI.mcp.onStatusChanged((next) => {
			if (mounted) setInfo(next);
		});

		return () => {
			mounted = false;
			off?.();
		};
	}, []);

	const start = useCallback(async () => {
		setIsBusy(true);
		try {
			const result = await window.electronAPI.mcp.start();
			setInfo(result);
		} finally {
			setIsBusy(false);
		}
	}, []);

	const stop = useCallback(async () => {
		setIsBusy(true);
		try {
			const result = await window.electronAPI.mcp.stop();
			setInfo(result);
		} finally {
			setIsBusy(false);
		}
	}, []);

	return { info, start, stop, isBusy };
}
