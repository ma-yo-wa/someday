import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { AnimatePresence, motion } from 'motion/react';
import s from './UpdateBanner.module.css';

/** How often to ask the network if a newer build exists. */
const CHECK_MS = 60_000;

/** When a new deploy is waiting, offer a one-tap reload into it. */
export default function UpdateBanner() {
  const [apply, setApply] = useState<(() => void) | null>(null);

  useEffect(() => {
    let registration: ServiceWorkerRegistration | undefined;
    let swUrl = '/sw.js';
    let timer: ReturnType<typeof setInterval> | undefined;

    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        setApply(() => () => {
          void updateSW(true);
        });
      },
      onRegisteredSW(url, reg) {
        swUrl = url;
        registration = reg;
        void checkForUpdate();
        timer = setInterval(() => void checkForUpdate(), CHECK_MS);
      },
    });

    async function checkForUpdate() {
      if (!registration || registration.installing || !navigator.onLine) return;
      try {
        const resp = await fetch(swUrl, {
          cache: 'no-store',
          headers: { 'cache-control': 'no-cache' },
        });
        if (resp.ok) await registration.update();
      } catch {
        /* offline / flaky — try again next tick */
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkForUpdate();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
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
