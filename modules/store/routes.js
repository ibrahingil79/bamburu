import { Hono } from 'hono';
import { safeError } from '../../core/errors.js';
import { hashPassword, verifyPassword, createCustomerSession, getCustomerSession, destroyCustomerSession } from '../../core/auth.js';
import { escHtml, escHtmlMultiline, safeUrl } from '../../core/escape.js';
import { rateLimit } from '../../core/rate-limit.js';
import { validate } from '../../core/validate.js';
import { validateCouponSchema, checkoutSchema, newsletterSchema, storeReviewSchema, accountRegisterSchema, accountLoginSchema, wishlistSchema } from './schemas.js';

const customerLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: 'customer-login',
  message: 'Demasiados intentos de login. Espera 15 minutos.',
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyPrefix: 'customer-register',
  message: 'Demasiados registros desde esta IP.',
});

const newsletterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyPrefix: 'newsletter',
  message: 'Demasiadas suscripciones desde esta IP. Inténtalo más tarde.',
});

const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyPrefix: 'review',
  message: 'Demasiadas reseñas desde esta IP. Inténtalo más tarde.',
});

const checkoutLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyPrefix: 'checkout',
  message: 'Demasiados pedidos desde esta IP. Inténtalo más tarde.',
});

function getStoreSettings(db) {
  return db.prepare('SELECT * FROM store_settings WHERE id=1').get() || { store_name:'Bamburu Store', primary_color:'#10b981' };
}

function getDefaultHomepageSections() {
  return [
    {
      id: "hero",
      type: "hero",
      active: true,
      settings: {
        title: "Calidad y Diseño en Cada Detalle",
        subtitle: "Descubre nuestra colección exclusiva con materiales premium y acabados artesanales.",
        btn_text: "Explorar Colección",
        btn_link: "/store/catalog",
        align: "center",
        use_banner_bg: false
      }
    },
    {
      id: "features",
      type: "features",
      active: true,
      settings: {
        title: "Por qué elegirnos",
        subtitle: "Creamos experiencias únicas a través de productos excepcionales",
        items: [
          { icon: "🚚", title: "Envío Express", desc: "Entrega rápida y segura en 24/48 horas con seguimiento en tiempo real." },
          { icon: "🛡️", title: "Pago Seguro", desc: "Tus transacciones están protegidas con cifrado SSL de nivel bancario." },
          { icon: "🔄", title: "Devoluciones Gratuitas", desc: "Garantía de satisfacción total. Tienes 30 días para cambios y devoluciones." }
        ]
      }
    },
    {
      id: "featured_products",
      type: "featured_products",
      active: true,
      settings: {
        title: "Productos Destacados",
        subtitle: "Nuestra selección especial recomendada para ti",
        limit: 8
      }
    },
    {
      id: "testimonials",
      type: "testimonials",
      active: true,
      settings: {
        title: "Clientes Satisfechos",
        subtitle: "Lo que opinan quienes ya confían en nosotros",
        items: [
          { name: "Sofía Martínez", rating: 5, comment: "La calidad del producto superó mis expectativas. Además, la atención al cliente fue impecable. ¡Recomendado!" },
          { name: "Alejandro Sanz", rating: 5, comment: "El envío llegó al día siguiente. Muy bien embalado y el producto funciona a la perfección. Repetiré seguro." },
          { name: "Laura Belmonte", rating: 4, comment: "Excelente diseño y acabados. Un producto premium que vale cada céntimo. Muy contenta con la compra." }
        ]
      }
    },
    {
      id: "newsletter",
      type: "newsletter",
      active: true,
      settings: {
        title: "Únete a nuestro Club",
        subtitle: "Regístrate y recibe un 10% de descuento en tu primera compra, además de acceso exclusivo a novedades.",
        btn_text: "Suscribirme"
      }
    }
  ];
}

function getHomepageSections(s) {
  let sections = null;
  if (s.homepage_sections) {
    try {
      sections = JSON.parse(s.homepage_sections);
    } catch (e) {
      console.error("Error parsing homepage_sections:", e);
    }
  }
  
  const defaults = getDefaultHomepageSections();
  if (!sections || !Array.isArray(sections)) {
    return defaults;
  }
  
  return defaults.map(def => {
    const existing = sections.find(sec => sec.id === def.id || sec.type === def.type);
    if (!existing) return def;
    
    const mergedSettings = { ...def.settings, ...existing.settings };
    
    if (def.type === 'features' && Array.isArray(mergedSettings.items)) {
      mergedSettings.items = def.settings.items.map((defItem, idx) => {
        const extItem = mergedSettings.items[idx] || {};
        return { ...defItem, ...extItem };
      });
    }
    if (def.type === 'testimonials' && Array.isArray(mergedSettings.items)) {
      mergedSettings.items = def.settings.items.map((defItem, idx) => {
        const extItem = mergedSettings.items[idx] || {};
        return { ...defItem, ...extItem };
      });
    }
    
    return {
      id: def.id,
      type: def.type,
      active: existing.active !== undefined ? !!existing.active : def.active,
      settings: mergedSettings
    };
  });
}

function resolvePreviewSettings(db, c) {
  const dbSettings = getStoreSettings(db);
  if (!c) return dbSettings;

  const queryTheme = c.req.query('preview_theme');
  
  if (queryTheme === 'clear') {
    c.header('Set-Cookie', 'bamburu_store_preview=; Path=/; Max-Age=0');
    return dbSettings;
  }
  
  if (queryTheme) {
    const settings = {
      theme: queryTheme,
      store_name: c.req.query('preview_name') || dbSettings.store_name,
      tagline: c.req.query('preview_tagline') !== undefined ? c.req.query('preview_tagline') : dbSettings.tagline,
      logo_url: c.req.query('preview_logo') !== undefined ? c.req.query('preview_logo') : dbSettings.logo_url,
      banner_url: c.req.query('preview_banner') !== undefined ? c.req.query('preview_banner') : dbSettings.banner_url,
      primary_color: c.req.query('preview_color') || dbSettings.primary_color,
      announcement: c.req.query('preview_announce') !== undefined ? c.req.query('preview_announce') : dbSettings.announcement,
      homepage_sections: c.req.query('preview_sections') !== undefined ? c.req.query('preview_sections') : dbSettings.homepage_sections,
      facebook_url: dbSettings.facebook_url,
      instagram_url: dbSettings.instagram_url,
      twitter_url: dbSettings.twitter_url,
      terms_html: dbSettings.terms_html,
      privacy_html: dbSettings.privacy_html,
      returns_html: dbSettings.returns_html,
      seo_title: dbSettings.seo_title,
      seo_description: dbSettings.seo_description,
      id: 1
    };
    
    const cookieData = {
      theme: settings.theme,
      store_name: settings.store_name,
      tagline: settings.tagline,
      logo_url: settings.logo_url,
      banner_url: settings.banner_url,
      primary_color: settings.primary_color,
      announcement: settings.announcement
      // homepage_sections excluido: el JSON es demasiado grande para una cookie y
      // ya viene en el query param preview_sections en cada request del iframe
    };

    c.header('Set-Cookie', `bamburu_store_preview=${encodeURIComponent(JSON.stringify(cookieData))}; Path=/; SameSite=Lax`);
    return settings;
  }
  
  const cookieHeader = c.req.header('cookie') || '';
  const match = cookieHeader.match(/(^|;\s*)bamburu_store_preview=([^;]*)/);
  if (match) {
    try {
      const parsed = JSON.parse(decodeURIComponent(match[2]));
      if (parsed && parsed.theme) {
        return {
          theme: parsed.theme,
          store_name: parsed.store_name || dbSettings.store_name,
          tagline: parsed.tagline !== undefined ? parsed.tagline : dbSettings.tagline,
          logo_url: parsed.logo_url !== undefined ? parsed.logo_url : dbSettings.logo_url,
          banner_url: parsed.banner_url !== undefined ? parsed.banner_url : dbSettings.banner_url,
          primary_color: parsed.primary_color || dbSettings.primary_color,
          announcement: parsed.announcement !== undefined ? parsed.announcement : dbSettings.announcement,
          homepage_sections: dbSettings.homepage_sections,
          facebook_url: dbSettings.facebook_url,
          instagram_url: dbSettings.instagram_url,
          twitter_url: dbSettings.twitter_url,
          terms_html: dbSettings.terms_html,
          privacy_html: dbSettings.privacy_html,
          returns_html: dbSettings.returns_html,
          seo_title: dbSettings.seo_title,
          seo_description: dbSettings.seo_description,
          id: 1
        };
      }
    } catch(e) {}
  }

  return dbSettings;
}



function getThemeStyles(theme, primaryColor) {
  let p = primaryColor || '#10b981';
  
  if (theme === 'nordic_forest' && p === '#10b981') {
    p = '#1b4d3e';
  } else if (theme === 'vintage_warm' && p === '#10b981') {
    p = '#c84b31';
  }

  let fontLink = '';
  let css = '';

  switch (theme) {
    case 'minimal_dark':
      fontLink = `
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
      `;
      css = `
        :root {
          --p: ${p};
        }
        body {
          font-family: 'Outfit', sans-serif;
          background: #0f172a;
          color: #e2e8f0;
        }
        header {
          background: #1e293b;
          border-bottom: 1px solid #334155;
        }
        header a {
          color: #cbd5e1;
        }
        header a:hover {
          color: var(--p);
        }
        .card {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 12px;
        }
        .card-img {
          background: #0f172a;
        }
        .card-title {
          color: #ffffff;
        }
        .compare-price {
          color: #64748b;
        }
        .btn-secondary {
          background: #334155;
          color: #cbd5e1;
          border: 1px solid #475569;
        }
        .btn-secondary:hover {
          background: #475569;
        }
        section {
          background: #1e293b !important;
          border: 1px solid #334155;
        }
        section h1, section h2, section h3, section h4 {
          color: #ffffff !important;
        }
        section p {
          color: #94a3b8 !important;
        }
        .form-label {
          color: #94a3b8;
        }
        .form-control {
          background: #1e293b;
          border: 1px solid #334155;
          color: #ffffff;
        }
        .form-control:focus {
          border-color: var(--p);
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
        }
        .alert-ok {
          background: rgba(16, 185, 129, 0.15);
          color: #34d399;
          border-color: #059669;
        }
        .alert-err {
          background: rgba(239, 68, 68, 0.15);
          color: #f87171;
          border-color: #b91c1c;
        }
      `;
      break;

    case 'nordic_forest':
      fontLink = `
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
      `;
      css = `
        :root {
          --p: ${p};
        }
        body {
          font-family: 'Inter', sans-serif;
          background: #f4f3ef;
          color: #2c3e35;
        }
        h1, h2, h3, h4, h5, h6, .card-title {
          font-family: 'Lora', serif;
          color: #1b4d3e;
          font-weight: 600;
        }
        header {
          background: #ffffff;
          border-bottom: 1px solid #e5e3dc;
        }
        header a {
          color: #2c3e35;
        }
        .card {
          background: #ffffff;
          border: 1px solid #e5e3dc;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(27, 77, 62, 0.04);
        }
        .card-img {
          background: #fcfbfa;
        }
        .btn {
          border-radius: 8px;
        }
        .btn-secondary {
          background: #e8e6df;
          color: #2c3e35;
          border: 1px solid #d3d0c5;
        }
        .btn-secondary:hover {
          background: #d3d0c5;
        }
        section {
          background: #ffffff !important;
          border: 1px solid #e5e3dc;
          box-shadow: 0 4px 12px rgba(27, 77, 62, 0.04);
        }
        .form-control {
          background: #ffffff;
          border: 1px solid #d3d0c5;
          border-radius: 8px;
        }
      `;
      break;

    case 'bold_tech':
      fontLink = `
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet">
      `;
      css = `
        :root {
          --p: ${p};
        }
        body {
          font-family: 'Space Grotesk', sans-serif;
          background: #ffffff;
          color: #000000;
        }
        h1, h2, h3, h4, h5, h6, .card-title, header a, .btn {
          text-transform: uppercase;
          font-weight: 700;
          letter-spacing: 0.05em;
        }
        header {
          background: #ffffff;
          border-bottom: 2px solid #000000;
        }
        header a {
          color: #000000;
        }
        .card {
          background: #ffffff;
          border: 2px solid #000000;
          border-radius: 0px !important;
          box-shadow: 4px 4px 0px #000000;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .card:hover {
          transform: translate(-2px, -2px);
          box-shadow: 6px 6px 0px #000000;
        }
        .card-img {
          background: #f1f5f9;
          border-bottom: 2px solid #000000;
          border-radius: 0px !important;
        }
        .badge {
          border-radius: 0px !important;
          border: 1.5px solid #000000;
        }
        .btn {
          border-radius: 0px !important;
          border: 2px solid #000000;
          box-shadow: 3px 3px 0px #000000;
        }
        .btn:hover {
          transform: translate(-1px, -1px);
          box-shadow: 4px 4px 0px #000000;
          filter: none;
        }
        .btn-primary {
          background: var(--p);
          color: #000000;
        }
        .btn-secondary {
          background: #ffffff;
          color: #000000;
        }
        .btn-secondary:hover {
          background: #f1f5f9;
        }
        .cart-fab {
          border-radius: 0px !important;
          border: 2px solid #000000;
          box-shadow: 4px 4px 0px #000000;
        }
        .cart-count {
          border-radius: 0px !important;
          border: 1.5px solid #000000;
        }
        section {
          background: #ffffff !important;
          border: 2px solid #000000 !important;
          border-radius: 0px !important;
          box-shadow: 4px 4px 0px #000000;
        }
        input, select, textarea, .form-control {
          border: 2px solid #000000 !important;
          border-radius: 0px !important;
          box-shadow: 2px 2px 0px #000000;
        }
        input:focus, select:focus, textarea:focus, .form-control:focus {
          box-shadow: 3px 3px 0px var(--p);
          border-color: #000000 !important;
        }
        .alert {
          border: 2px solid #000000 !important;
          border-radius: 0px !important;
          box-shadow: 3px 3px 0px #000000;
          color: #000000 !important;
        }
        .alert-ok {
          background: #d1fae5 !important;
        }
        .alert-err {
          background: #fee2e2 !important;
        }
        footer {
          border-top: 2px solid #000000;
          background: #ffffff;
          color: #000000;
        }
        footer a {
          color: #000000;
          font-weight: 700;
        }
        footer a:hover {
          color: var(--p);
        }
      `;
      break;

    case 'vintage_warm':
      fontLink = `
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@0,300;0,400;0,700;1,300;1,400&display=swap" rel="stylesheet">
      `;
      css = `
        :root {
          --p: ${p};
        }
        body {
          font-family: 'Merriweather', serif;
          background: #faf6f0;
          color: #3d342e;
          font-weight: 300;
        }
        h1, h2, h3, h4, h5, h6, .card-title, header a, .btn {
          font-weight: 700;
          color: #2b221a;
        }
        header {
          background: #fffdf9;
          border-bottom: 1px solid #e8dec9;
        }
        header a {
          color: #3d342e;
        }
        .card {
          background: #fffdf9;
          border: 1px solid #e8dec9;
          border-radius: 6px;
          box-shadow: 0 4px 10px rgba(61, 52, 46, 0.03);
        }
        .card-img {
          background: #fbf9f5;
        }
        .btn {
          border-radius: 6px;
          font-family: 'Merriweather', serif;
        }
        .btn-secondary {
          background: #f3eae0;
          color: #3d342e;
          border: 1px solid #e8dec9;
        }
        .btn-secondary:hover {
          background: #e8dec9;
        }
        section {
          background: #fffdf9 !important;
          border: 1px solid #e8dec9;
          box-shadow: 0 6px 15px rgba(61, 52, 46, 0.03);
        }
        .form-control {
          background: #ffffff;
          border: 1px solid #e8dec9;
          border-radius: 6px;
        }
        footer {
          background: #2b221a;
          color: #a2968c;
        }
        footer a {
          color: #a2968c;
        }
        footer a:hover {
          color: #ffffff;
        }
      `;
      break;

    case 'minimal_light':
    default:
      fontLink = `
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      `;
      css = `
        :root {
          --p: ${p};
        }
        body {
          font-family: 'Inter', sans-serif;
          background: #f8fafc;
          color: #1e293b;
        }
        header {
          background: #ffffff;
          border-bottom: 1px solid #e2e8f0;
        }
        .card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
        }
      `;
      break;
  }

  return { fontLink, css };
}

function buildPage(db, title, content, bodyScript = '', c = null) {
  const s = resolvePreviewSettings(db, c);
  let p = s.primary_color || '#10b981';
  
  if (s.theme === 'nordic_forest' && p === '#10b981') {
    p = '#1b4d3e';
  } else if (s.theme === 'vintage_warm' && p === '#10b981') {
    p = '#c84b31';
  }

  const { fontLink, css } = getThemeStyles(s.theme || 'minimal_light', p);
  const ann = s.announcement ? `<div style="background:${p};color:#fff;text-align:center;padding:.5rem;font-size:.85rem">${escHtml(s.announcement)}</div>` : '';
  const logoImg = s.logo_url ? `<img src="${s.logo_url}" style="height:36px;max-height:36px;object-fit:contain" alt="${escHtml(s.store_name||'')}">` : `<span style="font-size:1.3rem">🎋</span>`;
  const logo = `<div style="display:flex;align-items:center;gap:0.6rem">
    ${logoImg}
    <span class="store-name-text" style="font-size:1.25rem;font-weight:700;color:inherit;text-transform:none;letter-spacing:normal">${escHtml(s.store_name||'')}</span>
  </div>`;
  const social = [s.facebook_url && `<a href="${safeUrl(s.facebook_url)}" target="_blank" style="color:#94a3b8;font-size:.8rem">Facebook</a>`, s.instagram_url && `<a href="${safeUrl(s.instagram_url)}" target="_blank" style="color:#94a3b8;font-size:.8rem">Instagram</a>`, s.twitter_url && `<a href="${safeUrl(s.twitter_url)}" target="_blank" style="color:#94a3b8;font-size:.8rem">Twitter</a>`].filter(Boolean).join(' · ');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${escHtml(title)} | ${escHtml(s.store_name||'')}</title>
  ${s.seo_description ? `<meta name="description" content="${escHtml(s.seo_description)}">` : ''}
  ${fontLink}
  <style>
    :root{--p:${p}}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#1e293b}
    header{background:#fff;border-bottom:1px solid #e2e8f0;padding:.875rem 1.5rem;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:100}
    header a{text-decoration:none;color:#334155;font-weight:500;font-size:.9rem}
    header a:hover{color:var(--p)}
    nav{display:flex;gap:1.25rem;align-items:center}
    main{max-width:1200px;margin:2rem auto;padding:0 1rem}
    .grid{display:grid;gap:1.25rem}
    .grid-cards{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}
    .card-img{height:200px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:2.5rem;overflow:hidden;position:relative}
    .card-img img{width:100%;height:100%;object-fit:cover}
    .card-body{padding:1rem}
    .card-title{font-weight:600;margin-bottom:.35rem;font-size:.95rem}
    .card-price{color:var(--p);font-weight:700;font-size:1.15rem}
    .compare-price{text-decoration:line-through;color:#94a3b8;font-size:.85rem;margin-left:.4rem}
    .btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;padding:.5rem 1rem;border-radius:6px;font-size:.875rem;font-weight:600;cursor:pointer;border:none;text-decoration:none;transition:.15s}
    .btn-primary{background:var(--p);color:#fff;width:100%;margin-top:.75rem}
    .btn-primary:hover{filter:brightness(.9)}
    .btn-secondary{background:#f1f5f9;color:#334155;border:1px solid #e2e8f0}
    .btn-secondary:hover{background:#e2e8f0}
    .badge{display:inline-flex;padding:.18rem .5rem;border-radius:99px;font-size:.7rem;font-weight:600}
    .badge-sale{background:#fee2e2;color:#991b1b;position:absolute;top:.5rem;left:.5rem}
    .badge-featured{background:#fef3c7;color:#92400e;position:absolute;top:.5rem;right:.5rem}
    .cart-fab{position:fixed;bottom:1.5rem;right:1.5rem;background:var(--p);color:#fff;width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.2);font-size:1.3rem;text-decoration:none;z-index:200}
    .cart-count{position:absolute;top:-5px;right:-5px;background:#ef4444;color:#fff;font-size:.65rem;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700}
    footer{background:#0f172a;color:#94a3b8;padding:2rem;text-align:center;margin-top:4rem;font-size:.85rem}
    footer a{color:#64748b;text-decoration:none;margin:0 .5rem}
    footer a:hover{color:#94a3b8}
    .stars{color:#f59e0b}
    input,select,textarea{font-family:inherit}
    .form-group{margin-bottom:.9rem}
    .form-label{display:block;font-size:.83rem;font-weight:500;margin-bottom:.3rem;color:#475569}
    .form-control{width:100%;padding:.55rem .75rem;border:1px solid #e2e8f0;border-radius:6px;font-size:.875rem;color:#1e293b}
    .form-control:focus{outline:none;border-color:var(--p);box-shadow:0 0 0 3px rgba(16,185,129,.1)}
    .alert{padding:.75rem 1rem;border-radius:8px;margin-bottom:1rem;font-size:.85rem}
    .alert-ok{background:#d1fae5;color:#065f46;border:1px solid #6ee7b7}
    .alert-err{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}
    @media(max-width:600px){.grid-cards{grid-template-columns:repeat(2,1fr)}.card-img{height:150px}}

    /* Dynamic Sections Common Styles */
    .home-section {
      padding: 4rem 1.5rem;
      margin-bottom: 2.5rem;
      border-radius: 12px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
    }
    
    /* Hero Section */
    .hero-section {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-height: 380px;
      padding: 3rem 2rem;
      position: relative;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0,0,0,0.02);
    }
    .hero-section.align-left { text-align: left; align-items: flex-start; }
    .hero-section.align-center { text-align: center; align-items: center; }
    .hero-section.align-right { text-align: right; align-items: flex-end; }
    
    .hero-bg-overlay {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background-size: cover;
      background-position: center;
      z-index: 1;
      opacity: 0.15;
    }
    .hero-content {
      position: relative;
      z-index: 2;
      max-width: 800px;
    }
    .hero-title {
      font-size: 2.8rem;
      font-weight: 800;
      line-height: 1.2;
      margin-bottom: 1rem;
      color: #0f172a;
    }
    .hero-subtitle {
      font-size: 1.2rem;
      color: #475569;
      line-height: 1.6;
      margin-bottom: 2rem;
    }
    .hero-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 1rem;
      padding: 0.75rem 2rem;
      transition: all 0.2s;
    }
    
    /* Features Grid */
    .features-section {
      text-align: center;
      background: #ffffff;
    }
    .section-header {
      max-width: 600px;
      margin: 0 auto 3rem;
    }
    .section-header h2 {
      font-size: 2rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      color: #0f172a;
    }
    .section-header p {
      font-size: 1rem;
      color: #64748b;
    }
    .features-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2rem;
    }
    .feature-card {
      padding: 2rem 1.5rem;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .feature-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 10px 20px rgba(0,0,0,0.03);
    }
    .feature-icon {
      font-size: 2.5rem;
      margin-bottom: 1.25rem;
      display: inline-block;
    }
    .feature-title {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: #0f172a;
    }
    .feature-desc {
      font-size: 0.9rem;
      color: #475569;
      line-height: 1.5;
    }
    
    /* Products Section */
    .products-section {
      background: transparent;
      border: none;
      padding: 0;
    }
    
    /* Testimonials Section */
    .testimonials-section {
      text-align: center;
      background: #ffffff;
    }
    .testimonials-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2rem;
    }
    .testimonial-card {
      padding: 2rem 1.5rem;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      text-align: left;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .testimonial-stars {
      color: #f59e0b;
      margin-bottom: 1rem;
      font-size: 1rem;
    }
    .testimonial-comment {
      font-size: 0.95rem;
      color: #334155;
      line-height: 1.6;
      font-style: italic;
      margin-bottom: 1.5rem;
      flex: 1;
    }
    .testimonial-author {
      font-weight: 600;
      font-size: 0.9rem;
      color: #0f172a;
      border-top: 1px solid #e2e8f0;
      padding-top: 0.75rem;
    }
    
    /* Newsletter Section */
    .newsletter-section {
      background: #ffffff;
      padding: 4rem 2rem;
      text-align: center;
      box-shadow: 0 4px 20px rgba(0,0,0,0.02);
    }
    .newsletter-title {
      font-size: 2rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      color: #0f172a;
    }
    .newsletter-subtitle {
      font-size: 1rem;
      color: #64748b;
      margin-bottom: 2rem;
      max-width: 500px;
      margin-left: auto;
      margin-right: auto;
    }
    .newsletter-form {
      display: flex;
      gap: 0.5rem;
      max-width: 450px;
      margin: 0 auto;
    }
    
    @media(max-width: 768px) {
      .features-grid, .testimonials-grid {
        grid-template-columns: 1fr;
        gap: 1.5rem;
      }
      .newsletter-form {
        flex-direction: column;
      }
      .hero-title {
        font-size: 2rem;
      }
    }
  </style>
  <style>
    ${css}
  </style>
</head>
<body>
  ${ann}
  <header>
    <a href="/store">${logo}</a>
    <nav>
      <a href="/store/catalog">Catálogo</a>
      <a href="/store/account">Mi cuenta</a>
      <a href="/store/cart">Carrito</a>
    </nav>
  </header>
  <main>${content}</main>
  <a href="/store/cart" class="cart-fab">🛒<span class="cart-count" id="cartCount">0</span></a>
  <footer>
    <div style="margin-bottom:.75rem">${social}</div>
    <div>
      ${s.terms_html ? '<a href="/store/legal/terms">Términos</a>' : ''}
      ${s.privacy_html ? '<a href="/store/legal/privacy">Privacidad</a>' : ''}
      ${s.returns_html ? '<a href="/store/legal/returns">Devoluciones</a>' : ''}
    </div>
    <div style="margin-top:.75rem">© ${new Date().getFullYear()} ${escHtml(s.store_name||'')}</div>
  </footer>
  <script${c && c.get ? ` nonce="${c.get('cspNonce')}"` : ''}>
    function escHtml(s){if(s==null)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
    function getCart(){return JSON.parse(localStorage.getItem('cart')||'[]')}
    function saveCart(c){localStorage.setItem('cart',JSON.stringify(c))}
    function addToCart(id,name,price,variantId,variantName){
      const c=getCart();
      const key=id+(variantId?'_v'+variantId:'');
      const ex=c.find(x=>x.key===key);
      if(ex)ex.qty++;
      else c.push({key,id,name:(variantName?name+' ('+variantName+')':name),price,qty:1,variantId:variantId||null});
      saveCart(c);updateCartUI();
      const t=document.createElement('div');
      t.style.cssText='position:fixed;bottom:5rem;right:1.5rem;background:#059669;color:#fff;padding:.6rem 1rem;border-radius:8px;font-size:.85rem;font-weight:500;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.2)';
      t.textContent='✓ Agregado al carrito';
      document.body.appendChild(t);setTimeout(()=>t.remove(),2000);
    }
    function updateCartUI(){
      const c=getCart();
      const el=document.getElementById('cartCount');
      if(el)el.textContent=c.reduce((a,b)=>a+b.qty,0);
    }
    updateCartUI();
    ${bodyScript}

    // ── 5 SEP 2026 (csp-erp-migrar-handlers) — ENGANCHE DE LA TIENDA ────────────────────────────
    // Un solo despachador para las diez pantallas: cada una trae los controles que trae, y la rama
    // solo se ejecuta si su elemento existe, asi que no hace falta saber en cual estamos. El
    // carrito y la lista de deseos se PINTAN desde JavaScript, de modo que esto tiene que ir por
    // delegacion o cada linea nueva naceria con el boton muerto.
    document.addEventListener('click', function(e){
      var t = e.target.closest('[data-tn]'); if (!t) return;
      var a = t.getAttribute('data-tn');
      if (a === 'newsletter') subscribeNewsletter();
      else if (a === 'img') setMainImg(t.getAttribute('data-img'), t);
      else if (a === 'add-carrito') addToCartFromPage();
      else if (a === 'deseos') addToWishlist();
      else if (a === 'resena') submitReview();
      else if (a === 'cant') changeQty(Number(t.getAttribute('data-i')), Number(t.getAttribute('data-d')));
      else if (a === 'quitar') removeItem(Number(t.getAttribute('data-i')));
      else if (a === 'cupon') applyCoupon();
      else if (a === 'pedido') placeOrder();
      else if (a === 'salir') logout();
      else if (a === 'quitar-deseo') removeWish(Number(t.getAttribute('data-id')));
      else if (a === 'entrar') doLogin();
      else if (a === 'registrar') doRegister();
    });
    document.addEventListener('input', function(e){
      if (e.target.closest('[data-tn="filtrar"]')) filterCatalog();
    });
    document.addEventListener('change', function(e){
      var t = e.target.closest('[data-tn]'); if (!t) return;
      if (t.getAttribute('data-tn') === 'filtrar') filterCatalog();
      else if (t.getAttribute('data-tn') === 'envio') updateTotal();
    });
    // La foto que no carga: 'error' NO burbujea como los demas, pero SI se ve en captura.
    document.addEventListener('error', function(e){
      var img = e.target.closest ? e.target.closest('[data-tn="img-rota"]') : null;
      if (img) img.style.display = 'none';
    }, true);
  </script>
</body>
</html>`;
}

export function createRoutes(app, db) {
  const api = new Hono();
  const views = new Hono();

  // ── STORE API ──────────────────────────────────────────────────
  api.get('/products', c => {
    try {
      const cat = c.req.query('category');
      const tag = c.req.query('tag');
      const search = c.req.query('q');
      const featured = c.req.query('featured');
      let q = "SELECT p.*,c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE (p.status='active' OR p.status IS NULL)";
      const params = [];
      if (cat) { q += ' AND p.category_id=?'; params.push(cat); }
      if (search) { q += ' AND p.name LIKE ?'; params.push('%'+search+'%'); }
      if (featured) { q += ' AND p.featured=1'; }
      q += ' ORDER BY p.featured DESC, p.id DESC';
      const products = db.prepare(q).all(...params);
      if (tag) {
        const tagRow = db.prepare('SELECT id FROM tags WHERE name=?').get(tag);
        if (tagRow) {
          const taggedIds = new Set(db.prepare('SELECT product_id FROM product_tags WHERE tag_id=?').all(tagRow.id).map(r => r.product_id));
          return c.json(products.filter(p => taggedIds.has(p.id)));
        }
      }
      return c.json(products);
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.get('/products/:idOrSlug', c => {
    try {
      const key = c.req.param('idOrSlug');
      const p = isNaN(key) ? db.prepare("SELECT p.*,c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.slug=? AND p.status='active'").get(key) : db.prepare("SELECT p.*,c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.id=? AND p.status='active'").get(key);
      if (!p) return c.json({error:'No encontrado'},404);
      p.images = db.prepare('SELECT * FROM product_images WHERE product_id=? ORDER BY position').all(p.id);
      p.variants = db.prepare('SELECT * FROM product_variants WHERE product_id=?').all(p.id);
      p.reviews = db.prepare("SELECT * FROM product_reviews WHERE product_id=? AND status='approved' ORDER BY id DESC").all(p.id);
      p.avg_rating = p.reviews.length ? (p.reviews.reduce((a,b)=>a+b.rating,0)/p.reviews.length).toFixed(1) : null;
      p.tags = db.prepare('SELECT t.name FROM tags t JOIN product_tags pt ON pt.tag_id=t.id WHERE pt.product_id=?').all(p.id).map(t=>t.name);
      return c.json(p);
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.get('/categories', c => {
    try { return c.json(db.prepare('SELECT * FROM categories ORDER BY name').all()); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.get('/shipping', c => {
    try { return c.json(db.prepare("SELECT * FROM shipping_methods WHERE active=1 ORDER BY price").all()); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.post('/validate-coupon', validate(validateCouponSchema), async c => {
    try {
      const { code, subtotal } = c.get('validated');
      const dc = db.prepare("SELECT * FROM discount_codes WHERE code=? AND active=1 AND (expires_at IS NULL OR expires_at > datetime('now'))").get((code||'').trim().toUpperCase());
      if (!dc) return c.json({error:'Cupón no válido'},400);
      if (subtotal < dc.min_order) return c.json({error:`Mínimo de pedido: €${dc.min_order}`},400);
      if (dc.max_uses !== null && dc.uses_count >= dc.max_uses) return c.json({error:'Cupón agotado'},400);
      const amount = dc.type === 'percentage' ? subtotal * (dc.value/100) : dc.value;
      return c.json({valid:true, discount:{id:dc.id, type:dc.type, value:dc.value}, amount, message:`Cupón aplicado: -€${amount.toFixed(2)}`});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.post('/checkout', checkoutLimiter, validate(checkoutSchema), async c => {
    try {
      const { client, items, shipping_method_id, discount_code } = c.get('validated');
      // If logged in, use session client data as fallback for empty fields
      const sess = getCustomerSession(db, c.req);
      let sessionClient = null;
      if (sess) {
        const acc = db.prepare('SELECT * FROM customer_accounts WHERE id=?').get(sess.customerId);
        if (acc) sessionClient = db.prepare('SELECT * FROM clients WHERE id=?').get(acc.client_id);
      }

      const cfg = db.prepare('SELECT tax_rate FROM company_config WHERE id=1').get();
      const taxRate = cfg?.tax_rate || 21;
      let subtotal = 0;
      items.forEach(i => { subtotal += parseFloat(i.price) * parseInt(i.qty); });

      let shippingCost = 0;
      let shippingId = shipping_method_id || null;
      if (shippingId) {
        const sm = db.prepare('SELECT * FROM shipping_methods WHERE id=?').get(shippingId);
        if (sm) shippingCost = (sm.free_from && subtotal >= sm.free_from) ? 0 : sm.price;
      }

      let discountAmount = 0;
      let discountCodeId = null;
      if (discount_code) {
        const dc = db.prepare("SELECT * FROM discount_codes WHERE code=? AND active=1 AND (expires_at IS NULL OR expires_at > datetime('now'))").get(discount_code.trim().toUpperCase());
        if (dc && subtotal >= dc.min_order) {
          discountAmount = dc.type === 'percentage' ? subtotal * (dc.value/100) : dc.value;
          discountCodeId = dc.id;
        }
      }

      const taxBase = subtotal - discountAmount + shippingCost;
      const tax = taxBase * (taxRate/100);
      const total = taxBase + tax;
      const orderNum = 'WEB-' + Date.now();

      const run = db.transaction(() => {
        for (const it of items) {
          const prod = db.prepare('SELECT stock FROM products WHERE id=?').get(it.id);
          if (!prod) throw new Error('Producto no encontrado: ' + it.name);
          if (it.variant_id) {
            const v = db.prepare('SELECT stock FROM product_variants WHERE id=? AND product_id=?').get(it.variant_id, it.id);
            if (!v) throw new Error('Variante no encontrada: ' + it.name);
            if (v.stock < parseInt(it.qty)) throw new Error('Stock insuficiente para la variante: ' + it.name);
          } else {
            if (prod.stock < parseInt(it.qty)) throw new Error('Stock insuficiente: ' + it.name);
          }
        }
        let clientId = sessionClient ? sessionClient.id : null;
        const clientEmail = client?.email || sessionClient?.email;
        if (clientEmail) {
          const exist = db.prepare('SELECT id FROM clients WHERE email=?').get(clientEmail);
          if (exist) {
            clientId = exist.id;
            // Update client info if fields were provided
            if (client?.name || client?.phone || client?.address) {
              db.prepare('UPDATE clients SET name=COALESCE(NULLIF(?,\'\'),name), phone=COALESCE(NULLIF(?,\'\'),phone), address=COALESCE(NULLIF(?,\'\'),address) WHERE id=?').run(client.name||'', client.phone||'', client.address||'', clientId);
            }
          } else {
            const r = db.prepare('INSERT INTO clients (name,email,phone,address) VALUES (?,?,?,?)').run(client?.name||'', clientEmail, client?.phone||'', client?.address||'');
            clientId = r.lastInsertRowid;
          }
        }
        const ord = db.prepare('INSERT INTO sales_orders (order_number,client_id,shipping_method_id,discount_code_id,subtotal,shipping_cost,discount_amount,tax_amount,total,status,source,customer_notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(orderNum, clientId, shippingId, discountCodeId, subtotal, shippingCost, discountAmount, tax, total, 'pending', 'online', client?.notes||'');
        const orderId = ord.lastInsertRowid;
        items.forEach(it => {
          db.prepare('INSERT INTO sales_items (order_id,product_id,variant_id,product_name,quantity,unit_price,total) VALUES (?,?,?,?,?,?,?)').run(orderId, it.id, it.variant_id || null, it.name, parseInt(it.qty), parseFloat(it.price), parseFloat(it.price)*parseInt(it.qty));
          db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(parseInt(it.qty), it.id);
          if (it.variant_id) {
            db.prepare('UPDATE product_variants SET stock=stock-? WHERE id=? AND product_id=?').run(parseInt(it.qty), it.variant_id, it.id);
          }
          db.prepare('INSERT INTO inventory_movements (product_id,variant_id,type,quantity,reason) VALUES (?,?,?,?,?)').run(it.id, it.variant_id || null, 'out', parseInt(it.qty), `Venta Online (Pedido #${orderNum})`);
        });
        if (clientId) db.prepare('UPDATE clients SET total_spent=total_spent+? WHERE id=?').run(total, clientId);
        if (discountCodeId) db.prepare('UPDATE discount_codes SET uses_count=uses_count+1 WHERE id=?').run(discountCodeId);
        db.prepare('INSERT INTO order_status_history (order_id,status,comment,user_name) VALUES (?,?,?,?)').run(orderId, 'pending', 'Pedido online recibido', 'Sistema');
      });
      run();
      return c.json({success:true, order_number:orderNum, total});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // Newsletter subscribe
  api.post('/newsletter/subscribe', newsletterLimiter, validate(newsletterSchema), async c => {
    try {
      const { email, name } = c.get('validated');
      db.prepare('INSERT OR IGNORE INTO newsletter_subscribers (email,name) VALUES (?,?)').run(email, name||'');
      return c.json({success:true, message:'Suscripción confirmada'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // Reviews submit
  api.post('/reviews', reviewLimiter, validate(storeReviewSchema), async c => {
    try {
      const { product_id, customer_name, rating, comment } = c.get('validated');
      db.prepare('INSERT INTO product_reviews (product_id,customer_name,rating,comment,status) VALUES (?,?,?,?,?)').run(product_id, customer_name||'Anónimo', rating, comment||'', 'pending');
      return c.json({success:true, message:'Reseña enviada, pendiente de moderación'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // ── CUSTOMER ACCOUNTS ──────────────────────────────────────────
  api.post('/account/register', registerLimiter, validate(accountRegisterSchema), async c => {
    try {
      const { name, email, password } = c.get('validated');
      const passwordHash = await hashPassword(password);
      const txn = db.transaction(() => {
        let cl = db.prepare('SELECT id FROM clients WHERE email=?').get(email);
        if (!cl) {
          const r = db.prepare('INSERT INTO clients (name,email) VALUES (?,?)').run(name||email, email);
          cl = { id: r.lastInsertRowid };
        }
        db.prepare('INSERT INTO customer_accounts (client_id,email,password_hash) VALUES (?,?,?)').run(cl.id, email, passwordHash);
      });
      txn();
      const acc = db.prepare('SELECT * FROM customer_accounts WHERE email=?').get(email);
      const sessionId = createCustomerSession(db, acc.id);
      const headers = new Headers({'Content-Type':'application/json'});
      headers.set('Set-Cookie', `csess=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
      return new Response(JSON.stringify({success:true}), {headers});
    } catch(e) { return c.json({error:safeError(e).includes('UNIQUE')?'Email ya registrado':e.message},500); }
  });

  api.post('/account/login', customerLoginLimiter, validate(accountLoginSchema), async c => {
    try {
      const { email, password } = c.get('validated');
      const acc = db.prepare('SELECT * FROM customer_accounts WHERE email=? AND active=1').get(email);
      if (!acc) return c.json({error:'Credenciales incorrectas'},401);
      const result = await verifyPassword(password, acc.password_hash);
      if (!result.valid) return c.json({error:'Credenciales incorrectas'},401);
      if (result.needsRehash) {
        db.prepare('UPDATE customer_accounts SET password_hash=? WHERE id=?').run(await hashPassword(password), acc.id);
      }
      const sessionId = createCustomerSession(db, acc.id);
      const headers = new Headers({'Content-Type':'application/json'});
      headers.set('Set-Cookie', `csess=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
      return new Response(JSON.stringify({success:true}), {headers});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.post('/account/logout', c => {
    const cookie = c.req.header('cookie') || '';
    const match = cookie.match(/csess=([A-Za-z0-9_-]+)/);
    if (match) destroyCustomerSession(db, match[1]);
    const headers = new Headers({'Content-Type':'application/json'});
    headers.set('Set-Cookie', 'csess=; Path=/; Max-Age=0');
    return new Response(JSON.stringify({success:true}), {headers});
  });

  api.get('/account/orders', c => {
    try {
      const sess = getCustomerSession(db, c.req);
      if (!sess) return c.json({error:'No autenticado'},401);
      const acc = db.prepare('SELECT * FROM customer_accounts WHERE id=?').get(sess.customerId);
      if (!acc) return c.json({error:'No encontrado'},404);
      const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(acc.client_id);
      const orders = cl ? db.prepare('SELECT so.*,si.product_name,si.quantity,si.unit_price FROM sales_orders so LEFT JOIN sales_items si ON si.order_id=so.id WHERE so.client_id=? ORDER BY so.id DESC').all(cl.id) : [];
      return c.json({client: cl, orders});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // Wishlist
  api.get('/account/wishlist', c => {
    try {
      const sess = getCustomerSession(db, c.req);
      if (!sess) return c.json([]);
      return c.json(db.prepare('SELECT w.*,p.name,p.price,p.image_url,p.slug FROM wishlist w JOIN products p ON w.product_id=p.id WHERE w.customer_id=?').all(sess.customerId));
    } catch(e) { return c.json([]); }
  });

  api.post('/account/wishlist', validate(wishlistSchema), async c => {
    try {
      const sess = getCustomerSession(db, c.req);
      if (!sess) return c.json({error:'No autenticado'},401);
      const { product_id } = c.get('validated');
      db.prepare('INSERT OR IGNORE INTO wishlist (customer_id,product_id) VALUES (?,?)').run(sess.customerId, product_id);
      return c.json({success:true});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.delete('/account/wishlist/:pid', c => {
    try {
      const sess = getCustomerSession(db, c.req);
      if (!sess) return c.json({error:'No autenticado'},401);
      db.prepare('DELETE FROM wishlist WHERE customer_id=? AND product_id=?').run(sess.customerId, c.req.param('pid'));
      return c.json({success:true});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // ── STORE VIEWS ────────────────────────────────────────────────
  views.get('/', c => {
    const s = resolvePreviewSettings(db, c);
    const sections = getHomepageSections(s);
    
    let htmlContent = '';
    
    for (const section of sections) {
      if (!section.active) continue;
      
      switch (section.type) {
        case 'hero': {
          const opt = section.settings;
          const bgOverlay = opt.use_banner_bg && s.banner_url 
            ? `<div class="hero-bg-overlay" style="background-image: url('${s.banner_url}')"></div>` 
            : '';
          const alignClass = `align-${opt.align || 'center'}`;
          
          htmlContent += `
            <section class="home-section hero-section ${alignClass}">
              ${bgOverlay}
              <div class="hero-content">
                <h1 class="hero-title">${escHtml(opt.title || s.store_name || '')}</h1>
                ${opt.subtitle ? `<p class="hero-subtitle">${escHtml(opt.subtitle)}</p>` : ''}
                ${opt.btn_text && opt.btn_link ? `<a href="${safeUrl(opt.btn_link)}" class="btn btn-primary hero-btn">${escHtml(opt.btn_text)} →</a>` : ''}
              </div>
            </section>
          `;
          break;
        }
        case 'features': {
          const opt = section.settings;
          const itemsHtml = (opt.items || []).map(item => `
            <div class="feature-card">
              <span class="feature-icon">${escHtml(item.icon || '✨')}</span>
              <h3 class="feature-title">${escHtml(item.title || '')}</h3>
              <p class="feature-desc">${escHtml(item.desc || '')}</p>
            </div>
          `).join('');
          
          htmlContent += `
            <section class="home-section features-section">
              <div class="section-header">
                <h2>${escHtml(opt.title || 'Por qué elegirnos')}</h2>
                ${opt.subtitle ? `<p>${escHtml(opt.subtitle)}</p>` : ''}
              </div>
              <div class="features-grid">
                ${itemsHtml}
              </div>
            </section>
          `;
          break;
        }
        case 'featured_products': {
          const opt = section.settings;
          const limit = parseInt(opt.limit) || 8;
          
          htmlContent += `
            <div class="section-header" style="margin-top: 3rem; margin-bottom: 1.5rem; text-align: center;">
              <h2>${escHtml(opt.title || 'Productos Destacados')}</h2>
              ${opt.subtitle ? `<p>${escHtml(opt.subtitle)}</p>` : ''}
            </div>
            <section class="home-section products-section">
              <div id="featured" class="grid grid-cards" data-limit="${limit}"><p style="color:#64748b; text-align: center; width: 100%;">Cargando...</p></div>
              <div style="text-align:center;margin-top:2rem">
                <a href="/store/catalog" class="btn btn-secondary" style="display:inline-flex;width:auto">Ver todos los productos</a>
              </div>
            </section>
          `;
          break;
        }
        case 'testimonials': {
          const opt = section.settings;
          const itemsHtml = (opt.items || []).map(item => {
            const ratingVal = parseInt(item.rating) || 5;
            const starsHtml = '⭐'.repeat(ratingVal);
            return `
              <div class="testimonial-card">
                <div>
                  <div class="testimonial-stars">${starsHtml}</div>
                  <p class="testimonial-comment">"${escHtml(item.quote || item.comment || '')}"</p>
                </div>
                <div class="testimonial-author">${escHtml(item.name || '')}</div>
              </div>
            `;
          }).join('');
          
          htmlContent += `
            <section class="home-section testimonials-section">
              <div class="section-header">
                <h2>${escHtml(opt.title || 'Opiniones de Clientes')}</h2>
                ${opt.subtitle ? `<p>${escHtml(opt.subtitle)}</p>` : ''}
              </div>
              <div class="testimonials-grid">
                ${itemsHtml}
              </div>
            </section>
          `;
          break;
        }
        case 'newsletter': {
          const opt = section.settings;
          htmlContent += `
            <section class="home-section newsletter-section">
              <h2 class="newsletter-title">${escHtml(opt.title || 'Suscríbete')}</h2>
              ${opt.subtitle ? `<p class="newsletter-subtitle">${escHtml(opt.subtitle)}</p>` : ''}
              <div class="newsletter-form">
                <input id="nlEmail" type="email" placeholder="tu@email.com" class="form-control" style="flex:1;">
                <button class="btn btn-primary" style="width:auto;padding:.5rem 1.5rem" data-tn="newsletter">${escHtml(opt.button_text || opt.btn_text || 'Suscribirme')}</button>
              </div>
              <div id="nlMsg" style="margin-top:.75rem;font-size:.85rem"></div>
            </section>
          `;
          break;
        }
      }
    }

    return c.html(buildPage(db, 'Inicio', htmlContent, `
      const featEl = document.getElementById('featured');
      if (featEl) {
        const limit = parseInt(featEl.dataset.limit) || 8;
        fetch('/api/store/products?featured=1').then(r=>r.json()).then(prods=>{
          const show=prods.slice(0,limit);
          featEl.innerHTML=show.length?show.map(p=>'<div class="card"><div class="card-img">'+(p.image_url?'<img src="'+escHtml(p.image_url)+'" alt="'+escHtml(p.name)+'">'+'<span class="badge badge-featured">Destacado</span>':'📦')+'</div><div class="card-body"><div class="card-title">'+escHtml(p.name)+'</div><div><span class="card-price">€'+p.price.toFixed(2)+'</span>'+(p.compare_price?'<span class="compare-price">€'+p.compare_price.toFixed(2)+'</span>':'')+'</div><a href="/store/product/'+p.id+'" class="btn btn-primary">Ver producto</a></div></div>').join(''):'<p style="color:#64748b; text-align: center; width: 100%;">No hay productos destacados</p>';
        });
      }
      async function subscribeNewsletter(){
        const email=document.getElementById('nlEmail').value;
        const r=await fetch('/api/store/newsletter/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
        const d=await r.json();
        document.getElementById('nlMsg').innerHTML=d.error?'<span style="color:#ef4444">'+d.error+'</span>':'<span style="color:#10b981">✓ '+d.message+'</span>';
      }
    `, c));
  });

  views.get('/catalog', c => {
    const cats = db.prepare('SELECT * FROM categories ORDER BY name').all();
    const catOpts = cats.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
    const content = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;flex-wrap:wrap;gap:.75rem">
        <h1 style="font-size:1.5rem">Catálogo</h1>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <input id="searchQ" placeholder="Buscar..." style="padding:.5rem .75rem;border:1px solid #e2e8f0;border-radius:6px;font-size:.875rem;min-width:180px" data-tn="filtrar">
          <select id="catFilter" style="padding:.5rem .75rem;border:1px solid #e2e8f0;border-radius:6px;font-size:.875rem" data-tn="filtrar">
            <option value="">Todas las categorías</option>
            ${catOpts}
          </select>
          <select id="sortFilter" style="padding:.5rem .75rem;border:1px solid #e2e8f0;border-radius:6px;font-size:.875rem" data-tn="filtrar">
            <option value="default">Orden por defecto</option>
            <option value="price_asc">Precio: menor a mayor</option>
            <option value="price_desc">Precio: mayor a menor</option>
            <option value="name">Nombre A-Z</option>
          </select>
        </div>
      </div>
      <div id="catalog" class="grid grid-cards"></div>`;
    return c.html(buildPage(db, 'Catálogo', content, `
      let allProds=[];
      fetch('/api/store/products').then(r=>r.json()).then(p=>{allProds=p;renderProds(p);});
      function filterCatalog(){
        const q=document.getElementById('searchQ').value.toLowerCase();
        const cat=document.getElementById('catFilter').value;
        const sort=document.getElementById('sortFilter').value;
        let f=allProds.filter(p=>(!q||p.name.toLowerCase().includes(q))&&(!cat||p.category_id==cat));
        if(sort==='price_asc')f=[...f].sort((a,b)=>a.price-b.price);
        else if(sort==='price_desc')f=[...f].sort((a,b)=>b.price-a.price);
        else if(sort==='name')f=[...f].sort((a,b)=>a.name.localeCompare(b.name));
        renderProds(f);
      }
      function renderProds(prods){
        document.getElementById('catalog').innerHTML=prods.length?prods.map(p=>'<div class="card"><div class="card-img">'+(p.compare_price?'<span class="badge badge-sale">Oferta</span>':'')+(p.featured?'<span class="badge badge-featured">Destacado</span>':'')+(p.image_url?'<img src="'+escHtml(p.image_url)+'" alt="'+escHtml(p.name)+'">'+'':'📦')+'</div><div class="card-body"><div class="card-title">'+escHtml(p.name)+'</div>'+(p.category_name?'<div style="font-size:.75rem;color:#94a3b8;margin-bottom:.25rem">'+escHtml(p.category_name)+'</div>':'')+'<div><span class="card-price">€'+p.price.toFixed(2)+'</span>'+(p.compare_price?'<span class="compare-price">€'+p.compare_price.toFixed(2)+'</span>':'')+'</div><a href="/store/product/'+p.id+'" class="btn btn-primary">Ver producto</a></div></div>').join(''):'<p style="color:#64748b;padding:2rem 0">No hay productos disponibles</p>';
      }
    `, c));
  });

  views.get('/product/:id', c => {
    try {
      const p = db.prepare("SELECT p.*,c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.id=? AND (p.status='active' OR p.status IS NULL)").get(c.req.param('id'));
      if (!p) return c.redirect('/store/catalog');
      p.images = db.prepare('SELECT * FROM product_images WHERE product_id=? ORDER BY position').all(p.id);
      p.variants = db.prepare('SELECT * FROM product_variants WHERE product_id=?').all(p.id);
      p.reviews = db.prepare("SELECT * FROM product_reviews WHERE product_id=? AND status='approved' ORDER BY id DESC").all(p.id);
      const avgRating = p.reviews.length ? (p.reviews.reduce((a,b)=>a+b.rating,0)/p.reviews.length) : 0;
      const stars = n => '★'.repeat(Math.round(n)) + '☆'.repeat(5-Math.round(n));

      const allImgs = [p.image_url, ...p.images.map(i=>i.url)].filter(Boolean);
      const gallery = allImgs.length > 1 ? `<div style="display:flex;gap:.5rem;margin-top:.5rem;flex-wrap:wrap">${allImgs.map((img,i)=>`<img src="${escHtml(img)}" style="width:60px;height:60px;object-fit:cover;border-radius:6px;cursor:pointer;border:2px solid ${i===0?'var(--p)':'#e2e8f0'}" data-tn="img" data-img="${escHtml(img)}">`).join('')}</div>` : '';

      const variantSelect = p.variants.length ? `<div class="form-group"><label class="form-label">Selecciona variante</label><select class="form-control" id="variantSel"><option value="">-- Elige --</option>${p.variants.map(v=>`<option value="${v.id}" data-price="${v.price||p.price}">${escHtml(v.name)} — €${(v.price||p.price).toFixed(2)} (stock: ${v.stock})</option>`).join('')}</select></div>` : '';

      const reviewsHTML = p.reviews.length ? p.reviews.map(r=>`<div style="border-bottom:1px solid #f1f5f9;padding:1rem 0"><div style="display:flex;justify-content:space-between;margin-bottom:.25rem"><span style="font-weight:600">${escHtml(r.customer_name)}</span><span class="stars">${stars(r.rating)}</span></div><p style="font-size:.88rem;color:#475569">${escHtmlMultiline(r.comment||'')}</p></div>`).join('') : '<p style="color:#94a3b8;font-size:.88rem">Sin reseñas aún. ¡Sé el primero!</p>';

      const content = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:2.5rem;margin-bottom:3rem">
          <div>
            <div style="background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
              <img id="mainImg" src="${escHtml(p.image_url||'')}" style="width:100%;height:380px;object-fit:cover" data-tn="img-rota">
              ${!p.image_url ? `<div style="height:380px;display:flex;align-items:center;justify-content:center;font-size:4rem">📦</div>` : ''}
            </div>
            ${gallery}
          </div>
          <div>
            ${p.category_name ? `<div style="font-size:.8rem;color:#94a3b8;margin-bottom:.5rem">${escHtml(p.category_name)}</div>` : ''}
            <h1 style="font-size:1.6rem;margin-bottom:.75rem">${escHtml(p.name)}</h1>
            ${avgRating > 0 ? `<div style="margin-bottom:.75rem"><span class="stars">${stars(avgRating)}</span> <span style="color:#64748b;font-size:.85rem">(${p.reviews.length} reseñas)</span></div>` : ''}
            <div style="margin-bottom:1.25rem">
              <span style="font-size:1.8rem;font-weight:700;color:var(--p)" id="displayPrice">€${p.price.toFixed(2)}</span>
              ${p.compare_price ? `<span style="text-decoration:line-through;color:#94a3b8;font-size:1rem;margin-left:.5rem">€${p.compare_price.toFixed(2)}</span>` : ''}
            </div>
            ${p.description ? `<div style="color:#475569;font-size:.9rem;line-height:1.6;margin-bottom:1.25rem">${escHtmlMultiline(p.description)}</div>` : ''}
            ${variantSelect}
            <div class="form-group" style="display:flex;gap:.5rem;align-items:center">
              <label class="form-label" style="margin:0">Cantidad:</label>
              <input type="number" id="qty" value="1" min="1" style="width:70px;padding:.5rem;border:1px solid #e2e8f0;border-radius:6px;text-align:center">
            </div>
            <button class="btn btn-primary" style="width:auto;padding:.65rem 2rem;font-size:1rem" data-tn="add-carrito">🛒 Agregar al carrito</button>
            <button style="background:none;border:none;color:#64748b;cursor:pointer;margin-left:1rem;font-size:.9rem" data-tn="deseos">❤️ Guardar</button>
          </div>
        </div>

        <div style="margin-bottom:2rem">
          <h2 style="margin-bottom:1.25rem">Reseñas de clientes</h2>
          <div id="reviewsList">${reviewsHTML}</div>
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:1.5rem;margin-top:1.5rem">
            <h3 style="margin-bottom:1rem">Escribir una reseña</h3>
            <div class="form-group"><label class="form-label">Tu nombre</label><input class="form-control" id="rName" placeholder="Tu nombre"></div>
            <div class="form-group"><label class="form-label">Valoración</label>
              <select class="form-control" id="rRating" style="width:auto">
                <option value="5">⭐⭐⭐⭐⭐ Excelente</option>
                <option value="4">⭐⭐⭐⭐ Muy bueno</option>
                <option value="3">⭐⭐⭐ Regular</option>
                <option value="2">⭐⭐ Malo</option>
                <option value="1">⭐ Muy malo</option>
              </select>
            </div>
            <div class="form-group"><label class="form-label">Comentario</label><textarea class="form-control" id="rComment" rows="3"></textarea></div>
            <button class="btn btn-primary" style="width:auto" data-tn="resena">Enviar reseña</button>
            <div id="rMsg" style="margin-top:.5rem;font-size:.85rem"></div>
          </div>
        </div>`;

      return c.html(buildPage(db, p.name, content, `
        function setMainImg(url,el){document.getElementById('mainImg').src=url;document.querySelectorAll('[data-tn="img"]').forEach(i=>i.style.border='2px solid #e2e8f0');el.style.border='2px solid var(--p)';}
        document.getElementById('variantSel')?.addEventListener('change',function(){const opt=this.options[this.selectedIndex];const price=opt.dataset.price;if(price)document.getElementById('displayPrice').textContent='€'+parseFloat(price).toFixed(2);});
        function addToCartFromPage(){
          const v=document.getElementById('variantSel');
          const vid=v?v.value:null;
          const vname=vid?v.options[v.selectedIndex]?.text:'';
          if(v&&v.options.length>1&&!vid){alert('Selecciona una variante');return;}
          const qty=parseInt(document.getElementById('qty').value)||1;
          for(let i=0;i<qty;i++)addToCart(${p.id},${JSON.stringify(p.name).replace(/</g,'\\u003c')},${p.price},vid||null,vname||null);
        }
        async function addToWishlist(){
          const r=await fetch('/api/store/account/wishlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product_id:${p.id}})});
          const d=await r.json();
          if(d.error)alert(d.error==='No autenticado'?'Inicia sesión para guardar en favoritos':d.error);
          else{const b=document.querySelector('[onclick="addToWishlist()"]');b.textContent='❤️ Guardado';b.style.color='#ef4444';}
        }
        async function submitReview(){
          const r=await fetch('/api/store/reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product_id:${p.id},customer_name:document.getElementById('rName').value,rating:parseInt(document.getElementById('rRating').value),comment:document.getElementById('rComment').value})});
          const d=await r.json();
          document.getElementById('rMsg').innerHTML=d.error?'<span style="color:#ef4444">'+d.error+'</span>':'<span style="color:#10b981">✓ '+d.message+'</span>';
        }
      `, c));
    } catch(e) { return c.redirect('/store/catalog'); }
  });

  views.get('/cart', c => {
    const content = `
      <h1 style="margin-bottom:1.5rem">Tu Carrito</h1>
      <div style="display:grid;grid-template-columns:1fr 340px;gap:1.5rem;align-items:start">
        <div id="cartItems"></div>
        <div id="cartSummaryBox" style="display:none">
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:1.5rem">
            <h3 style="margin-bottom:1rem">Resumen</h3>
            <div style="display:flex;justify-content:space-between;margin-bottom:.4rem;font-size:.9rem"><span>Subtotal</span><span id="sumSub">€0.00</span></div>
            <hr style="border:none;border-top:1px solid #f1f5f9;margin:.75rem 0">
            <div style="display:flex;justify-content:space-between;font-weight:700;font-size:1.05rem"><span>Total estimado</span><span id="sumTotal">€0.00</span></div>
            <a href="/store/checkout" class="btn btn-primary" style="margin-top:1rem">Proceder al pago →</a>
          </div>
        </div>
      </div>`;
    return c.html(buildPage(db, 'Carrito', content, `
      function renderCart(){
        const cart=getCart();
        const el=document.getElementById('cartItems');
        const sb=document.getElementById('cartSummaryBox');
        if(!cart.length){el.innerHTML='<div style="text-align:center;padding:3rem;background:#fff;border-radius:10px;border:1px solid #e2e8f0"><p style="color:#94a3b8;font-size:1rem">Tu carrito está vacío</p><a href="/store/catalog" class="btn btn-primary" style="width:auto;margin-top:1rem;display:inline-flex">Explorar catálogo</a></div>';sb.style.display='none';return;}
        let sub=0;
        el.innerHTML=cart.map((x,i)=>{sub+=x.price*x.qty;return '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:1rem;margin-bottom:.75rem;display:flex;gap:1rem;align-items:center">'+
          '<div style="flex:1"><div style="font-weight:600">'+escHtml(x.name)+'</div><div style="color:#94a3b8;font-size:.85rem">€'+x.price.toFixed(2)+' por unidad</div></div>'+
          '<div style="display:flex;align-items:center;gap:.5rem">'+
          '<button data-tn="cant" data-i="'+i+'" data-d="-1" style="background:#f1f5f9;border:none;border-radius:4px;width:28px;height:28px;cursor:pointer;font-weight:600">-</button>'+
          '<span style="min-width:24px;text-align:center;font-weight:600">'+x.qty+'</span>'+
          '<button data-tn="cant" data-i="'+i+'" data-d="1" style="background:#f1f5f9;border:none;border-radius:4px;width:28px;height:28px;cursor:pointer;font-weight:600">+</button>'+
          '</div>'+
          '<div style="min-width:60px;text-align:right;font-weight:700">€'+(x.price*x.qty).toFixed(2)+'</div>'+
          '<button data-tn="quitar" data-i="'+i+'" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:1.1rem">✕</button>'+
          '</div>';}).join('');
        document.getElementById('sumSub').textContent='€'+sub.toFixed(2);
        document.getElementById('sumTotal').textContent='€'+sub.toFixed(2);
        sb.style.display='';
        updateCartUI();
      }
      function changeQty(i,d){const c=getCart();c[i].qty=Math.max(1,c[i].qty+d);saveCart(c);renderCart();}
      function removeItem(i){const c=getCart();c.splice(i,1);saveCart(c);renderCart();}
      renderCart();
    `, c));
  });

  views.get('/checkout', c => {
    const sess = getCustomerSession(db, c.req);
    let prefill = { name:'', email:'', phone:'', address:'' };
    if (sess) {
      const acc = db.prepare('SELECT * FROM customer_accounts WHERE id=?').get(sess.customerId);
      if (acc) {
        const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(acc.client_id);
        if (cl) prefill = { name: cl.name||'', email: cl.email||'', phone: cl.phone||'', address: cl.address||'' };
      }
    }
    const shippingMethods = db.prepare("SELECT * FROM shipping_methods WHERE active=1 ORDER BY price").all();
    const shipOpts = shippingMethods.map(s => `<option value="${s.id}" data-price="${s.price}" data-free="${s.free_from||9999999}">${escHtml(s.name)} — €${s.price.toFixed(2)}${s.free_from?` (gratis +€${s.free_from})`:''}${s.estimated_days?' · '+escHtml(s.estimated_days):''}</option>`).join('');

    const content = `
      <h1 style="margin-bottom:1.5rem">Finalizar Compra</h1>
      <div style="display:grid;grid-template-columns:1fr 360px;gap:1.5rem;align-items:start">
        <div>
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:1.5rem;margin-bottom:1rem">
            <h3 style="margin-bottom:1rem">Tus datos${sess ? ' <span style="font-size:.8rem;color:#10b981;font-weight:400">✓ Sesión activa</span>' : ''}</h3>
            <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
              <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="cName" required value="${escHtml(prefill.name||'')}"></div>
              <div class="form-group"><label class="form-label">Email *</label><input class="form-control" type="email" id="cEmail" required value="${escHtml(prefill.email||'')}"></div>
            </div>
            <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
              <div class="form-group"><label class="form-label">Teléfono</label><input class="form-control" id="cPhone" value="${escHtml(prefill.phone||'')}"></div>
              <div class="form-group"><label class="form-label">Dirección</label><input class="form-control" id="cAddr" value="${escHtml(prefill.address||'')}"></div>
            </div>
            <div class="form-group"><label class="form-label">Notas del pedido (opcional)</label><textarea class="form-control" id="cNotes" rows="2"></textarea></div>
          </div>
          ${shippingMethods.length ? `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:1.5rem;margin-bottom:1rem">
            <h3 style="margin-bottom:1rem">Método de envío</h3>
            <select class="form-control" id="shippingMethod" data-tn="envio"><option value="">Sin envío / Retiro en tienda</option>${shipOpts}</select>
          </div>` : ''}
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:1.5rem">
            <h3 style="margin-bottom:1rem">Cupón de descuento</h3>
            <div style="display:flex;gap:.5rem">
              <input class="form-control" id="couponCode" placeholder="Código..." style="text-transform:uppercase">
              <button class="btn btn-secondary" data-tn="cupon">Aplicar</button>
            </div>
            <div id="couponMsg" style="margin-top:.4rem;font-size:.83rem"></div>
          </div>
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:1.5rem;position:sticky;top:80px">
          <h3 style="margin-bottom:1rem">Tu pedido</h3>
          <div id="orderItems"></div>
          <hr style="border:none;border-top:1px solid #f1f5f9;margin:.75rem 0">
          <div style="display:flex;justify-content:space-between;font-size:.88rem;margin-bottom:.3rem"><span>Subtotal</span><span id="coSubtotal">€0.00</span></div>
          <div style="display:flex;justify-content:space-between;font-size:.88rem;margin-bottom:.3rem;color:#10b981" id="coDiscRow" style="display:none"><span>Descuento</span><span id="coDiscount">-€0.00</span></div>
          <div style="display:flex;justify-content:space-between;font-size:.88rem;margin-bottom:.3rem" id="coShipRow" style="display:none"><span>Envío</span><span id="coShipping">€0.00</span></div>
          <hr style="border:none;border-top:1px solid #f1f5f9;margin:.75rem 0">
          <div style="display:flex;justify-content:space-between;font-weight:700;font-size:1.05rem"><span>Total</span><span id="coTotal">€0.00</span></div>
          <button class="btn btn-primary" style="margin-top:1rem" data-tn="pedido">Confirmar pedido</button>
          <div id="orderMsg" style="margin-top:.5rem;font-size:.83rem"></div>
        </div>
      </div>`;

    return c.html(buildPage(db, 'Checkout', content, `
      let couponDiscount=0,couponCode=null;
      function updateTotal(){
        const cart=getCart();
        let sub=cart.reduce((a,b)=>a+(b.price*b.qty),0);
        document.getElementById('orderItems').innerHTML=cart.map(x=>'<div style="display:flex;justify-content:space-between;font-size:.88rem;margin-bottom:.3rem"><span>'+escHtml(x.name)+' x'+x.qty+'</span><span>€'+(x.price*x.qty).toFixed(2)+'</span></div>').join('');
        const shipSel=document.getElementById('shippingMethod');
        let ship=0;
        if(shipSel&&shipSel.value){const opt=shipSel.options[shipSel.selectedIndex];const freeFrom=parseFloat(opt.dataset.free||9999999);ship=sub>=freeFrom?0:parseFloat(opt.dataset.price||0);}
        const disc=couponDiscount;
        const total=sub-disc+ship;
        document.getElementById('coSubtotal').textContent='€'+sub.toFixed(2);
        if(disc>0){document.getElementById('coDiscount').textContent='-€'+disc.toFixed(2);document.getElementById('coDiscRow').style.display='flex';}else{document.getElementById('coDiscRow').style.display='none';}
        if(ship>0){document.getElementById('coShipping').textContent='€'+ship.toFixed(2);document.getElementById('coShipRow').style.display='flex';}else{document.getElementById('coShipRow').style.display='none';}
        document.getElementById('coTotal').textContent='€'+total.toFixed(2);
      }
      async function applyCoupon(){
        const code=document.getElementById('couponCode').value.trim();
        if(!code)return;
        const cart=getCart();
        const sub=cart.reduce((a,b)=>a+(b.price*b.qty),0);
        const r=await fetch('/api/store/validate-coupon',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,subtotal:sub})});
        const d=await r.json();
        if(d.error){document.getElementById('couponMsg').innerHTML='<span style="color:#ef4444">'+d.error+'</span>';couponDiscount=0;couponCode=null;}
        else{document.getElementById('couponMsg').innerHTML='<span style="color:#10b981">✓ '+d.message+'</span>';couponDiscount=d.amount;couponCode=code;}
        updateTotal();
      }
      async function placeOrder(){
        const cart=getCart();
        if(!cart.length){alert('Tu carrito está vacío');return;}
        const client={name:document.getElementById('cName').value,email:document.getElementById('cEmail').value,phone:document.getElementById('cPhone').value,address:document.getElementById('cAddr').value,notes:document.getElementById('cNotes').value};
        if(!client.name||!client.email){document.getElementById('orderMsg').innerHTML='<span style="color:#ef4444">Nombre y email son requeridos</span>';return;}
        const shipSel=document.getElementById('shippingMethod');
        const r=await fetch('/api/store/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client,items:cart,shipping_method_id:shipSel?.value||null,discount_code:couponCode})});
        const d=await r.json();
        if(d.error){document.getElementById('orderMsg').innerHTML='<span style="color:#ef4444">'+d.error+'</span>';return;}
        localStorage.removeItem('cart');updateCartUI();
        window.location.href='/store/order-confirmation/'+d.order_number;
      }
      updateTotal();
      document.getElementById('shippingMethod')?.addEventListener('change',updateTotal);
    `, c));
  });

  views.get('/order-confirmation/:orderNum', c => {
    const rawOrderNum = c.req.param('orderNum');
    if (!/^[A-Z0-9-]{1,30}$/.test(rawOrderNum)) return c.html('<h1>404</h1>', 404);
    const orderNum = escHtml(rawOrderNum);
    const sess = getCustomerSession(db, c.req);
    const accountBtn = sess
      ? `<a href="/store/account" class="btn btn-secondary" style="width:auto">Ver mis pedidos</a>`
      : `<a href="/store/account/register" class="btn btn-secondary" style="width:auto">Crea tu cuenta para seguir pedidos</a>`;
    const content = `
      <div style="text-align:center;background:#fff;border-radius:12px;padding:4rem 2rem;max-width:600px;margin:0 auto">
        <div style="font-size:3rem;margin-bottom:1rem">✅</div>
        <h1 style="margin-bottom:.75rem;color:#10b981">¡Pedido confirmado!</h1>
        <p style="color:#475569;margin-bottom:.5rem">Tu número de pedido es:</p>
        <div style="font-size:1.3rem;font-weight:700;background:#f1f5f9;padding:.75rem 1.5rem;border-radius:8px;display:inline-block;margin-bottom:1.5rem">${orderNum}</div>
        <p style="color:#64748b;margin-bottom:2rem">Guarda este número para consultar el estado de tu pedido.</p>
        <div style="display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap">
          <a href="/store" class="btn btn-primary" style="width:auto">Seguir comprando</a>
          ${accountBtn}
        </div>
      </div>`;
    return c.html(buildPage(db, 'Pedido confirmado', content, '', c));
  });

  views.get('/account', c => {
    const sess = getCustomerSession(db, c.req);
    if (!sess) return c.redirect('/store/account/login');
    const acc = db.prepare('SELECT * FROM customer_accounts WHERE id=?').get(sess.customerId);
    if (!acc) return c.redirect('/store/account/login');
    const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(acc.client_id);
    const orders = cl ? db.prepare('SELECT * FROM sales_orders WHERE client_id=? ORDER BY id DESC').all(cl.id) : [];
    const statusBadge = s => { const m={pending:'#f59e0b',processing:'#0ea5e9',shipped:'#8b5cf6',delivered:'#10b981',completed:'#10b981',cancelled:'#ef4444',refunded:'#94a3b8'}; return `<span style="background:${m[s]||'#94a3b8'};color:#fff;padding:.2rem .55rem;border-radius:99px;font-size:.7rem;font-weight:600">${escHtml(s)}</span>`; };
    const orderRows = orders.map(o => `<tr><td>${escHtml(o.order_number)}</td><td>€${Number(o.total||0).toFixed(2)}</td><td>${statusBadge(o.status)}</td><td style="color:#94a3b8;font-size:.8rem">${o.created_at?.split(' ')[0]||'-'}</td></tr>`).join('');
    const content = `
      <h1 style="margin-bottom:1.5rem">Mi Cuenta</h1>
      <div style="display:grid;grid-template-columns:280px 1fr;gap:1.5rem">
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:1.5rem;height:fit-content">
          <div style="text-align:center;margin-bottom:1.25rem">
            <div style="width:60px;height:60px;background:#f1f5f9;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto .5rem;font-size:1.5rem">👤</div>
            <strong>${escHtml(cl?.name||acc.email)}</strong>
            <div style="color:#94a3b8;font-size:.82rem">${escHtml(acc.email)}</div>
          </div>
          <button data-tn="salir" class="btn btn-secondary" style="width:100%;font-size:.85rem">Cerrar sesión</button>
        </div>
        <div>
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
            <div style="padding:1rem 1.25rem;border-bottom:1px solid #f1f5f9;font-weight:600">Mis pedidos</div>
            <table style="width:100%;border-collapse:collapse;font-size:.875rem">
              <thead><tr style="background:#f8fafc"><th style="padding:.65rem 1rem;text-align:left;color:#64748b;font-size:.75rem;font-weight:600;text-transform:uppercase">Pedido</th><th style="padding:.65rem 1rem;text-align:left;color:#64748b;font-size:.75rem;font-weight:600;text-transform:uppercase">Total</th><th style="padding:.65rem 1rem;text-align:left;color:#64748b;font-size:.75rem;font-weight:600;text-transform:uppercase">Estado</th><th style="padding:.65rem 1rem;text-align:left;color:#64748b;font-size:.75rem;font-weight:600;text-transform:uppercase">Fecha</th></tr></thead>
              <tbody>${orderRows||'<tr><td colspan="4" style="text-align:center;padding:2rem;color:#94a3b8">Sin pedidos</td></tr>'}</tbody>
            </table>
          </div>
          <div id="wishlistSection" style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:1.5rem;margin-top:1rem">
            <h3 style="margin-bottom:1rem">❤️ Lista de deseos</h3>
            <div id="wishlistItems"><p style="color:#94a3b8">Cargando...</p></div>
          </div>
        </div>
      </div>`;
    return c.html(buildPage(db, 'Mi Cuenta', content, `
      fetch('/api/store/account/wishlist').then(r=>r.json()).then(items=>{
        document.getElementById('wishlistItems').innerHTML=items.length?'<div class="grid grid-cards">'+items.map(p=>'<div class="card"><div class="card-img">'+(p.image_url?'<img src="'+escHtml(p.image_url)+'">':'📦')+'</div><div class="card-body"><div class="card-title">'+escHtml(p.name)+'</div><div style="color:var(--p);font-weight:700">€'+p.price.toFixed(2)+'</div><div style="display:flex;gap:.4rem;margin-top:.5rem"><a href="/store/product/'+p.id+'" class="btn btn-primary" style="flex:1">Ver</a><button data-tn="quitar-deseo" data-id="'+p.id+'" class="btn btn-secondary" style="padding:.45rem .6rem">✕</button></div></div></div>').join('')+'</div>':'<p style="color:#94a3b8">Tu lista de deseos está vacía</p>';
      });
      async function removeWish(pid){await fetch('/api/store/account/wishlist/'+pid,{method:'DELETE'});location.reload();}
      async function logout(){await fetch('/api/store/account/logout',{method:'POST'});location.href='/store';}
    `, c));
  });

  views.get('/account/login', c => {
    const content = `
      <div style="max-width:380px;margin:2rem auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:2rem">
        <h1 style="margin-bottom:.25rem;font-size:1.3rem">Iniciar sesión</h1>
        <p style="color:#94a3b8;font-size:.85rem;margin-bottom:1.5rem">¿No tienes cuenta? <a href="/store/account/register" style="color:var(--p)">Regístrate</a></p>
        <div class="form-group"><label class="form-label">Email</label><input class="form-control" id="lEmail" type="email" required></div>
        <div class="form-group"><label class="form-label">Contraseña</label><input class="form-control" id="lPwd" type="password" required></div>
        <div id="lMsg" style="margin-bottom:.75rem;font-size:.83rem"></div>
        <button class="btn btn-primary" data-tn="entrar">Entrar</button>
      </div>`;
    return c.html(buildPage(db, 'Iniciar sesión', content, `
      async function doLogin(){
        const r=await fetch('/api/store/account/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('lEmail').value,password:document.getElementById('lPwd').value})});
        const d=await r.json();
        if(d.error){document.getElementById('lMsg').innerHTML='<span style="color:#ef4444">'+d.error+'</span>';}
        else{window.location.href='/store/account';}
      }
      document.getElementById('lPwd').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
    `, c));
  });

  views.get('/account/register', c => {
    const content = `
      <div style="max-width:380px;margin:2rem auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:2rem">
        <h1 style="margin-bottom:.25rem;font-size:1.3rem">Crear cuenta</h1>
        <p style="color:#94a3b8;font-size:.85rem;margin-bottom:1.5rem">¿Ya tienes cuenta? <a href="/store/account/login" style="color:var(--p)">Inicia sesión</a></p>
        <div class="form-group"><label class="form-label">Nombre</label><input class="form-control" id="rName"></div>
        <div class="form-group"><label class="form-label">Email *</label><input class="form-control" id="rEmail" type="email" required></div>
        <div class="form-group"><label class="form-label">Contraseña *</label><input class="form-control" id="rPwd" type="password" required></div>
        <div id="rMsg" style="margin-bottom:.75rem;font-size:.83rem"></div>
        <button class="btn btn-primary" data-tn="registrar">Crear cuenta</button>
      </div>`;
    return c.html(buildPage(db, 'Registro', content, `
      async function doRegister(){
        const r=await fetch('/api/store/account/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('rName').value,email:document.getElementById('rEmail').value,password:document.getElementById('rPwd').value})});
        const d=await r.json();
        if(d.error){document.getElementById('rMsg').innerHTML='<span style="color:#ef4444">'+d.error+'</span>';}
        else{window.location.href='/store/account';}
      }
    `, c));
  });

  // Legal pages
  views.get('/legal/:page', c => {
    const pageKey = c.req.param('page');
    const s = resolvePreviewSettings(db, c);
    const map = { terms: ['Términos y Condiciones', s.terms_html], privacy: ['Política de Privacidad', s.privacy_html], returns: ['Política de Devoluciones', s.returns_html] };
    const [title, html] = map[pageKey] || ['Página', ''];
    if (!html) return c.redirect('/store');
    // SEGURIDAD: contenido HTML controlado por admin (textos legales).
    // El admin es responsable de no introducir <script> u otro contenido peligroso.
    const content = `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:2rem;max-width:800px"><h1 style="margin-bottom:1.5rem">${escHtml(title)}</h1><div style="line-height:1.7;color:#475569">${html}</div></div>`;
    return c.html(buildPage(db, title, content, '', c));
  });

  // D1 — TIENDA PÚBLICA APAGADA (reversible). Mismo patrón que la retirada del POS viejo (PIEZA C):
  // se comenta el montaje, NO se borra; `routes.js` permanece en el repo. /store/* y /api/store/* → 404.
  // (El checkout ya estaba roto: INSERT a `inventory_movements`, tabla archivada en el Pilar 3.)
  // Para reactivar: descomentar estas dos líneas (y revisar el clúster archivado por D1).
  // ⚙️ 5 SEP 2026 — se montó UN RATO, y solo en una instancia de sonda, para poder medir la tienda
  // antes de quitar `unsafe-inline` (autorizado por Ibrahin). Vuelve apagada: D1 sigue en pie.
  // Sus plantillas SÍ quedan migradas: 0 handlers de atributo y su bloque con nonce, así que el día
  // que se descomenten estas dos líneas la tienda ya cumple la política estricta.
  // app.route('/api/store', api);
  // app.route('/store', views);
}
