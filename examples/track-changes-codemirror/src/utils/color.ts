/**
 * Generates a user-specific color based on their user ID.
 * @param userId - The user ID to generate a color for.
 * @returns A hex color string in the format "#RRGGBB".
 */
export function getUserColorFallback(userId: string) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = (hash & 0x00ffffff).toString(16).toUpperCase();
  return "#" + "00000".substring(0, 6 - color.length) + color;
}

/**
 * Adds transparency to a hex color by appending an alpha channel.
 * The transparency value should be between 0 (fully transparent) and 1 (fully opaque).
 * @param color - The hex color string (e.g., "#RRGGBB" or "#RGB").
 * @param transparency - A number between 0 and 1 representing the desired transparency level.
 * @returns
 */
export function addTransparencyToColor(
  color: string,
  transparency: number
): string {
  // Clip the last two characters (alpha channel) if present
  const hexColor = color.substring(0, 7);
  // Convert transparency to a hex value (00 to FF)
  const alpha = Math.round(transparency * 255)
    .toString(16)
    .padStart(2, "0");
  return hexColor + alpha;
}
