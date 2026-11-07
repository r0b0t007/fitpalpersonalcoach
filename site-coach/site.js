/* FitPal Coach site behaviour: scroll reveal, and a referral link's ref.
   The `.js` and `.intro` root classes are set by an inline <head> script, not here, so the hero
   never paints before the intro arms. This file only handles what can wait for DOMContentLoaded.

   CHW-342 removed the other two jobs this file had. The menu button went with the section links
   on phones (three in-page anchors are not worth a menu), and the hero's silent autoplay loop
   went with the hero: the film on the page now has a voice-over, so it ships with native
   controls and preload="none" and plays only when pressed, which needs no script at all.

   Reduced motion is checked once and short-circuits the observer: every reveal is shown
   immediately. */

/* A referral link (CHW-350): fitpal.ma/?ref=<a coach's page handle>. The ref is carried onto the
   sign-up links (coach.fitpal.ma/#/start…) and the language switcher, in the URLs only: nothing
   is written to cookies or storage, so the site still sets none. A ref that is no handle (the
   pattern of backend/app/Coaching/Handle.php) is ignored; the server checks the rest. */
(function () {
  'use strict'

  var m = /[?&]ref=([^&#]*)/.exec(window.location.search)
  if (!m) return
  var ref
  try { ref = decodeURIComponent(m[1]).trim().replace(/^@+/, '').toLowerCase() } catch (e) { return }
  if (!/^[a-z0-9._]{3,30}$/.test(ref) || ref.charAt(0) === '.' || ref.slice(-1) === '.' || ref.indexOf('..') >= 0) return

  var links = document.querySelectorAll('a[href]')
  for (var i = 0; i < links.length; i++) {
    var h = links[i].getAttribute('href')
    if (h.indexOf('https://coach.fitpal.ma/#/start') === 0) {
      links[i].setAttribute('href', h + (h.indexOf('?') >= 0 ? '&' : '?') + 'ref=' + ref)
    } else if (links[i].hasAttribute('hreflang') && /^\/(en\/|es\/)?$/.test(h)) {
      links[i].setAttribute('href', h + '?ref=' + ref)
    }
  }
})()

;(function () {
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
