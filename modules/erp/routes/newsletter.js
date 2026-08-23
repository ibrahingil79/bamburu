import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { adminLayout } from '../layout.js';
import { requirePerm } from '../../../core/auth.js';

export function createNewsletterRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  api.get('/', requirePerm('newsletter.read'), c => {
    try { return c.json(db.prepare('SELECT * FROM newsletter_subscribers ORDER BY id DESC').all()); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.delete('/:id', requirePerm('newsletter.delete'), c => {
    try { db.prepare('DELETE FROM newsletter_subscribers WHERE id=?').run(c.req.param('id')); return c.json({message:'Eliminado'}); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.get('/export', requirePerm('newsletter.read'), c => {
    try {
      const rows = db.prepare('SELECT email,name,created_at FROM newsletter_subscribers WHERE active=1 ORDER BY created_at DESC').all();
      const q = v => '"'+String(v??'').replace(/"/g,'""')+'"';
      const h = ['Email','Nombre','Fecha'];
      const r = rows.map(x => [q(x.email),q(x.name),q(x.created_at?.split(' ')[0])].join(','));
      return c.body([h.join(','),...r].join('\n'), 200, {'Content-Type':'text/csv','Content-Disposition':'attachment; filename="newsletter.csv"'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  views.get('/', requirePerm('newsletter.read'), c => {
    const total = db.prepare('SELECT COUNT(*) as c FROM newsletter_subscribers WHERE active=1').get()?.c || 0;
    const content = `
      <div class="ph"><h2>Newsletter</h2>
        <a href="/api/erp/newsletter/export" class="btn btn-secondary">Exportar CSV</a>
      </div>
      <div class="bf-cards" style="grid-template-columns:minmax(0,220px)"><div class="bf-card inerte">
        <span class="bf-k">Suscriptores activos</span><span class="bf-v gana">${total}</span></div></div>
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>Email</th><th>Nombre</th><th>Estado</th><th>Fecha</th><th></th></tr></thead>
          <tbody id="nlBody"><tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--muted)">Cargando...</td></tr></tbody>
        </table></div>
      </div>
      <script>
      api('GET','/api/erp/newsletter').then(subs=>{
        document.getElementById('nlBody').innerHTML=subs.length?subs.map(s=>'<tr>'+
          '<td>'+escHtml(s.email)+'</td>'+
          '<td>'+escHtml(s.name||'-')+'</td>'+
          '<td>'+(s.active?'<span class="badge b-green">Activo</span>':'<span class="badge b-red">Inactivo</span>')+'</td>'+
          '<td style="color:var(--muted);font-size:.8rem">'+(s.created_at?.split(' ')[0]||'-')+'</td>'+
          '<td><button class="btn btn-danger btn-sm" onclick="del('+s.id+')">Eliminar</button></td>'+
          '</tr>').join(''):'<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--muted)">Sin suscriptores</td></tr>';
      });
      async function del(id){if(!confirm('¿Eliminar suscriptor?'))return;await api('DELETE','/api/erp/newsletter/'+id);toast('Eliminado');location.reload();}
      </script>`;
    return c.html(adminLayout('Newsletter', content, 'newsletter', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
