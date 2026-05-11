import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { TOOL_DISPLAY } from "@/mcp/toolCatalog";
import type { McpToolCategory, McpToolDisplayInfo } from "@/mcp/types";
import { useMcpStatus } from "@/mcp/useMcpStatus";

interface McpServerDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

const CATEGORY_ORDER: McpToolCategory[] = [
	"read",
	"frame",
	"zoom",
	"trim",
	"speed",
	"annotation",
	"canvas",
	"playback",
	"export",
];

const CATEGORY_LABELS: Record<McpToolCategory, string> = {
	read: "Read & inspect",
	frame: "Visual grounding",
	zoom: "Zoom",
	trim: "Trim",
	speed: "Speed",
	annotation: "Annotations",
	canvas: "Canvas & style",
	playback: "Playback",
	export: "Export",
};

function groupByCategory(tools: ReadonlyArray<McpToolDisplayInfo>) {
	const grouped = new Map<McpToolCategory, McpToolDisplayInfo[]>();
	for (const category of CATEGORY_ORDER) grouped.set(category, []);
	for (const tool of tools) grouped.get(tool.category)?.push(tool);
	return grouped;
}

export function McpServerDialog({ open, onOpenChange }: McpServerDialogProps) {
	const { info, start, stop, isBusy } = useMcpStatus();
	const [copied, setCopied] = useState(false);
	const grouped = groupByCategory(TOOL_DISPLAY);
	const isRunning = info.status === "running";

	async function handleToggle() {
		if (isRunning) {
			await stop();
		} else {
			await start();
		}
	}

	async function handleCopyUrl() {
		if (!info.url) return;
		try {
			await window.electronAPI.writeClipboard(info.url);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
			return;
		} catch {
			// Fall through to the browser fallback below.
		}
		try {
			await navigator.clipboard.writeText(info.url);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Last resort: focus the input so the user can copy manually.
			document.getElementById("mcp-url")?.focus();
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>MCP Server</DialogTitle>
					<DialogDescription>
						Let external AI agents drive this editor over the Model Context Protocol. Enable the
						server, then paste the URL into your MCP client (Claude Desktop, Claude Code, Cursor,
						…). The server only accepts loopback connections; disabling it closes the port.
					</DialogDescription>
				</DialogHeader>

				<div className="flex items-center justify-between rounded-lg border p-3">
					<div className="flex items-center gap-3">
						<StatusPill info={info} />
						<span className="text-sm">
							{isRunning
								? `Server is running on port ${info.port}`
								: info.status === "error"
									? `Error: ${info.errorMessage ?? "unknown"}`
									: "Server is stopped"}
						</span>
					</div>
					<Button
						onClick={handleToggle}
						disabled={isBusy}
						variant={isRunning ? "outline" : "default"}
					>
						{isRunning ? "Disable" : "Enable"}
					</Button>
				</div>

				{isRunning && info.url && (
					<div className="space-y-2">
						<label className="text-sm font-medium" htmlFor="mcp-url">
							Connection URL
						</label>
						<div className="flex gap-2">
							<input
								id="mcp-url"
								readOnly
								value={info.url}
								className="flex-1 rounded-md border bg-background px-3 py-2 font-mono text-xs"
								onFocus={(e) => e.currentTarget.select()}
							/>
							<Button onClick={handleCopyUrl} size="sm" variant="outline">
								{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
							</Button>
						</div>
						<p className="text-xs text-muted-foreground">
							Loopback-only. Disabling the server closes this port.
						</p>
					</div>
				)}

				<div className="max-h-72 space-y-3 overflow-y-auto rounded-lg border p-3">
					<p className="text-sm font-medium">Available tools ({TOOL_DISPLAY.length})</p>
					{CATEGORY_ORDER.map((category) => {
						const items = grouped.get(category) ?? [];
						if (items.length === 0) return null;
						return (
							<div key={category}>
								<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
									{CATEGORY_LABELS[category]}
								</p>
								<ul className="mt-1 space-y-0.5">
									{items.map((tool) => (
										<li key={tool.name} className="text-xs">
											<span className="font-mono text-foreground">{tool.name}</span>
											<span className="text-muted-foreground"> — {tool.description}</span>
										</li>
									))}
								</ul>
							</div>
						);
					})}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function StatusPill({ info }: { info: ReturnType<typeof useMcpStatus>["info"] }) {
	const palette: Record<typeof info.status, string> = {
		stopped: "bg-muted text-muted-foreground",
		starting: "bg-amber-500/20 text-amber-700",
		running: "bg-emerald-500/20 text-emerald-700",
		error: "bg-red-500/20 text-red-700",
	};
	const label: Record<typeof info.status, string> = {
		stopped: "Stopped",
		starting: "Starting…",
		running: "Running",
		error: "Error",
	};
	return (
		<span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", palette[info.status])}>
			{label[info.status]}
		</span>
	);
}
