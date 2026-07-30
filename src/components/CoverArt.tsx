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

  return (
    <div
      className={`${s.photo} ${s[size]} ${className ?? ''}`}
      style={{ backgroundImage: `url(${url})` }}
      aria-hidden
    />
  );
}
