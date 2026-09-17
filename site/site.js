// FitPal marketing site — progressive enhancement only: the burger toggle for the
// mobile nav. Everything else on the site works with JavaScript disabled.
const SITE_NAME = 'FitPal';                    // keep in sync with the rename procedure (README)
const SITE_URL = 'https://gym.fitpal.ma';

const burger = document.querySelector('.burger');
const menu = document.getElementById('menu');
if (burger && menu) {
  burger.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    burger.setAttribute('aria-expanded', String(open));
  });
  menu.addEventListener('click', e => {
    if (e.target.tagName === 'A') { menu.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); }
  });
}
