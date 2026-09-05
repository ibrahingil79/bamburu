import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
const BASE='http://desarrollo-bamburu.localhost:3011';
const db=new Database(tenantDb('desarrollo-bamburu'));
const owner=db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
const tok='sonda-csp-'+randomBytes(12).toString('hex'), ahora=Math.floor(Date.now()/1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(tok, owner.id, ahora, ahora+1800, randomBytes(16).toString('hex'));
const browser=await puppeteer.launch({...launchOpts()});
try{
  const p=await browser.newPage();
  await p.setCookie({name:'asess',value:tok,domain:'desarrollo-bamburu.localhost',path:'/'});
  for(const ruta of process.argv.slice(2)){
    await p.goto(BASE+ruta,{waitUntil:'networkidle0'});
    await new Promise(x=>setTimeout(x,400));
    const d=await p.evaluate(()=>{
      const out=[];
      document.querySelectorAll('*').forEach(el=>{
        for(const a of el.attributes) if(/^on[a-z]+$/i.test(a.name))
          out.push(el.tagName.toLowerCase()+'['+(el.id||el.className||'')+'] '+a.name+'="'+a.value.slice(0,60)+'"');
      });
      return out;
    });
    console.log('\n'+ruta); d.forEach(x=>console.log('   '+x));
  }
} finally { await browser.close(); db.prepare('DELETE FROM admin_sessions WHERE token=?').run(tok); db.close(); }
