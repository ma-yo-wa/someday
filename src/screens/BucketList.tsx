import { motion } from 'motion/react';
import CoverArt from '../components/CoverArt';
import { useApp, partnerName } from '../lib/store';
import { isBucketItem } from '../lib/types';
import { tintsFor } from '../lib/tint';
import s from './BucketList.module.css';

export default function BucketList() {
  const activities = useApp((st) => st.activities);
  const config = useApp((st) => st.config);
  const openDetail = useApp((st) => st.openDetail);
  const openComposer = useApp((st) => st.openComposer);

  const items = activities
    .filter(isBucketItem)
    .slice()
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

  const tints = tintsFor(items.map((a) => a.id));

  if (!items.length) {
    return (
      <div className={s.board}>
        <div className={s.blank}>
          <p>Things you both want to do, before they have a date</p>
          <button type="button" onClick={() => openComposer('bucket')}>
            Add the first one
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={s.board}>
      {items.map((a, i) => (
        <motion.button
          key={a.id}
          type="button"
          className={s.card}
          style={{ background: tints[i] }}
          onClick={() => openDetail(a.id)}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.055, duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {a.image_url && <CoverArt url={a.image_url} size="card" className={s.art} />}
          <div className={s.veil} />

          <div className={s.body}>
            <h3 className={s.title}>{a.title}</h3>
            <div className={s.foot}>{partnerName(config, a.created_by)}</div>
          </div>
        </motion.button>
      ))}
    </div>
  );
}
