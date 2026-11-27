// Animierter Sternenhimmel: 3 Parallax-Ebenen, Funkeln, gelegentliche Sternschnuppen
const canvas = document.getElementById('stars');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, dpr = 1, stars = [], shooters = [], enabled = true, dim = false, raf = 0, last = 0;
const TINTS = ['255,255,255', '200,220,255', '230,200,255', '170,240,255', '255,210,240'];

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const n = Math.round((W * H) / 5200);
  stars = Array.from({ length: n }, () => {
    const layer = Math.random() < 0.65 ? 0 : Math.random() < 0.75 ? 1 : 2;
    return {
      x: Math.random() * W, y: Math.random() * H, layer,
      r: [0.5, 0.9, 1.5][layer] * (0.7 + Math.random() * 0.6),
      a: 0.35 + Math.random() * 0.65, tw: Math.random() * Math.PI * 2, ts: 0.6 + Math.random() * 2.2,
      tint: TINTS[(Math.random() * TINTS.length) | 0],
    };
  });
  if (!enabled) drawStatic();
}

function drawStar(s, alpha) {
  ctx.fillStyle = `rgba(${s.tint},${alpha})`;
  ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
  if (s.layer === 2) {
    ctx.fillStyle = `rgba(${s.tint},${alpha * 0.18})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 4, 0, Math.PI * 2); ctx.fill();
  }
}

function drawStatic() {
  ctx.clearRect(0, 0, W, H);
  for (const s of stars) drawStar(s, s.a * (dim ? 0.55 : 1));
}

function frame(t) {
  raf = requestAnimationFrame(frame);
  if (t - last < 33) return; // ~30 fps reicht und schont die CPU
  const dt = Math.min(0.1, (t - last) / 1000); last = t;
  ctx.clearRect(0, 0, W, H);
  const speed = [2, 5, 10];
  for (const s of stars) {
    s.x -= speed[s.layer] * dt; s.y += speed[s.layer] * dt * 0.25;
    if (s.x < -5) s.x = W + 5; if (s.y > H + 5) s.y = -5;
    s.tw += s.ts * dt;
    const a = s.a * (0.65 + 0.35 * Math.sin(s.tw)) * (dim ? 0.55 : 1);
    drawStar(s, a);
  }
  if (!dim && Math.random() < 0.004 && shooters.length < 2) {
    shooters.push({ x: Math.random() * W * 0.8 + W * 0.2, y: Math.random() * H * 0.4, vx: -(500 + Math.random() * 400), vy: 180 + Math.random() * 160, life: 1 });
  }
  shooters = shooters.filter((s) => s.life > 0);
  for (const s of shooters) {
    s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt * 1.1;
    const tx = s.x - s.vx * 0.12, ty = s.y - s.vy * 0.12;
    const g = ctx.createLinearGradient(s.x, s.y, tx, ty);
    g.addColorStop(0, `rgba(255,255,255,${s.life})`);
    g.addColorStop(0.3, `rgba(160,140,255,${s.life * 0.5})`);
    g.addColorStop(1, 'rgba(0,240,255,0)');
    ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(tx, ty); ctx.stroke();
  }
}

export function startStars(on = true) {
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else if (enabled) raf = requestAnimationFrame(frame);
  });
  resize();
  setStarsEnabled(on);
}

export function setStarsEnabled(on) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  enabled = on && !reduce;
  cancelAnimationFrame(raf);
  if (enabled) raf = requestAnimationFrame(frame); else drawStatic();
}

export function setStarsDim(v) { dim = v; if (!enabled) drawStatic(); }
