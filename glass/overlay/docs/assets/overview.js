(() => {
  // The extractor also imports documentation scripts in its Node.js smoke check.
  if (typeof document === 'undefined') return;
  // One deck per page; any page may carry one (glass and coding share this file).
  const deck = document.querySelector('.overview-deck');
  if (!deck || deck.dataset.ready) return;

  const allSlides = [...deck.querySelectorAll('.overview-slide')];
  const counter = deck.querySelector('.overview-counter');
  const previous = deck.querySelector('[data-prev]');
  const next = deck.querySelector('[data-next]');
  const fullscreen = deck.querySelector('[data-fullscreen]');
  const message = deck.querySelector('.overview-message');
  // A deck that marks some slides .overview-essential opens on those alone; a toolbar
  // button switches to every slide and back. Other decks always show every slide.
  const essentials = allSlides.filter((slide) => slide.classList.contains('overview-essential'));
  const hasEssentials = essentials.length > 0 && essentials.length < allSlides.length;
  const modeKey = `overview-mode:${deck.id || window.location.pathname}`;
  let full = !hasEssentials || readStoredMode() === 'full';
  let slides = [];
  let dots = [];
  let index = 0;
  let modeButton = null;

  function readStoredMode() {
    try { return window.sessionStorage.getItem(modeKey); } catch { return null; }
  }

  function storeMode() {
    try { window.sessionStorage.setItem(modeKey, full ? 'full' : 'essentials'); } catch { /* private window */ }
  }

  function title(slide) {
    return slide.querySelector('h1, h2').textContent.replace('¶', '').trim();
  }

  function layout() {
    slides = full ? allSlides : essentials;
    allSlides.forEach((slide) => {
      if (slides.includes(slide)) delete slide.dataset.skipped;
      else slide.dataset.skipped = 'true';
    });
    const dotList = deck.querySelector('.overview-dots');
    dotList.replaceChildren();
    dots = slides.map((slide, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = String(i + 1);
      button.setAttribute('aria-label', `Slide ${i + 1}: ${title(slide)}`);
      button.addEventListener('click', () => go(i));
      dotList.append(button);
      return button;
    });
    if (modeButton) {
      modeButton.textContent = full ? `Essentials (${essentials.length})` : `Full overview (${allSlides.length})`;
      modeButton.setAttribute('aria-pressed', String(full));
      modeButton.title = full
        ? `Show only the ${essentials.length} essential slides`
        : `Show all ${allSlides.length} slides`;
    }
  }

  // The hash names a slide by its id (slide-N, N its place among all slides), so a link
  // to a slide stays valid in either mode. A link to a slide outside the essentials
  // opens the full deck.
  function readHash() {
    const match = /^#(slide-\d+)$/.exec(window.location.hash);
    const slide = match && allSlides.find((s) => s.id === match[1]);
    if (!slide) return 0;
    if (!slides.includes(slide)) {
      full = true;
      layout();
    }
    return slides.indexOf(slide);
  }

  function go(target, updateHash = true) {
    index = Math.max(0, Math.min(slides.length - 1, target));
    const moveFocus = deck.querySelector('.overview-stage').contains(document.activeElement);
    allSlides.forEach((slide) => { slide.hidden = slide !== slides[index]; });
    dots.forEach((dot, i) => {
      if (i === index) dot.setAttribute('aria-current', 'step');
      else dot.removeAttribute('aria-current');
    });
    counter.textContent = `${index + 1} / ${slides.length}`;
    previous.disabled = index === 0;
    next.disabled = index === slides.length - 1;
    deck.querySelector('.overview-stage').scrollTop = 0;
    if (updateHash) history.replaceState(null, '', `#${slides[index].id}`);
    if (moveFocus) {
      const heading = slides[index].querySelector('h1, h2');
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }

  function toggleMode() {
    const current = slides[index];
    full = !full;
    storeMode();
    layout();
    // Stay on the same slide when it is in the new set; otherwise go to the nearest
    // essential slide before it.
    let target = slides.indexOf(current);
    if (target < 0) {
      const before = allSlides.slice(0, allSlides.indexOf(current)).reverse();
      target = Math.max(0, slides.indexOf(before.find((slide) => slides.includes(slide))));
    }
    go(target);
  }

  async function toggleFullscreen() {
    message.textContent = '';
    try {
      if (document.fullscreenElement === deck) await document.exitFullscreen();
      else await deck.requestFullscreen();
    } catch (error) {
      message.textContent = `Fullscreen unavailable: ${error.message}. Use your browser's fullscreen command instead.`;
    }
  }

  if (hasEssentials) {
    modeButton = document.createElement('button');
    modeButton.type = 'button';
    modeButton.dataset.mode = '';
    modeButton.addEventListener('click', toggleMode);
    fullscreen.before(modeButton);
  }

  previous.addEventListener('click', () => go(index - 1));
  next.addEventListener('click', () => go(index + 1));
  fullscreen.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    fullscreen.textContent = document.fullscreenElement === deck ? 'Exit fullscreen' : 'Fullscreen';
  });
  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // The deck owns the arrow keys wherever focus is on its page, except while typing.
    const target = event.target;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === ' ' && target.closest('button, a')) return;
    switch (event.key) {
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        event.preventDefault();
        go(index + 1);
        break;
      case 'ArrowLeft':
      case 'PageUp':
        event.preventDefault();
        go(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        go(0);
        break;
      case 'End':
        event.preventDefault();
        go(slides.length - 1);
        break;
      case 'Escape':
        // Back to the documentation home (the header logo's link). In fullscreen the
        // browser takes Escape to leave fullscreen, so this needs a second press.
        if (document.fullscreenElement) break;
        event.preventDefault();
        window.location.href = document.querySelector('a.md-logo')?.href || new URL('..', window.location.href).href;
        break;
      case 'f':
      case 'F':
        event.preventDefault();
        toggleFullscreen();
        break;
      case 'a':
      case 'A':
        if (!hasEssentials) break;
        event.preventDefault();
        toggleMode();
        break;
      default:
        break;
    }
  });
  window.addEventListener('hashchange', () => go(readHash(), false));
  layout();
  deck.dataset.ready = 'true';
  deck.querySelector('.overview-toolbar').hidden = false;
  deck.querySelector('.overview-controls').hidden = false;
  const help = deck.querySelector('.overview-help');
  if (hasEssentials && help) help.textContent += ' / A for all or essentials';
  go(readHash(), false);
})();
