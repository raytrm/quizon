/**
 * Escapa caracteres HTML peligrosos para evitar inyección en plantillas.
 */
export function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Muestra un aviso flotante temporal en pantalla.
 */
export function showToast(message, type = 'error', durationMs = 3500) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = `toast ${type === 'info' ? 'info' : ''}`;
  el.textContent = message;
  document.body.appendChild(el);

  setTimeout(() => {
    el.remove();
  }, durationMs);
}

/**
 * Lee un parámetro de la query string actual.
 */
export function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/**
 * Inicia un temporizador visual sincronizado contra un timestamp UTC `endsAt`.
 * Devuelve una función `stop()` para detenerlo.
 */
export function startCountdown(endsAt, totalSeconds, onTick) {
  let active = true;
  const totalMs = Math.max(1000, (totalSeconds || 20) * 1000);

  function frame() {
    if (!active) return;
    const remainingMs = Math.max(0, endsAt - Date.now());
    const secondsLeft = Math.ceil(remainingMs / 1000);
    const percent = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));
    onTick({ remainingMs, secondsLeft, percent });
    if (remainingMs > 0) {
      requestAnimationFrame(frame);
    }
  }

  frame();
  return () => {
    active = false;
  };
}

/**
 * Feedback háptico breve en dispositivos móviles compatibles.
 */
export function vibrate(pattern = 35) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignorar en navegadores que bloqueen vibración
    }
  }
}

/**
 * Registra el Service Worker para soporte PWA.
 */
export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

