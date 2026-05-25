import { Hono } from 'hono';
import { adminLayout } from '../layout.js';
import { requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { reviewStatusSchema } from '../schemas.js';

export function createReviewRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  api.get('/', requirePerm('reviews.read'), c => {
    try {
      const status = c.req.query('status') || '';
      let q = 'SELECT r.*,p.name as product_name FROM product_reviews r LEFT JOIN products p ON r.product_id=p.id';
      const params = [];
      if (status) { q += ' WHERE r.status=?'; params.push(status); }
      q += ' ORDER BY r.id DESC';
      return c.json(db.prepare(q).all(...params));
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.put('/:id', requirePerm('reviews.update'), validate(reviewStatusSchema), async c => {
    try {
      const d = c.get('validated');
      db.prepare('UPDATE product_reviews SET status=? WHERE id=?').run(d.status, c.req.param('id'));
      return c.json({message:'Actualizado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.delete('/:id', requirePerm('reviews.delete'), c => {
    try { db.prepare('DELETE FROM product_reviews WHERE id=?').run(c.req.param('id')); return c.json({message:'Eliminado'}); }
    catch(e) { return c.json({error:e.message},500); }
  });

  views.get('/', c => {
    const pending = db.prepare("SELECT COUNT(*) as c FROM product_reviews WHERE status='pending'").get()?.c || 0;
    const content = `
      <div class="ph"><h2>Reseñas de Productos</h2>
        <select class="form-control" id="statusFilter" style="width:auto" onchange="loadReviews()">
          <option value="">Todas</option>
          <option value="pending">Pendientes (${pending})</option>
          <option value="approved">Aprobadas</option>
          <option value="rejected">Rechazadas</option>
        </select>
      </div>
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>Producto</th><th>Autor</th><th>Valoración</th><th>Comentario</th><th>Estado</th><th>Fecha</th><th></th></tr></thead>
          <tbody id="revBody"><tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--muted)">Cargando...</td></tr></tbody>
        </table></div>
      </div>
      <script>
      async function loadReviews(){
        const s=document.getElementById('statusFilter').value;
        const revs=await api('GET','/api/erp/reviews'+(s?'?status='+s:'')).catch(()=>[]);
        const stars=n=>'<span class="stars">'+('').repeat(n)+('').repeat(5-n)+'</span>';
        const sb={pending:'b-yellow',approved:'b-green',rejected:'b-red'};
        document.getElementById('revBody').innerHTML=revs.length?revs.map(r=>'<tr>'+
          '<td><strong>'+escHtml(r.product_name)+'</strong></td>'+
          '<td>'+escHtml(r.customer_name)+'</td>'+
          '<td>'+stars(r.rating)+'</td>'+
          '<td style="font-size:.82rem;max-width:250px;overflow:hidden;text-overflow:ellipsis">'+escHtml(r.comment||'-')+'</td>'+
          '<td><span class="badge '+(sb[r.status]||'b-gray')+'">'+r.status+'</span></td>'+
          '<td style="color:var(--muted);font-size:.8rem">'+(r.created_at?.split(' ')[0]||'-')+'</td>'+
          '<td style="white-space:nowrap">'+
          (r.status!=='approved'?'<button class="btn btn-primary btn-sm" onclick="approve('+r.id+')">✓</button> ':'') +
          (r.status!=='rejected'?'<button class="btn btn-warning btn-sm" onclick="reject('+r.id+')"></button> ':'') +
          '<button class="btn btn-danger btn-sm" onclick="del('+r.id+')">Eliminar</button></td>'+
          '</tr>').join(''):'<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--muted)">Sin reseñas</td></tr>';
      }
      async function approve(id){await api('PUT','/api/erp/reviews/'+id,{status:'approved'});toast('Aprobada');loadReviews();}
      async function reject(id){await api('PUT','/api/erp/reviews/'+id,{status:'rejected'});toast('Rechazada');loadReviews();}
      async function del(id){if(!confirm('¿Eliminar?'))return;await api('DELETE','/api/erp/reviews/'+id);toast('Eliminada');loadReviews();}
      loadReviews();
      </script>`;
    return c.html(adminLayout('Reseñas', content, 'reviews', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
