import { AnimatePresence, motion } from 'motion/react';
import { useApp } from '../lib/store';
import s from './Toasts.module.css';

export default function Toasts() {
  const toasts = useApp((st) => st.toasts);

  return (
    <div className={s.wrap} role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className={s.toast}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
