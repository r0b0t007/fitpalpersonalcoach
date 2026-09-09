import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { imgSrc, resolveMedia } from '../lib/exercises.js'
import { coachMediaFor, coachMediaVersion, subscribeCoachMedia } from '../lib/coach-media.js'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Big autoplaying demo; tap toggles to the still frame. `compact` shrinks it (superset cards).
// `minimizable` (workout view) adds a persistent minimize/expand control so the animation stops
// eating the screen; the chosen size is saved to settings and carries across exercises and
// future workouts (issue #12). Settings can also turn workout media off entirely
// (gifSize 'off') — then nothing renders here and the exercise card closes up. That switch is
// about screen space, so it covers a coach's video too: a video eats MORE of the screen than a
// gif, not less, and a member who turned media off did not ask for a bigger version of it.
// Any other/legacy value behaves as 'full'.
//
// Since step 5 there are up to three sources here, and the exercise no longer has to be one the
// dataset knows: a coach's uploaded video, the dataset gif, the dataset still. Custom exercises
// used to render nothing at all because ex.gif was empty — now they render whatever the coach
// shot for them. lib/exercises.js resolveMedia owns the order and is tested there.
export default function Media({ ex, id, compact, minimizable }) {
  const [playing, setPlaying] = useState(true)
  // How many rungs of the chain have failed, NOT a tri-state flag any more. A <video> fires
  // `error` for a dropped connection AND for a codec the browser cannot decode — a 'raw' upload
  // (iPhone HEVC in a .mov) is exactly that, and it fails on Chrome and Firefox specifically.
  // Degrading one rung at a time means such a video falls back to the dataset animation instead
  // of straight to a neutral tile, and only an exercise with nothing underneath it lands there.
  // Non-zero also means "we are only here because something failed", which is what the retry
  // hint below keys on — a still frame is a fallback on rung 1 and the whole point on rung 0.
  const [gone, setGone] = useState(0)
  const gifSize = useStore(s => s.S.gifSize)
  const update = useStore(s => s.update)
  // The coach's list arrives once, after sign-in (App.jsx). Everything downstream of the
  // registry is synchronous, so this only exists to repaint the one time it lands.
  useSyncExternalStore(subscribeCoachMedia, coachMediaVersion, coachMediaVersion)
  const vid = useRef(null)
  const box = useRef(null)
  // Nothing plays until the card is on screen. The workout's list view mounts a Media for EVERY
  // exercise in the session at once (views/Workout.jsx), and play() overrides preload="metadata"
  // — it buffers the file. Six coach demos against the 90 MB the API accepts is half a gigabyte
  // of a member's cellular data spent before they have scrolled past the first exercise; the
  // dataset gifs this replaces are two orders of magnitude smaller and could afford to be eager.
  // One-way on purpose: scrolling past does not un-download what already arrived, and stopping
  // a demo the member is halfway through watching to save bytes already spent helps nobody.
  // IntersectionObserver is a browser API, not a dependency; where it is missing, eager play is
  // the right fallback — the demo playing is the feature, the saved bytes are the optimisation.
  const [onScreen, setOnScreen] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (onScreen || typeof IntersectionObserver === 'undefined') return
    const el = box.current
    if (!el) return
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) { setOnScreen(true); io.disconnect() }
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [onScreen])

  const m = resolveMedia(ex, coachMediaFor(ex && ex.id))
  // Whatever actually exists, in the order it should be tried.
  const chain = [m.video && 'video', m.gif && 'gif', m.poster && 'still'].filter(Boolean)
  const kind = chain[gone] || null
  // Paused on the animation: the still frame stands in, exactly as it always did.
  const showStill = kind === 'gif' && !playing

  // A <video> is imperative — there is no `paused` prop. Autoplay can also be refused outright
  // by the browser; muted + playsInline is the deal that normally gets it allowed, and a refusal
  // is not an error worth degrading over — but it does mean the video is NOT playing, and
  // `playing` is what the hint below reads. Believing ourselves over the element is how you get
  // "tap to pause" printed over a motionless poster (iOS Low Power Mode refuses even muted
  // autoplay) and a first tap that appears to do nothing because all it did was agree.
  useEffect(() => {
    const el = vid.current
    if (!el) return
    if (!playing || !onScreen) { el.pause(); return }
    // play() returns a promise in every current browser and undefined in some older ones.
    const p = el.play()
    if (p && p.catch) p.catch(() => setPlaying(false))
  }, [playing, kind, onScreen])

  if (!m.any) return null
  if (minimizable && gifSize === 'off') return null
  const mini = minimizable && gifSize === 'mini'
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'full' : 'mini' }) }
  // A failing still means nothing below it is going to work either — go straight to the tile
  // rather than re-requesting the same URL one rung down.
  const onError = () => setGone(g => (showStill ? chain.length : g + 1))
  const onTap = () => {
    // A rung that still animates gets the tap it has always had: play/pause. Anything else is a
    // dead end — the still standing in for an animation that would not load, or the tile with
    // nothing left under it — and what put us there is usually ONE dropped request (a CDN
    // hiccup, an expired session on a gated instance). So from there a tap retries the chain
    // from the top, which is what a tap has meant since before coach demos existed.
    // Deliberately not "retry whenever something failed": a coach video the browser cannot
    // decode falls back to a working gif, and retrying there would throw the member back onto
    // the undecodable video every time they tried to pause it.
    if (kind === 'video' || kind === 'gif') { setPlaying(p => !p); return }
    setGone(0)
    setPlaying(true)
  }
  const alt = exerciseNameFor(ex)
  return (
    <div ref={box} className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '') + (!kind ? ' broken' : '')} id={id} onClick={onTap}>
      {kind === 'video'
        // No `controls`: the container's tap is play/pause and always has been, and a control
        // bar would swallow every one of those taps (scrub, mute, fullscreen all bubble into it).
        // This is a looping muted demo, the same contract as the gif it replaces.
        // onPlay/onPause are the other half of the reconciliation above: a browser that stops
        // the video on its own (a hit concurrent-decoder limit in the list view, Low Power Mode
        // kicking in mid-demo) tells us here, and nowhere else.
        ? <video ref={vid} src={m.video} poster={m.poster || undefined} aria-label={alt} muted loop playsInline
            preload="metadata" onError={onError} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
        : kind
          ? <img decoding="async" draggable={false} src={showStill || kind === 'still' ? m.poster : m.gif} alt={alt} onError={onError} />
          : <div className="exmedia-x"><Icon name="dumbbell" /></div>}
      {/* The library is visibly mixed now — a stock animation and the coach's own footage sit in
          the same card — so say which one this is. 'raw' rides on the same badge instead of a
          second one: nothing in the API ever converts it, so this caveat is permanent, and a
          member who sees a black rectangle deserves to know it is the file and not their phone. */}
      {kind === 'video' && (
        <span className={'exbadge' + (m.raw ? ' warn' : '')}>
          <Icon name={m.raw ? 'warning' : 'camera'} />{m.raw ? t('Coach demo — may not play here') : t('Coach demo')}
        </span>
      )}
      {minimizable && (
        <button className="giftoggle" onClick={toggleSize}>
          <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
        </button>
      )}
      {/* Whichever thing a tap does here, say so. On an animating rung that is play/pause — and
          it stays true after a coach video falls back to the gif, which the old `gone === 0`
          gate silently dropped. On a rung we only reached because something failed to load it
          is the retry, and without a word there the card looks like a picture nobody can fix. */}
      {!mini && (kind === 'video' || kind === 'gif') && (
        <span className="gifhint">
          <Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}
        </span>
      )}
      {!mini && gone > 0 && kind !== 'video' && kind !== 'gif' && (
        <span className="gifhint"><Icon name="reset" />{t('tap to retry')}</span>
      )}
    </div>
  )
}

export function Thumb({ ex }) {
  // Deliberately left dataset-only. A coach's upload is a video with no cheap frame to put in a
  // 50×50 square, and subscribing every row of a 1,300-item library list to the media registry
  // to find that out would cost a re-render of the whole list for a picture nobody looks at.
  if (!ex.img) return <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
  return <img className="thumb" loading="lazy" decoding="async" draggable={false} src={imgSrc(ex)} alt="" />
}
