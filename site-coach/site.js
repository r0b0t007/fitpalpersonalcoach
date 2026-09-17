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
  if (vid && !reduce) {
    vid.preload = 'metadata'
    vid.loop = true
    vid.autoplay = true
    vid.removeAttribute('controls')

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
      toggle.setAttribute('data-state', vid.paused ? 'paused' : 'playing')
      toggle.setAttribute('aria-label', vid.paused ? T.play : T.pause)
    }

    toggle.addEventListener('click', function () {
      if (vid.paused) vid.play(); else vid.pause()
    })
    vid.addEventListener('play', sync)
    vid.addEventListener('pause', sync)
    sync()
    if (vid.parentNode) vid.parentNode.appendChild(toggle)

    var play = vid.play()
    // Autoplay is refused on some browsers and on data-saver. Hand the native controls back
    // rather than leaving a dead poster — and drop our own button, so the two never stack.
    if (play && typeof play.catch === 'function') {
      play.catch(function () {
        vid.setAttribute('controls', '')
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
