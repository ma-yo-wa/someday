/**
 * Full-bleed orb icons. iOS/Android apply the squircle/mask — never draw a
 * circle on cream (that creates the white border on the home screen).
 *
 *   npm i -D sharp && node scripts/generate-icons.mjs
 */
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const svg = (size) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="orb" cx="50%" cy="44%" r="72%">
      <stop offset="0%" stop-color="#FF7396"/>
      <stop offset="22%" stop-color="#FD8696"/>
      <stop offset="46%" stop-color="#FDA492"/>
      <stop offset="66%" stop-color="#F0C296"/>
      <stop offset="100%" stop-color="#CDE7B3"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#orb)"/>
</svg>`;

async function write(name, size) {
  const buf = await sharp(Buffer.from(svg(size))).png().toBuffer();
  writeFileSync(join(out, name), buf);
  console.log(name, size);
}

await write('icon-192.png', 192);
await write('icon-512.png', 512);
await write('icon-maskable-512.png', 512);
await write('apple-touch-icon.png', 180);
await write('icon-source.png', 1024);
console.log('ok → public/');
