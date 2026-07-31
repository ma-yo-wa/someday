import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { AnimatePresence, motion } from 'motion/react';
import s from './UpdateBanner.module.css';

/** When a new deploy is waiting after a launch, offer a one-tap reload.
 *  No background polling — updates are rare; a swipe-away reopen is enough. */
export default function UpdateBanner() {
  const [apply, setApply] = useState<(() => void) | null>(null);

  useEffect(() => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        setApply(() => () => {
          void updateSW(true);
        });
      },
    });
  }, []);

  return (
    <div className={s.wrap}>
      <AnimatePresence>
        {apply && (
          <motion.button
            type="button"
            className={s.banner}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            onClick={() => apply()}
          >
            Update available — tap to refresh
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
