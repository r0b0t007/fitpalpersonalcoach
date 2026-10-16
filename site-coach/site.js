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

  /* Ships as a bare poster: no controls and no source src, so with no JS it is a still image
     rather than a play button wired to nothing. This script adds the controls on every path
     that can also supply the file - tap-to-load under reduced motion or on a frugal
     connection, autoplay otherwise. A muted inline loop is the promo convention, but it is
     opt-in rather than the default. */
  var vid = document.querySelector('video[data-autoplay]')

  /* The markup ships preload="none" and no <source> src, so the document itself costs nothing.
     This block is the only thing that can pull the file, and it used to do so unconditionally
     at DOMContentLoaded: 2.4 MB, 84% of the page weight, fetched before the hero had finished
     painting and in competition with the font and stylesheet for a slow link. That is what was
     holding LCP, not the stylesheet.

     Three gates now stand in front of it:

       reduced motion  no autoplay at all; tap-to-load, same as the next gate
       narrow / saveData  never preload it. A phone on a metered connection gets the poster and
                       a control that loads on demand; nobody spends 2.4 MB to autoplay a
                       seventeen-second loop they did not ask for.
       viewport        otherwise wait for IntersectionObserver. The video sits in the hero so
                       this usually fires straight away, but it fires AFTER first paint, which
                       is the whole point. */

  var conn = navigator.connection || {}
  var frugal = conn.saveData === true ||
    /(^|-)2g$/.test(String(conn.effectiveType || '')) ||
    (window.matchMedia && window.matchMedia('(max-width: 767px)').matches)

  if (vid && (reduce || frugal)) {
    /* Poster plus a real control, with the sources attached up front but preload kept at
       "none": the browser knows what it would play and fetches nothing until the control is
       pressed. The native control then does everything itself, inside the visitor's own tap.

       This used to attach the sources from a 'play' listener instead. That never ran in
       Chrome: an element with no usable source sits at NETWORK_NO_SOURCE, Chrome greys out its
       play button, and pressing it fires no 'play' event at all - a dead control. Reissuing
       play() after load() also fought iOS, which refuses a play outside the gesture in Low
       Power Mode. Attaching early avoids both. */
    attachSource(vid, 'none')
    vid.setAttribute('controls', '')
  }

  if (vid && !reduce && !frugal) {
    var armed = false
    var arm = function () {
      if (armed) return
      armed = true
      attachSource(vid, 'metadata')
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
  /* `preload` is 'metadata' for the autoplay path, which is about to play anyway, and 'none'
     for tap-to-load, where load() only re-runs source selection so the control comes alive. */
  function attachSource (v, preload) {
    if (v.dataset && v.dataset.armed === '1') return
    if (v.dataset) v.dataset.armed = '1'
    var srcs = v.querySelectorAll('source[data-src]')
    if (!srcs.length) return
    for (var n = 0; n < srcs.length; n++) {
      srcs[n].setAttribute('src', srcs[n].getAttribute('data-src'))
    }
    v.preload = preload
    v.load()
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
       this path. With no JS the video is a still poster, and under reduced motion it gets native
       controls and never autoplays — a button in the HTML would be dead weight in exactly those cases. */
    var LABELS = {
      en: { pause: 'Pause the video', play: 'Play the video' },
      es: { pause: 'Pausar el vídeo', play: 'Reproducir el vídeo' },
      fr: { pause: 'Mettre la vidéo en pause', play: 'Lire la vidéo' }
    }
    var T = LABELS[(document.documentElement.lang || 'fr').toLowerCase().slice(0, 2)] || LABELS.fr

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
