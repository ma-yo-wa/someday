import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import Sheet from './Sheet';
import Switch from './Switch';
import GcalPicker from './GcalPicker';
import { useApp } from '../lib/store';
import { updateDisplayName } from '../lib/auth';
import {
  clearGoogleToken,
  connectGoogle,
  fetchGoogleEvents,
  googleClientId,
  googleToken,
  listGoogleCalendars,
  saveGoogleCalendar,
  savedGoogleCalendar,
  type GoogleCalendar,
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
  'ios-install': 'Open Someday from the Home Screen icon to turn notifications on.',
  default: 'Hear when she joins, locks in a date, or updates notes.',
  denied: 'Blocked — iPhone Settings → Someday → Notifications.',
  'granted-idle': 'Allowed. Turn the switch on to finish subscribing.',
  on: 'On — joins, locked-in dates, and note changes.',
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
  const setExternal = useApp((st) => st.setExternal);
  const setInviteShareOpen = useApp((st) => st.setInviteShareOpen);
  const refreshSpace = useApp((st) => st.refreshSpace);
  const toast = useApp((st) => st.toast);

  const signedIn = authPhase === 'signedIn';
  const [url, setUrl] = useState(config.supabaseUrl);
  const [key, setKey] = useState(config.supabaseKey);
  const [spaceId, setSpaceId] = useState(config.spaceId);
  const [myName, setMyName] = useState(space?.myName ?? config.names[config.me]);
  const [gcalOn, setGcalOn] = useState(Boolean(googleToken()));
  const [gcalName, setGcalName] = useState(savedGoogleCalendar()?.summary ?? null);
  const [gcalList, setGcalList] = useState<GoogleCalendar[] | null>(null);
  const [gcalBusy, setGcalBusy] = useState(false);
  const [bell, setBell] = useState<PushState>('default');
  const [bellBusy, setBellBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMyName(space?.myName ?? config.names[config.me]);
    setGcalOn(Boolean(googleToken()));
    setGcalName(savedGoogleCalendar()?.summary ?? null);
    void registerPush().then(() => setBell(pushState()));
    void syncPush().then(() => setBell(pushState()));
  }, [open, space?.myName, config.names, config.me]);

  async function pickGoogleCalendar(cal: GoogleCalendar) {
    const token = googleToken();
    if (!token) {
      toast('Connect Google again');
      setGcalOn(false);
      setGcalList(null);
      return;
    }
    setGcalBusy(true);
    try {
      saveGoogleCalendar(cal);
      setGcalName(cal.summary);
      setGcalList(null);
      const owner = space?.myId ?? String(config.me);
      const events = await fetchGoogleEvents(token, owner, cal.id);
      setExternal(events);
      setGcalOn(true);
      toast(
        events.length
          ? `${cal.summary} — ${events.length} events`
          : `${cal.summary} — nothing in the next few months`,
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Couldn’t load that calendar');
    } finally {
      setGcalBusy(false);
    }
  }

  function closeGcalPicker() {
    const had = savedGoogleCalendar();
    setGcalList(null);
    if (!had) {
      clearGoogleToken();
      setGcalOn(false);
      setGcalName(null);
      setExternal([]);
    }
  }

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
              placeholder="Mayowa"
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
            disabled={gcalBusy}
            label="Connect Google Calendar"
            onChange={(on) => {
              void (async () => {
                if (!on) {
                  clearGoogleToken();
                  saveGoogleCalendar(null);
                  setGcalList(null);
                  setGcalName(null);
                  setExternal([]);
                  setGcalOn(false);
                  toast('Google Calendar disconnected');
                  return;
                }
                setGcalBusy(true);
                try {
                  const token = await connectGoogle();
                  const calendars = await listGoogleCalendars(token);
                  if (!calendars.length) {
                    setGcalOn(false);
                    toast('No calendars found on that Google account');
                    return;
                  }
                  setGcalOn(true);
                  setGcalList(calendars);
                } catch (err) {
                  setGcalOn(false);
                  toast(err instanceof Error ? err.message : 'Google connect failed');
                } finally {
                  setGcalBusy(false);
                }
              })();
            }}
          />
        </div>
        {gcalOn && gcalName && (
          <button
            type="button"
            className={f.listRow}
            disabled={gcalBusy}
            onClick={() => {
              void (async () => {
                const token = googleToken();
                if (!token) {
                  toast('Connect Google again');
                  return;
                }
                setGcalBusy(true);
                try {
                  setGcalList(await listGoogleCalendars(token));
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Couldn’t list calendars');
                } finally {
                  setGcalBusy(false);
                }
              })();
            }}
          >
            <span className={f.rowLabel}>{gcalName}</span>
            <span className={f.hint}>Change ›</span>
          </button>
        )}
      </div>
      <p className={f.rowNote}>
        Read-only overlay from one Google calendar. Never becomes a plan. Best
        from Safari/Chrome the first time you connect.
      </p>

      <GcalPicker
        open={!!gcalList?.length}
        calendars={gcalList ?? []}
        selectedId={savedGoogleCalendar()?.id ?? null}
        busy={gcalBusy}
        onClose={closeGcalPicker}
        onPick={(cal) => void pickGoogleCalendar(cal)}
      />

      {!googleClientId() && (
        <>
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
          <p className={f.rowNote}>
            Set VITE_GOOGLE_CLIENT_ID in Cloudflare and redeploy, or paste a Web
            client ID here once.
          </p>
        </>
      )}

      <span className={f.label}>Notifications</span>
      <div className={f.group}>
        <div className={f.listRow}>
          <span className={f.rowLabel}>Push</span>
          <Switch
            on={bell === 'on'}
            disabled={bellBusy || bell === 'ios-install' || bell === 'unsupported'}
            label="Notifications"
            onChange={(on) => {
              if (bellBusy) return;
              void (async () => {
                setBellBusy(true);
                try {
                  const msg = on ? await enablePush() : await disablePush();
                  await registerPush();
                  setBell(pushState());
                  toast(msg);
                } finally {
                  setBellBusy(false);
                }
              })();
            }}
          />
        </div>
      </div>
      <p className={f.rowNote}>
        {bellBusy ? 'Working…' : PUSH_COPY[bell]}
      </p>

      {signedIn && !config.vapidPublicKey.trim() && (
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
          <p className={f.rowNote}>
            Needed once — set VITE_VAPID_PUBLIC_KEY in Cloudflare, or paste here.
          </p>
        </>
      )}

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
