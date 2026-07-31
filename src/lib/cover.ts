import { artFor } from './art';

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

/** Search keywords per emoji — Latin search actually works. */
const ICON_TAGS: Record<string, string> = {
  '🎈': 'party balloon celebrate',
  '🎁': 'gift present birthday',
  '🎂': 'cake birthday anniversary',
  '🎉': 'party celebrate confetti',
  '🎊': 'party celebrate',
  '💐': 'flowers bouquet romance',
  '☕': 'coffee cafe espresso',
  '🍵': 'tea matcha',
  '🍷': 'wine dinner drink',
  '🍸': 'cocktail bar drink',
  '🍺': 'beer drink pub',
  '🍽️': 'dinner restaurant food eat',
  '🍕': 'pizza food',
  '🍣': 'sushi food japanese',
  '🌮': 'taco food mexican',
  '🍦': 'ice cream dessert sweet',
  '🥐': 'croissant breakfast bakery',
  '🥗': 'salad food healthy',
  '🏠': 'home house',
  '🏡': 'home house garden',
  '🏨': 'hotel stay travel',
  '🏰': 'castle travel',
  '⛺': 'camp tent outdoors',
  '🌅': 'sunset beach ocean',
  '✈️': 'flight fly airport travel plane',
  '🚗': 'drive car road trip',
  '🚲': 'bike bicycle ride',
  '⛵': 'boat sail water',
  '🚂': 'train rail travel',
  '🗺️': 'map travel trip',
  '🎬': 'movie film cinema',
  '🎵': 'music song',
  '🎧': 'music headphones',
  '🎸': 'guitar music concert',
  '🎮': 'game gaming',
  '📚': 'book read library',
  '⚽': 'soccer sport',
  '🏀': 'basketball sport',
  '🎾': 'tennis sport',
  '🏌️': 'golf sport',
  '🏊': 'swim beach pool',
  '⛷️': 'ski snow winter',
  '🧘': 'yoga spa rest',
  '💃': 'dance club',
  '🎨': 'art museum gallery paint',
  '📷': 'photo camera',
  '🛍️': 'shop shopping',
  '💍': 'ring wedding anniversary',
  '❤️': 'love heart romance',
  '💕': 'love hearts romance',
  '✨': 'sparkle special',
  '🌟': 'star special',
  '🔥': 'fire hot',
  '🌈': 'rainbow',
  '🐶': 'dog pet',
  '🐱': 'cat pet',
  '🌸': 'flower blossom spring',
  '🍀': 'luck clover',
  '🌙': 'moon night',
  '☀️': 'sun day sunny',
  '💼': 'work meeting office',
  '💻': 'laptop work computer',
  '📱': 'phone call',
  '📝': 'notes write plan',
  '💡': 'idea lightbulb',
  '🔑': 'key',
};

/** Icons for the picker: title match first, then the rest. */
export function iconsForPicker(title: string, query: string): string[] {
  const filtered = filterIcons(query);
  const suggested = artFor(title.trim() || null);
  if (!title.trim() || suggested === '🗓' || suggested === '✦') return filtered;
  if (!filtered.includes(suggested)) {
    return [suggested, ...filtered];
  }
  return [suggested, ...filtered.filter((e) => e !== suggested)];
}

export function filterIcons(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return COVER_ICONS;
  if ([...q].some((ch) => COVER_ICONS.includes(ch) || Object.keys(ICON_TAGS).includes(ch))) {
    return COVER_ICONS.filter((e) => q.includes(e));
  }
  return COVER_ICONS.filter((e) => (ICON_TAGS[e] ?? '').includes(q) || e.includes(q));
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
