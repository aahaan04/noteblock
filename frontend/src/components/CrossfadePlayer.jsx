import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';

// ── Silent audio keep-alive for iOS Safari / mobile background tabs ───────────
// iOS kills audio when the page is hidden unless an AudioContext is actively
// running. We create a near-silent 1-second looping buffer to keep the audio
// session alive. Must be started on first user gesture (iOS requirement).
let sharedAudioCtx = null;
let silentSource   = null;

function startSilentLoop() {
  if (silentSource) return; // already running
  try {
    if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = sharedAudioCtx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, sampleRate, sampleRate); // 1-second silent buffer
    // near-silent (not completely silent — some browsers kill a true-zero buffer)
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

// ── Web Lock API keep-alive ───────────────────────────────────────────────────
// Requests a Web Lock that never releases, signalling to the browser that this
// page has ongoing work and should not be throttled/suspended in the background.
function acquireWakeLock() {
  if (!navigator.locks?.request) return;
  navigator.locks.request('noteblock-audio-keepalive', { mode: 'shared' }, () =>
    new Promise(() => {}) // never resolves — holds the lock indefinitely
  );
}

const CrossfadePlayer = forwardRef(function CrossfadePlayer(
  { queue, vibeVideos, vibeEnabled, crossfadeSecs = 5, jukeboxPaused = false,
    vibePlayedIds = [], onMarkPlaying, onMarkPlayed, onNowPlaying, onVibeActive, onVibePlayed },
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
  // Track whether music was playing when page was hidden so we can resume
  const wasPlayingRef = useRef(false);

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

    // Build ordered candidate list starting after afterIdx
    const startIdx = afterIdx !== null ? (afterIdx + 1) % vids.length : S.current.vibeIdx;
    const ordered = [];
    for (let i = 0; i < vids.length; i++) {
      ordered.push(vids[(startIdx + i) % vids.length]);
    }

    // Pick first unplayed
    const unplayed = ordered.filter(v => !played.has(v.videoId));
    if (unplayed.length) {
      const pick = unplayed[0];
      const idx = vids.indexOf(pick);
      return { type: 'vibe', videoId: pick.videoId, title: pick.title ?? 'Vibe', channel: pick.channel, vibeIdx: idx };
    }

    // All played — reset and pick from beginning
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
      // Auto-start vibe if enabled — audio already unlocked at this point
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
      audioUnlocked.current = true;
      startSilentLoop(); // start keep-alive on first user-initiated play
      const req = getNextRequested();
      if (req)  { startEntry(req);  return; }
      const vibe = getNextVibe(null);
      if (vibe) startEntry(vibe);
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
    get isIdle() { return S.current.mode === 'idle'; },
  }));

  // ── pause / resume when host toggles jukebox ──────────────────────────────

  useEffect(() => {
    if (!initialized.current || !audioUnlocked.current) return;
    if (jukeboxPaused) {
      try { getActive()?.pauseVideo(); } catch {}
      wasPlayingRef.current = false;
    } else if (S.current.mode !== 'idle') {
      try { getActive()?.playVideo(); getActive()?.unMute(); getActive()?.setVolume(100); } catch {}
      wasPlayingRef.current = true;
    }
  }, [jukeboxPaused]); // eslint-disable-line

  // ── Mobile background audio keep-alive ───────────────────────────────────
  // visibilitychange: resume playback if the page was visible and playing when hidden
  // Web Lock: prevent browser from throttling this tab in background
  useEffect(() => {
    acquireWakeLock();

    // Start silent loop on first tap (iOS needs a gesture before AudioContext)
    const onFirstGesture = () => {
      startSilentLoop();
      document.removeEventListener('touchstart', onFirstGesture);
      document.removeEventListener('click', onFirstGesture);
    };
    document.addEventListener('touchstart', onFirstGesture, { passive: true });
    document.addEventListener('click', onFirstGesture, { passive: true });

    function handleVisibilityChange() {
      if (document.hidden) return; // page going to background — nothing to do
      // Page came back to foreground
      resumeAudioCtx();
      if (wasPlayingRef.current && initialized.current && !S.current.crossfading) {
        try { getActive()?.playVideo(); } catch {}
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('touchstart', onFirstGesture);
      document.removeEventListener('click', onFirstGesture);
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

    // If idle, try to start something
    if (mode === 'idle') {
      const req = getNextRequested();
      if (req) { startEntry(req); return; }
      const vibe = getNextVibe(null);
      if (vibe) { startEntry(vibe); return; }
    }
    // If vibe and a song arrives, crossfade into it
    if (mode === 'vibe' && !S.current.crossfading) {
      const req = getNextRequested();
      if (req) { doCrossfade(req); return; }
    }
    // Update preloaded next
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
