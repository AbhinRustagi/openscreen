import { deriveNextId, normalizeProjectEditor } from "@/components/video-editor/projectPersistence";
import {
	type AnnotationRegion,
	type CropRegion,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_BLUR_DATA,
	DEFAULT_ZOOM_DEPTH,
	type SpeedRegion,
	type TrimRegion,
	type WebcamLayoutPreset,
	type WebcamMaskShape,
	type WebcamPosition,
	ZOOM_DEPTH_SCALES,
	type ZoomRegion,
} from "@/components/video-editor/types";
import type { EditorState } from "@/hooks/useEditorHistory";
import type { ExportFormat, ExportQuality, GifFrameRate } from "@/lib/exporter";
import type { ProjectMedia } from "@/lib/recordingSession";
import { type McpToolName, TOOL_CATALOG, TOOL_SCHEMAS } from "./toolCatalog";

export type EditorStateLike = EditorState;

export interface McpEditorControls {
	getState(): EditorStateLike;
	pushState(patch: Partial<EditorStateLike>): void;
	getMedia(): ProjectMedia | null;
	getCurrentTimeMs(): number;
	getDurationMs(): number;
	getIsPlaying(): boolean;
	seekMs(timestampMs: number): void;
	captureSourceFrame(timestampMs: number): Promise<string>;
	captureRenderedFrame(timestampMs: number): Promise<string>;
	exportProject(args: {
		outputPath: string;
		format?: ExportFormat;
		quality?: ExportQuality;
		gifFrameRate?: GifFrameRate;
		gifLoop?: boolean;
	}): Promise<{ path: string }>;
}

type Handler = (params: unknown) => Promise<unknown> | unknown;

function frameImage(base64: string) {
	return { __mcpContent: "image" as const, mimeType: "image/png", dataBase64: base64 };
}

function buildTimelineSummary(state: EditorStateLike) {
	const entries: Array<{
		id: string;
		kind: "zoom" | "trim" | "speed" | "annotation";
		startMs: number;
		endMs: number;
		summary: string;
	}> = [];

	for (const r of state.zoomRegions) {
		entries.push({
			id: r.id,
			kind: "zoom",
			startMs: r.startMs,
			endMs: r.endMs,
			summary: `zoom depth=${r.depth} focus=(${r.focus.cx.toFixed(2)},${r.focus.cy.toFixed(2)})`,
		});
	}
	for (const r of state.trimRegions) {
		entries.push({ id: r.id, kind: "trim", startMs: r.startMs, endMs: r.endMs, summary: "trim" });
	}
	for (const r of state.speedRegions) {
		entries.push({
			id: r.id,
			kind: "speed",
			startMs: r.startMs,
			endMs: r.endMs,
			summary: `speed ×${r.speed}`,
		});
	}
	for (const r of state.annotationRegions) {
		const preview =
			r.type === "text"
				? r.content.slice(0, 40)
				: r.type === "blur"
					? `${r.blurData?.type ?? "blur"} ${r.blurData?.shape ?? ""}`
					: r.type;
		entries.push({
			id: r.id,
			kind: "annotation",
			startMs: r.startMs,
			endMs: r.endMs,
			summary: `${r.type}: ${preview}`,
		});
	}

	entries.sort((a, b) => a.startMs - b.startMs);
	return entries;
}

function nextZoomRegion(
	state: EditorStateLike,
	params: {
		startMs: number;
		endMs: number;
		depth?: number;
		focus?: { cx: number; cy: number };
		customScale?: number;
		rotationPreset?: "iso" | "left" | "right";
	},
): ZoomRegion {
	const id = `zoom-${deriveNextId(
		"zoom",
		state.zoomRegions.map((r) => r.id),
	)}`;
	const depth = (params.depth ?? DEFAULT_ZOOM_DEPTH) as ZoomRegion["depth"];
	return {
		id,
		startMs: Math.round(params.startMs),
		endMs: Math.max(Math.round(params.startMs) + 1, Math.round(params.endMs)),
		depth,
		focus: params.focus ?? { cx: 0.5, cy: 0.5 },
		customScale: params.customScale ?? ZOOM_DEPTH_SCALES[depth],
		...(params.rotationPreset ? { rotationPreset: params.rotationPreset } : {}),
	};
}

function nextTrimRegion(
	state: EditorStateLike,
	params: { startMs: number; endMs: number },
): TrimRegion {
	const id = `trim-${deriveNextId(
		"trim",
		state.trimRegions.map((r) => r.id),
	)}`;
	return {
		id,
		startMs: Math.round(params.startMs),
		endMs: Math.max(Math.round(params.startMs) + 1, Math.round(params.endMs)),
	};
}

function nextSpeedRegion(
	state: EditorStateLike,
	params: { startMs: number; endMs: number; speed: number },
): SpeedRegion {
	const id = `speed-${deriveNextId(
		"speed",
		state.speedRegions.map((r) => r.id),
	)}`;
	return {
		id,
		startMs: Math.round(params.startMs),
		endMs: Math.max(Math.round(params.startMs) + 1, Math.round(params.endMs)),
		speed: params.speed,
	};
}

function nextAnnotationRegion(
	state: EditorStateLike,
	params: {
		startMs: number;
		endMs: number;
		type?: AnnotationRegion["type"];
		content?: string;
		position?: { x: number; y: number };
		size?: { width: number; height: number };
		style?: Partial<AnnotationRegion["style"]>;
		figureData?: AnnotationRegion["figureData"];
		blurData?: Partial<AnnotationRegion["blurData"]>;
	},
): AnnotationRegion {
	const id = `annotation-${deriveNextId(
		"annotation",
		state.annotationRegions.map((r) => r.id),
	)}`;
	const type = params.type ?? "text";
	const zIndex = state.annotationRegions.reduce((max, r) => Math.max(max, r.zIndex), 0) + 1;

	return {
		id,
		startMs: Math.round(params.startMs),
		endMs: Math.max(Math.round(params.startMs) + 1, Math.round(params.endMs)),
		type,
		content: params.content ?? "",
		position: params.position ?? DEFAULT_ANNOTATION_POSITION,
		size: params.size ?? DEFAULT_ANNOTATION_SIZE,
		style: { ...DEFAULT_ANNOTATION_STYLE, ...(params.style ?? {}) },
		zIndex,
		...(type === "blur" ? { blurData: { ...DEFAULT_BLUR_DATA, ...(params.blurData ?? {}) } } : {}),
		...(params.figureData ? { figureData: params.figureData } : {}),
	};
}

function patchZoom(region: ZoomRegion, patch: Partial<ZoomRegion>): ZoomRegion {
	const next: ZoomRegion = { ...region, ...patch };
	if (patch.startMs != null) next.startMs = Math.round(patch.startMs);
	if (patch.endMs != null) next.endMs = Math.max(next.startMs + 1, Math.round(patch.endMs));
	if (patch.depth != null && patch.customScale == null) {
		next.customScale = ZOOM_DEPTH_SCALES[patch.depth];
	}
	return next;
}

function patchTrim(region: TrimRegion, patch: Partial<TrimRegion>): TrimRegion {
	const next: TrimRegion = { ...region, ...patch };
	if (patch.startMs != null) next.startMs = Math.round(patch.startMs);
	if (patch.endMs != null) next.endMs = Math.max(next.startMs + 1, Math.round(patch.endMs));
	return next;
}

function patchSpeed(region: SpeedRegion, patch: Partial<SpeedRegion>): SpeedRegion {
	const next: SpeedRegion = { ...region, ...patch };
	if (patch.startMs != null) next.startMs = Math.round(patch.startMs);
	if (patch.endMs != null) next.endMs = Math.max(next.startMs + 1, Math.round(patch.endMs));
	return next;
}

function patchAnnotation(
	region: AnnotationRegion,
	patch: Partial<AnnotationRegion>,
): AnnotationRegion {
	const next: AnnotationRegion = { ...region, ...patch };
	if (patch.startMs != null) next.startMs = Math.round(patch.startMs);
	if (patch.endMs != null) next.endMs = Math.max(next.startMs + 1, Math.round(patch.endMs));
	if (patch.style) next.style = { ...region.style, ...patch.style };
	if (patch.blurData)
		next.blurData = { ...(region.blurData ?? DEFAULT_BLUR_DATA), ...patch.blurData };
	return next;
}

function validateParams<K extends McpToolName>(name: K, params: unknown) {
	const schema = TOOL_SCHEMAS[name];
	return schema.parse(params) as unknown as Record<string, unknown>;
}

export function createToolHandlers(controls: McpEditorControls): Record<McpToolName, Handler> {
	const map: Record<string, Handler> = {};

	map.get_editor_state = () => ({
		editor: controls.getState(),
		media: controls.getMedia(),
		currentTimeMs: controls.getCurrentTimeMs(),
		durationMs: controls.getDurationMs(),
		isPlaying: controls.getIsPlaying(),
	});

	map.get_timeline_summary = () => buildTimelineSummary(controls.getState());

	map.list_regions = (params) => {
		const { kind } = validateParams("list_regions", params) as { kind: string };
		const state = controls.getState();
		switch (kind) {
			case "zoom":
				return state.zoomRegions;
			case "trim":
				return state.trimRegions;
			case "speed":
				return state.speedRegions;
			case "annotation":
				return state.annotationRegions;
			default:
				throw new Error(`unknown region kind: ${kind}`);
		}
	};

	map.get_source_frame = async (params) => {
		const { timestampMs } = validateParams("get_source_frame", params) as { timestampMs: number };
		const base64 = await controls.captureSourceFrame(timestampMs);
		return frameImage(base64);
	};

	map.get_rendered_frame = async (params) => {
		const { timestampMs } = validateParams("get_rendered_frame", params) as { timestampMs: number };
		const base64 = await controls.captureRenderedFrame(timestampMs);
		return frameImage(base64);
	};

	// Zoom CRUD
	map.add_zoom_region = (params) => {
		const p = validateParams("add_zoom_region", params) as Parameters<typeof nextZoomRegion>[1];
		const state = controls.getState();
		const region = nextZoomRegion(state, p);
		controls.pushState({ zoomRegions: [...state.zoomRegions, region] });
		return region;
	};
	map.update_zoom_region = (params) => {
		const { id, ...patch } = validateParams("update_zoom_region", params) as {
			id: string;
		} & Partial<ZoomRegion>;
		const state = controls.getState();
		const existing = state.zoomRegions.find((r) => r.id === id);
		if (!existing) throw new Error(`zoom region not found: ${id}`);
		const updated = patchZoom(existing, patch);
		controls.pushState({
			zoomRegions: state.zoomRegions.map((r) => (r.id === id ? updated : r)),
		});
		return updated;
	};
	map.delete_zoom_region = (params) => {
		const { id } = validateParams("delete_zoom_region", params) as { id: string };
		const state = controls.getState();
		const exists = state.zoomRegions.some((r) => r.id === id);
		if (!exists) throw new Error(`zoom region not found: ${id}`);
		controls.pushState({ zoomRegions: state.zoomRegions.filter((r) => r.id !== id) });
		return { id, deleted: true };
	};

	// Trim CRUD
	map.add_trim_region = (params) => {
		const p = validateParams("add_trim_region", params) as Parameters<typeof nextTrimRegion>[1];
		const state = controls.getState();
		const region = nextTrimRegion(state, p);
		controls.pushState({ trimRegions: [...state.trimRegions, region] });
		return region;
	};
	map.update_trim_region = (params) => {
		const { id, ...patch } = validateParams("update_trim_region", params) as {
			id: string;
		} & Partial<TrimRegion>;
		const state = controls.getState();
		const existing = state.trimRegions.find((r) => r.id === id);
		if (!existing) throw new Error(`trim region not found: ${id}`);
		const updated = patchTrim(existing, patch);
		controls.pushState({ trimRegions: state.trimRegions.map((r) => (r.id === id ? updated : r)) });
		return updated;
	};
	map.delete_trim_region = (params) => {
		const { id } = validateParams("delete_trim_region", params) as { id: string };
		const state = controls.getState();
		const exists = state.trimRegions.some((r) => r.id === id);
		if (!exists) throw new Error(`trim region not found: ${id}`);
		controls.pushState({ trimRegions: state.trimRegions.filter((r) => r.id !== id) });
		return { id, deleted: true };
	};

	// Speed CRUD
	map.add_speed_region = (params) => {
		const p = validateParams("add_speed_region", params) as Parameters<typeof nextSpeedRegion>[1];
		const state = controls.getState();
		const region = nextSpeedRegion(state, p);
		controls.pushState({ speedRegions: [...state.speedRegions, region] });
		return region;
	};
	map.update_speed_region = (params) => {
		const { id, ...patch } = validateParams("update_speed_region", params) as {
			id: string;
		} & Partial<SpeedRegion>;
		const state = controls.getState();
		const existing = state.speedRegions.find((r) => r.id === id);
		if (!existing) throw new Error(`speed region not found: ${id}`);
		const updated = patchSpeed(existing, patch);
		controls.pushState({
			speedRegions: state.speedRegions.map((r) => (r.id === id ? updated : r)),
		});
		return updated;
	};
	map.delete_speed_region = (params) => {
		const { id } = validateParams("delete_speed_region", params) as { id: string };
		const state = controls.getState();
		const exists = state.speedRegions.some((r) => r.id === id);
		if (!exists) throw new Error(`speed region not found: ${id}`);
		controls.pushState({ speedRegions: state.speedRegions.filter((r) => r.id !== id) });
		return { id, deleted: true };
	};

	// Annotation CRUD
	map.add_annotation = (params) => {
		const p = validateParams("add_annotation", params) as Parameters<
			typeof nextAnnotationRegion
		>[1];
		const state = controls.getState();
		const region = nextAnnotationRegion(state, p);
		controls.pushState({ annotationRegions: [...state.annotationRegions, region] });
		return region;
	};
	map.update_annotation = (params) => {
		const { id, ...patch } = validateParams("update_annotation", params) as {
			id: string;
		} & Partial<AnnotationRegion>;
		const state = controls.getState();
		const existing = state.annotationRegions.find((r) => r.id === id);
		if (!existing) throw new Error(`annotation not found: ${id}`);
		const updated = patchAnnotation(existing, patch);
		controls.pushState({
			annotationRegions: state.annotationRegions.map((r) => (r.id === id ? updated : r)),
		});
		return updated;
	};
	map.delete_annotation = (params) => {
		const { id } = validateParams("delete_annotation", params) as { id: string };
		const state = controls.getState();
		const exists = state.annotationRegions.some((r) => r.id === id);
		if (!exists) throw new Error(`annotation not found: ${id}`);
		controls.pushState({
			annotationRegions: state.annotationRegions.filter((r) => r.id !== id),
		});
		return { id, deleted: true };
	};
	map.add_blur_annotation = (params) => {
		const p = validateParams("add_blur_annotation", params) as {
			startMs: number;
			endMs: number;
			position?: { x: number; y: number };
			size?: { width: number; height: number };
			blurData?: Partial<AnnotationRegion["blurData"]>;
		};
		const state = controls.getState();
		const region = nextAnnotationRegion(state, { ...p, type: "blur" });
		controls.pushState({ annotationRegions: [...state.annotationRegions, region] });
		return region;
	};

	// Canvas
	map.set_wallpaper = (params) => {
		const { value } = validateParams("set_wallpaper", params) as { value: string };
		controls.pushState({ wallpaper: value });
		return { wallpaper: value };
	};
	map.set_padding = (params) => {
		const { value } = validateParams("set_padding", params) as { value: number };
		controls.pushState({ padding: value });
		return { padding: value };
	};
	map.set_border_radius = (params) => {
		const { value } = validateParams("set_border_radius", params) as { value: number };
		controls.pushState({ borderRadius: value });
		return { borderRadius: value };
	};
	map.set_shadow_intensity = (params) => {
		const { value } = validateParams("set_shadow_intensity", params) as { value: number };
		controls.pushState({ shadowIntensity: value });
		return { shadowIntensity: value };
	};
	map.set_motion_blur = (params) => {
		const { value } = validateParams("set_motion_blur", params) as { value: number };
		controls.pushState({ motionBlurAmount: value });
		return { motionBlurAmount: value };
	};
	map.set_show_blur = (params) => {
		const { value } = validateParams("set_show_blur", params) as { value: boolean };
		controls.pushState({ showBlur: value });
		return { showBlur: value };
	};
	map.set_aspect_ratio = (params) => {
		const { value } = validateParams("set_aspect_ratio", params) as {
			value: EditorState["aspectRatio"];
		};
		const state = controls.getState();
		// Normalize a tentative state to detect webcam-layout snapping.
		const normalized = normalizeProjectEditor({ ...state, aspectRatio: value });
		const snapped = normalized.webcamLayoutPreset !== state.webcamLayoutPreset;
		controls.pushState({
			aspectRatio: normalized.aspectRatio,
			webcamLayoutPreset: normalized.webcamLayoutPreset,
		});
		return {
			aspectRatio: normalized.aspectRatio,
			webcamLayoutPreset: normalized.webcamLayoutPreset,
			webcamLayoutSnapped: snapped,
		};
	};
	map.set_crop_region = (params) => {
		const crop = validateParams("set_crop_region", params) as unknown as CropRegion;
		controls.pushState({ cropRegion: crop });
		return crop;
	};
	map.set_webcam_layout = (params) => {
		const { preset } = validateParams("set_webcam_layout", params) as {
			preset: WebcamLayoutPreset;
		};
		controls.pushState({ webcamLayoutPreset: preset });
		return { webcamLayoutPreset: preset };
	};
	map.set_webcam_size = (params) => {
		const { value } = validateParams("set_webcam_size", params) as { value: number };
		controls.pushState({ webcamSizePreset: value });
		return { webcamSizePreset: value };
	};
	map.set_webcam_position = (params) => {
		const position = validateParams("set_webcam_position", params) as unknown as WebcamPosition;
		controls.pushState({ webcamPosition: position });
		return { webcamPosition: position };
	};
	map.set_webcam_mask_shape = (params) => {
		const { shape } = validateParams("set_webcam_mask_shape", params) as {
			shape: WebcamMaskShape;
		};
		controls.pushState({ webcamMaskShape: shape });
		return { webcamMaskShape: shape };
	};

	// Playback
	map.seek = (params) => {
		const { timestampMs } = validateParams("seek", params) as { timestampMs: number };
		controls.seekMs(timestampMs);
		return { currentTimeMs: controls.getCurrentTimeMs() };
	};
	map.get_playhead = () => ({
		currentTimeMs: controls.getCurrentTimeMs(),
		isPlaying: controls.getIsPlaying(),
	});

	// Export
	map.export_project = async (params) => {
		const p = validateParams("export_project", params) as Parameters<
			McpEditorControls["exportProject"]
		>[0];
		return await controls.exportProject(p);
	};

	// Sanity check: every catalog tool has a handler.
	for (const tool of TOOL_CATALOG) {
		if (!map[tool.name]) {
			throw new Error(`missing MCP handler for ${tool.name}`);
		}
	}

	return map as Record<McpToolName, Handler>;
}
