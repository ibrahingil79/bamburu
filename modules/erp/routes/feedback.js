import { Hono } from 'hono';
import { adminLayout } from '../layout.js';

export function createFeedbackRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // ── API: POST /api/erp/feedback ────────────────────────────────
  api.post('/', async c => {
    try {
      const body = await c.req.json();
      const { rating, message } = body;
      const r = parseInt(rating);
      if (!r || r < 1 || r > 5) return c.json({ error: 'Valoración inválida (1–5)' }, 400);
      if (!message || typeof message !== 'string' || !message.trim()) {
        return c.json({ error: 'El mensaje no puede estar vacío' }, 400);
      }
      if (message.length > 2000) return c.json({ error: 'El mensaje es demasiado largo (máx 2000 caracteres)' }, 400);
      const userName = c.get('session')?.userName || '';
      db.prepare('INSERT INTO feedback (rating, message, user_name) VALUES (?, ?, ?)')
        .run(r, message.trim(), userName);
      return c.json({ message: 'Gracias por tu comentario' });
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // ── VIEW: GET /admin/feedback ──────────────────────────────────
  views.get('/', c => {
    const csrf = c.get('session')?.csrfToken || '';
    const content = `
      <div class="ph"><h2>Enviar comentario</h2></div>
      <div class="card" style="max-width:560px">
        <div class="card-body" id="form-wrap">
          <div class="form-group">
            <label class="form-label">Valoración</label>
            <div id="stars" style="display:flex;gap:8px;margin-top:4px">
              ${[1,2,3,4,5].map(n => `<button type="button" data-v="${n}" onclick="setRating(${n})"
                style="width:40px;height:40px;border-radius:8px;border:1px solid var(--border);background:#f8fafc;font-size:18px;cursor:pointer;transition:.15s">★</button>`).join('')}
            </div>
            <input type="hidden" id="rating" value="">
          </div>
          <div class="form-group">
            <label class="form-label">¿Qué mejorarías? ¿Qué echas en falta?</label>
            <textarea class="form-control" id="msg" rows="5" maxlength="2000" placeholder="Cuéntanos..."></textarea>
          </div>
          <button class="btn btn-primary" onclick="sendFeedback()">Enviar</button>
        </div>
        <div id="thanks" style="display:none;padding:2rem;text-align:center">
          <div style="font-size:2rem;margin-bottom:12px">✓</div>
          <p style="font-weight:600;margin-bottom:8px">¡Gracias por tu comentario!</p>
          <p style="color:var(--muted);font-size:.85rem;margin-bottom:20px">Tu opinión nos ayuda a mejorar Bamburu.</p>
          <a href="/admin" class="btn btn-secondary">Volver al panel</a>
        </div>
      </div>
      <script>
      let selectedRating = 0;
      function setRating(v) {
        selectedRating = v;
        document.getElementById('rating').value = v;
        document.querySelectorAll('#stars button').forEach(b => {
          const n = +b.dataset.v;
          b.style.background = n <= v ? '#0D9488' : '#f8fafc';
          b.style.color = n <= v ? '#fff' : '#0F172A';
          b.style.borderColor = n <= v ? '#0D9488' : 'var(--border)';
        });
      }
      async function sendFeedback() {
        const rating = selectedRating;
        const message = document.getElementById('msg').value.trim();
        if (!rating) { alert('Selecciona una valoración'); return; }
        if (!message) { alert('Escribe un comentario'); return; }
        try {
          await api('POST', '/api/erp/feedback', { rating, message });
          document.getElementById('form-wrap').style.display = 'none';
          document.getElementById('thanks').style.display = 'block';
        } catch(e) { alert(e.message || 'Error al enviar'); }
      }
      </script>`;
    return c.html(adminLayout('Enviar comentario', content, '', csrf, c));
  });

  return { api, views };
}
