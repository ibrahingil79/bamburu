// Zona 7 · AVANCE (SOLO LECTURA) — refleja DENTRO del panel la foto del avance que vive en la
// página de control de Notion. No crea tablero ni edita nada: solo lee y muestra. Si Notion
// falla, sale un aviso claro y el resto del panel NO se rompe (cada zona es independiente).
import { escHtml } from '../../core/escape.js';
import { saLayout } from './layout.js';

const NOTION_PAGE = '36e18b04-bb1f-812f-99ee-f96789ac2909';

async function fetchNotionSnapshot() {
  const token = process.env.NOTION_TOKEN;
  if (!token) return { ok: false, error: 'NOTION_TOKEN no está configurado en /etc/bamburu.env' };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);   // no dejamos colgar la página si Notion va lento
  try {
    const r = await fetch(`https://api.notion.com/v1/blocks/${NOTION_PAGE}/children?page_size=100`, {
      headers: { 'Authorization': 'Bearer ' + token, 'Notion-Version': '2022-06-28' },
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) return { ok: false, error: `Notion respondió ${r.status}` };
    const data = await r.json();
    const blocks = (data.results || []).map(b => {
      const t = b.type;
      const rt = (b[t] && b[t].rich_text) || [];
      return { type: t, text: rt.map(x => x.plain_text).join('') };
    }).filter(b => b.text || b.type === 'divider');
    return { ok: true, blocks, hasMore: !!data.has_more };
  } catch (e) {
    clearTimeout(to);
    return { ok: false, error: e.name === 'AbortError' ? 'Notion tardó demasiado en responder' : (e.message || 'error de red') };
  }
}

function renderBlocks(blocks) {
  return blocks.map(b => {
    const txt = escHtml(b.text);
    switch (b.type) {
      case 'heading_1': return `<h2 style="font-size:18px;margin:18px 0 8px;color:#f59e0b">${txt}</h2>`;
      case 'heading_2': return `<h3 style="font-size:15px;margin:14px 0 6px">${txt}</h3>`;
      case 'heading_3': return `<h4 style="font-size:13px;margin:10px 0 4px;color:#cbd5e1">${txt}</h4>`;
      case 'bulleted_list_item':
      case 'numbered_list_item': return `<div style="padding-left:16px;color:#94a3b8;font-size:13px;line-height:1.6">• ${txt}</div>`;
      case 'to_do': return `<div style="color:#94a3b8;font-size:13px;line-height:1.6">☐ ${txt}</div>`;
      case 'divider': return '<hr style="border:none;border-top:1px solid rgba(255,255,255,.08);margin:14px 0">';
      default: return txt ? `<p style="color:#cbd5e1;font-size:13px;line-height:1.6;margin:6px 0">${txt}</p>` : '';
    }
  }).join('');
}

export function mountAvance(sa) {
  sa.get('/avance', async c => {
    const sess = c.get('sa');
    const snap = await fetchNotionSnapshot();
    const body = !snap.ok
      ? `<div class="card" style="border-color:rgba(245,158,11,.35)">
           <div style="color:#fbbf24;font-weight:700;margin-bottom:6px">⚠ No se pudo leer Notion ahora</div>
           <div style="color:#94a3b8;font-size:13px">${escHtml(snap.error)}. El resto del panel funciona con normalidad; vuelve a intentarlo en un momento.</div>
         </div>`
      : `<div class="card">${renderBlocks(snap.blocks)}
           ${snap.hasMore ? '<div style="color:#64748b;font-size:12px;margin-top:16px">(Vista parcial — el detalle completo está en Notion.)</div>' : ''}</div>`;
    const content = `
      <h1>Avance del proyecto</h1>
      <div class="sa-sub">Reflejo de SOLO LECTURA del panel de control en Notion (no se edita aquí).
        <a href="https://www.notion.so/${NOTION_PAGE.replace(/-/g, '')}" target="_blank" rel="noopener" style="color:#f59e0b;text-decoration:none">Abrir en Notion ↗</a></div>
      ${body}`;
    return c.html(saLayout('Avance', content, 'avance', sess, sess.csrfToken, c.get('cspNonce')));
  });
}
