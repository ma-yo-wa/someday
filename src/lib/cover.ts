/** Stored covers are either a normal image URL / data-URL, or `emoji:🎈`. */

export function isEmojiCover(url: string | null | undefined): boolean {
  return Boolean(url?.startsWith('emoji:'));
}

export function emojiFromCover(url: string): string {
  return decodeURIComponent(url.slice('emoji:'.length));
}

export function emojiCover(emoji: string): string {
  return `emoji:${encodeURIComponent(emoji)}`;
}

/** Everyday icon set — general life stuff, not niche. */
export const COVER_ICONS: string[] = [
  '🎈', '🎁', '🎂', '🎉', '🎊', '💐',
  '☕', '🍵', '🍷', '🍸', '🍺', '🍽️',
  '🍕', '🍣', '🌮', '🍦', '🥐', '🥗',
  '🏠', '🏡', '🏨', '🏰', '⛺', '🌅',
  '✈️', '🚗', '🚲', '⛵', '🚂', '🗺️',
  '🎬', '🎵', '🎧', '🎸', '🎮', '📚',
  '⚽', '🏀', '🎾', '🏌️', '🏊', '⛷️',
  '🧘', '💃', '🎨', '📷', '🛍️', '💍',
  '❤️', '💕', '✨', '🌟', '🔥', '🌈',
  '🐶', '🐱', '🌸', '🍀', '🌙', '☀️',
  '💼', '💻', '📱', '📝', '💡', '🔑',
];

export function filterIcons(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return COVER_ICONS;
  // Emoji don't match text well — keep all when typing Latin letters;
  // if they paste an emoji, filter to that.
  if ([...q].some((ch) => COVER_ICONS.includes(ch))) {
    return COVER_ICONS.filter((e) => q.includes(e));
  }
  return COVER_ICONS;
}

/** Compress a library photo for storage in `image_url`. */
export async function fileToCoverDataUrl(file: File, max = 960): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Couldn’t process that photo');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.82);
}
