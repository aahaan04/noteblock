import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';

/**
 * SimplePlayer — renders a YouTube embed iframe for the current song.
 * Exposes start() and skip() via ref so VenueControl can trigger them
 * from user-gesture click handlers (required for browser autoplay).
 */
const CrossfadePlayer = forwardRef(function CrossfadePlayer(
  { queue, vibeVideos, vibeEnabled, crossfadeSecs = 5,
    onMarkPlaying, onMarkPlayed, onNowPlaying, onVibeActive },
  ref
) {
  const [currentEntry, setCurrentEntry] = useState(null);

  // Keep a ref so imperative methods always see the latest values
  const stateRef = useRef({ currentEntry: null, queue: [], vibeVideos: [], vibeEnabled: false });
  useEffect(() => { stateRef.current.queue = queue; }, [queue]);
  useEffect(() => { stateRef.current.vibeVideos = vibeVideos; }, [vibeVideos]);
  useEffect(() => { stateRef.current.vibeEnabled = vibeEnabled; }, [vibeEnabled]);
  useEffect(() => { stateRef.current.currentEntry = currentEntry; }, [currentEntry]);

  function getNextRequested(excludeId = null) {
    const pending = stateRef.current.queue.filter(
      i => i.status === 'pending' && i.id !== excludeId
    );
    if (!pending.length) return null;
    const quick = pending.filter(i => i.play_type === 'quick');
    const normal = pending.filter(i => i.play_type !== 'quick');
    const item = quick[0] ?? normal[0];
    return { type: 'requested', item, videoId: item.youtube_video_id, title: item.song_title };
  }

  function getNextVibe(afterIdx = null) {
    const vids = stateRef.current.vibeVideos;
    if (!stateRef.current.vibeEnabled || !vids.length) return null;
    const idx = afterIdx !== null ? (afterIdx + 1) % vids.length : 0;
    return { type: 'vibe', videoId: vids[idx].videoId, title: vids[idx].title ?? 'Vibe', vibeIdx: idx };
  }

  function playEntry(entry) {
    if (!entry) return;
    setCurrentEntry(entry);
    if (entry.type === 'requested') {
      onMarkPlaying?.(entry.item.id);
    }
    onNowPlaying?.(entry);
    onVibeActive?.(entry.type === 'vibe');
  }

  // When queue changes and we're idle, don't auto-start (requires user gesture).
  // The Start button in VenueControl calls start() explicitly.

  // If currently playing a vibe and a song arrives, switch to it
  useEffect(() => {
    const cur = stateRef.current.currentEntry;
    if (!cur || cur.type !== 'vibe') return;
    const req = getNextRequested();
    if (req) playEntry(req);
  }, [queue]); // eslint-disable-line

  useImperativeHandle(ref, () => ({
    start() {
      const cur = stateRef.current.currentEntry;
      if (cur) return; // already playing
      const req = getNextRequested();
      if (req) { playEntry(req); return; }
      if (stateRef.current.vibeEnabled) {
        const vibe = getNextVibe(null);
        if (vibe) playEntry(vibe);
      }
    },
    skip() {
      const cur = stateRef.current.currentEntry;
      // Mark current as played
      if (cur?.type === 'requested') onMarkPlayed?.(cur.item.id);

      // Find what comes next
      const req = getNextRequested(cur?.item?.id ?? null);
      if (req) { playEntry(req); return; }

      if (stateRef.current.vibeEnabled) {
        const vibe = getNextVibe(cur?.type === 'vibe' ? (cur.vibeIdx ?? 0) : null);
        if (vibe) { playEntry(vibe); return; }
      }

      // Nothing left
      setCurrentEntry(null);
      onNowPlaying?.(null);
      onVibeActive?.(false);
    },
    get isIdle() { return !stateRef.current.currentEntry; },
  }));

  const videoId = currentEntry?.videoId ?? null;

  return (
    <div style={{
      position: 'relative', width: '100%', paddingTop: '56.25%',
      background: '#111', borderRadius: 12, overflow: 'hidden',
    }}>
      {videoId ? (
        <iframe
          key={videoId}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1&controls=1&rel=0&playsinline=1&modestbranding=1`}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          title="Now Playing"
        />
      ) : (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 8, color: '#555', fontSize: 13,
        }}>
          <span style={{ fontSize: 36 }}>🎵</span>
          <span>No song playing</span>
        </div>
      )}
    </div>
  );
});

export default CrossfadePlayer;
