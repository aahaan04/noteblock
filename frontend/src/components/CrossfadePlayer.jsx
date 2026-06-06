import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';

const POLL_MS = 500;

/**
 * CrossfadePlayer manages two YouTube IFrame players (A and B) for
 * seamless gapless crossfade between requested songs and vibe mode.
 *
 * Props:
 *   queue         – array of queue_items with status 'pending'|'playing' (sorted by priority)
 *   vibeVideos    – array of { videoId, title } for vibe mode
 *   vibeEnabled   – boolean
 *   crossfadeSecs – number (2–10)
 *   onMarkPlaying – (itemId) => void
 *   onMarkPlayed  – (itemId) => void
 *   onNowPlaying  – ({ type: 'requested'|'vibe', item?, videoId?, title? }) => void
 *   onVibeActive  – (boolean) => void
 */
const CrossfadePlayer = forwardRef(function CrossfadePlayer(
  { queue, vibeVideos, vibeEnabled, crossfadeSecs = 5,
    onMarkPlaying, onMarkPlayed, onNowPlaying, onVibeActive },
  ref
) {
  const [ytReady, setYtReady] = useState(false);
  const [playersReady, setPlayersReady] = useState(false); // true only after YT.Player instances exist
  const [displayActive, setDisplayActive] = useState('A'); // which iframe is visible

  // Player refs
  const pA = useRef(null);
  const pB = useRef(null);

  // Mutable state (avoids stale closures in setInterval)
  const S = useRef({
    active: 'A',            // 'A' | 'B'
    crossfading: false,
    mode: 'idle',           // 'idle' | 'requested' | 'vibe'
    current: null,          // { type, item?, videoId, title?, vibeIdx? }
    next: null,             // same shape — pre-loaded in inactive player
    vibeIdx: 0,
    queue: [],
    vibeVideos: [],
    vibeEnabled: false,
    crossfadeSecs: 5,
  });

  // Keep mutable refs in sync
  useEffect(() => { S.current.queue = queue; }, [queue]);
  useEffect(() => { S.current.vibeVideos = vibeVideos; }, [vibeVideos]);
  useEffect(() => { S.current.vibeEnabled = vibeEnabled; }, [vibeEnabled]);
  useEffect(() => { S.current.crossfadeSecs = crossfadeSecs; }, [crossfadeSecs]);

  const getActive = () => S.current.active === 'A' ? pA.current : pB.current;
  const getInactive = () => S.current.active === 'A' ? pB.current : pA.current;

  // ── helpers ──────────────────────────────────────────────────────────────

  function getNextRequested(excludeId = null) {
    const pending = S.current.queue.filter(
      i => i.status === 'pending' && i.id !== excludeId
    );
    if (!pending.length) return null;
    // Quick play first, then FIFO
    const quick = pending.filter(i => i.play_type === 'quick');
    const normal = pending.filter(i => i.play_type !== 'quick');
    const item = quick[0] ?? normal[0];
    return { type: 'requested', item, videoId: item.youtube_video_id, title: item.song_title };
  }

  function getNextVibe(afterIdx = null) {
    const vids = S.current.vibeVideos;
    if (!S.current.vibeEnabled || !vids.length) return null;
    const idx = afterIdx !== null ? (afterIdx + 1) % vids.length : S.current.vibeIdx;
    const v = vids[idx];
    return { type: 'vibe', videoId: v.videoId, title: v.title ?? 'Vibe', vibeIdx: idx };
  }

  function computeNext(currentEntry) {
    // What plays after currentEntry?
    const currentItemId = currentEntry?.item?.id ?? null;
    const req = getNextRequested(currentItemId);
    if (req) return req;
    if (currentEntry?.type === 'vibe') {
      return getNextVibe(currentEntry.vibeIdx);
    }
    return getNextVibe(null);
  }

  function preloadInto(player, entry) {
    if (!player || !entry) return;
    try {
      player.cueVideoById(entry.videoId);
      player.setVolume(0);
    } catch {}
  }

  function playEntry(player, entry) {
    if (!player || !entry) return;
    try {
      player.loadVideoById(entry.videoId);
      player.setVolume(100);
    } catch {}
  }

  // ── start playing (no crossfade) ─────────────────────────────────────────

  function startEntry(entry) {
    S.current.current = entry;
    S.current.mode = entry.type;
    if (entry.type === 'vibe') S.current.vibeIdx = entry.vibeIdx ?? 0;

    playEntry(getActive(), entry);

    if (entry.type === 'requested') {
      onMarkPlaying?.(entry.item.id);
    }
    onNowPlaying?.(entry);
    onVibeActive?.(entry.type === 'vibe');

    // Pre-load next into inactive
    const next = computeNext(entry);
    S.current.next = next;
    preloadInto(getInactive(), next);
  }

  // ── crossfade ────────────────────────────────────────────────────────────

  const fadeRef = useRef(null);

  function doCrossfade(targetEntry) {
    if (S.current.crossfading) return;
    S.current.crossfading = true;

    const outPlayer = getActive();
    const inPlayer = getInactive();

    if (targetEntry) {
      // Load and start the incoming player
      try {
        inPlayer.loadVideoById(targetEntry.videoId);
        inPlayer.setVolume(0);
        inPlayer.playVideo();
      } catch {}
    }

    const duration = (S.current.crossfadeSecs ?? 5) * 1000;
    const steps = 40;
    const stepMs = duration / steps;
    let step = 0;

    clearInterval(fadeRef.current);
    fadeRef.current = setInterval(() => {
      step++;
      const progress = step / steps;
      try { outPlayer?.setVolume(Math.round(100 * (1 - progress))); } catch {}
      try { inPlayer?.setVolume(Math.round(100 * progress)); } catch {}

      if (step >= steps) {
        clearInterval(fadeRef.current);

        // Stop old player
        try { outPlayer?.stopVideo(); outPlayer?.setVolume(100); } catch {}

        // Swap active
        const newActive = S.current.active === 'A' ? 'B' : 'A';
        S.current.active = newActive;
        setDisplayActive(newActive);

        // Mark old item played
        const prev = S.current.current;
        if (prev?.type === 'requested' && prev.item) {
          onMarkPlayed?.(prev.item.id);
        }

        // Advance state
        const incoming = targetEntry ?? S.current.next;
        if (incoming) {
          S.current.current = incoming;
          S.current.mode = incoming.type;
          if (incoming.type === 'vibe') S.current.vibeIdx = incoming.vibeIdx ?? 0;
          if (incoming.type === 'requested') onMarkPlaying?.(incoming.item.id);
          onNowPlaying?.(incoming);
          onVibeActive?.(incoming.type === 'vibe');

          // Pre-load after-next into now-inactive player
          const afterNext = computeNext(incoming);
          S.current.next = afterNext;
          preloadInto(getInactive(), afterNext);
        } else {
          S.current.current = null;
          S.current.next = null;
          S.current.mode = 'idle';
          onNowPlaying?.(null);
          onVibeActive?.(false);
        }

        S.current.crossfading = false;
      }
    }, stepMs);
  }

  // ── expose skip() to parent via ref ──────────────────────────────────────

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
        S.current.next = null;
        S.current.mode = 'idle';
        onNowPlaying?.(null);
        onVibeActive?.(false);
      }
    },
    // Call this from a click handler so the browser allows autoplay
    start() {
      if (S.current.mode !== 'idle') return;
      const next = getNextRequested() ?? getNextVibe(null);
      if (next) startEntry(next);
    },
    get isIdle() { return S.current.mode === 'idle'; },
  }));

  // ── poll: trigger crossfade when near end ─────────────────────────────────

  const pollRef = useRef(null);

  useEffect(() => {
    if (!playersReady) return;
    pollRef.current = setInterval(() => {
      if (S.current.crossfading || S.current.mode === 'idle') return;
      const player = getActive();
      if (!player) return;
      try {
        if (player.getPlayerState?.() !== 1 /* PLAYING */) return;
        const cur = player.getCurrentTime?.();
        const dur = player.getDuration?.();
        if (!dur || dur < 3) return;
        const remaining = dur - cur;
        const threshold = S.current.crossfadeSecs ?? 5;
        if (remaining <= threshold && remaining > 0 && S.current.next) {
          doCrossfade(null); // use pre-loaded next
        }
      } catch {}
    }, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [playersReady]);

  // ── watch queue/vibe changes ──────────────────────────────────────────────

  useEffect(() => {
    if (!playersReady) return;

    const { mode, crossfading } = S.current;
    const pendingItems = queue.filter(i => i.status === 'pending');

    if (mode === 'idle') {
      // Nothing playing — start something
      const req = getNextRequested();
      if (req) { startEntry(req); return; }
      if (vibeEnabled && vibeVideos.length > 0) {
        startEntry({ type: 'vibe', videoId: vibeVideos[0].videoId, title: vibeVideos[0].title, vibeIdx: 0 });
        return;
      }
      return;
    }

    if (mode === 'vibe' && pendingItems.length > 0 && !crossfading) {
      // New song arrived while in vibe — crossfade to it immediately
      const req = getNextRequested();
      if (req) doCrossfade(req);
      return;
    }

    if (mode === 'requested') {
      // Update pre-loaded next in case queue changed
      const next = computeNext(S.current.current);
      if (next?.videoId !== S.current.next?.videoId) {
        S.current.next = next;
        preloadInto(getInactive(), next);
      }
    }
  }, [queue, vibeEnabled, vibeVideos, playersReady]);

  // ── handle song naturally ending ──────────────────────────────────────────

  function handleEnded(playerName) {
    if (playerName !== S.current.active) return;
    if (S.current.crossfading) return;

    const prev = S.current.current;
    if (prev?.type === 'requested') onMarkPlayed?.(prev.item.id);

    const next = S.current.next ?? computeNext(prev);
    if (next) {
      S.current.current = null; // avoid double-mark
      S.current.crossfading = false;

      // Hard cut (no fade) — crossfade should have already triggered via poll
      const newActive = S.current.active === 'A' ? 'B' : 'A';
      S.current.active = newActive;
      setDisplayActive(newActive);
      S.current.current = next;
      S.current.mode = next.type;
      if (next.type === 'vibe') S.current.vibeIdx = next.vibeIdx ?? 0;
      if (next.type === 'requested') onMarkPlaying?.(next.item.id);
      onNowPlaying?.(next);
      onVibeActive?.(next.type === 'vibe');

      // Start inactive (now active) player
      try {
        const ap = S.current.active === 'A' ? pA.current : pB.current;
        ap?.playVideo();
        ap?.setVolume(100);
      } catch {}

      const afterNext = computeNext(next);
      S.current.next = afterNext;
      preloadInto(getInactive(), afterNext);
    } else {
      S.current.mode = 'idle';
      S.current.current = null;
      onNowPlaying?.(null);
      onVibeActive?.(false);

      // Check if vibe should start
      if (S.current.vibeEnabled && S.current.vibeVideos.length > 0) {
        const entry = getNextVibe(null);
        if (entry) startEntry(entry);
      }
    }
  }

  function handleError(playerName) {
    if (playerName !== S.current.active) return;
    // Skip to next on error
    const next = S.current.next ?? computeNext(S.current.current);
    if (next) {
      const outPlayer = getActive();
      try { outPlayer?.stopVideo(); } catch {}
      const newActive = S.current.active === 'A' ? 'B' : 'A';
      S.current.active = newActive;
      setDisplayActive(newActive);
      const ap = S.current.active === 'A' ? pA.current : pB.current;
      try { ap?.loadVideoById(next.videoId); ap?.setVolume(100); } catch {}
      S.current.current = next;
      S.current.mode = next.type;
      const afterNext = computeNext(next);
      S.current.next = afterNext;
      preloadInto(getInactive(), afterNext);
    }
  }

  // ── YouTube IFrame API ────────────────────────────────────────────────────

  useEffect(() => {
    if (window.YT?.Player) { setYtReady(true); return; }

    window.onYouTubeIframeAPIReady = () => setYtReady(true);

    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }

    // Fallback: poll in case the callback already fired before we registered it
    const poll = setInterval(() => {
      if (window.YT?.Player) { setYtReady(true); clearInterval(poll); }
    }, 200);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    if (!ytReady) return;

    let readyCount = 0;
    const onPlayerReady = () => {
      readyCount++;
      if (readyCount >= 2) setPlayersReady(true); // both players initialised
    };

    const makePlayer = (elementId, playerName) =>
      new window.YT.Player(elementId, {
        playerVars: {
          autoplay: 0, controls: 1, modestbranding: 1,
          rel: 0, playsinline: 1, enablejsapi: 1, fs: 1,
        },
        events: {
          onReady: onPlayerReady,
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.ENDED) handleEnded(playerName);
          },
          onError: () => handleError(playerName),
        },
      });

    pA.current = makePlayer('yt-player-a', 'A');
    pB.current = makePlayer('yt-player-b', 'B');

    return () => {
      setPlayersReady(false);
      readyCount = 0;
      clearInterval(fadeRef.current);
      try { pA.current?.destroy(); } catch {}
      try { pB.current?.destroy(); } catch {}
    };
  }, [ytReady]);

  // ── render ────────────────────────────────────────────────────────────────

  const isIdle = S.current.mode === 'idle';

  return (
    <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', background: '#111', borderRadius: 12, overflow: 'hidden' }}>
      {/* Player A */}
      <div
        id="yt-player-a"
        style={{
          position: 'absolute', inset: 0,
          opacity: displayActive === 'A' && !isIdle ? 1 : 0,
          transition: `opacity ${crossfadeSecs}s linear`,
          pointerEvents: displayActive === 'A' ? 'auto' : 'none',
        }}
      />
      {/* Player B */}
      <div
        id="yt-player-b"
        style={{
          position: 'absolute', inset: 0,
          opacity: displayActive === 'B' && !isIdle ? 1 : 0,
          transition: `opacity ${crossfadeSecs}s linear`,
          pointerEvents: displayActive === 'B' ? 'auto' : 'none',
        }}
      />
      {/* Overlay: loading or idle */}
      {(!ytReady || isIdle) && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 8, color: '#666', fontSize: 13,
          background: '#111',
        }}>
          <span style={{ fontSize: 32 }}>🎵</span>
          <span>{!ytReady ? 'Loading player…' : 'No song playing'}</span>
        </div>
      )}
    </div>
  );
});

export default CrossfadePlayer;
