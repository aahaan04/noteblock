import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';

// ── Silent audio keep-alive for iOS Safari / mobile background tabs ───────────
// iOS kills audio when the page is hidden unless an AudioContext is actively
// running. A near-silent (not true-zero — some browsers kill a true-zero buffer)
// 1-second looping buffer keeps the audio session alive. Must be triggered on
// a genuine user gesture (iOS requirement).
let sharedAudioCtx = null;
let silentSource   = null;

function startSilentLoop() {
  if (silentSource) return; // already running
  try {
    if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = sharedAudioCtx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, sampleRate, sampleRate); // 1-second buffer
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 0.000002 - 0.000001;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(ctx.destination);
    source.start();
    silentSource = source;
  } catch {}
}

function resumeAudioCtx() {
  try {
    if (sharedAudioCtx?.state === 'suspended') sharedAudioCtx.resume().catch(() => {});
  } catch {}
}

// iOS detection (iPadOS reports desktop UA but has maxTouchPoints > 1)
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const CrossfadePlayer = forwardRef(function CrossfadePlayer(
  { queue, vibeVideos, vibeEnabled, crossfadeSecs = 5, jukeboxPaused = false,
    vibePlayedIds = [], onMarkPlaying, onMarkPlayed, onNowPlaying, onVibeActive, onVibePlayed,
    venueId },
  ref
) {
  const [ytReady,       setYtReady]       = useState(false);
  const [isPlaying,     setIsPlaying]     = useState(false);
  const [displayActive, setDisplayActive] = useState('A');

  const pA          = useRef(null);
  const pB          = useRef(null);
  const readyCount  = useRef(0);
  const initialized = useRef(false);
  const audioUnlocked = useRef(false);
  const fadeRef     = useRef(null);
  const pollRef     = useRef(null);
  // Tracks whether music was actively playing when the page was last hidden
  const wasPlayingRef = useRef(false);
  // Last known video + position captured when the page goes to the background
  const hiddenStateRef = useRef(null);
  // AbortController that holds the current Web Lock (released on pause)
  const wakeLockCtrlRef = useRef(null);
  // Stores an entry to start as soon as the players finish initialising
  // (used by resumeFromSaved when called before YouTube API is ready)
  const pendingResumeRef = useRef(null);
  // Set when a resume lands before the players are ready — onReady picks it up
  const pendingStartRef = useRef(false);

  const S = useRef({
    active: 'A', crossfading: false, mode: 'idle',
    current: null, next: null, vibeIdx: 0,
    queue: [], vibeVideos: [], vibeEnabled: false, crossfadeSecs: 5,
    vibePlayedIds: new Set(),
  });

  useEffect(() => { S.current.queue        = queue;        }, [queue]);
  useEffect(() => { S.current.vibeVideos   = vibeVideos;  }, [vibeVideos]);
  useEffect(() => { S.current.vibeEnabled  = vibeEnabled; }, [vibeEnabled]);
  useEffect(() => { S.current.crossfadeSecs = crossfadeSecs; }, [crossfadeSecs]);
  useEffect(() => { S.current.vibePlayedIds = new Set(vibePlayedIds); }, [vibePlayedIds]);

  const getActive   = () => S.current.active === 'A' ? pA.current : pB.current;
  const getInactive = () => S.current.active === 'A' ? pB.current : pA.current;

  // ── Web Lock helpers (component-level so they share wakeLockCtrlRef) ───────

  function acquireWakeLock() {
    if (!navigator.locks?.request) return;
    releaseWakeLock();
    wakeLockCtrlRef.current = new AbortController();
    navigator.locks.request(
      'noteblock-audio-keepalive',
      { mode: 'shared', signal: wakeLockCtrlRef.current.signal },
      () => new Promise(() => {}) // hold until aborted
    ).catch(() => {}); // AbortError on release is expected
  }

  function releaseWakeLock() {
    if (wakeLockCtrlRef.current) {
      wakeLockCtrlRef.current.abort();
      wakeLockCtrlRef.current = null;
    }
  }

  function getNextRequested(excludeId = null) {
    const pending = S.current.queue.filter(i => i.status === 'pending' && i.id !== excludeId);
    if (!pending.length) return null;
    const item = pending.find(i => i.play_type === 'quick') ?? pending[0];
    return { type: 'requested', item, videoId: item.youtube_video_id, title: item.song_title };
  }

  function getNextVibe(afterIdx = null) {
    const vids = S.current.vibeVideos;
    if (!S.current.vibeEnabled || !vids.length) return null;

    const played = S.current.vibePlayedIds;
    const startIdx = afterIdx !== null ? (afterIdx + 1) % vids.length : S.current.vibeIdx;
    const ordered = [];
    for (let i = 0; i < vids.length; i++) {
      ordered.push(vids[(startIdx + i) % vids.length]);
    }

    const unplayed = ordered.filter(v => !played.has(v.videoId));
    if (unplayed.length) {
      const pick = unplayed[0];
      const idx = vids.indexOf(pick);
      return { type: 'vibe', videoId: pick.videoId, title: pick.title ?? 'Vibe', channel: pick.channel, vibeIdx: idx };
    }

    // All played — reset and start over
    S.current.vibePlayedIds = new Set();
    const pick = ordered[0];
    const idx = vids.indexOf(pick);
    return { type: 'vibe', videoId: pick.videoId, title: pick.title ?? 'Vibe', channel: pick.channel, vibeIdx: idx };
  }

  function computeNext(cur) {
    const req = getNextRequested(cur?.item?.id ?? null);
    if (req) return req;
    if (cur?.type === 'vibe') return getNextVibe(cur.vibeIdx);
    return getNextVibe(null);
  }

  function safeLoad(player, videoId) {
    try { player.loadVideoById(videoId); player.unMute(); player.setVolume(100); } catch {}
  }
  function safeCue(player, videoId) {
    try { player.cueVideoById(videoId); player.unMute(); player.setVolume(0); } catch {}
  }

  // ── start a song ──────────────────────────────────────────────────────────

  function startEntry(entry) {
    S.current.current = entry;
    S.current.mode    = entry.type;
    if (entry.type === 'vibe') S.current.vibeIdx = entry.vibeIdx ?? 0;
    safeLoad(getActive(), entry.videoId);
    if (entry.type === 'requested') onMarkPlaying?.(entry.item.id);
    onNowPlaying?.(entry);
    onVibeActive?.(entry.type === 'vibe');
    setIsPlaying(true);
    wasPlayingRef.current = true;
    const next = computeNext(entry);
    S.current.next = next;
    if (next) safeCue(getInactive(), next.videoId);
  }

  // ── crossfade ─────────────────────────────────────────────────────────────

  function doCrossfade(targetEntry) {
    if (S.current.crossfading) return;
    S.current.crossfading = true;
    const outPlayer = getActive();
    const inPlayer  = getInactive();
    const entry     = targetEntry ?? S.current.next;
    if (entry) {
      try { inPlayer.loadVideoById(entry.videoId); inPlayer.unMute(); inPlayer.setVolume(0); inPlayer.playVideo(); } catch {}
    }
    const steps = 40, stepMs = ((S.current.crossfadeSecs ?? 5) * 1000) / steps;
    let step = 0;
    clearInterval(fadeRef.current);
    fadeRef.current = setInterval(() => {
      step++;
      const t = step / steps;
      try { outPlayer?.setVolume(Math.round(100 * (1 - t))); } catch {}
      try { inPlayer?.setVolume(Math.round(100 * t));         } catch {}
      if (step < steps) return;
      clearInterval(fadeRef.current);
      try { outPlayer?.stopVideo(); outPlayer?.setVolume(100); } catch {}
      const newActive = S.current.active === 'A' ? 'B' : 'A';
      S.current.active = newActive;
      setDisplayActive(newActive);
      const prev = S.current.current;
      if (prev?.type === 'requested') onMarkPlayed?.(prev.item.id);
      if (prev?.type === 'vibe') onVibePlayed?.(prev.videoId);
      if (entry) {
        S.current.current = entry;
        S.current.mode    = entry.type;
        if (entry.type === 'vibe') S.current.vibeIdx = entry.vibeIdx ?? 0;
        if (entry.type === 'requested') onMarkPlaying?.(entry.item.id);
        onNowPlaying?.(entry);
        onVibeActive?.(entry.type === 'vibe');
        setIsPlaying(true);
        wasPlayingRef.current = true;
        const afterNext = computeNext(entry);
        S.current.next = afterNext;
        if (afterNext) safeCue(getInactive(), afterNext.videoId);
      } else {
        S.current.current = null; S.current.next = null; S.current.mode = 'idle';
        onNowPlaying?.(null); onVibeActive?.(false); setIsPlaying(false);
        wasPlayingRef.current = false;
      }
      S.current.crossfading = false;
    }, stepMs);
  }

  // ── song ended ────────────────────────────────────────────────────────────

  function handleEnded(playerName) {
    if (playerName !== S.current.active || S.current.crossfading) return;
    const prev = S.current.current;
    if (prev?.type === 'requested') onMarkPlayed?.(prev.item.id);
    if (prev?.type === 'vibe') onVibePlayed?.(prev.videoId);
    const next = S.current.next ?? computeNext(prev);
    if (next) {
      const newActive = S.current.active === 'A' ? 'B' : 'A';
      S.current.active = newActive; S.current.current = next; S.current.mode = next.type;
      if (next.type === 'vibe') S.current.vibeIdx = next.vibeIdx ?? 0;
      if (next.type === 'requested') onMarkPlaying?.(next.item.id);
      onNowPlaying?.(next); onVibeActive?.(next.type === 'vibe');
      setDisplayActive(newActive); setIsPlaying(true);
      wasPlayingRef.current = true;
      try { const ap = newActive === 'A' ? pA.current : pB.current; ap?.unMute(); ap?.playVideo(); ap?.setVolume(100); } catch {}
      const afterNext = computeNext(next);
      S.current.next = afterNext;
      if (afterNext) safeCue(getInactive(), afterNext.videoId);
    } else {
      S.current.mode = 'idle'; S.current.current = null; S.current.next = null;
      onNowPlaying?.(null); onVibeActive?.(false); setIsPlaying(false);
      wasPlayingRef.current = false;
      const vibe = getNextVibe(null);
      if (vibe) startEntry(vibe);
    }
  }

  function handleError(playerName) {
    if (playerName !== S.current.active) return;
    const next = S.current.next ?? computeNext(S.current.current);
    if (!next) return;
    try { getActive()?.stopVideo(); } catch {}
    const newActive = S.current.active === 'A' ? 'B' : 'A';
    S.current.active = newActive; S.current.current = next; S.current.mode = next.type;
    setDisplayActive(newActive);
    try { const ap = newActive === 'A' ? pA.current : pB.current; ap?.loadVideoById(next.videoId); ap?.unMute(); ap?.setVolume(100); } catch {}
    S.current.next = computeNext(next);
    if (S.current.next) safeCue(getInactive(), S.current.next.videoId);
  }

  // ── ref API ───────────────────────────────────────────────────────────────

  useImperativeHandle(ref, () => ({
    start() {
      if (!initialized.current || S.current.mode !== 'idle') return;
      beginPlayback();
    },
    skip() {
      if (S.current.crossfading) return;
      const prev = S.current.current;
      const next = S.current.next ?? computeNext(prev);
      if (next) {
        doCrossfade(next);
      } else {
        try { getActive()?.stopVideo(); } catch {}
        if (prev?.type === 'requested') onMarkPlayed?.(prev.item.id);
        if (prev?.type === 'vibe') onVibePlayed?.(prev.videoId);
        S.current.current = null; S.current.next = null; S.current.mode = 'idle';
        onNowPlaying?.(null); onVibeActive?.(false); setIsPlaying(false);
        wasPlayingRef.current = false;
      }
    },
    // Returns elapsed seconds of the currently-playing video (for state save)
    getElapsed() {
      try { return getActive()?.getCurrentTime?.() ?? 0; } catch { return 0; }
    },
    // Android Chrome restore: play a saved video, seeking to the saved position.
    // Uses 'vibe' type so it integrates naturally with the queue/vibe state machine.
    resumeFromSaved({ videoId, title, elapsed = 0 }) {
      audioUnlocked.current = true;
      startSilentLoop();
      acquireWakeLock();
      const entry = { type: 'vibe', videoId, title: title ?? 'Song', vibeIdx: 0 };
      if (initialized.current && S.current.mode === 'idle') {
        startEntry(entry);
        if (elapsed > 2) {
          setTimeout(() => { try { getActive()?.seekTo(elapsed, true); } catch {} }, 2500);
        }
      } else {
        // Players not ready yet — queue for when they initialise
        pendingResumeRef.current = { entry, elapsed };
      }
    },
    get isIdle() { return S.current.mode === 'idle'; },
  }));

  // ── pause / resume when host toggles jukebox (with fade) ─────────────────

  const pauseFadeRef = useRef(null);

  function fadeOutAndPause(durationMs = 1500) {
    const player = getActive();
    if (!player) return;
    clearInterval(pauseFadeRef.current);
    let vol = 100;
    const steps = 30;
    const stepMs = durationMs / steps;
    const decrement = 100 / steps;
    pauseFadeRef.current = setInterval(() => {
      vol = Math.max(0, vol - decrement);
      try { player.setVolume(Math.round(vol)); } catch {}
      if (vol <= 0) {
        clearInterval(pauseFadeRef.current);
        try { player.pauseVideo(); } catch {}
      }
    }, stepMs);
  }

  function fadeInOnResume(durationMs = 800) {
    const player = getActive();
    if (!player) return;
    clearInterval(pauseFadeRef.current);
    try { player.setVolume(0); player.playVideo(); player.unMute(); } catch {}
    let vol = 0;
    const steps = 20;
    const stepMs = durationMs / steps;
    const increment = 100 / steps;
    pauseFadeRef.current = setInterval(() => {
      vol = Math.min(100, vol + increment);
      try { player.setVolume(Math.round(vol)); } catch {}
      if (vol >= 100) clearInterval(pauseFadeRef.current);
    }, stepMs);
  }

  // Previous jukeboxPaused value, so a genuine pause -> resume transition can
  // be told apart from this effect's ordinary run on mount. Without that
  // distinction the "resume while idle" branch below would auto-start
  // playback on every page load, with no user gesture behind it.
  const prevPausedRef = useRef(jukeboxPaused);

  // Begins playback from a standing start (queue first, then vibe). Shared by
  // the imperative start() and by resuming out of a paused-and-idle state.
  function beginPlayback() {
    audioUnlocked.current = true;
    startSilentLoop();
    acquireWakeLock();
    const req = getNextRequested();
    if (req) { startEntry(req); return; }
    const vibe = getNextVibe(null);
    if (vibe) startEntry(vibe);
  }

  useEffect(() => {
    const wasPaused = prevPausedRef.current;
    prevPausedRef.current = jukeboxPaused;

    if (jukeboxPaused) {
      if (!initialized.current || !audioUnlocked.current) return; // nothing playing to fade out
      clearInterval(pauseFadeRef.current);
      fadeOutAndPause(1500);
      wasPlayingRef.current = false;
      releaseWakeLock(); // no background work needed while paused
      return;
    }

    // Only react to an actual paused -> resumed transition.
    if (!wasPaused) return;

    // Players not up yet (host hit Resume before the YouTube API finished
    // loading) — hand off to onReady rather than dropping the resume.
    if (!initialized.current) { pendingStartRef.current = true; return; }

    clearInterval(pauseFadeRef.current);
    if (S.current.mode !== 'idle') {
      fadeInOnResume(800);
      wasPlayingRef.current = true;
      acquireWakeLock(); // signal active playback to the browser
    } else {
      // Idle at resume time means the player remounted while the venue was
      // still paused in the DB (page reload, or a mobile tab the OS killed).
      // The Start button is hidden whenever the venue is paused, so Resume is
      // the only control the host has — it has to actually begin playback
      // here, otherwise the click appears to do nothing at all.
      beginPlayback();
    }
  }, [jukeboxPaused]); // eslint-disable-line

  // ── Mobile background audio keep-alive ───────────────────────────────────

  useEffect(() => {
    acquireWakeLock();

    // Start silent loop on first tap anywhere (iOS requires a gesture)
    const onFirstGesture = () => {
      startSilentLoop();
      document.removeEventListener('touchstart', onFirstGesture);
      document.removeEventListener('click', onFirstGesture);
    };
    document.addEventListener('touchstart', onFirstGesture, { passive: true });
    document.addEventListener('click', onFirstGesture, { passive: true });

    function handleVisibilityChange() {
      if (document.hidden) {
        // Capture current playback state for potential recovery on return
        if (S.current.current?.videoId) {
          try {
            const elapsed = getActive()?.getCurrentTime?.() ?? 0;
            hiddenStateRef.current = { videoId: S.current.current.videoId, elapsed };
            // Persist to localStorage so Android Chrome can restore if the tab is killed
            if (venueId) {
              const title = S.current.current.type === 'requested'
                ? (S.current.current.item?.song_title ?? 'Song')
                : (S.current.current.title ?? 'Song');
              localStorage.setItem(`nb_session_${venueId}`, JSON.stringify({
                videoId: S.current.current.videoId,
                title,
                elapsed,
                timestamp: Date.now(),
              }));
            }
          } catch {}
        }
        return;
      }

      // Returning to foreground
      resumeAudioCtx(); // re-activate AudioContext first (iOS requirement)

      if (!wasPlayingRef.current || !initialized.current || S.current.crossfading) return;

      const doResume = () => {
        const player = getActive();
        if (!player) return;
        try {
          const state = player.getPlayerState?.();
          // -1=unstarted, 0=ended, 2=paused, 5=cued — player lost its video on iOS
          if (state === -1 || state === 0 || state === 5) {
            const hs = hiddenStateRef.current;
            if (hs?.videoId) {
              // Reload from last known position so playback resumes seamlessly
              player.loadVideoById({ videoId: hs.videoId, startSeconds: Math.max(0, hs.elapsed - 1) });
              player.unMute();
              player.setVolume(100);
            }
          } else {
            player.playVideo();
          }
        } catch {}
      };

      if (isIOS) {
        // iOS needs the AudioContext to settle before YouTube audio can play
        setTimeout(doResume, 300);
      } else {
        doResume();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('touchstart', onFirstGesture);
      document.removeEventListener('click', onFirstGesture);
      releaseWakeLock();
    };
  }, []); // eslint-disable-line

  // ── load YouTube IFrame API ───────────────────────────────────────────────

  useEffect(() => {
    if (window.YT?.Player) { setYtReady(true); return; }
    window.onYouTubeIframeAPIReady = () => setYtReady(true);
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
    const poll = setInterval(() => { if (window.YT?.Player) { setYtReady(true); clearInterval(poll); } }, 200);
    return () => clearInterval(poll);
  }, []);

  // ── create players once API ready ─────────────────────────────────────────

  useEffect(() => {
    if (!ytReady) return;
    readyCount.current = 0; initialized.current = false;

    const makePlayer = (elId, name) => new window.YT.Player(elId, {
      playerVars: { autoplay: 0, controls: 1, modestbranding: 1, rel: 0, playsinline: 1, enablejsapi: 1 },
      events: {
        onReady: () => {
          readyCount.current++;
          if (readyCount.current < 2) return;
          initialized.current = true;
          // If resumeFromSaved was called before the players were ready, fire it now
          if (pendingResumeRef.current) {
            const { entry, elapsed } = pendingResumeRef.current;
            pendingResumeRef.current = null;
            startEntry(entry);
            if (elapsed > 2) {
              setTimeout(() => { try { getActive()?.seekTo(elapsed, true); } catch {} }, 2500);
            }
          } else if (pendingStartRef.current) {
            // Host hit Resume while the players were still loading.
            pendingStartRef.current = false;
            if (S.current.mode === 'idle') beginPlayback();
          }
          pollRef.current = setInterval(() => {
            if (!audioUnlocked.current || S.current.crossfading || S.current.mode === 'idle') return;
            try {
              const player = getActive();
              if (player?.getPlayerState?.() !== 1) return;
              const remaining = (player.getDuration?.() ?? 0) - (player.getCurrentTime?.() ?? 0);
              if (remaining > 0 && remaining <= (S.current.crossfadeSecs ?? 5) && S.current.next) doCrossfade(null);
            } catch {}
          }, 500);
        },
        onStateChange: (e) => { if (e.data === window.YT.PlayerState.ENDED) handleEnded(name); },
        onError:       ()  => handleError(name),
      },
    });

    pA.current = makePlayer('yt-player-a', 'A');
    pB.current = makePlayer('yt-player-b', 'B');

    return () => {
      clearInterval(pollRef.current); clearInterval(fadeRef.current);
      initialized.current = false; audioUnlocked.current = false; readyCount.current = 0;
      try { pA.current?.destroy(); } catch {}
      try { pB.current?.destroy(); } catch {}
    };
  }, [ytReady]);

  // ── react to queue / vibe changes ────────────────────────────────────────

  useEffect(() => {
    if (!initialized.current || !audioUnlocked.current) return;
    const { mode } = S.current;

    if (mode === 'idle') {
      const req = getNextRequested();
      if (req) { startEntry(req); return; }
      const vibe = getNextVibe(null);
      if (vibe) { startEntry(vibe); return; }
    }
    if (mode === 'vibe' && !S.current.crossfading) {
      const req = getNextRequested();
      if (req) { doCrossfade(req); return; }
    }
    if (mode === 'requested') {
      const next = computeNext(S.current.current);
      if (next?.videoId !== S.current.next?.videoId) {
        S.current.next = next;
        if (next) safeCue(getInactive(), next.videoId);
      }
    }
  }, [queue, vibeEnabled, vibeVideos]); // eslint-disable-line

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', background: '#111', borderRadius: 12, overflow: 'hidden' }}>
      <div id="yt-player-a" style={{ position: 'absolute', inset: 0, opacity: displayActive === 'A' && isPlaying ? 1 : 0, transition: `opacity ${crossfadeSecs}s linear`, pointerEvents: displayActive === 'A' ? 'auto' : 'none' }} />
      <div id="yt-player-b" style={{ position: 'absolute', inset: 0, opacity: displayActive === 'B' && isPlaying ? 1 : 0, transition: `opacity ${crossfadeSecs}s linear`, pointerEvents: displayActive === 'B' ? 'auto' : 'none' }} />
      {(!ytReady || !isPlaying) && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#555', fontSize: 13, background: '#111', pointerEvents: 'none' }}>
          <span style={{ fontSize: 36 }}>🎵</span>
          <span>{!ytReady ? 'Loading player…' : 'No song playing'}</span>
        </div>
      )}
    </div>
  );
});

export default CrossfadePlayer;
