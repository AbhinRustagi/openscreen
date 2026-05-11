import { z } from "zod";
import type { McpToolCategory, McpToolDisplayInfo } from "./types";

const zoomFocus = z.object({
	cx: z.number().min(0).max(1),
	cy: z.number().min(0).max(1),
});

const zoomDepth = z.union([
	z.literal(1),
	z.literal(2),
	z.literal(3),
	z.literal(4),
	z.literal(5),
	z.literal(6),
]);

const rotationPreset = z.enum(["iso", "left", "right"]);

const annotationType = z.enum(["text", "image", "figure", "blur"]);

const annotationPosition = z.object({
	x: z.number().min(0).max(100),
	y: z.number().min(0).max(100),
});

const annotationSize = z.object({
	width: z.number().min(1).max(200),
	height: z.number().min(1).max(200),
});

const annotationStyle = z
	.object({
		color: z.string().optional(),
		backgroundColor: z.string().optional(),
		fontSize: z.number().min(1).optional(),
		fontFamily: z.string().optional(),
		fontWeight: z.enum(["normal", "bold"]).optional(),
		fontStyle: z.enum(["normal", "italic"]).optional(),
		textDecoration: z.enum(["none", "underline"]).optional(),
		textAlign: z.enum(["left", "center", "right"]).optional(),
	})
	.partial();

const figureData = z
	.object({
		arrowDirection: z.enum([
			"up",
			"down",
			"left",
			"right",
			"up-right",
			"up-left",
			"down-right",
			"down-left",
		]),
		color: z.string(),
		strokeWidth: z.number().min(1),
	})
	.partial();

const blurData = z
	.object({
		type: z.enum(["blur", "mosaic"]),
		shape: z.enum(["rectangle", "oval", "freehand"]),
		color: z.enum(["white", "black"]),
		intensity: z.number().min(2).max(40),
		blockSize: z.number().min(4).max(48),
		freehandPoints: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
	})
	.partial();

const aspectRatio = z.enum(["16:9", "4:3", "1:1", "9:16", "3:4", "21:9", "4:5", "original"]);

const exportFormat = z.enum(["mp4", "gif"]);
const exportQuality = z.enum(["good", "medium", "source"]);
const gifFrameRate = z.union([z.literal(15), z.literal(20), z.literal(25), z.literal(30)]);

export const TOOL_SCHEMAS = {
	get_editor_state: z.object({}),
	get_timeline_summary: z.object({}),
	list_regions: z.object({
		kind: z.enum(["zoom", "trim", "speed", "annotation"]),
	}),

	get_source_frame: z.object({
		timestampMs: z.number().int().min(0),
	}),
	get_rendered_frame: z.object({
		timestampMs: z.number().int().min(0),
	}),

	add_zoom_region: z.object({
		startMs: z.number().int().min(0),
		endMs: z.number().int().min(1),
		depth: zoomDepth.optional(),
		focus: zoomFocus.optional(),
		customScale: z.number().min(1).max(5).optional(),
		rotationPreset: rotationPreset.optional(),
	}),
	update_zoom_region: z.object({
		id: z.string(),
		startMs: z.number().int().min(0).optional(),
		endMs: z.number().int().min(1).optional(),
		depth: zoomDepth.optional(),
		focus: zoomFocus.optional(),
		customScale: z.number().min(1).max(5).optional(),
		rotationPreset: rotationPreset.optional(),
	}),
	delete_zoom_region: z.object({ id: z.string() }),

	add_trim_region: z.object({
		startMs: z.number().int().min(0),
		endMs: z.number().int().min(1),
	}),
	update_trim_region: z.object({
		id: z.string(),
		startMs: z.number().int().min(0).optional(),
		endMs: z.number().int().min(1).optional(),
	}),
	delete_trim_region: z.object({ id: z.string() }),

	add_speed_region: z.object({
		startMs: z.number().int().min(0),
		endMs: z.number().int().min(1),
		speed: z.number().min(0.1).max(16),
	}),
	update_speed_region: z.object({
		id: z.string(),
		startMs: z.number().int().min(0).optional(),
		endMs: z.number().int().min(1).optional(),
		speed: z.number().min(0.1).max(16).optional(),
	}),
	delete_speed_region: z.object({ id: z.string() }),

	add_annotation: z.object({
		startMs: z.number().int().min(0),
		endMs: z.number().int().min(1),
		type: annotationType.optional(),
		content: z.string().optional(),
		position: annotationPosition.optional(),
		size: annotationSize.optional(),
		style: annotationStyle.optional(),
		figureData: figureData.optional(),
		blurData: blurData.optional(),
	}),
	update_annotation: z.object({
		id: z.string(),
		startMs: z.number().int().min(0).optional(),
		endMs: z.number().int().min(1).optional(),
		type: annotationType.optional(),
		content: z.string().optional(),
		position: annotationPosition.optional(),
		size: annotationSize.optional(),
		style: annotationStyle.optional(),
		figureData: figureData.optional(),
		blurData: blurData.optional(),
	}),
	delete_annotation: z.object({ id: z.string() }),
	add_blur_annotation: z.object({
		startMs: z.number().int().min(0),
		endMs: z.number().int().min(1),
		position: annotationPosition.optional(),
		size: annotationSize.optional(),
		blurData: blurData.optional(),
	}),

	set_wallpaper: z.object({ value: z.string() }),
	set_padding: z.object({ value: z.number().min(0).max(100) }),
	set_border_radius: z.object({ value: z.number().min(0) }),
	set_shadow_intensity: z.object({ value: z.number().min(0).max(1) }),
	set_motion_blur: z.object({ value: z.number().min(0).max(1) }),
	set_show_blur: z.object({ value: z.boolean() }),
	set_aspect_ratio: z.object({ value: aspectRatio }),
	set_crop_region: z.object({
		x: z.number().min(0).max(1),
		y: z.number().min(0).max(1),
		width: z.number().min(0.01).max(1),
		height: z.number().min(0.01).max(1),
	}),
	set_webcam_layout: z.object({
		preset: z.enum(["picture-in-picture", "no-webcam", "vertical-stack", "dual-frame"]),
	}),
	set_webcam_size: z.object({ value: z.number().min(10).max(50) }),
	set_webcam_position: z.object({
		cx: z.number().min(0).max(1),
		cy: z.number().min(0).max(1),
	}),
	set_webcam_mask_shape: z.object({
		shape: z.enum(["rectangle", "circle", "square", "rounded"]),
	}),

	seek: z.object({ timestampMs: z.number().int().min(0) }),
	get_playhead: z.object({}),

	export_project: z.object({
		outputPath: z.string().min(1),
		format: exportFormat.optional(),
		quality: exportQuality.optional(),
		gifFrameRate: gifFrameRate.optional(),
		gifLoop: z.boolean().optional(),
	}),
} as const;

export type McpToolName = keyof typeof TOOL_SCHEMAS;

export interface McpToolDef<T extends McpToolName = McpToolName> {
	name: T;
	description: string;
	category: McpToolCategory;
	schema: (typeof TOOL_SCHEMAS)[T];
}

const TOOL_METADATA: Record<McpToolName, { description: string; category: McpToolCategory }> = {
	get_editor_state: {
		description:
			"Return the full editor state: every region, canvas setting, media path, video duration, and current playhead.",
		category: "read",
	},
	get_timeline_summary: {
		description:
			"Return a chronologically ordered list of every region across kinds with id, kind, start/end, and a one-line description.",
		category: "read",
	},
	list_regions: {
		description: "List all regions of a single kind (zoom, trim, speed, or annotation).",
		category: "read",
	},
	get_source_frame: {
		description:
			"Extract a PNG frame from the raw source recording at `timestampMs`. The agent uses this to know what's at a given moment without app effects applied.",
		category: "frame",
	},
	get_rendered_frame: {
		description:
			"Extract a PNG frame of the composited editor view (wallpaper, padding, zoom, annotations, webcam) at `timestampMs`. Use for verifying edits.",
		category: "frame",
	},
	add_zoom_region: {
		description:
			"Add a zoom region. `focus.cx`/`focus.cy` are normalized (0-1) coordinates on the source video. `depth` (1-6) picks a preset scale; `customScale` (1.0-5.0) overrides it.",
		category: "zoom",
	},
	update_zoom_region: {
		description: "Update any subset of fields on an existing zoom region.",
		category: "zoom",
	},
	delete_zoom_region: { description: "Delete a zoom region by id.", category: "zoom" },
	add_trim_region: {
		description: "Add a trim region (a slice of the timeline that will be cut from the export).",
		category: "trim",
	},
	update_trim_region: {
		description: "Update the start/end of an existing trim region.",
		category: "trim",
	},
	delete_trim_region: { description: "Delete a trim region by id.", category: "trim" },
	add_speed_region: {
		description:
			"Add a speed region. `speed` is a playback multiplier in [0.1, 16] (e.g. 2 = 2x faster).",
		category: "speed",
	},
	update_speed_region: {
		description: "Update any subset of fields on an existing speed region.",
		category: "speed",
	},
	delete_speed_region: { description: "Delete a speed region by id.", category: "speed" },
	add_annotation: {
		description:
			"Add an annotation overlay (text, image, figure, or blur). Position and size are percentages of the canvas.",
		category: "annotation",
	},
	update_annotation: {
		description: "Update any subset of fields on an existing annotation.",
		category: "annotation",
	},
	delete_annotation: {
		description: "Delete an annotation by id.",
		category: "annotation",
	},
	add_blur_annotation: {
		description:
			"Convenience tool to add a blur/mosaic annotation. Equivalent to add_annotation with type='blur' and sensible defaults.",
		category: "annotation",
	},
	set_wallpaper: {
		description:
			"Set the canvas background. Accepts a canonical wallpaper path (/wallpapers/wallpaperN.jpg) or a CSS color/gradient string.",
		category: "canvas",
	},
	set_padding: { description: "Set canvas padding (0-100).", category: "canvas" },
	set_border_radius: {
		description: "Set the corner radius of the recorded video on the canvas (px).",
		category: "canvas",
	},
	set_shadow_intensity: {
		description: "Set drop-shadow intensity (0-1).",
		category: "canvas",
	},
	set_motion_blur: { description: "Set motion-blur amount (0-1).", category: "canvas" },
	set_show_blur: { description: "Toggle the global blur effect.", category: "canvas" },
	set_aspect_ratio: {
		description:
			"Set the export aspect ratio. The webcam layout may auto-snap if the current layout is incompatible (flagged in the response).",
		category: "canvas",
	},
	set_crop_region: {
		description:
			"Set the source crop region as normalized (0-1) x/y/width/height. width and height are relative to (1 - x) and (1 - y) respectively.",
		category: "canvas",
	},
	set_webcam_layout: {
		description:
			"Set the webcam layout preset. 'vertical-stack' is portrait-only; 'dual-frame' is landscape-only.",
		category: "canvas",
	},
	set_webcam_size: {
		description: "Set webcam size as a percentage of the canvas reference dimension (10-50).",
		category: "canvas",
	},
	set_webcam_position: {
		description:
			"Set the webcam center position as normalized (0-1) coordinates. Only takes effect with the picture-in-picture layout.",
		category: "canvas",
	},
	set_webcam_mask_shape: {
		description: "Set the webcam mask shape.",
		category: "canvas",
	},
	seek: {
		description: "Move the playhead to `timestampMs`. Returns the new currentTime.",
		category: "playback",
	},
	get_playhead: {
		description: "Return the current playhead position (ms) and whether playback is active.",
		category: "playback",
	},
	export_project: {
		description:
			"Export the project to `outputPath`. The app must be visible; rendering uses the live PixiJS pipeline.",
		category: "export",
	},
};

export const TOOL_CATALOG: ReadonlyArray<McpToolDef> = (
	Object.keys(TOOL_SCHEMAS) as McpToolName[]
).map((name) => ({
	name,
	description: TOOL_METADATA[name].description,
	category: TOOL_METADATA[name].category,
	schema: TOOL_SCHEMAS[name],
}));

export const TOOL_DISPLAY: ReadonlyArray<McpToolDisplayInfo> = TOOL_CATALOG.map((tool) => ({
	name: tool.name,
	description: tool.description,
	category: tool.category,
}));
