/* FitPal Coach site behaviour: menu, scroll reveal, FAQ height.
   The `.js` and `.intro` root classes are set by an inline <head> script, not here, so the hero
   never paints before the intro arms. This file only handles what can wait for DOMContentLoaded.

   Reduced motion is checked once and short-circuits every motion path: the observer is never
   created and every reveal is shown immediately. */

(function () {
  'use strict'

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /* ---- menu -------------------------------------------------------- */

  var burger = document.querySelector('.burger')
  var nav = document.querySelector('.nav')

  if (burger && nav) {
    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('open')
      burger.setAttribute('aria-expanded', open ? 'true' : 'false')
    })

    // Close on navigation, and on Escape, so the sheet never traps a keyboard user.
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        nav.classList.remove('open')
        burger.setAttribute('aria-expanded', 'false')
      }
    })

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        nav.classList.remove('open')
        burger.setAttribute('aria-expanded', 'false')
        burger.focus()
      }
    })
  }

  /* ---- hero video --------------------------------------------------- */

  /* Ships as a poster plus controls, which is what a visitor gets with reduced motion, with no
     JS, or before the render exists. Only when motion is welcome does it become an autoplaying
     loop, and only once it can actually play through: a muted inline loop is the promo
     convention, but it is opt-in rather than the default. */
  var vid = document.querySelector('video[data-autoplay]')

  /* The markup ships preload="none" and no <source> src, so the document itself costs nothing.
     This block is the only thing that can pull the file, and it used to do so unconditionally
     at DOMContentLoaded: 2.4 MB, 84% of the page weight, fetched before the hero had finished
     painting and in competition with the font and stylesheet for a slow link. That is what was
     holding LCP, not the stylesheet.

     Three gates now stand in front of it:

       reduced motion  as before, no autoplay at all
       narrow / saveData  never load it. A phone on a metered connection gets the poster and a
                       control that loads on demand; nobody spends 2.4 MB to autoplay a
                       seventeen-second loop they did not ask for.
       viewport        otherwise wait for IntersectionObserver. The video sits in the hero so
                       this usually fires straight away, but it fires AFTER first paint, which
                       is the whole point. */

  var conn = navigator.connection || {}
  var frugal = conn.saveData === true ||
    /(^|-)2g$/.test(String(conn.effectiveType || '')) ||
    window.matchMedia('(max-width: 767px)').matches

  if (vid && !reduce && frugal) {
    /* Poster plus a real control; attachSource() is what finally fetches anything.

       The reissued play() is not belt and braces. Pressing the control fires 'play', this
       handler attaches the sources, and attachSource() calls load() - which ABORTS the very
       play that got us here (the promise rejects AbortError) and leaves the element paused at
       0 with a perfectly good source loaded. Without the second play() the visitor taps once,
       downloads the video, and watches nothing happen. */
    vid.setAttribute('controls', '')
    vid.addEventListener('play', function once () {
      vid.removeEventListener('play', once)
      if (!attachSource(vid)) return
      vid.addEventListener('loadeddata', function go () {
        vid.removeEventListener('loadeddata', go)
        var again = vid.play()
        if (again && typeof again.catch === 'function') again.catch(function () {})
      })
    })
  }

  if (vid && !reduce && !frugal) {
    var armed = false
    var arm = function () {
      if (armed) return
      armed = true
      attachSource(vid)
      startAutoplay(vid)
    }
    if ('IntersectionObserver' in window) {
      var vio = new IntersectionObserver(function (es) {
        for (var k = 0; k < es.length; k++) {
          if (es[k].isIntersecting) { vio.disconnect(); arm(); return }
        }
      }, { rootMargin: '200px' })
      vio.observe(vid)
    } else {
      arm()
    }
  }

  /* Sources live in data-src so the browser cannot start fetching before we decide it should.
     WebM first: it is the smaller encode, and a browser that cannot play it falls through to
     the MP4 on the same element. */
  /* Returns true only when it actually attached, so callers know whether load() was issued and
     whether the play it interrupted has to be reissued. */
  function attachSource (v) {
    if (v.dataset && v.dataset.armed === '1') return false
    if (v.dataset) v.dataset.armed = '1'
    var srcs = v.querySelectorAll('source[data-src]')
    if (!srcs.length) return false
    for (var n = 0; n < srcs.length; n++) {
      srcs[n].setAttribute('src', srcs[n].getAttribute('data-src'))
    }
    v.preload = 'metadata'
    v.load()
    return true
  }

  function startAutoplay (v) {
    v.loop = true
    v.autoplay = true
    v.removeAttribute('controls')

    /* WCAG 2.2.2, Pause Stop Hide (Level A): this is moving content that starts by itself,
       runs well past five seconds, loops forever, and sits beside text someone is trying to
       read. Taking the native controls away removed the only way to stop it, so a dedicated
       control has to replace them.

       It is built here rather than written into the markup because it is only ever needed on
       this path. With no JS, or under reduced motion, the video keeps its native controls and
       never autoplays — a button in the HTML would be dead weight in exactly those cases. */
    var en = (document.documentElement.lang || 'fr').toLowerCase().indexOf('en') === 0
    var T = en
      ? { pause: 'Pause the video', play: 'Play the video' }
      : { pause: 'Mettre la vidéo en pause', play: 'Lire la vidéo' }

    var toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'media-toggle'

    var sync = function () {
      toggle.setAttribute('data-state', v.paused ? 'paused' : 'playing')
      toggle.setAttribute('aria-label', v.paused ? T.play : T.pause)
    }

    toggle.addEventListener('click', function () {
      if (v.paused) v.play(); else v.pause()
    })
    v.addEventListener('play', sync)
    v.addEventListener('pause', sync)
    sync()
    if (v.parentNode) v.parentNode.appendChild(toggle)

    var play = v.play()
    // Autoplay is refused on some browsers and on data-saver. Hand the native controls back
    // rather than leaving a dead poster — and drop our own button, so the two never stack.
    if (play && typeof play.catch === 'function') {
      play.catch(function () {
        v.setAttribute('controls', '')
        if (toggle.parentNode) toggle.parentNode.removeChild(toggle)
      })
    }
  }

  /* ---- scroll reveal ----------------------------------------------- */

  var targets = document.querySelectorAll('.rv')

  if (reduce || !('IntersectionObserver' in window)) {
    // Show everything and never arm the observer.
    for (var i = 0; i < targets.length; i++) targets[i].classList.add('in')
    return
  }

  var io = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].isIntersecting) continue
      entries[i].target.classList.add('in')
      io.unobserve(entries[i].target)
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 })

  for (var j = 0; j < targets.length; j++) io.observe(targets[j])
})()
