export const PRESET_COLORS = [
  '#ef4444', // red
  '#3b82f6', // blue
  '#22c55e', // green
  '#eab308', // yellow
  '#f97316', // orange
  '#ffffff', // white
  '#000000', // black
] as const;

/** The orange used for the click indicator. Matches PRESET_COLORS[4]. */
export const CLICK_INDICATOR_COLOR = PRESET_COLORS[4];
