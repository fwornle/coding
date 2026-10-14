(() => {
  // The extractor also imports documentation scripts in its Node.js smoke check.
  if (typeof document === 'undefined') return;
  const template = document.getElementById('header-decks');
  const header = document.querySelector('.md-header__inner');
  if (!template || !header || header.querySelector('.header-deck')) return;
  // Ahead of the palette toggle, or of search when there is no toggle.
  const anchor = header.querySelector('.md-header__option, label[for="__search"], .md-header__source');
  const links = template.content.cloneNode(true);
  const here = window.location.pathname.replace(/index\.html$/, '');
  for (const link of links.querySelectorAll('a')) {
    // Resolved by hand: an anchor inside a <template> has no base URL, so link.href is empty.
    const target = new URL(link.getAttribute('href'), window.location.href).pathname.replace(/index\.html$/, '');
    if (target === here) link.setAttribute('aria-current', 'page');
  }
  header.insertBefore(links, anchor);
})();
