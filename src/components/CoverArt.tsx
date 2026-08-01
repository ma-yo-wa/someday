import { emojiFromCover, isEmojiCover } from '../lib/cover';
import s from './CoverArt.module.css';

interface Props {
  url: string | null | undefined;
  className?: string;
  /** Larger emoji for detail / picker preview. */
  size?: 'card' | 'hero' | 'thumb';
}

export default function CoverArt({ url, className, size = 'card' }: Props) {
  if (!url) return null;

  if (isEmojiCover(url)) {
    return (
      <div className={`${s.emoji} ${s[size]} ${className ?? ''}`} aria-hidden>
        <span>{emojiFromCover(url)}</span>
      </div>
    );
  }

  /* A real <img> rather than a background, so the browser can skip
     everything below the fold. A long bucket list is otherwise a few
     hundred simultaneous decodes. The detail sheet's hero is already on
     screen by the time it renders, so it doesn't wait. */
  return (
    <div className={`${s.photo} ${s[size]} ${className ?? ''}`} aria-hidden>
      <img
        src={url}
        alt=""
        loading={size === 'hero' ? 'eager' : 'lazy'}
        decoding="async"
      />
    </div>
  );
}
