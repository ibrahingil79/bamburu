import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { db } from './core/db.js';
import { loadModules } from './core/loader.js';
import { cleanupExpiredSessions } from './core/auth.js';
import { cleanupRateLimitBuckets } from './core/rate-limit.js';
import { securityHeaders } from './core/security-headers.js';
import { initControlDb, getTenantBySlug, createTenantSession } from './core/control-db.js';
import { tenantMiddleware, getTenantDb } from './core/tenant-middleware.js';
import { createAdminSession } from './core/auth.js';
import { autologinStore } from './core/autologin-store.js';
import { register as registerRegistro } from './modules/registro/index.js';
import { docsHtml } from './docs.html.js';

initControlDb();

const app = new Hono();

app.use('*', securityHeaders());
app.use('/public/*', serveStatic({ root: './' }));
app.get('/', c => c.html(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bamburu — Tu negocio gestionado con IA</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0A0F1E;--bg2:#0D1229;--bg3:#111833;--bg4:#0B1024;
  --teal:#0D9488;--teal-l:#14B8A6;--teal-ll:#2DD4BF;--teal-d:#0F766E;
  --teal-glow:rgba(13,148,136,0.4);--teal-sub:rgba(13,148,136,0.07);
  --text:#F1F5F9;--text2:#CBD5E1;--text3:#94A3B8;--text4:#64748B;
  --border:rgba(255,255,255,0.06);--border2:rgba(255,255,255,0.1);--border-t:rgba(13,148,136,0.2);
}
html{scroll-behavior:smooth}
body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);line-height:1.6;overflow-x:hidden;-webkit-font-smoothing:antialiased}
nav{position:fixed;top:0;left:0;right:0;z-index:100;height:68px;display:flex;align-items:center;justify-content:space-between;padding:0 32px;background:rgba(10,15,30,0.7);backdrop-filter:blur(24px);border-bottom:1px solid var(--border);transition:background 0.3s}
nav.scrolled{background:rgba(10,15,30,0.95)}
.nav-logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:20px;color:#fff;text-decoration:none;letter-spacing:-0.02em}
.nav-logo span{color:var(--teal-l)}
.nav-links{display:flex;align-items:center;gap:32px}
.nav-links a{color:var(--text3);text-decoration:none;font-size:13px;font-weight:500;letter-spacing:0.01em;transition:color 0.2s}
.nav-links a:hover{color:#fff}
.nav-btn{background:var(--teal)!important;color:#fff!important;padding:9px 20px;border-radius:10px;font-weight:600!important;font-size:13px!important;transition:all 0.2s!important;border:none;cursor:pointer;font-family:inherit}
.nav-btn:hover{background:var(--teal-l)!important;transform:translateY(-1px);box-shadow:0 8px 30px -8px var(--teal-glow)}
.burger{display:none;background:none;border:none;color:#fff;cursor:pointer;padding:4px}
.hero{min-height:100vh;display:flex;align-items:center;position:relative;overflow:hidden;padding:100px 32px 60px}
.hero-bg{position:absolute;inset:0;overflow:hidden}
.hero-bg canvas{position:absolute;inset:0;width:100%;height:100%}
.hero-glow1{position:absolute;width:900px;height:900px;border-radius:50%;background:radial-gradient(circle,rgba(13,148,136,0.2) 0%,rgba(13,148,136,0.05) 40%,transparent 70%);top:-10%;right:-10%;filter:blur(40px);animation:float1 8s ease-in-out infinite}
.hero-glow2{position:absolute;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(15,118,110,0.15) 0%,transparent 70%);bottom:5%;left:-5%;filter:blur(50px);animation:float2 10s ease-in-out infinite}
.hero-glow3{position:absolute;width:400px;height:400px;border-radius:50%;background:radial-gradient(circle,rgba(20,184,166,0.1) 0%,transparent 70%);top:40%;left:40%;filter:blur(60px);animation:float1 6s ease-in-out infinite reverse}
@keyframes float1{0%,100%{transform:translate(0,0)}50%{transform:translate(30px,-20px)}}
@keyframes float2{0%,100%{transform:translate(0,0)}50%{transform:translate(-20px,30px)}}
.hero-mesh{position:absolute;inset:0;background-image:linear-gradient(rgba(13,148,136,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(13,148,136,0.025) 1px,transparent 1px);background-size:80px 80px;mask-image:radial-gradient(ellipse 80% 70% at 50% 40%,black 20%,transparent 80%);-webkit-mask-image:radial-gradient(ellipse 80% 70% at 50% 40%,black 20%,transparent 80%)}
.hero-inner{position:relative;z-index:2;max-width:1280px;margin:0 auto;width:100%;display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center}
.hero-left{max-width:620px}
.hero-badge{display:inline-flex;align-items:center;gap:8px;padding:7px 18px;border-radius:100px;border:1px solid var(--border-t);background:rgba(13,148,136,0.06);font-size:12px;font-weight:600;color:var(--teal-l);letter-spacing:0.04em;text-transform:uppercase;margin-bottom:28px}
.hero-badge-dot{width:6px;height:6px;border-radius:50%;background:var(--teal-l);animation:pulse2 2s ease-in-out infinite;box-shadow:0 0 8px var(--teal-glow)}
@keyframes pulse2{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.4;transform:scale(0.8)}}
.hero h1{font-size:clamp(40px,5.5vw,72px);font-weight:900;line-height:1.02;letter-spacing:-0.04em;margin-bottom:24px}
.hero h1 em{font-style:normal;color:var(--teal-l);position:relative}
.hero h1 em::after{content:'';position:absolute;bottom:2px;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--teal),transparent);border-radius:2px;opacity:0.5}
.hero-sub{font-size:clamp(16px,1.8vw,19px);color:var(--text2);line-height:1.7;margin-bottom:40px;max-width:520px;font-weight:400}
.hero-buttons{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:48px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:15px 30px;border-radius:14px;font-size:15px;font-weight:600;text-decoration:none;cursor:pointer;border:none;transition:all 0.3s cubic-bezier(0.16,1,0.3,1);font-family:inherit;position:relative}
.btn-primary{background:linear-gradient(135deg,var(--teal),var(--teal-d));color:#fff;box-shadow:0 4px 30px -6px var(--teal-glow),inset 0 1px 0 rgba(255,255,255,0.1)}
.btn-primary:hover{transform:translateY(-2px);box-shadow:0 8px 40px -4px var(--teal-glow),inset 0 1px 0 rgba(255,255,255,0.15);background:linear-gradient(135deg,var(--teal-l),var(--teal))}
.btn-primary:active{transform:translateY(0)}
.btn-ghost{background:rgba(255,255,255,0.03);color:var(--text2);border:1px solid var(--border2)}
.btn-ghost:hover{background:rgba(255,255,255,0.07);color:#fff;border-color:rgba(255,255,255,0.2);transform:translateY(-1px)}
.hero-social{display:flex;align-items:center;gap:16px}
.hero-social span{font-size:12px;color:var(--text4);text-transform:uppercase;letter-spacing:0.08em;font-weight:600}
.hero-avatars{display:flex}
.hero-avatars div{width:32px;height:32px;border-radius:50%;border:2px solid var(--bg);margin-left:-8px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff}
.hero-avatars div:first-child{margin-left:0}
.hero-right{position:relative;display:flex;justify-content:center}
.mockup{width:100%;max-width:560px;position:relative}
.mockup-window{background:var(--bg2);border:1px solid var(--border2);border-radius:20px;overflow:hidden;box-shadow:0 40px 100px -30px rgba(0,0,0,0.7),0 0 60px -10px var(--teal-glow);position:relative;z-index:2}
.mockup-bar{height:44px;background:rgba(255,255,255,0.02);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 16px;gap:8px}
.mockup-dot{width:10px;height:10px;border-radius:50%}
.mockup-dot:nth-child(1){background:#EF4444}
.mockup-dot:nth-child(2){background:#F59E0B}
.mockup-dot:nth-child(3){background:#22C55E}
.mockup-url{margin-left:12px;flex:1;height:26px;background:rgba(255,255,255,0.04);border-radius:6px;display:flex;align-items:center;padding:0 10px;font-size:11px;color:var(--text4)}
.mockup-body{padding:24px;min-height:360px;position:relative}
.mockup-welcome{display:flex;align-items:center;gap:12px;margin-bottom:20px;padding:14px 16px;background:linear-gradient(135deg,rgba(13,148,136,0.1),rgba(13,148,136,0.03));border:1px solid rgba(13,148,136,0.12);border-radius:12px}
.mockup-welcome-avatar{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--teal),var(--teal-d));display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:#fff;flex-shrink:0}
.mockup-welcome-text{font-size:13px;font-weight:500;color:var(--text2);line-height:1.4}
.mockup-welcome-text strong{color:var(--teal-l);font-weight:600}
.mockup-cards{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px}
.mockup-card{background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:12px;padding:14px;text-align:center}
.mockup-card-val{font-size:22px;font-weight:800;color:#fff;margin-bottom:2px}
.mockup-card-label{font-size:10px;color:var(--text4);text-transform:uppercase;letter-spacing:0.06em}
.mockup-card:nth-child(1) .mockup-card-val{color:var(--teal-l)}
.mockup-chart{background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:12px;padding:16px;height:120px;position:relative;overflow:hidden}
.mockup-chart-title{font-size:11px;color:var(--text4);margin-bottom:12px;font-weight:500}
.mockup-chart svg{width:100%;height:70px}
.mockup-float{position:absolute;z-index:3;animation:floatCard 6s ease-in-out infinite}
.mockup-float-1{top:-20px;right:-30px;background:var(--bg3);border:1px solid var(--border-t);border-radius:14px;padding:12px 16px;box-shadow:0 20px 50px -15px rgba(13,148,136,0.3);animation-delay:0s}
.mockup-float-2{bottom:30px;left:-40px;background:var(--bg3);border:1px solid var(--border);border-radius:14px;padding:12px 16px;box-shadow:0 20px 50px -15px rgba(0,0,0,0.5);animation-delay:2s}
.mockup-float-label{font-size:10px;color:var(--text4);margin-bottom:4px}
.mockup-float-val{font-size:16px;font-weight:700;color:#fff}
.mockup-float-1 .mockup-float-val{color:var(--teal-l)}
@keyframes floatCard{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.hero-shape{position:absolute;z-index:1;opacity:0.15;pointer-events:none}
.hero-shape-1{top:15%;right:5%;width:80px;height:80px;border:1px solid var(--teal);border-radius:20px;transform:rotate(45deg);animation:spinSlow 30s linear infinite}
.hero-shape-2{bottom:20%;left:3%;width:60px;height:60px;border:1px solid var(--teal);border-radius:50%;animation:spinSlow 20s linear infinite reverse}
.hero-shape-3{top:60%;right:8%;width:40px;height:40px;background:var(--teal);border-radius:12px;opacity:0.06;transform:rotate(15deg);animation:float1 7s ease-in-out infinite}
@keyframes spinSlow{to{transform:rotate(405deg)}}
section{padding:120px 32px;position:relative}
.sec-label{display:inline-flex;align-items:center;gap:10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:var(--teal-l);margin-bottom:16px}
.sec-label::before{content:'';width:24px;height:1.5px;background:linear-gradient(90deg,var(--teal),transparent);border-radius:1px}
.sec-title{font-size:clamp(30px,4vw,48px);font-weight:800;letter-spacing:-0.03em;line-height:1.1;margin-bottom:16px}
.sec-desc{font-size:17px;color:var(--text3);max-width:540px;line-height:1.7}
.logos-bar{padding:60px 32px;text-align:center;border-top:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--bg4)}
.logos-bar p{font-size:12px;color:var(--text4);text-transform:uppercase;letter-spacing:0.12em;font-weight:600;margin-bottom:28px}
.logos-row{display:flex;align-items:center;justify-content:center;gap:48px;flex-wrap:wrap;opacity:0.35}
.demo-section{background:var(--bg2);overflow:hidden;position:relative}
.demo-section::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--border-t),transparent)}
.demo-inner{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1fr 1.1fr;gap:80px;align-items:center}
.demo-text .sec-desc{margin-bottom:36px}
.demo-stats{display:flex;gap:40px;margin-top:8px}
.demo-stat{text-align:left}
.demo-stat-val{font-size:36px;font-weight:900;letter-spacing:-0.03em;background:linear-gradient(135deg,var(--teal-l),var(--teal));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.demo-stat-label{font-size:12px;color:var(--text4);margin-top:2px;text-transform:uppercase;letter-spacing:0.06em;font-weight:500}
.chat-wrap{position:relative}
.chat-bg-glow{position:absolute;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,rgba(13,148,136,0.08),transparent 70%);top:-50px;right:-50px;filter:blur(40px);pointer-events:none}
.chat-container{background:linear-gradient(180deg,#0E1428,#0B1024);border:1px solid var(--border2);border-radius:24px;overflow:hidden;position:relative;z-index:2;box-shadow:0 30px 80px -20px rgba(0,0,0,0.6)}
.chat-top{padding:20px 24px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px;background:rgba(255,255,255,0.015)}
.chat-avatar{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,var(--teal-l),var(--teal-d));display:flex;align-items:center;justify-content:center;position:relative}
.chat-avatar::after{content:'';position:absolute;inset:-3px;border-radius:14px;border:1px solid var(--border-t);animation:pulse-border 3s ease-in-out infinite}
@keyframes pulse-border{0%,100%{opacity:0.5}50%{opacity:1}}
.chat-avatar svg{width:20px;height:20px}
.chat-name{font-weight:700;font-size:15px;color:#fff}
.chat-status{font-size:12px;color:var(--teal-l);display:flex;align-items:center;gap:5px;font-weight:500}
.chat-status-dot{width:6px;height:6px;border-radius:50%;background:var(--teal-l);box-shadow:0 0 8px var(--teal-glow);animation:pulse2 2s ease-in-out infinite}
.chat-body{padding:24px;max-height:460px;overflow:hidden}
.chat-messages{display:flex;flex-direction:column;gap:16px}
.chat-msg{max-width:82%;padding:14px 18px;border-radius:18px;font-size:13.5px;line-height:1.6;opacity:0;transform:translateY(14px);transition:all 0.5s cubic-bezier(0.16,1,0.3,1)}
.chat-msg.visible{opacity:1;transform:translateY(0)}
.chat-msg.disa{align-self:flex-start;background:linear-gradient(135deg,rgba(13,148,136,0.12),rgba(13,148,136,0.05));border:1px solid rgba(13,148,136,0.15);color:var(--text);border-bottom-left-radius:6px}
.chat-msg.user{align-self:flex-end;background:rgba(255,255,255,0.05);border:1px solid var(--border);color:var(--text2);border-bottom-right-radius:6px}
.chat-msg .hl{color:var(--teal-l);font-weight:700}
.chat-msg .tag{display:inline-block;padding:3px 9px;border-radius:6px;font-size:10px;font-weight:700;letter-spacing:0.03em;vertical-align:middle;margin-left:4px}
.tag-risk{background:rgba(239,68,68,0.15);color:#F87171;border:1px solid rgba(239,68,68,0.2)}
.tag-ok{background:rgba(16,185,129,0.12);color:#34D399;border:1px solid rgba(16,185,129,0.2)}
.tag-warn{background:rgba(245,158,11,0.12);color:#FBBF24;border:1px solid rgba(245,158,11,0.2)}
.chat-typing{display:flex;gap:5px;padding:8px 0;opacity:0;transition:opacity 0.3s}
.chat-typing.visible{opacity:1}
.chat-typing span{width:7px;height:7px;border-radius:50%;background:var(--teal-l);animation:tdot 1.4s ease-in-out infinite}
.chat-typing span:nth-child(2){animation-delay:0.2s}
.chat-typing span:nth-child(3){animation-delay:0.4s}
@keyframes tdot{0%,60%,100%{opacity:0.25;transform:scale(0.8)}30%{opacity:1;transform:scale(1.1)}}
.features-section{background:var(--bg);position:relative}
.features-header{text-align:center;max-width:600px;margin:0 auto 64px}
.features-header .sec-desc{margin:0 auto}
.features-grid{max-width:1120px;margin:0 auto;display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.feature-card{background:linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01));border:1px solid var(--border);border-radius:24px;padding:36px 30px;position:relative;overflow:hidden;transition:all 0.4s cubic-bezier(0.16,1,0.3,1)}
.feature-card::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at top left,rgba(13,148,136,0.06),transparent 60%);opacity:0;transition:opacity 0.4s}
.feature-card::after{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--border-t),transparent);opacity:0;transition:opacity 0.4s}
.feature-card:hover{border-color:var(--border-t);transform:translateY(-6px);box-shadow:0 24px 60px -16px rgba(13,148,136,0.15)}
.feature-card:hover::before,.feature-card:hover::after{opacity:1}
.feature-icon{width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,rgba(13,148,136,0.12),rgba(13,148,136,0.04));border:1px solid rgba(13,148,136,0.12);display:flex;align-items:center;justify-content:center;margin-bottom:22px;transition:all 0.3s}
.feature-card:hover .feature-icon{background:linear-gradient(135deg,rgba(13,148,136,0.2),rgba(13,148,136,0.08));box-shadow:0 0 20px rgba(13,148,136,0.15)}
.feature-icon svg{width:24px;height:24px;stroke:var(--teal-l);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.feature-card h3{font-size:18px;font-weight:700;margin-bottom:10px;color:#fff}
.feature-card p{font-size:14px;color:var(--text4);line-height:1.65}
.feature-num{position:absolute;top:24px;right:24px;font-size:64px;font-weight:900;color:rgba(255,255,255,0.02);line-height:1;letter-spacing:-0.04em}
.cta-section{background:var(--bg2);text-align:center;position:relative;overflow:hidden}
.cta-section::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--border-t),transparent)}
.cta-bg-shape{position:absolute;border-radius:50%;pointer-events:none;filter:blur(80px)}
.cta-bg-shape-1{width:600px;height:400px;background:radial-gradient(circle,rgba(13,148,136,0.1),transparent 70%);top:-100px;left:50%;transform:translateX(-50%)}
.cta-bg-shape-2{width:300px;height:300px;background:radial-gradient(circle,rgba(15,118,110,0.08),transparent 70%);bottom:-50px;right:10%}
.cta-inner{position:relative;z-index:2;max-width:640px;margin:0 auto}
.cta-inner .sec-title{margin-bottom:14px}
.cta-inner .sec-desc{margin:0 auto 40px;text-align:center}
.cta-note{font-size:13px;color:var(--text4)}
.cta-note strong{color:var(--teal-l);font-weight:600}
footer{background:var(--bg);border-top:1px solid var(--border);padding:36px 32px;display:flex;align-items:center;justify-content:space-between;max-width:1200px;margin:0 auto}
footer p{font-size:12px;color:var(--text4)}
footer a{color:var(--teal);text-decoration:none;font-weight:500}
footer a:hover{text-decoration:underline}
.footer-links{display:flex;gap:24px}
.toast{position:fixed;bottom:32px;left:50%;transform:translateX(-50%) translateY(100px);background:var(--bg3);border:1px solid var(--border-t);color:var(--text);padding:14px 24px;border-radius:14px;font-size:14px;z-index:1000;opacity:0;transition:all 0.4s cubic-bezier(0.16,1,0.3,1);pointer-events:none;display:flex;align-items:center;gap:10px;box-shadow:0 20px 50px -15px rgba(0,0,0,0.6)}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.reveal{opacity:0;transform:translateY(32px);transition:all 0.8s cubic-bezier(0.16,1,0.3,1)}
.reveal.visible{opacity:1;transform:translateY(0)}
@media(max-width:1024px){
  .hero-inner{grid-template-columns:1fr;gap:48px;text-align:center}
  .hero-left{max-width:100%;margin:0 auto}
  .hero-sub{margin:0 auto 40px}
  .hero-buttons{justify-content:center}
  .hero-social{justify-content:center}
  .demo-inner{grid-template-columns:1fr;gap:48px}
  .hero-right{max-width:500px;margin:0 auto}
}
@media(max-width:768px){
  .nav-links{display:none}
  .burger{display:block}
  .features-grid{grid-template-columns:1fr}
  section{padding:80px 20px}
.demo-stats{gap:24px}
  .mockup-float{display:none}
  .hero{padding:80px 20px 40px}
  .hero-shape{display:none}
  footer{flex-direction:column;gap:16px;text-align:center}
}
@media(max-width:480px){
  .mockup-cards{grid-template-columns:1fr}
  .demo-stats{flex-direction:column;gap:16px}
  .hero h1{font-size:36px}
}
.panel-section{background:var(--bg);position:relative}
.panel-inner{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1fr 1.2fr;gap:80px;align-items:center}
.panel-list{list-style:none;margin-top:28px;display:flex;flex-direction:column;gap:12px}
.panel-list li{display:flex;align-items:center;gap:10px;font-size:15px;color:var(--text2)}
.pm-window{background:var(--bg2);border:1px solid var(--border2);border-radius:16px;overflow:hidden;box-shadow:0 30px 80px -20px rgba(0,0,0,0.6)}
.pm-bar{height:36px;background:rgba(255,255,255,0.02);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 12px;gap:6px}
.pm-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.pm-url{margin-left:8px;font-size:10px;color:var(--text4);flex:1;text-align:center}
.pm-layout{display:grid;grid-template-columns:140px 1fr}
.pm-sidebar{background:var(--bg4);padding:12px 8px;border-right:1px solid var(--border)}
.pm-logo{padding:8px;font-size:13px;font-weight:800;color:#fff;margin-bottom:8px}
.pm-logo span{color:var(--teal-l)}
.pm-nav-section{font-size:9px;color:var(--text4);text-transform:uppercase;letter-spacing:0.08em;padding:8px 8px 4px;font-weight:600}
.pm-nav-item{display:flex;align-items:center;gap:6px;padding:6px 8px;font-size:11px;color:var(--text3);border-radius:6px;cursor:default;margin-bottom:2px}
.pm-nav-active{background:rgba(13,148,136,0.1);color:var(--teal-l);font-weight:600}
.pm-content{padding:14px}
.pm-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.pm-title{font-size:13px;font-weight:700;color:#fff}
.pm-btn{background:var(--teal);color:#fff;border:none;padding:4px 10px;border-radius:6px;font-size:10px;font-weight:600;cursor:default}
.pm-table{display:flex;flex-direction:column;gap:1px}
.pm-thead{display:grid;grid-template-columns:1.5fr 0.7fr 0.5fr 0.7fr;padding:6px 8px;font-size:9px;color:var(--text4);text-transform:uppercase;letter-spacing:0.06em}
.pm-row{display:grid;grid-template-columns:1.5fr 0.7fr 0.5fr 0.7fr;padding:8px;border-radius:6px;font-size:11px;color:var(--text2);background:rgba(255,255,255,0.02);margin-bottom:3px;align-items:center}
.pm-name{color:#fff;font-weight:500}
.pm-price{color:var(--teal-l);font-weight:600}
.pm-stock{color:var(--text2)}
.pm-stock-warn{color:#F59E0B;font-weight:700}
.pm-stock-empty{color:#EF4444;font-weight:700}
.pm-badge{font-size:9px;font-weight:700;padding:2px 8px;border-radius:10px}
.pm-badge-ok{background:rgba(16,185,129,0.12);color:#34D399}
.pm-badge-warn{background:rgba(239,68,68,0.12);color:#F87171}
.roles-section{background:var(--bg2);position:relative}
.roles-section::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--border-t),transparent)}
.roles-inner{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center}
.rm-card{background:var(--bg3);border:1px solid var(--border);border-radius:14px;padding:18px}
.rm-header{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.rm-avatar{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0}
.rm-name{font-size:13px;font-weight:600;color:#fff}
.rm-role{font-size:11px;color:var(--text4)}
.rm-badge{margin-left:auto;background:rgba(16,185,129,0.12);color:#34D399;font-size:10px;font-weight:700;padding:3px 10px;border-radius:10px}
.rm-perms-title{font-size:10px;color:var(--text4);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;font-weight:600}
.rm-perms{display:flex;flex-wrap:wrap;gap:6px}
.rm-perm{font-size:11px;padding:4px 10px;border-radius:8px;font-weight:500}
.rm-perm-on{background:rgba(13,148,136,0.12);color:var(--teal-l);border:1px solid rgba(13,148,136,0.2)}
.rm-perm-off{background:rgba(255,255,255,0.03);color:var(--text4);border:1px solid var(--border)}
@media(max-width:1024px){
  .panel-inner,.roles-inner{grid-template-columns:1fr;gap:48px}
}
.countries-section{background:var(--bg);position:relative}
.countries-inner{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center}
.country-cards{display:flex;flex-direction:column;gap:12px}
.country-card{background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:16px 20px;display:flex;align-items:center;gap:16px;transition:all 0.3s}
.country-card:hover{border-color:var(--border-t);transform:translateX(6px)}
.country-flag{font-size:28px;flex-shrink:0}
.country-name{font-size:14px;font-weight:700;color:#fff;margin-bottom:2px}
.country-details{font-size:12px;color:var(--text4);display:flex;gap:10px;flex-wrap:wrap}
.country-tag{background:rgba(13,148,136,0.08);color:var(--teal-l);padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;border:1px solid rgba(13,148,136,0.15)}
.invoice-section{background:var(--bg2);position:relative}
.invoice-section::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--border-t),transparent)}
.invoice-inner{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1.2fr 1fr;gap:80px;align-items:center}
.inv-mockup{background:var(--bg3);border:1px solid var(--border);border-radius:16px;padding:24px;position:relative}
.inv-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)}
.inv-logo{font-size:16px;font-weight:800;color:#fff}
.inv-logo span{color:var(--teal-l)}
.inv-num{text-align:right}
.inv-num-label{font-size:10px;color:var(--text4);text-transform:uppercase;letter-spacing:0.06em}
.inv-num-val{font-size:18px;font-weight:700;color:var(--teal-l)}
.inv-info{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}
.inv-field-label{font-size:10px;color:var(--text4);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px}
.inv-field-val{font-size:13px;color:var(--text2);font-weight:500}
.inv-table{width:100%;margin-bottom:16px}
.inv-table-head{display:grid;grid-template-columns:2fr 0.5fr 0.8fr 0.8fr;padding:6px 8px;font-size:9px;color:var(--text4);text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid var(--border)}
.inv-table-row{display:grid;grid-template-columns:2fr 0.5fr 0.8fr 0.8fr;padding:8px;font-size:11px;color:var(--text2);border-bottom:1px solid rgba(255,255,255,0.03)}
.inv-total{display:flex;justify-content:flex-end;gap:40px;font-size:12px;color:var(--text3);margin-bottom:12px}
.inv-total strong{color:#fff;font-size:14px}
.inv-hash{background:rgba(13,148,136,0.06);border:1px solid rgba(13,148,136,0.12);border-radius:8px;padding:8px 12px;font-size:9px;color:var(--text4);word-break:break-all;font-family:monospace}
.inv-hash span{color:var(--teal-l);font-weight:600}
.web-section{background:var(--bg);position:relative}
.web-inner{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1fr 1.2fr;gap:80px;align-items:center}
.web-preview{background:var(--bg2);border:1px solid var(--border2);border-radius:16px;overflow:hidden;box-shadow:0 30px 80px -20px rgba(0,0,0,0.6)}
.web-bar{height:32px;background:rgba(255,255,255,0.02);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 10px;gap:5px}
.web-dot{width:7px;height:7px;border-radius:50%;display:inline-block}
.web-url{margin-left:8px;font-size:9px;color:var(--text4);flex:1;text-align:center}
.web-body{padding:16px}
.web-shop-hero{background:linear-gradient(135deg,rgba(13,148,136,0.15),rgba(13,148,136,0.05));border-radius:10px;padding:16px;text-align:center;margin-bottom:12px}
.web-shop-name{font-size:14px;font-weight:800;color:#fff;margin-bottom:4px}
.web-shop-sub{font-size:11px;color:var(--text4)}
.web-products{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.web-product{background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center}
.web-product-img{width:100%;height:48px;background:linear-gradient(135deg,rgba(13,148,136,0.1),rgba(13,148,136,0.03));border-radius:6px;margin-bottom:6px;display:flex;align-items:center;justify-content:center}
.web-product-name{font-size:9px;color:var(--text2);font-weight:600;margin-bottom:2px}
.web-product-price{font-size:10px;color:var(--teal-l);font-weight:700}
.telegram-section{background:var(--bg2);position:relative}
.telegram-section::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--border-t),transparent)}
.telegram-inner{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center}
.tg-phone{width:260px;margin:0 auto;background:#0E1420;border:2px solid var(--border2);border-radius:36px;overflow:hidden;box-shadow:0 30px 80px -20px rgba(0,0,0,0.7);padding:12px 0}
.tg-header{padding:10px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border)}
.tg-avatar{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--teal),var(--teal-d));display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff}
.tg-name{font-size:12px;font-weight:600;color:#fff}
.tg-online{font-size:10px;color:var(--teal-l)}
.tg-messages{padding:12px;display:flex;flex-direction:column;gap:8px}
.tg-msg{padding:8px 12px;border-radius:12px;font-size:11px;line-height:1.5;max-width:85%}
.tg-msg-user{align-self:flex-end;background:var(--teal-d);color:#fff;border-bottom-right-radius:3px}
.tg-msg-disa{align-self:flex-start;background:rgba(255,255,255,0.06);color:var(--text2);border-bottom-left-radius:3px}
.tg-msg-disa strong{color:var(--teal-l)}
@media(max-width:1024px){
  .countries-inner,.invoice-inner,.web-inner,.telegram-inner{grid-template-columns:1fr;gap:48px}
}
</style>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>
</head>
<body>

<nav id="nav">
  <a href="#" class="nav-logo">
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
      <rect width="30" height="30" rx="9" fill="url(#lg)"/>
      <path d="M8 19V11l7 4-7 4z" fill="#fff"/>
      <path d="M15 19V11l7 4-7 4z" fill="rgba(255,255,255,0.45)"/>
      <defs><linearGradient id="lg" x1="0" y1="0" x2="30" y2="30"><stop stop-color="#14B8A6"/><stop offset="1" stop-color="#0D9488"/></linearGradient></defs>
    </svg>
    Bamburu
  </a>
  <div class="nav-links">
    <a href="#demo">Cómo funciona</a>
    <a href="#features">Características</a>
    <a href="/docs">Documentación</a>
    <a href="/acceso">Acceso</a>
    <a href="/registro" class="nav-btn">Probar gratis</a>
  </div>
  <button class="burger" onclick="window.location.href='/registro'" aria-label="Ir a registro">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
  </button>
</nav>

<section class="hero">
  <div class="hero-bg">
    <div class="hero-glow1"></div>
    <div class="hero-glow2"></div>
    <div class="hero-glow3"></div>
    <div class="hero-mesh"></div>
    <canvas id="heroCanvas"></canvas>
  </div>
  <div class="hero-shape hero-shape-1"></div>
  <div class="hero-shape hero-shape-2"></div>
  <div class="hero-shape hero-shape-3"></div>
  <div class="hero-inner">
    <div class="hero-left">
      <div class="hero-badge"><span class="hero-badge-dot"></span>Programa beta — plazas limitadas</div>
      <h1>Bamburu gestiona tu negocio.<br><em>Tú dedícate a crecer.</em></h1>
      <p class="hero-sub">El primer sistema de gestión con inteligencia artificial para autónomos hispanohablantes. Bamburu trabaja, tú decides.</p>
      <div class="hero-buttons">
        <a href="/registro" class="btn btn-primary">
          Prueba gratis
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </a>
        <a href="#demo" class="btn btn-ghost">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Ver cómo funciona
        </a>
      </div>
      <div class="hero-social">
        <div class="hero-avatars">
          <div style="background:linear-gradient(135deg,#6366F1,#8B5CF6)">M</div>
          <div style="background:linear-gradient(135deg,#EC4899,#F43F5E)">A</div>
          <div style="background:linear-gradient(135deg,#F59E0B,#EF4444)">C</div>
          <div style="background:linear-gradient(135deg,var(--teal),var(--teal-d))">+</div>
        </div>
        <span>+1.200 autónomos en lista de espera</span>
      </div>
    </div>
    <div class="hero-right">
      <div class="mockup">
        <div class="mockup-float mockup-float-1">
          <div class="mockup-float-label">Clientes activos</div>
          <div class="mockup-float-val">↑ 23%</div>
        </div>
        <div class="mockup-float mockup-float-2">
          <div class="mockup-float-label">Tareas de DISA hoy</div>
          <div class="mockup-float-val">47</div>
        </div>
        <div class="mockup-window">
          <div class="mockup-bar">
            <div class="mockup-dot"></div>
            <div class="mockup-dot"></div>
            <div class="mockup-dot"></div>
            <div class="mockup-url">app.bamburu.com/dashboard</div>
          </div>
          <div class="mockup-body">
            <div class="mockup-welcome">
              <div class="mockup-welcome-avatar">D</div>
              <div class="mockup-welcome-text">Buenos días, Carlos. <strong>DISA ha gestionado 12 tareas</strong> mientras dormías. Tengo 3 sugerencias para ti.</div>
            </div>
            <div class="mockup-cards">
              <div class="mockup-card">
                <div class="mockup-card-val">€4.2k</div>
                <div class="mockup-card-label">Ventas semana</div>
              </div>
              <div class="mockup-card">
                <div class="mockup-card-val">156</div>
                <div class="mockup-card-label">Pedidos</div>
              </div>
              <div class="mockup-card">
                <div class="mockup-card-val">97%</div>
                <div class="mockup-card-label">Automatizado</div>
              </div>
            </div>
            <div class="mockup-chart">
              <div class="mockup-chart-title">Ingresos · Últimos 7 días</div>
              <svg viewBox="0 0 460 70" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="rgba(13,148,136,0.3)"/>
                    <stop offset="100%" stop-color="rgba(13,148,136,0)"/>
                  </linearGradient>
                  <linearGradient id="chartStroke" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stop-color="#0D9488"/>
                    <stop offset="100%" stop-color="#2DD4BF"/>
                  </linearGradient>
                </defs>
                <path d="M0,55 Q30,50 65,42 T130,30 T195,35 T260,18 T325,22 T390,8 T460,5 L460,70 L0,70 Z" fill="url(#chartFill)"/>
                <path d="M0,55 Q30,50 65,42 T130,30 T195,35 T260,18 T325,22 T390,8 T460,5" fill="none" stroke="url(#chartStroke)" stroke-width="2.5" stroke-linecap="round"/>
                <circle cx="460" cy="5" r="4" fill="#2DD4BF"><animate attributeName="r" values="4;6;4" dur="2s" repeatCount="indefinite"/></circle>
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<div class="logos-bar">
  <p>Adaptado para los mercados más importantes</p>
  <div class="logos-row" style="font-size:15px;font-weight:700;color:#94A3B8;font-family:'Inter',sans-serif;display:flex;gap:48px;justify-content:center;flex-wrap:wrap">
    <span>España</span>
    <span>México</span>
    <span>Colombia</span>
    <span>Argentina</span>
    <span>Chile</span>
  </div>
</div>

<section class="demo-section" id="demo">
  <div class="demo-inner">
    <div class="demo-text reveal">
      <div class="sec-label">DISA — La IA de Bamburu</div>
      <h2 class="sec-title">Conoce a DISA,<br>la inteligencia que<br>vive en Bamburu.</h2>
      <p class="sec-desc">Bamburu incluye a DISA, una IA que analiza tu negocio, detecta problemas antes de que ocurran y actúa sin que tengas que hacer nada.</p>
      <div class="demo-stats">
        <div class="demo-stat">
          <div class="demo-stat-val">4.2h</div>
          <div class="demo-stat-label">Ahorro diario</div>
        </div>
        <div class="demo-stat">
          <div class="demo-stat-val">97%</div>
          <div class="demo-stat-label">Tareas auto.</div>
        </div>
        <div class="demo-stat">
          <div class="demo-stat-val">+34%</div>
          <div class="demo-stat-label">Ventas recuperadas</div>
        </div>
      </div>
    </div>
    <div class="chat-wrap reveal">
      <div class="chat-bg-glow"></div>
      <div class="chat-container" id="chatContainer">
        <div class="chat-top">
          <div class="chat-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.58-3.25 3.93"/><path d="M8.25 5.93A4 4 0 0 1 12 2"/><path d="M12 18a8 8 0 0 1-8-8"/><path d="M12 18a8 8 0 0 0 8-8"/><line x1="12" y1="18" x2="12" y2="22"/></svg>
          </div>
          <div>
            <div class="chat-name">DISA</div>
            <div class="chat-status"><span class="chat-status-dot"></span> Analizando tu negocio</div>
          </div>
        </div>
        <div class="chat-body">
          <div class="chat-messages" id="chatMessages"></div>
          <div class="chat-typing" id="chatTyping"><span></span><span></span><span></span></div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="features-section" id="features">
  <div class="features-header reveal">
    <div class="sec-label" style="justify-content:center">Todo incluido</div>
    <h2 class="sec-title">Gestión completa,<br>inteligencia nativa</h2>
    <p class="sec-desc">Cada módulo funciona solo y mejor junto a DISA. Sin complementos, sin costes ocultos.</p>
  </div>
  <div class="features-grid">
    <div class="feature-card reveal">
      <div class="feature-num">01</div>
      <div class="feature-icon">
        <svg viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
      </div>
      <h3>Pedidos y ventas</h3>
      <p>Centraliza todos tus canales de venta en un solo lugar. DISA prioriza los urgentes y detecta patrones de compra para anticiparte.</p>
    </div>
    <div class="feature-card reveal">
      <div class="feature-num">02</div>
      <div class="feature-icon">
        <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.87"/></svg>
      </div>
      <h3>Clientes inteligentes</h3>
      <p>Perfiles automáticos con historial, preferencias y predicción de compra. DISA alerta si un cliente está en riesgo de abandono.</p>
    </div>
    <div class="feature-card reveal">
      <div class="feature-num">03</div>
      <div class="feature-icon">
        <svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
      </div>
      <h3>Inventario automático</h3>
      <p>Stock actualizado en tiempo real. DISA hace pedidos a proveedores cuando detecta que vas a quedarte sin existencias.</p>
    </div>
    <div class="feature-card reveal">
      <div class="feature-num">04</div>
      <div class="feature-icon">
        <svg viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/><line x1="6" y1="16" x2="10" y2="16"/><line x1="14" y1="16" x2="18" y2="16"/></svg>
      </div>
      <h3>Facturación legal</h3>
      <p>Facturas y tickets adaptados a la normativa fiscal de tu país. DISA genera, envía y hace seguimiento de cobros automáticamente.</p>
    </div>
    <div class="feature-card reveal">
      <div class="feature-num">05</div>
      <div class="feature-icon">
        <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/><rect x="2" y="2" width="20" height="20" rx="2" opacity="0.3"/></svg>
      </div>
      <h3>Analítica en tiempo real</h3>
      <p>Dashboards que entiendes sin ser financiero. DISA te explica qué pasa y qué hacer, no solo muestra gráficos sin contexto.</p>
    </div>
    <div class="feature-card reveal">
      <div class="feature-num">06</div>
      <div class="feature-icon">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      </div>
      <h3>Multi-país</h3>
      <p>Diseñado para España, México y Colombia. Moneda, impuestos y lenguaje adaptados a tu mercado desde el primer día.</p>
    </div>
  </div>
</section>

<section class="panel-section" id="panel">
  <div class="panel-inner">
    <div class="panel-text reveal">
      <div class="sec-label">Panel de control</div>
      <h2 class="sec-title">Todo tu negocio en un solo lugar</h2>
      <p class="sec-desc">Gestiona productos, pedidos, clientes e inventario desde un panel diseñado para que cualquier persona de tu equipo lo use sin formación.</p>
      <ul class="panel-list">
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Control de stock en tiempo real</li>
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Pedidos con estados personalizables</li>
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Facturación automática Verifactu</li>
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Múltiples usuarios con permisos</li>
      </ul>
    </div>
    <div class="panel-mockup reveal">
      <div class="pm-window">
        <div class="pm-bar">
          <span class="pm-dot" style="background:#EF4444"></span>
          <span class="pm-dot" style="background:#F59E0B"></span>
          <span class="pm-dot" style="background:#22C55E"></span>
          <span class="pm-url">negocio.bamburu.com/admin/products</span>
        </div>
        <div class="pm-layout">
          <div class="pm-sidebar">
            <div class="pm-logo">Bam<span>buru</span></div>
            <div class="pm-nav-section">General</div>
            <div class="pm-nav-item pm-nav-active">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7l-8-4-8 4M20 7l-8 4M20 7v10l-8 4M12 11v10"/></svg>
              Productos
            </div>
            <div class="pm-nav-item">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11H5a2 2 0 0 0-2 2v7h14v-7a2 2 0 0 0-2-2h-4"/></svg>
              Pedidos
            </div>
            <div class="pm-nav-item">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
              Clientes
            </div>
            <div class="pm-nav-section">Inventario</div>
            <div class="pm-nav-item">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8"/></svg>
              Stock
            </div>
          </div>
          <div class="pm-content">
            <div class="pm-header">
              <span class="pm-title">Productos</span>
              <button class="pm-btn">+ Nuevo</button>
            </div>
            <div class="pm-table">
              <div class="pm-thead">
                <span>Nombre</span><span>Precio</span><span>Stock</span><span>Estado</span>
              </div>
              <div class="pm-row">
                <span class="pm-name">Vela Lavanda 200g</span>
                <span class="pm-price">€18.50</span>
                <span class="pm-stock">45</span>
                <span class="pm-badge pm-badge-ok">Activo</span>
              </div>
              <div class="pm-row">
                <span class="pm-name">Set Romántico 3 velas</span>
                <span class="pm-price">€48.00</span>
                <span class="pm-stock pm-stock-warn">4</span>
                <span class="pm-badge pm-badge-ok">Activo</span>
              </div>
              <div class="pm-row">
                <span class="pm-name">Cesta Relax Premium</span>
                <span class="pm-price">€75.00</span>
                <span class="pm-stock">8</span>
                <span class="pm-badge pm-badge-ok">Activo</span>
              </div>
              <div class="pm-row">
                <span class="pm-name">Aceite Bergamota 30ml</span>
                <span class="pm-price">€14.00</span>
                <span class="pm-stock pm-stock-empty">0</span>
                <span class="pm-badge pm-badge-warn">Sin stock</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="roles-section" id="roles">
  <div class="roles-inner">
    <div class="roles-mockup reveal">
      <div class="rm-card">
        <div class="rm-header">
          <div class="rm-avatar" style="background:linear-gradient(135deg,#6366f1,#4338ca)">MG</div>
          <div>
            <div class="rm-name">María García</div>
            <div class="rm-role">Empleado</div>
          </div>
          <span class="rm-badge">Activo</span>
        </div>
        <div class="rm-perms-title">Permisos asignados</div>
        <div class="rm-perms">
          <span class="rm-perm rm-perm-on">Ver productos</span>
          <span class="rm-perm rm-perm-off">Editar productos</span>
          <span class="rm-perm rm-perm-on">Ver pedidos</span>
          <span class="rm-perm rm-perm-off">Crear pedidos</span>
          <span class="rm-perm rm-perm-on">Ver clientes</span>
          <span class="rm-perm rm-perm-off">Ver facturas</span>
        </div>
      </div>
      <div class="rm-card" style="margin-top:16px">
        <div class="rm-header">
          <div class="rm-avatar" style="background:linear-gradient(135deg,#f59e0b,#d97706)">CR</div>
          <div>
            <div class="rm-name">Carlos Ruiz</div>
            <div class="rm-role">Vendedor</div>
          </div>
          <span class="rm-badge">Activo</span>
        </div>
        <div class="rm-perms-title">Permisos asignados</div>
        <div class="rm-perms">
          <span class="rm-perm rm-perm-on">Ver productos</span>
          <span class="rm-perm rm-perm-on">Ver pedidos</span>
          <span class="rm-perm rm-perm-on">Crear pedidos</span>
          <span class="rm-perm rm-perm-on">Ver clientes</span>
          <span class="rm-perm rm-perm-on">Crear clientes</span>
          <span class="rm-perm rm-perm-off">Ver facturas</span>
        </div>
      </div>
    </div>
    <div class="roles-text reveal">
      <div class="sec-label">Control de acceso</div>
      <h2 class="sec-title">Cada persona ve solo lo que necesita</h2>
      <p class="sec-desc">Define permisos granulares por usuario. Tu equipo accede exactamente a lo que necesita, sin poner en riesgo datos sensibles del negocio.</p>
      <ul class="panel-list">
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Permisos por módulo y acción</li>
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Roles predefinidos o personalizados</li>
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>2FA obligatorio por usuario</li>
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Registro de actividad completo</li>
      </ul>
    </div>
  </div>
</section>

<!-- SECCIÓN E: Multi-país -->
<section class="countries-section" id="paises">
  <div class="countries-inner">
    <div class="reveal">
      <div class="sec-label">Multi-país</div>
      <h2 class="sec-title">Hecho para el mundo hispanohablante</h2>
      <p class="sec-desc">España, México, Colombia y toda Latinoamérica. Cada país con su moneda, impuestos y normativa fiscal. Sin configuraciones complicadas.</p>
      <ul class="panel-list" style="margin-top:28px">
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>IVA 21% España · 16% México · 19% Colombia</li>
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>NIF/CIF · RFC · NIT según el país</li>
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Moneda local en cada operación</li>
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Más países añadiéndose constantemente</li>
      </ul>
    </div>
    <div class="country-cards reveal">
      <div class="country-card">
        <span class="country-flag">🇪🇸</span>
        <div>
          <div class="country-name">España</div>
          <div class="country-details">
            <span class="country-tag">EUR €</span>
            <span class="country-tag">IVA 21%</span>
            <span class="country-tag">NIF/CIF</span>
            <span class="country-tag">Verifactu</span>
          </div>
        </div>
      </div>
      <div class="country-card">
        <span class="country-flag">🇲🇽</span>
        <div>
          <div class="country-name">México</div>
          <div class="country-details">
            <span class="country-tag">MXN $</span>
            <span class="country-tag">IVA 16%</span>
            <span class="country-tag">RFC</span>
            <span class="country-tag">CFDI</span>
          </div>
        </div>
      </div>
      <div class="country-card">
        <span class="country-flag">🇨🇴</span>
        <div>
          <div class="country-name">Colombia</div>
          <div class="country-details">
            <span class="country-tag">COP $</span>
            <span class="country-tag">IVA 19%</span>
            <span class="country-tag">NIT</span>
            <span class="country-tag">DIAN</span>
          </div>
        </div>
      </div>
      <div class="country-card" style="border-style:dashed;opacity:0.6">
        <span class="country-flag">🌎</span>
        <div>
          <div class="country-name">Más países</div>
          <div class="country-details">
            <span class="country-tag">Argentina · Chile · Perú · Venezuela...</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- SECCIÓN F: Facturación -->
<section class="invoice-section" id="facturacion">
  <div class="invoice-inner">
    <div class="inv-mockup reveal">
      <div class="inv-header">
        <div>
          <div class="inv-logo">Bam<span>buru</span></div>
          <div style="font-size:11px;color:var(--text4);margin-top:4px">Factura electrónica</div>
        </div>
        <div class="inv-num">
          <div class="inv-num-label">Número</div>
          <div class="inv-num-val">F-2026-0042</div>
          <div style="font-size:10px;color:var(--text4);margin-top:2px">25/05/2026</div>
        </div>
      </div>
      <div class="inv-info">
        <div>
          <div class="inv-field-label">Emisor</div>
          <div class="inv-field-val">Velas Aroma SL</div>
          <div style="font-size:11px;color:var(--text4)">B-12345678</div>
        </div>
        <div>
          <div class="inv-field-label">Cliente</div>
          <div class="inv-field-val">María García López</div>
          <div style="font-size:11px;color:var(--text4)">45678901-A</div>
        </div>
      </div>
      <div class="inv-table">
        <div class="inv-table-head">
          <span>Concepto</span><span>Cant.</span><span>Precio</span><span>Total</span>
        </div>
        <div class="inv-table-row">
          <span>Vela Lavanda 200g</span><span>2</span><span>€18.50</span><span>€37.00</span>
        </div>
        <div class="inv-table-row">
          <span>Set Romántico 3 velas</span><span>1</span><span>€48.00</span><span>€48.00</span>
        </div>
      </div>
      <div class="inv-total">
        <span>Base imponible: €85.00</span>
        <span>IVA 21%: €17.85</span>
        <strong>Total: €102.85</strong>
      </div>
      <div class="inv-hash">
        <span>Huella Verifactu:</span> a3f8c2d1e9b4...7f2a1c8e3d9b · <span style="color:#34D399">✓ Válida</span>
      </div>
    </div>
    <div class="reveal">
      <div class="sec-label">Facturación automática</div>
      <h2 class="sec-title">De pedido a factura en un clic</h2>
      <p class="sec-desc">Genera facturas con numeración correlativa, cumplimiento Verifactu para España y formatos locales para cada país. Todo automatizado.</p>
      <ul class="panel-list" style="margin-top:28px">
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Numeración automática correlativa</li>
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Hash SHA-256 Verifactu encadenado</li>
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>PDF descargable e imprimible</li>
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Datos fiscales completos por país</li>
      </ul>
    </div>
  </div>
</section>

<!-- SECCIÓN G: Constructor Web -->
<section class="web-section" id="tienda">
  <div class="web-inner">
    <div class="reveal">
      <div class="sec-label">Constructor web</div>
      <h2 class="sec-title">Tu tienda online<br>en minutos</h2>
      <p class="sec-desc">DISA construye tu tienda conversacionalmente. Le dices el estilo, conecta tus productos y despliega automáticamente con dominio propio.</p>
      <ul class="panel-list" style="margin-top:28px">
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Sin código, sin complicaciones</li>
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Productos sincronizados con el ERP</li>
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Dominio propio con hosting incluido</li>
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>SEO automático y diseño responsive</li>
      </ul>
    </div>
    <div class="web-preview reveal">
      <div class="web-bar">
        <span class="web-dot" style="background:#EF4444"></span>
        <span class="web-dot" style="background:#F59E0B"></span>
        <span class="web-dot" style="background:#22C55E"></span>
        <span class="web-url">velasaroma.com</span>
      </div>
      <div class="web-body">
        <div class="web-shop-hero">
          <div class="web-shop-name">Velas Aroma</div>
          <div class="web-shop-sub">Aromas naturales para tu hogar</div>
          <button style="background:var(--teal);color:#fff;border:none;padding:6px 16px;border-radius:8px;font-size:11px;font-weight:600;margin-top:8px;cursor:default">Ver catálogo</button>
        </div>
        <div style="font-size:10px;color:var(--text4);margin-bottom:8px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">Productos destacados</div>
        <div class="web-products">
          <div class="web-product">
            <div class="web-product-img">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="1.5"><path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7z"/></svg>
            </div>
            <div class="web-product-name">Vela Lavanda</div>
            <div class="web-product-price">€18.50</div>
          </div>
          <div class="web-product">
            <div class="web-product-img">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="1.5"><path d="M20 7l-8-4-8 4M20 7l-8 4M20 7v10l-8 4"/></svg>
            </div>
            <div class="web-product-name">Set Romántico</div>
            <div class="web-product-price">€48.00</div>
          </div>
          <div class="web-product">
            <div class="web-product-img">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 3"/></svg>
            </div>
            <div class="web-product-name">Cesta Relax</div>
            <div class="web-product-price">€75.00</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- SECCIÓN H: Telegram -->
<section class="telegram-section" id="movil">
  <div class="telegram-inner">
    <div class="tg-phone reveal">
      <div class="tg-header">
        <div class="tg-avatar">D</div>
        <div>
          <div class="tg-name">DISA · Bamburu</div>
          <div class="tg-online">en línea</div>
        </div>
      </div>
      <div class="tg-messages">
        <div class="tg-msg tg-msg-user">¿Cuánto vendí esta semana?</div>
        <div class="tg-msg tg-msg-disa">Esta semana llevas <strong>€1.243</strong> en ventas netas. Tu mejor día fue el martes con €420. Tienes 3 pedidos pendientes de enviar.</div>
        <div class="tg-msg tg-msg-user">Ajusta el stock de Vela Lavanda a 50</div>
        <div class="tg-msg tg-msg-disa">Hecho. Stock de <strong>Vela Lavanda 200g</strong> actualizado a 50 unidades. ¿Quieres que avise cuando baje de 10?</div>
        <div class="tg-msg tg-msg-user">Sí, activa esa alerta</div>
        <div class="tg-msg tg-msg-disa">Alerta activada. Te avisaré cuando el stock baje de 10 unidades.</div>
      </div>
    </div>
    <div class="reveal">
      <div class="sec-label">Gestión móvil</div>
      <h2 class="sec-title">Tu ERP en el<br>bolsillo</h2>
      <p class="sec-desc">Conecta Bamburu con Telegram y gestiona tu negocio desde el móvil. Consulta ventas, ajusta stock y recibe alertas sin abrir el navegador.</p>
      <ul class="panel-list" style="margin-top:28px">
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Consultas en lenguaje natural</li>
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Ajusta stock y crea pedidos</li>
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Alertas automáticas de stock bajo</li>
        <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-l)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>OCR de facturas por foto</li>
      </ul>
    </div>
  </div>
</section>

<section class="cta-section" id="cta">
  <div class="cta-bg-shape cta-bg-shape-1"></div>
  <div class="cta-bg-shape cta-bg-shape-2"></div>
  <div class="cta-inner reveal">
    <div class="sec-label" style="justify-content:center">Acceso anticipado</div>
    <h2 class="sec-title">Sé de los primeros<br>en probar Bamburu</h2>
    <p class="sec-desc">Los mejores comentarios del programa beta se llevan un año gratis. Tu negocio merece inteligencia real, no hojas de cálculo.</p>
    <div style="text-align:center;margin-bottom:18px">
      <a href="/registro" class="btn btn-primary" style="font-size:16px;padding:14px 32px;text-decoration:none">Prueba gratis</a>
    </div>
    <p class="cta-note">Gratis durante la beta · Sin tarjeta · <strong>Un año gratis con tu opinión</strong></p>
  </div>
</section>


<footer>
  <p>© 2026 Bamburu</p>
  <div class="footer-links">
    <a href="#">Privacidad</a>
    <a href="#">Términos</a>
    <a href="#">Contacto</a>
  </div>
</footer>

<div class="toast" id="toast"></div>

<script>
(function(){
  const c=document.getElementById('heroCanvas');
  const ctx=c.getContext('2d');
  let w,h,particles=[];
  function resize(){w=c.width=c.parentElement.offsetWidth;h=c.height=c.parentElement.offsetHeight}
  window.addEventListener('resize',resize);resize();
  class Particle{
    constructor(){this.reset()}
    reset(){
      this.x=Math.random()*w;this.y=Math.random()*h;
      this.r=Math.random()*1.5+0.3;
      this.vx=(Math.random()-0.5)*0.3;this.vy=(Math.random()-0.5)*0.3;
      this.alpha=Math.random()*0.5+0.1;
    }
    update(){
      this.x+=this.vx;this.y+=this.vy;
      if(this.x<0||this.x>w||this.y<0||this.y>h)this.reset();
    }
    draw(){
      ctx.beginPath();ctx.arc(this.x,this.y,this.r,0,Math.PI*2);
      ctx.fillStyle='rgba(13,148,136,'+this.alpha+')';ctx.fill();
    }
  }
  for(let i=0;i<80;i++)particles.push(new Particle());
  function connectParticles(){
    for(let i=0;i<particles.length;i++){
      for(let j=i+1;j<particles.length;j++){
        const dx=particles[i].x-particles[j].x;
        const dy=particles[i].y-particles[j].y;
        const dist=Math.sqrt(dx*dx+dy*dy);
        if(dist<150){
          ctx.beginPath();
          ctx.moveTo(particles[i].x,particles[i].y);
          ctx.lineTo(particles[j].x,particles[j].y);
          ctx.strokeStyle='rgba(13,148,136,'+(0.06*(1-dist/150))+')';
          ctx.lineWidth=0.5;ctx.stroke();
        }
      }
    }
  }
  function animate(){
    ctx.clearRect(0,0,w,h);
    particles.forEach(p=>{p.update();p.draw()});
    connectParticles();requestAnimationFrame(animate);
  }
  animate();
})();

window.addEventListener('scroll',()=>{document.getElementById('nav').classList.toggle('scrolled',window.scrollY>50)});

const chatData=[
  {type:'disa',html:'Buenos días, he estado analizando tu negocio mientras dormías. Tengo novedades.'},
  {type:'user',html:'Cuéntame, ¿qué has encontrado?'},
  {type:'disa',html:'He detectado <span class="hl">3 clientes en riesgo</span> de abandono esta semana. <span class="tag tag-risk">Riesgo alto</span>'},
  {type:'disa',html:'María García lleva 18 días sin comprar. He generado un <span class="hl">15% de descuento personalizado</span> basado en su historial de €2.340/año. ¿Lo envío?'},
  {type:'user',html:'Sí, envíalo. ¿Y las ventas de la semana?'},
  {type:'disa',html:'Ventas semanales: <span class="hl">€4.280</span> (+12% vs. semana anterior) <span class="tag tag-ok">↑ Tendencia positiva</span>'},
  {type:'disa',html:'Tu producto estrella se queda sin stock en 3 días. He preparado un pedido a tu proveedor habitual. <span class="tag tag-warn">Stock bajo</span>'},
  {type:'user',html:'Confirma el pedido. ¡Gracias DISA!'},
  {type:'disa',html:'Pedido enviado, descuento a María en camino, 2 clientes recuperados ayer. Te aviso con el siguiente informe.'},
];
const chatMessages=document.getElementById('chatMessages');
const chatTyping=document.getElementById('chatTyping');
let chatIdx=0,chatStarted=false;
function addMsg(){
  if(chatIdx>=chatData.length)return;
  const d=chatData[chatIdx];
  const el=document.createElement('div');
  el.className='chat-msg '+d.type;
  el.innerHTML=d.html;
  chatMessages.appendChild(el);
  chatTyping.classList.remove('visible');
  requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add('visible')));
  chatIdx++;
  if(chatIdx<chatData.length){
    const delay=d.type==='disa'?2600:1600;
    setTimeout(()=>{
      if(chatData[chatIdx].type==='disa')chatTyping.classList.add('visible');
      setTimeout(addMsg,chatData[chatIdx].type==='disa'?1100:500);
    },delay);
  }
}
function startChat(){if(chatStarted)return;chatStarted=true;chatTyping.classList.add('visible');setTimeout(addMsg,900)}
const chatObs=new IntersectionObserver(e=>{e.forEach(en=>{if(en.isIntersecting){startChat();chatObs.unobserve(en.target)}})},{threshold:0.25});
chatObs.observe(document.getElementById('chatContainer'));

const revObs=new IntersectionObserver(e=>{e.forEach(en=>{if(en.isIntersecting){en.target.classList.add('visible');revObs.unobserve(en.target)}})},{threshold:0.08,rootMargin:'0px 0px -40px 0px'});
document.querySelectorAll('.reveal').forEach((el,i)=>{el.style.transitionDelay=(i%6)*70+'ms';revObs.observe(el)});

function showToast(msg,type='info'){
  const t=document.getElementById('toast');
  const icons={success:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#14B8A6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',error:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'};
  t.innerHTML=(icons[type]||'')+msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),3500);
}

</script>
<script>
gsap.registerPlugin(ScrollTrigger);

// Hero mockup — parallax pronunciado
gsap.to('.mockup-window', {
  yPercent: -25,
  ease: 'none',
  scrollTrigger: {
    trigger: '.hero',
    start: 'top top',
    end: 'bottom top',
    scrub: 1
  }
});

// Floating cards — movimiento opuesto al scroll
gsap.to('.mockup-float-1', {
  y: -60, x: 20,
  ease: 'none',
  scrollTrigger: {
    trigger: '.hero',
    start: 'top top',
    end: 'bottom top',
    scrub: 1
  }
});

gsap.to('.mockup-float-2', {
  y: 50, x: -20,
  ease: 'none',
  scrollTrigger: {
    trigger: '.hero',
    start: 'top top',
    end: 'bottom top',
    scrub: 1
  }
});

// Secciones — entrada desde abajo con escala
gsap.utils.toArray('section').forEach(section => {
  gsap.fromTo(section,
    { opacity: 0, y: 100, scale: 0.95 },
    {
      opacity: 1, y: 0, scale: 1,
      duration: 1.2,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: section,
        start: 'top 80%',
        toggleActions: 'play none none none'
      }
    }
  );
});

// Títulos — entrada lateral
gsap.utils.toArray('.sec-title').forEach(el => {
  gsap.fromTo(el,
    { opacity: 0, x: -60 },
    {
      opacity: 1, x: 0,
      duration: 1,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: el,
        start: 'top 85%',
        toggleActions: 'play none none none'
      }
    }
  );
});

// Hero text — animación inicial al cargar
gsap.fromTo('.hero-badge',
  { opacity: 0, y: 30 },
  { opacity: 1, y: 0, duration: 0.8, delay: 0.2, ease: 'power3.out' }
);
gsap.fromTo('.hero h1',
  { opacity: 0, y: 50 },
  { opacity: 1, y: 0, duration: 1, delay: 0.4, ease: 'power3.out' }
);
gsap.fromTo('.hero-sub',
  { opacity: 0, y: 30 },
  { opacity: 1, y: 0, duration: 0.8, delay: 0.6, ease: 'power3.out' }
);
gsap.fromTo('.hero-buttons',
  { opacity: 0, y: 30 },
  { opacity: 1, y: 0, duration: 0.8, delay: 0.8, ease: 'power3.out' }
);
gsap.fromTo('.mockup',
  { opacity: 0, y: 80, scale: 0.9 },
  { opacity: 1, y: 0, scale: 1, duration: 1.2, delay: 0.5, ease: 'power3.out' }
);

// Glow parallax
gsap.to('.hero-glow1', {
  y: 150, x: -50,
  ease: 'none',
  scrollTrigger: {
    trigger: '.hero',
    start: 'top top',
    end: 'bottom top',
    scrub: 2
  }
});

gsap.to('.hero-glow2', {
  y: -100, x: 30,
  ease: 'none',
  scrollTrigger: {
    trigger: '.hero',
    start: 'top top',
    end: 'bottom top',
    scrub: 3
  }
});
</script>
</body>
</html>`));

app.post('/find-tenant', async c => {
  try {
    const body = await c.req.json();
    const email = (body?.email || '').trim().toLowerCase();
    const pickedSlug = typeof body?.slug === 'string' ? body.slug : null;
    if (!email || !email.includes('@')) {
      return c.json({ error: 'Email inválido' }, 400);
    }
    const { getTenantsByEmail } = await import('./core/control-db.js');
    const tenants = getTenantsByEmail(email);
    if (!tenants.length) {
      return c.json({ error: 'No encontramos ningún negocio con ese email' }, 404);
    }

    // Dominio base público: presente SOLO en producción (lo pone /etc/bamburu.env).
    // Su ausencia = dev/Tailscale (un solo host, sin subdominios) → se mantiene el flujo
    // original (cookie btenant + login relativo). No rompe desarrollo.
    const baseDomain = process.env.PUBLIC_BASE_DOMAIN || null;

    // ¿El usuario ya eligió un negocio concreto en la pantalla de selección?
    let tenant = null;
    if (pickedSlug) {
      tenant = tenants.find(t => t.slug === pickedSlug) || null;
      if (!tenant) return c.json({ error: 'Ese email no pertenece a ese negocio' }, 404);
    } else if (tenants.length === 1) {
      tenant = tenants[0];
    }

    // Varios negocios y aún sin elegir → devolver la lista para que el usuario escoja.
    if (!tenant) {
      return c.json({
        mode: 'choose',
        tenants: tenants.map(t => ({
          slug: t.slug,
          name: t.name,
          // Producción: URL absoluta del subdominio. Dev: null (se resuelve por btenant al elegir).
          url: baseDomain ? `https://${t.slug}.${baseDomain}/admin/login` : null,
        })),
      });
    }

    // Un negocio resuelto.
    if (baseDomain) {
      // PRODUCCIÓN: al login de SU subdominio → manda el paso 3 del middleware y la sesión
      // cae en el host correcto. No hace falta cookie btenant (el subdominio identifica el negocio).
      return c.json({ mode: 'redirect', url: `https://${tenant.slug}.${baseDomain}/admin/login` });
    }

    // DEV/Tailscale (un solo host): comportamiento original — cookie btenant host-only + login relativo.
    c.header('Set-Cookie', `btenant=${tenant.slug}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
    return c.json({ mode: 'password', slug: tenant.slug, url: '/admin/login' });
  } catch(e) {
    return c.json({ error: 'Error interno' }, 500);
  }
});

app.get('/acceso', c => c.html(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acceder — Bamburu</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070B14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.card{width:100%;max-width:400px;padding:40px 36px;background:linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.08);border-radius:24px;box-shadow:0 30px 80px rgba(0,0,0,0.5)}
.logo{font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.03em;margin-bottom:28px;text-align:center}
.logo span{color:#14B8A6}
h1{font-size:20px;font-weight:700;color:#fff;margin-bottom:6px;text-align:center}
.sub{font-size:14px;color:rgba(255,255,255,0.45);text-align:center;margin-bottom:28px}
label{display:block;font-size:12px;font-weight:600;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:7px}
input{width:100%;padding:13px 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;font-size:15px;font-family:inherit;outline:none;transition:all 0.2s}
input:focus{border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.15)}
input[readonly]{color:rgba(255,255,255,0.5);cursor:default}
.field{margin-bottom:20px}
.btn{width:100%;padding:14px;background:linear-gradient(135deg,#14B8A6,#0F766E);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;transition:all 0.2s;margin-top:4px}
.btn:hover{transform:translateY(-1px);box-shadow:0 8px 30px rgba(20,184,166,0.35)}
.btn:disabled{opacity:0.6;cursor:not-allowed;transform:none;box-shadow:none}
.err{font-size:13px;color:#F87171;text-align:center;margin-top:14px;display:none}
.back{display:flex;align-items:center;gap:6px;font-size:13px;color:rgba(255,255,255,0.4);cursor:pointer;margin-bottom:22px;background:none;border:none;font-family:inherit;padding:0}
.back:hover{color:#14B8A6}
.email-badge{display:flex;align-items:center;justify-content:space-between;padding:11px 14px;background:rgba(20,184,166,0.06);border:1px solid rgba(20,184,166,0.15);border-radius:10px;margin-bottom:20px;font-size:14px;color:#fff}
.email-badge button{background:none;border:none;font-size:12px;color:rgba(255,255,255,0.4);cursor:pointer;font-family:inherit}
.email-badge button:hover{color:#14B8A6}
</style>
</head>
<body>
<div class="card">
  <div class="logo">Bam<span>buru</span></div>

  <!-- Paso 1: email -->
  <div id="step1">
    <h1>Accede a tu panel</h1>
    <p class="sub">Introduce tu email para continuar</p>
    <div class="field">
      <label for="emailIn">Email</label>
      <input id="emailIn" type="email" placeholder="tu@email.com" autocomplete="email" autofocus>
    </div>
    <button class="btn" id="btnContinue" onclick="findTenant()">Continuar</button>
    <p class="err" id="err1"></p>
  </div>

  <!-- Paso 2: contraseña -->
  <div id="step2" style="display:none">
    <button class="back" onclick="goBack()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 5-7 7 7 7"/></svg>
      Cambiar email
    </button>
    <h1>Bienvenido</h1>
    <p class="sub">Introduce tu contraseña</p>
    <div class="email-badge">
      <span id="emailDisplay"></span>
      <button type="button" onclick="goBack()">Cambiar</button>
    </div>
    <form id="loginForm" method="POST">
      <input type="hidden" name="email" id="hiddenEmail">
      <div class="field">
        <label for="pwIn">Contraseña</label>
        <input id="pwIn" type="password" name="password" placeholder="••••••••" autocomplete="current-password">
      </div>
      <button type="submit" class="btn" id="btnLogin">Entrar al panel</button>
      <p class="err" id="err2"></p>
    </form>
    <p style="text-align:center;font-size:13px;color:rgba(255,255,255,0.4);margin-top:16px">
      <a href="/admin/forgot-password" style="color:rgba(255,255,255,0.4);text-decoration:none" onmouseover="this.style.color='#14B8A6'" onmouseout="this.style.color='rgba(255,255,255,0.4)'">¿Olvidaste tu contraseña?</a>
    </p>
  </div>

  <!-- Paso: elegir negocio (cuando el email está en varios) -->
  <div id="stepChoose" style="display:none">
    <button class="back" onclick="goBack()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 5-7 7 7 7"/></svg>
      Cambiar email
    </button>
    <h1>Elige tu negocio</h1>
    <p class="sub">Tu email está en varios negocios. ¿A cuál quieres entrar?</p>
    <div id="chooseList"></div>
  </div>
</div>
<script>
(function(){
  const step1=document.getElementById('step1');
  const step2=document.getElementById('step2');
  const stepChoose=document.getElementById('stepChoose');
  const emailIn=document.getElementById('emailIn');
  const pwIn=document.getElementById('pwIn');
  const err1=document.getElementById('err1');
  const err2=document.getElementById('err2');

  emailIn.addEventListener('keydown',e=>{if(e.key==='Enter')findTenant()});

  function resetContinue(){
    const btn=document.getElementById('btnContinue');
    btn.textContent='Continuar';btn.disabled=false;
  }

  // Decide qué hacer con la respuesta de /find-tenant según su 'mode'.
  function handleResp(r,d,email){
    if(!r.ok){showErr(err1,(d&&d.error)||'No encontramos ninguna cuenta con ese email.');resetContinue();return}
    if(d.mode==='redirect'){window.location.href=d.url;return}        // producción: al subdominio del negocio
    if(d.mode==='choose'){showChooser(d.tenants||[],email);return}     // email en varios negocios
    // dev (un solo host): pedir la contraseña aquí mismo (btenant ya puesto por el servidor)
    document.getElementById('loginForm').action=d.url;
    document.getElementById('hiddenEmail').value=email;
    document.getElementById('emailDisplay').textContent=email;
    step1.style.display='none';stepChoose.style.display='none';step2.style.display='block';
    pwIn.focus();
  }

  function showChooser(list,email){
    const box=document.getElementById('chooseList');
    box.innerHTML='';
    list.forEach(function(t){
      const b=document.createElement('button');
      b.className='btn';b.style.marginBottom='10px';
      b.textContent=t.name||t.slug;
      b.onclick=function(){choose(t,email)};
      box.appendChild(b);
    });
    step1.style.display='none';step2.style.display='none';stepChoose.style.display='block';
    resetContinue();
  }

  async function choose(t,email){
    if(t.url){window.location.href=t.url;return}                      // producción: URL absoluta del negocio
    try{
      const r=await fetch('/find-tenant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,slug:t.slug})});
      handleResp(r,await r.json(),email);                             // dev: vuelve como 'password'
    }catch{showErr(err1,'Error de conexión. Inténtalo de nuevo.')}
  }

  window.findTenant=async function(){
    const email=emailIn.value.trim();
    if(!email||!email.includes('@')){showErr(err1,'Introduce un email válido.');return}
    const btn=document.getElementById('btnContinue');
    btn.textContent='Buscando...';btn.disabled=true;err1.style.display='none';
    try{
      const r=await fetch('/find-tenant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
      handleResp(r,await r.json(),email);
    }catch{showErr(err1,'Error de conexión. Inténtalo de nuevo.');resetContinue()}
  };

  window.goBack=function(){
    step2.style.display='none';stepChoose.style.display='none';step1.style.display='block';
    err2.style.display='none';
    resetContinue();
    emailIn.focus();
  };

  document.getElementById('loginForm').addEventListener('submit',function(){
    const btn=document.getElementById('btnLogin');
    btn.textContent='Entrando...';btn.disabled=true;
  });

  function showErr(el,msg){el.textContent=msg;el.style.display='block'}
})();
</script>
</body>
</html>`));

app.get('/docs', c => c.html(docsHtml()));

registerRegistro(app);

// Auto-login tras el alta. Vive en el APEX (antes del tenant-middleware) y resuelve el
// negocio desde el TOKEN, no desde el subdominio — así el redirect puede ser relativo al
// host actual y funciona en cualquier entorno (Tailscale/localhost/dominio público).
// Crea la sesión en la BD del negocio y registra el vínculo cookie→negocio en control.db
// (tenant_sessions) para que el resto de la navegación sepa en qué negocio está aunque el
// host no lo identifique. El camino por subdominio sigue intacto para el login normal.
app.get('/admin/autologin', c => {
  const token = c.req.query('token');
  if (!token) return c.redirect('/acceso');
  const data = autologinStore.get(token);
  if (!data) return c.redirect('/acceso?error=expired');
  autologinStore.delete(token);                       // un solo uso

  const tenant = getTenantBySlug(data.slug);
  if (!tenant || tenant.status !== 'active') return c.redirect('/acceso');

  const tenantDb = getTenantDb(tenant);
  const user = tenantDb.prepare('SELECT id, role FROM admin_users WHERE email=? AND active=1').get(data.email);
  if (!user) return c.redirect('/acceso');

  const sessionToken = createAdminSession(tenantDb, user.id);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  createTenantSession({
    tenant_id: tenant.id, session_token: sessionToken,
    user_id: user.id, user_email: data.email, user_role: user.role, expires_at: expiresAt,
  });

  const headers = new Headers({ Location: '/admin' });   // relativo: se queda en el host actual
  headers.set('Set-Cookie', `asess=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`);
  return new Response(null, { status: 302, headers });
});

app.use('*', tenantMiddleware);

console.log('🎋 Iniciando Bamburu...');
await loadModules(app, db);

serve({ fetch: app.fetch, port: 3000, hostname: '127.0.0.1' }, (info) => {
  console.log('🚀 Bamburu listo en http://localhost:' + info.port);
  console.log('👉 Admin:   http://localhost:3000/admin');
  console.log('👉 Tienda:  http://localhost:3000/store');
});

// Limpieza de sesiones en control.db
async function cleanupControlSessions() {
  try {
    const { controlDb } = await import('./core/control-db.js');
    controlDb.prepare("DELETE FROM tenant_sessions WHERE expires_at <= datetime('now')").run();
  } catch {}
}

cleanupControlSessions();
setInterval(cleanupControlSessions, 6 * 60 * 60 * 1000);

// Limpieza de sesiones expiradas — se ejecuta al arrancar y luego cada 6 horas
async function cleanupAllTenantSessions() {
  try {
    const { controlDb } = await import('./core/control-db.js');
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const Database = require('better-sqlite3');
    const path = await import('path');

    const tenants = controlDb
      .prepare("SELECT * FROM tenants WHERE status='active'")
      .all();

    for (const tenant of tenants) {
      try {
        const dbPath = path.default.isAbsolute(tenant.db_filename)
          ? tenant.db_filename
          : path.default.join(process.cwd(), tenant.db_filename);
        const tdb = new Database(dbPath);
        const now = Math.floor(Date.now() / 1000);
        tdb.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now);
        tdb.prepare('DELETE FROM customer_sessions WHERE expires_at <= ?').run(now);
        tdb.close();
      } catch {}
    }
  } catch {}
}

cleanupAllTenantSessions();
setInterval(cleanupAllTenantSessions, 6 * 60 * 60 * 1000);
setInterval(cleanupRateLimitBuckets, 10 * 60 * 1000);
