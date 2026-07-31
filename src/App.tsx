import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import NavBar from './components/NavBar';
import TabBar from './components/TabBar';
import AddSheet from './components/AddSheet';
import Composer from './components/Composer';
import Detail from './components/Detail';
import Settings from './components/Settings';
import ExternalDetail from './components/ExternalDetail';
import InviteAccept from './components/InviteAccept';
import InviteShare from './components/InviteShare';
import Auth from './components/Auth';
import Toasts from './components/Toasts';
import BucketList from './screens/BucketList';
import Calendar from './screens/Calendar';
import { peekInvite, watchPasswordRecovery } from './lib/auth';
import { useApp } from './lib/store';
import s from './App.module.css';

export default function App() {
  const ready = useApp((st) => st.ready);
  const authPhase = useApp((st) => st.authPhase);
  const screen = useApp((st) => st.screen);
  const space = useApp((st) => st.space);
  const inviteCode = useApp((st) => st.inviteCode);
  const inviteShareOpen = useApp((st) => st.inviteShareOpen);
  const passwordRecovery = useApp((st) => st.passwordRecovery);
  const boot = useApp((st) => st.boot);
  const refreshSpace = useApp((st) => st.refreshSpace);
  const setNavScroll = useApp((st) => st.setNavScroll);
  const setInviteShareOpen = useApp((st) => st.setInviteShareOpen);
  const setInviteCode = useApp((st) => st.setInviteCode);
  const setPasswordRecovery = useApp((st) => st.setPasswordRecovery);
  const main = useRef<HTMLElement>(null);
  const [inviterHint, setInviterHint] = useState<string | null>(null);
  // After Auth unmounts, iOS often delivers the Sign-in tap to whatever is
  // now under the finger (usually the avatar → Settings). Eat that click.
  const [blockChrome, setBlockChrome] = useState(false);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    const href = window.location.href;
    if (/type=recovery/i.test(href)) setPasswordRecovery(true);

    let off: () => void = () => {};
    void watchPasswordRecovery(() => setPasswordRecovery(true)).then((unsub) => {
      off = unsub;
    });
    return () => off();
  }, [setPasswordRecovery]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('compose') === '1') {
      useApp.getState().setAddOpen(true);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!inviteCode || authPhase !== 'signedOut') return;
    void peekInvite(inviteCode)
      .then((p) => setInviterHint(p?.inviterName ?? null))
      .catch(() => setInviterHint(null));
  }, [inviteCode, authPhase]);

  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [screen]);

  if (authPhase === 'loading') {
    return <div className={s.app} />;
  }

  if (passwordRecovery || authPhase === 'signedOut') {
    return (
      <div className={s.app}>
        <Auth
          inviterHint={passwordRecovery ? null : inviterHint}
          startInRecovery={passwordRecovery}
          onSignedIn={async () => {
            setPasswordRecovery(false);
            setBlockChrome(true);
            useApp.getState().setSettingsOpen(false);
            try {
              await refreshSpace();
            } finally {
              window.setTimeout(() => setBlockChrome(false), 600);
            }
          }}
        />
        <Toasts />
      </div>
    );
  }

  return (
    <div
      className={s.app}
      style={blockChrome ? { pointerEvents: 'none' } : undefined}
    >
      <NavBar />

      <main
        ref={main}
        className={`${s.main} ${screen === 'bucket' ? s.largeTitleRoom : ''}`}
        onScroll={(e) => setNavScroll(e.currentTarget.scrollTop)}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={screen}
            className={s.screen}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
          >
            {ready && (screen === 'bucket' ? <BucketList /> : <Calendar />)}
          </motion.div>
        </AnimatePresence>
      </main>

      <TabBar />
      <AddSheet />
      <Composer />
      <Detail />
      <Settings />
      <ExternalDetail />
      <InviteShare
        open={inviteShareOpen}
        code={space?.inviteCode ?? ''}
        onClose={() => setInviteShareOpen(false)}
      />
      <InviteAccept
        code={inviteCode ?? ''}
        open={authPhase === 'signedIn' && !!inviteCode}
        onJoined={() => {
          setInviteCode(null);
          void refreshSpace();
        }}
        onDismiss={() => setInviteCode(null)}
      />
      <Toasts />
    </div>
  );
}
