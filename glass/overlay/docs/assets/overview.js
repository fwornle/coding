(() => {
  // The extractor also imports documentation scripts in its Node.js smoke check.
  if (typeof document === 'undefined') return;
  const deck = document.getElementById('glass-overview');
  if (!deck || deck.dataset.ready) return;

  const slides = [...deck.querySelectorAll('.overview-slide')];
  const counter = deck.querySelector('.overview-counter');
  const previous = deck.querySelector('[data-prev]');
  const next = deck.querySelector('[data-next]');
  const fullscreen = deck.querySelector('[data-fullscreen]');
  const message = deck.querySelector('.overview-message');
  let index = 0;

  const dots = slides.map((slide, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(i + 1);
    button.setAttribute('aria-label', `Slide ${i + 1}: ${slide.querySelector('h1, h2').textContent.replace('¶', '').trim()}`);
    button.addEventListener('click', () => go(i));
    deck.querySelector('.overview-dots').append(button);
    return button;
  });

  function readHash() {
    const match = /^#slide-(\d+)$/.exec(window.location.hash);
    return match ? Number(match[1]) - 1 : 0;
  }

  function go(target, updateHash = true) {
    const oldSlide = slides[index];
    index = Math.max(0, Math.min(slides.length - 1, target));
    const moveFocus = oldSlide.contains(document.activeElement);
    slides.forEach((slide, i) => { slide.hidden = i !== index; });
    dots.forEach((dot, i) => {
      if (i === index) dot.setAttribute('aria-current', 'step');
      else dot.removeAttribute('aria-current');
    });
    counter.textContent = `${index + 1} / ${slides.length}`;
    previous.disabled = index === 0;
    next.disabled = index === slides.length - 1;
    deck.querySelector('.overview-stage').scrollTop = 0;
    if (updateHash) history.replaceState(null, '', `#slide-${index + 1}`);
    if (moveFocus) {
      const heading = slides[index].querySelector('h1, h2');
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
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

  previous.addEventListener('click', () => go(index - 1));
  next.addEventListener('click', () => go(index + 1));
  fullscreen.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    fullscreen.textContent = document.fullscreenElement === deck ? 'Exit fullscreen' : 'Fullscreen';
  });
  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (target !== document.body && !deck.contains(target)) return;
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
      case 'f':
      case 'F':
        event.preventDefault();
        toggleFullscreen();
        break;
      default:
        break;
    }
  });
  window.addEventListener('hashchange', () => go(readHash(), false));
  deck.dataset.ready = 'true';
  deck.querySelector('.overview-toolbar').hidden = false;
  deck.querySelector('.overview-controls').hidden = false;
  go(readHash(), false);
})();
