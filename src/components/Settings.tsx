import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import Sheet from './Sheet';
import Switch from './Switch';
import { useApp } from '../lib/store';
import { updateDisplayName } from '../lib/auth';
import {
  clearGoogleToken,
  connectGoogle,
  fetchGoogleEvents,
  googleToken,
} from '../lib/gcal';
import {
  disablePush,
  enablePush,
  pushState,
  registerPush,
  syncPush,
  type PushState,
} from '../lib/push';
import f from './Form.module.css';

const PUSH_COPY: Record<PushState, string> = {
  unsupported: "This browser can't do web push.",
  'ios-install': 'Add Someday to your Home Screen to get notifications.',
  default: "You'll hear when dates lock in or notes change.",
  denied: 'Blocked — turn notifications on in Settings.',
  'granted-idle': 'Allowed. Turn the switch on to finish.',
  on: "You'll hear about locked-in dates and note changes.",
};

export default function Settings() {
  const open = useApp((st) => st.settingsOpen);
  const setOpen = useApp((st) => st.setSettingsOpen);
  const config = useApp((st) => st.config);
  const updateConfig = useApp((st) => st.updateConfig);
  const connect = useApp((st) => st.connect);
  const disconnect = useApp((st) => st.disconnect);
  const signOutUser = useApp((st) => st.signOutUser);
  const authPhase = useApp((st) => st.authPhase);
  const backendName = useApp((st) => st.backendName);
  const space = useApp((st) => st.space);
  const external = useApp((st) => st.external);
  const setExternal = useApp((st) => st.setExternal);
  const togglePreview = useApp((st) => st.togglePreview);
  const setInviteShareOpen = useApp((st) => st.setInviteShareOpen);
  const refreshSpace = useApp((st) => st.refreshSpace);
  const toast = useApp((st) => st.toast);

  const signedIn = authPhase === 'signedIn';
  const [url, setUrl] = useState(config.supabaseUrl);
  const [key, setKey] = useState(config.supabaseKey);
  const [spaceId, setSpaceId] = useState(config.spaceId);
  const [myName, setMyName] = useState(space?.myName ?? config.names[config.me]);
  const [gcalOn, setGcalOn] = useState(Boolean(googleToken()));
  const [bell, setBell] = useState<PushState>('default');

  useEffect(() => {
    if (!open) return;
    setMyName(space?.myName ?? config.names[config.me]);
    void registerPush().then(() => setBell(pushState()));
    void syncPush().then(() => setBell(pushState()));
  }, [open, space?.myName, config.names, config.me]);

  return (
    <Sheet open={open} onClose={() => setOpen(false)} heading="Settings">
      {signedIn ? (
        <>
          <span className={f.label}>Your name</span>
          <div className={f.group}>
            <input
              className={f.input}
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              onBlur={() => {
                void (async () => {
                  const clean = myName.trim();
                  if (!clean || clean === space?.myName) return;
                  try {
                    await updateDisplayName(clean);
                    updateConfig({ names: loadNames(config.me, clean, config.names) });
                    await refreshSpace();
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Couldn’t save name');
                  }
                })();
              }}
              placeholder="Your name"
            />
          </div>

          <span className={f.label}>Partner</span>
          <div className={f.group}>
            {space?.partner2Id && space.partnerName ? (
              <div className={f.listRow}>
                <span className={f.rowLabel}>{space.partnerName}</span>
              </div>
            ) : (
              <button
                type="button"
                className={f.listRow}
                onClick={() => {
                  setOpen(false);
                  setInviteShareOpen(true);
                }}
              >
                <span className={f.rowLabel}>Invite your person</span>
                <span className={f.hint}>›</span>
              </button>
            )}
          </div>
          {!space?.partner2Id && (
            <p className={f.rowNote}>
              One open seat. Share an invite when you’re ready — until then
              it’s just you.
            </p>
          )}
        </>
      ) : (
        <>
          <span className={f.label}>Names</span>
          <div className={f.group}>
            <input
              className={f.input}
              value={config.names[0]}
              onChange={(e) =>
                updateConfig({ names: [e.target.value, config.names[1]] })
              }
              placeholder="You"
            />
            <input
              className={f.input}
              value={config.names[1]}
              onChange={(e) =>
                updateConfig({ names: [config.names[0], e.target.value] })
              }
              placeholder="Them"
            />
          </div>

          <span className={f.label}>Which one are you?</span>
          <div className={f.segmented}>
            {([0, 1] as const).map((i) => (
              <button
                key={i}
                type="button"
                className={`${f.segment} ${config.me === i ? f.segmentOn : ''}`}
                onClick={() => updateConfig({ me: i })}
              >
                {config.me === i && (
                  <motion.span
                    layoutId="segment-knob"
                    className={f.segmentKnob}
                    transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                  />
                )}
                <span className={f.segmentLabel}>
                  {config.names[i] || (i === 0 ? 'Me' : 'You')}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <span className={f.label}>Calendars</span>
      <div className={f.group}>
        <div className={f.listRow}>
          <span className={f.rowLabel}>Google Calendar</span>
          <Switch
            on={gcalOn}
            label="Connect Google Calendar"
            onChange={(on) => {
              void (async () => {
                if (!on) {
                  clearGoogleToken();
                  setExternal([]);
                  setGcalOn(false);
                  toast('Google Calendar disconnected');
                  return;
                }
                try {
                  const token = await connectGoogle();
                  const events = await fetchGoogleEvents(token, String(config.me));
                  setExternal(events);
                  setGcalOn(true);
                  toast(`Showing ${events.length} events`);
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Google connect failed');
                }
              })();
            }}
          />
        </div>
        <div className={f.listRow}>
          <span className={f.rowLabel}>Sample events</span>
          <Switch
            on={external.length > 0 && !gcalOn}
            onChange={togglePreview}
            label="Show sample calendar events"
          />
        </div>
      </div>
      <p className={f.rowNote}>
        Imported events stay read-only and share their titles by default. They
        never become plans.
      </p>

      <span className={f.label}>Google client ID</span>
      <div className={f.group}>
        <input
          className={f.input}
          value={config.googleClientId}
          onChange={(e) => updateConfig({ googleClientId: e.target.value })}
          placeholder="xxxx.apps.googleusercontent.com"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>

      <span className={f.label}>Notifications</span>
      <div className={f.group}>
        <div className={f.listRow}>
          <span className={f.rowLabel}>Push</span>
          <Switch
            on={bell === 'on'}
            label="Notifications"
            onChange={(on) => {
              void (async () => {
                const msg = on ? await enablePush() : await disablePush();
                setBell(pushState());
                toast(msg);
              })();
            }}
          />
        </div>
      </div>
      <p className={f.rowNote}>{PUSH_COPY[bell]}</p>

      {!signedIn && (
        <>
          <span className={f.label}>VAPID public key</span>
          <div className={f.group}>
            <input
              className={f.input}
              value={config.vapidPublicKey}
              onChange={(e) => updateConfig({ vapidPublicKey: e.target.value })}
              placeholder="BNxxx…"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>

          <span className={f.label}>
            Sync{' '}
            <span className={f.hint}>
              —{' '}
              {backendName === 'supabase'
                ? 'connected, syncing live'
                : 'this device only'}
            </span>
          </span>
          <div className={f.group}>
            <input
              className={f.input}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Project URL"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            <input
              className={f.input}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Anon public key"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            <input
              className={f.input}
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
              placeholder="Space id (optional if signing in)"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>

          <div className={f.row}>
            <button
              type="button"
              className={`${f.btn} ${f.ghost}`}
              onClick={() => void disconnect()}
            >
              Disconnect
            </button>
            <button
              type="button"
              className={`${f.btn} ${f.solid}`}
              onClick={() =>
                void connect({ supabaseUrl: url, supabaseKey: key, spaceId })
              }
            >
              Connect
            </button>
          </div>
        </>
      )}

      {signedIn && (
        <div className={f.row}>
          <button
            type="button"
            className={`${f.btn} ${f.ghost}`}
            onClick={() => void signOutUser()}
          >
            Sign out
          </button>
        </div>
      )}
    </Sheet>
  );
}

function loadNames(
  me: 0 | 1,
  myName: string,
  current: [string, string],
): [string, string] {
  return me === 0 ? [myName, current[1]] : [current[0], myName];
}
