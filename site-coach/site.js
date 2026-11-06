/* FitPal Coach site behaviour: scroll reveal, and nothing else.
   The `.js` and `.intro` root classes are set by an inline <head> script, not here, so the hero
   never paints before the intro arms. This file only handles what can wait for DOMContentLoaded.

   CHW-342 removed the other two jobs this file had. The menu button went with the section links
   on phones (three in-page anchors are not worth a menu), and the hero's silent autoplay loop
   went with the hero: the film on the page now has a voice-over, so it ships with native
   controls and preload="none" and plays only when pressed, which needs no script at all.

   Reduced motion is checked once and short-circuits the observer: every reveal is shown
   immediately. */

(function () {
  'use strict'

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  var targets = document.querySelectorAll('.rv')

  if (reduce || !('IntersectionObserver' in window)) {
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
