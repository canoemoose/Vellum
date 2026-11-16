// A tool's button in the toolbar (ToolPalette marks each with data-tool, including a group's
// button while it shows that tool), for what opens beside it: the stamp tools' grid.

export const BUTTON_SELECTOR = (tool: string): string => `[data-tool="${tool}"]`;
