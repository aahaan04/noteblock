import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';

const CrossfadePlayer = forwardRef(function CrossfadePlayer(
  { queue, vibeVideos, vibeEnabled, crossfadeSecs = 5,
    onMarkPlaying, onMarkPlayed, onNowPlaying, onVibeActive },
  ref
) {
  const [ytReady, setYtReady]     = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);       // reactive flag for overlay
  const [displayActive, setDisplayActive] = useState('A'); // which iframe is on top

  const pA = useRef(null);
  const pB = useRef(null);
  const readyCount  = useRef(0);
  const fadeRef     = useRef(null);
  const pollRef     = useRef(null);
  const initialized = useRef(false); // true once both onReady fired

  // All mutable playback state lives here — never causes stale closures
  const S = useRef({
    active: 'A',
    crossfading: false,
    mode: 'idle',          // 'idle' | 'requested' | 'vibe'
    current: null,
    next: null,
    vibeIdx: 0,
    queue: [],
    vibeVideos: [],
    vibeEnabled: false,
    crossfadeSecs: 5,
  });

  // Keep S in sync with props
  useEffect(() => { S.current.queue       = queue;       }, [queue]);
  useEffect(() => { S.current.vibeVideos  = vibeVideos;  }, [vibeVideos]);
  useEffect(() => { S.current.vibeEnabled = vibeEnabled; }, [vibeEnabled]);
  useEffect(() => { S.current.crossfadeSecs = crossfadeSecs; }, [crossfadeSecs]);

  // ── helpers ───────────────────────────────────────────────────────────────

  const getActive   = () => S.current.active === 'A' ? pA.current : pB.current;
  const getInactive = () => S.current.active === 'A' ? pB.current : pA.current;

  function getNextRequested(excludeId = null) {
    const pending = S.current.queue.filter(i => i.status === 'pending' && i.id !== excludeId);
    if (!pending.length) return null;
    const quick = pending.filter(i => i.play_type === 'quick');
    const item  = quick[0] ?? pending[0];
    return { type: 'requested', item, videoId: item.youtube_video_id, title: item.song_title };
  }

  function getNextVibe(afterIdx = null) {
    const vids = S.current.vibeVideos;
    if (!S.current.vibeEnabled || !vids.length) return null;
    const idx = afterIdx !== null ? (afterIdx + 1) % vids.length : S.current.vibeIdx;
    return { type: 'vibe', videoId: vids[idx].videoId, title: vids[idx].title ?? 'Vibe', vibeIdx: idx };
  }

  function computeNext(cur) {
    const req = getNextRequested(cur?.item?.id ?? null);
    if (req) return req;
    if (cur?.type === 'vibe') return getNextVibe(cur.vibeIdx);
    return getNextVibe(null);
  }

  function safePlay(player, videoId) {
    try { player.loadVideoById(videoId); player.unMute(); player.setVolume(100); } catch {}
  }

  function safeCue(player, videoId) {
    try { player.cueVideoById(videoId); player.unMute(); player.setVolume(0); } catch {}
  }

  // ── start a song (no crossfade) ───────────────────────────────────────────

  function startEntry(entry) {
    S.current.current = entry;
    S.current.mode    = entry.type;
    if (entry.type === 'vibe') S.current.vibeIdx = entry.vibeIdx ?? 0;

    safePlay(getActive(), entry.videoId);

    if (entry.type === 'requested') onMarkPlaying?.(entry.item.id);
    onNowPlaying?.(entry);
    onVibeActive?.(entry.type === 'vibe');
    setIsPlaying(true);

    const next = computeNext(entry);
    S.current.next = next;
    if (next) safeCue(getInactive(), next.videoId);
  }

  // ── crossfade to next song ────────────────────────────────────────────────

  function doCrossfade(targetEntry) {
    if (S.current.crossfading) return;
    S.current.crossfading = true;

    const outPlayer = getActive();
    const inPlayer  = getInactive();
    const entry     = targetEntry ?? S.current.next;

    if (entry) {
      try {
        inPlayer.loadVideoById(entry.videoId);
        inPlayer.unMute();
        inPlayer.setVolume(0);
        inPlayer.playVideo();
      } catch {}
    }

    const steps  = 40;
    const stepMs = ((S.current.crossfadeSecs ?? 5) * 1000) / steps;
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

      // Mark old item played
      const prev = S.current.current;
      if (prev?.type === 'requested') onMarkPlayed?.(prev.item.id);

      if (entry) {
        S.current.current = entry;
        S.current.mode    = entry.type;
        if (entry.type === 'vibe') S.current.vibeIdx = entry.vibeIdx ?? 0;
        if (entry.type === 'requested') onMarkPlaying?.(entry.item.id);
        onNowPlaying?.(entry);
        onVibeActive?.(entry.type === 'vibe');
        setIsPlaying(true);

        const afterNext = computeNext(entry);
        S.current.next = afterNext;
        if (afterNext) safeCue(getInactive(), afterNext.videoId);
      } else {
        S.current.current = null;
        S.current.next    = null;
        S.current.mode    = 'idle';
        onNowPlaying?.(null);
        onVibeActive?.(false);
        setIsPlaying(false);
      }
      S.current.crossfading = false;
    }, stepMs);
  }

  // ── song ended naturally ──────────────────────────────────────────────────

  function handleEnded(playerName) {
    if (playerName !== S.current.active || S.current.crossfading) return;
    const prev = S.current.current;
    if (prev?.type === 'requested') onMarkPlayed?.(prev.item.id);

    const next = S.current.next ?? computeNext(prev);
    if (next) {
      S.current.crossfading = false;
      const newActive = S.current.active === 'A' ? 'B' : 'A';
      S.current.active = newActive;
      setDisplayActive(newActive);
      S.current.current = next;
      S.current.mode    = next.type;
      if (next.type === 'vibe') S.current.vibeIdx = next.vibeIdx ?? 0;
      if (next.type === 'requested') onMarkPlaying?.(next.item.id);
      onNowPlaying?.(next);
      onVibeActive?.(next.type === 'vibe');
      setIsPlaying(true);
      try {
        const ap = newActive === 'A' ? pA.current : pB.current;
        ap?.unMute(); ap?.playVideo(); ap?.setVolume(100);
      } catch {}
      const afterNext = computeNext(next);
      S.current.next = afterNext;
      if (afterNext) safeCue(getInactive(), afterNext.videoId);
    } else {
      S.current.mode    = 'idle';
      S.current.current = null;
      S.current.next    = null;
      onNowPlaying?.(null);
      onVibeActive?.(false);
      setIsPlaying(false);
      if (S.current.vibeEnabled && S.current.vibeVideos.length) {
        const vibe = getNextVibe(null);
        if (vibe) startEntry(vibe);
      }
    }
  }

  function handleError(playerName) {
    if (playerName !== S.current.active) return;
    const next = S.current.next ?? computeNext(S.current.current);
    if (!next) return;
    try { getActive()?.stopVideo(); } catch {}
    const newActive = S.current.active === 'A' ? 'B' : 'A';
    S.current.active = newActive;
    setDisplayActive(newActive);
    try {
      const ap = newActive === 'A' ? pA.current : pB.current;
      ap?.loadVideoById(next.videoId); ap?.unMute(); ap?.setVolume(100);
    } catch {}
    S.current.current = next;
    S.current.mode    = next.type;
    S.current.next    = computeNext(next);
    if (S.current.next) safeCue(getInactive(), S.current.next.videoId);
  }

  // ── expose skip() / start() ───────────────────────────────────────────────

  useImperativeHandle(ref, () => ({
    skip() {
      if (S.current.crossfading) return;
      const prev = S.current.current;
      const next = S.current.next ?? computeNext(prev);
      if (next) {
        doCrossfade(next);
      } else {
        try { getActive()?.stopVideo(); } catch {}
        if (prev?.type === 'requested') onMarkPlayed?.(prev.item.id);
        S.current.current = null;
        S.current.next    = null;
        S.current.mode    = 'idle';
        onNowPlaying?.(null);
        onVibeActive?.(false);
        setIsPlaying(false);
      }
    },
    // Fallback manual start (e.g. if autoplay was blocked)
    start() {
      if (S.current.mode !== 'idle' || !initialized.current) return;
      const req = getNextRequested();
      if (req)  { startEntry(req);  return; }
      const vibe = getNextVibe(null);
      if (vibe) startEntry(vibe);
    },
    get isIdle() { return S.current.mode === 'idle'; },
  }));

  // ── load YouTube IFrame API ───────────────────────────────────────────────

  useEffect(() => {
    if (window.YT?.Player) { setYtReady(true); return; }
    window.onYouTubeIframeAPIReady = () => setYtReady(true);
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
    const poll = setInterval(() => {
      if (window.YT?.Player) { setYtReady(true); clearInterval(poll); }
    }, 200);
    return () => clearInterval(poll);
  }, []);

  // ── create players once API is ready ─────────────────────────────────────

  useEffect(() => {
    if (!ytReady) return;
    readyCount.current  = 0;
    initialized.current = false;

    const onPlayerReady = () => {
      readyCount.current++;
      if (readyCount.current < 2) return;

      initialized.current = true;

      // Auto-start immediately — no user gesture needed if autoplay is permitted
      const req = getNextRequested();
      if (req)  { startEntry(req);  }
      else if (S.current.vibeEnabled && S.current.vibeVideos.length) {
        const vibe = getNextVibe(null);
        if (vibe) startEntry(vibe);
      }

      // Poll: trigger crossfade when approaching end of song
      pollRef.current = setInterval(() => {
        if (!initialized.current || S.current.crossfading || S.current.mode === 'idle') return;
        const player = getActive();
        try {
          if (player?.getPlayerState?.() !== 1) return; // not playing
          const remaining = player.getDuration?.() - player.getCurrentTime?.();
          if (!remaining || remaining < 0) return;
          const threshold = S.current.crossfadeSecs ?? 5;
          if (remaining <= threshold && S.current.next) doCrossfade(null);
        } catch {}
      }, 500);
    };

    const makePlayer = (elId, name) =>
      new window.YT.Player(elId, {
        playerVars: { autoplay: 0, controls: 1, modestbranding: 1, rel: 0, playsinline: 1, enablejsapi: 1 },
        events: {
          onReady: onPlayerReady,
          onStateChange: (e) => { if (e.data === window.YT.PlayerState.ENDED) handleEnded(name); },
          onError:       ()  => handleError(name),
        },
      });

    pA.current = makePlayer('yt-player-a', 'A');
    pB.current = makePlayer('yt-player-b', 'B');

    return () => {
      clearInterval(pollRef.current);
      clearInterval(fadeRef.current);
      initialized.current = false;
      readyCount.current  = 0;
      try { pA.current?.destroy(); } catch {}
      try { pB.current?.destroy(); } catch {}
    };
  }, [ytReady]);

  // ── react to queue / vibe changes ────────────────────────────────────────

  useEffect(() => {
    if (!initialized.current) return;
    const { mode } = S.current;

    if (mode === 'idle') {
      const req = getNextRequested();
      if (req)  { startEntry(req); return; }
      if (vibeEnabled && vibeVideos.length) {
        startEntry({ type: 'vibe', videoId: vibeVideos[0].videoId, title: vibeVideos[0].title, vibeIdx: 0 });
      }
      return;
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
