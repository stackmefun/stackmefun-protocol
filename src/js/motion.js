// motion.js - damped-spring solver, scroll reveal, parallax, count-up, scroll progress.
// prefers-reduced-motion: every effect resolves instantly.
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** damped harmonic oscillator, semi-implicit Euler with fixed 1/240 s substeps */
export function spring(from, to, { stiffness = 170, damping = 20, mass = 1 } = {}, onUpdate, onDone) {
  if (reduced()) {
    onUpdate(to);
    onDone && onDone();
    return () => {};
  }
  let x = from, v = 0, raf = 0, last = performance.now(), stopped = false;
  const step = (now) => {
    if (stopped) return;
    let dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    while (dt > 0) {
      const h = Math.min(dt, 1 / 240);
      const a = (-stiffness * (x - to) - damping * v) / mass;
      v += a * h;
      x += v * h;
      dt -= h;
    }
    onUpdate(x);
    if (Math.abs(x - to) < 0.0015 && Math.abs(v) < 0.0015) {
      onUpdate(to);
      onDone && onDone();
      return;
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}

/** scroll-reveal with staggered spring entrance. root = scroll container (null = viewport). */
export function reveal(scope, root = null) {
  const items = Array.isArray(scope) ? scope : [...scope.querySelectorAll('[data-reveal]:not([data-revealed])')];
  if (reduced() || !('IntersectionObserver' in window)) {
    items.forEach((el) => (el.dataset.revealed = '1'));
    return;
  }
  items.forEach((el) => {
    el.style.opacity = '0';
    el.style.transform = 'translate3d(0,22px,0)';
  });
  let queue = 0;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target;
        io.unobserve(el);
        const delay = Math.min(queue++, 8) * 70;
        setTimeout(() => {
          el.dataset.revealed = '1';
          spring(0, 1, { stiffness: 170, damping: 19 }, (p) => {
            el.style.opacity = String(Math.min(1, Math.max(0, p * 1.4)));
            el.style.transform = `translate3d(0,${(1 - p) * 22}px,0)`;
          }, () => {
            el.style.opacity = '';
            el.style.transform = '';
          });
          queue = Math.max(0, queue - 1);
        }, delay);
      }
    },
    { root, threshold: 0.08, rootMargin: '0px 0px -4% 0px' },
  );
  items.forEach((el) => io.observe(el));
}

/** hero parallax: pointer + scroll drive depth layers and the phone tilt (spring-smoothed) */
export function parallax() {
  const layers = [...document.querySelectorAll('[data-depth]')];
  const wrap = document.querySelector('.phone-wrap');
  if (reduced()) return;
  const t = { x: 0, y: 0 }, cur = { x: 0, y: 0 }, vel = { x: 0, y: 0 };
  let sy = 0, raf = 0;
  const loop = () => {
    for (const k of ['x', 'y']) {
      const a = -90 * (cur[k] - t[k]) - 14 * vel[k];
      vel[k] += a / 60;
      cur[k] += vel[k] / 60;
    }
    for (const el of layers) {
      const d = parseFloat(el.dataset.depth);
      el.style.setProperty('--px', (cur.x * d * 26).toFixed(2) + 'px');
      el.style.setProperty('--py', (cur.y * d * 26 + sy * d * -0.12).toFixed(2) + 'px');
    }
    raf = requestAnimationFrame(loop);
  };
  // phone tilt: reference formula, +-2deg, off below 900px, smoothed by the CSS 200ms ease-out transition
  const tilt = (x, y) => { if (wrap) wrap.style.transform = `perspective(1200px) rotateX(${y}deg) rotateY(${x}deg)`; };
  addEventListener('pointermove', (e) => {
    t.x = (e.clientX / innerWidth - 0.5) * 2;
    t.y = (e.clientY / innerHeight - 0.5) * 2;
    if (innerWidth >= 900) tilt(((e.clientX / innerWidth - 0.5) * 4).toFixed(3), ((e.clientY / innerHeight - 0.5) * -4).toFixed(3));
  }, { passive: true });
  addEventListener('resize', () => { if (innerWidth < 900) tilt(0, 0); });
  // banner backdrop: translateY by 10% of scroll, clamped
  const bg = document.querySelector('.bg-photo img');
  const bgMove = () => bg && bg.style.setProperty('--bgy', Math.min(scrollY * 0.1, innerHeight * 0.15).toFixed(1) + 'px');
  addEventListener('scroll', () => { sy = scrollY; bgMove(); }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(raf);
    if (!document.hidden) raf = requestAnimationFrame(loop);
  });
  raf = requestAnimationFrame(loop);
}

/** fixed scroll progress bar */
export function progressBar(el) {
  const upd = () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    el.style.transform = `scaleX(${h > 0 ? Math.min(1, scrollY / h) : 0})`;
  };
  addEventListener('scroll', upd, { passive: true });
  addEventListener('resize', upd);
  upd();
}

/** spotlight hover: tracks pointer into --mx/--my on cards, rows and tiles */
export function spotlight(root = document) {
  root.addEventListener('pointermove', (e) => {
    const el = e.target.closest && e.target.closest('[data-spot]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', e.clientX - r.left + 'px');
    el.style.setProperty('--my', e.clientY - r.top + 'px');
  }, { passive: true });
}

/** count-up with change flash. el.dataset.v holds the last numeric value. */
export function countTo(el, to, fmt, { flash = true } = {}) {
  const prev = el.dataset.v === undefined ? null : Number(el.dataset.v);
  el.dataset.v = String(to);
  if (to == null || Number.isNaN(to)) {
    el.textContent = '—';
    return;
  }
  if (prev === to) return;
  if (flash && prev !== null) {
    el.classList.remove('up', 'down');
    void el.offsetWidth;
    el.classList.add(to > prev ? 'up' : 'down');
  }
  if (el._stop) el._stop();
  const from = prev === null ? 0 : prev;
  el._stop = spring(0, 1, { stiffness: 120, damping: 22 }, (p) => {
    el.textContent = fmt(from + (to - from) * p);
  }, () => (el.textContent = fmt(to)));
}
