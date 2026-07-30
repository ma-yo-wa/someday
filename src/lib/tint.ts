/* The orb's hues, deepened until they can carry white text but kept
   saturated — a flat dark fill of the same hue goes muddy, and six muddy
   rectangles is what a board of these looked like. Each card is a short
   gradient instead, light at the top corner where nothing sits and dark
   at the bottom where the title does, so the type has contrast without
   a heavy scrim over the whole card.

   Tint comes from the id, so the board looks composed rather than random
   and a given card keeps its colour forever. */
const PALETTE: Array<[string, string]> = [
  ['#E0416F', '#7A1F3D'],
  ['#DE5A3E', '#7E2A28'],
  ['#D0842F', '#6E3F22'],
  ['#A8901F', '#55491F'],
  ['#6C9330', '#35491F'],
  ['#34925A', '#1B4A2E'],
];

function bucket(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  // Ids that share a prefix land together without a final avalanche.
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return Math.abs(h) % PALETTE.length;
}

const gradient = (i: number): string => {
  const [from, to] = PALETTE[i] as [string, string];
  return `linear-gradient(155deg, ${from} 0%, ${to} 82%)`;
};

export function tintFor(id: string): string {
  return gradient(bucket(id));
}

/* The hash is uniform, but uniform isn't the same as good-looking: on a
   board of four, random assignment lands three cards on the same hue
   often enough to look broken. So the colour is still derived from the
   id — a card keeps its own — and then nudged along the palette only
   when it would collide with the card to its left or the one above it in
   the two-column grid. */
export function tintsFor(ids: string[]): string[] {
  const chosen: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    let idx = bucket(ids[i] as string);
    for (
      let step = 0;
      step < PALETTE.length && (idx === chosen[i - 1] || idx === chosen[i - 2]);
      step++
    ) {
      idx = (idx + 1) % PALETTE.length;
    }
    chosen.push(idx);
  }
  return chosen.map(gradient);
}

/** One partner at each end of the orb. */
export function faceColor(index: 0 | 1): string {
  return index === 0 ? '#4F7735' : '#C4285A';
}
