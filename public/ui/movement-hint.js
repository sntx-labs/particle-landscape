(() => {
  const codes = { KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D' };
  const editing = 'input,textarea,select,button,a,[contenteditable],aside,.sh-panel';

  window.LabsMovementHint = ({ viewport, enabled = () => true }) => {
    if (!viewport || viewport.querySelector('.labs-movement-hint')) return;
    const pointer = matchMedia('(any-hover: hover) and (any-pointer: fine)');
    const hint = document.createElement('div');
    hint.className = 'labs-movement-hint';
    hint.setAttribute('role', 'img');
    hint.setAttribute('aria-label', 'W, A, S and D movement keys');
    const keys = {};
    for (const [code, letter] of Object.entries(codes)) {
      const key = document.createElement('kbd');
      key.textContent = letter;
      key.dataset.key = letter.toLowerCase();
      key.setAttribute('aria-hidden', 'true');
      hint.append(key);
      keys[code] = key;
    }
    const positionHost = getComputedStyle(viewport).position === 'static';
    if (positionHost) viewport.classList.add('labs-movement-host');
    viewport.append(hint);
    let dismissed = false, fadeTimer, removeTimer;
    const clearKeys = () => Object.values(keys).forEach(key => key.classList.remove('is-pressed'));
    const sync = () => {
      hint.hidden = dismissed || !pointer.matches || !enabled();
      if (hint.hidden) clearKeys();
    };
    const destroy = () => {
      dismissed = true;
      clearInterval(checkTimer);
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
      pointer.removeEventListener('change', sync);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', clearKeys);
      window.removeEventListener('pagehide', destroy);
      hint.remove();
      if (positionHost) viewport.classList.remove('labs-movement-host');
    };
    function keydown(event) {
      // The scene's handler runs first: only acknowledged movement dismisses the hint.
      if (!codes[event.code] || !event.defaultPrevented || event.target.closest?.(editing)) return;
      sync();
      if (hint.hidden || dismissed) return;
      keys[event.code].classList.add('is-pressed');
      if (fadeTimer) return;
      fadeTimer = setTimeout(() => {
        hint.classList.add('is-leaving');
        removeTimer = setTimeout(destroy, 650);
      }, 3000);
    }
    function keyup(event) { keys[event.code]?.classList.remove('is-pressed'); }
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', clearKeys);
    window.addEventListener('pagehide', destroy);
    pointer.addEventListener('change', sync);
    const checkTimer = setInterval(sync, 250);
    sync();
    return { destroy };
  };
})();
