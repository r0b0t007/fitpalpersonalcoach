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
  // No text on any of it, so nothing new to translate.
  const [gone, setGone] = useState(0)
  const gifSize = useStore(s => s.S.gifSize)
  const update = useStore(s => s.update)
  // The coach's list arrives once, after sign-in (App.jsx). Everything downstream of the
  // registry is synchronous, so this only exists to repaint the one time it lands.
  useSyncExternalStore(subscribeCoachMedia, coachMediaVersion, coachMediaVersion)
  const vid = useRef(null)

  const m = resolveMedia(ex, coachMediaFor(ex && ex.id))
  // Whatever actually exists, in the order it should be tried.
  const chain = [m.video && 'video', m.gif && 'gif', m.poster && 'still'].filter(Boolean)
  const kind = chain[gone] || null
  // Paused on the animation: the still frame stands in, exactly as it always did.
  const showStill = kind === 'gif' && !playing

  // A <video> is imperative — there is no `paused` prop. Autoplay can also be refused outright
  // by the browser; muted + playsInline is the deal that normally gets it allowed, and a refusal
  // is not an error worth degrading over, so the rejection is swallowed and the tap-to-play hint
  // is already on screen.
  useEffect(() => {
    const el = vid.current
    if (!el) return
    if (!playing) { el.pause(); return }
    // play() returns a promise in every current browser and undefined in some older ones.
    const p = el.play()
    if (p && p.catch) p.catch(() => {})
  }, [playing, kind])

  if (!m.any) return null
  if (minimizable && gifSize === 'off') return null
  const mini = minimizable && gifSize === 'mini'
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'full' : 'mini' }) }
  // A failing still means nothing below it is going to work either — go straight to the tile
  // rather than re-requesting the same URL one rung down.
  const onError = () => setGone(g => (showStill ? chain.length : g + 1))
  const onTap = () => {
    // Only the dead tile retries the whole chain. A video that fell back to the gif is working,
    // and a tap there should do what a tap has always done.
    if (!kind) { setGone(0); setPlaying(true); return }
    setPlaying(p => !p)
  }
  const alt = exerciseNameFor(ex)
  return (
    <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '') + (!kind ? ' broken' : '')} id={id} onClick={onTap}>
      {kind === 'video'
        // No `controls`: the container's tap is play/pause and always has been, and a control
        // bar would swallow every one of those taps (scrub, mute, fullscreen all bubble into it).
        // This is a looping muted demo, the same contract as the gif it replaces.
        ? <video ref={vid} src={m.video} poster={m.poster || undefined} aria-label={alt} muted loop playsInline preload="metadata" onError={onError} />
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
      {!mini && gone === 0 && kind && kind !== 'still' && (
        <span className="gifhint">
          <Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}
        </span>
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
