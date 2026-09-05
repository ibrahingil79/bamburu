import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
const db=new Database(tenantDb('desarrollo-bamburu'));
const owner=db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
const tok='sonda-csp-'+randomBytes(12).toString('hex'), ahora=Math.floor(Date.now()/1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(tok, owner.id, ahora, ahora+1800, randomBytes(16).toString('hex'));
const browser=await puppeteer.launch({...launchOpts()});
try{
  const p=await browser.newPage();
  await p.setCookie({name:'asess',value:tok,domain:'desarrollo-bamburu.localhost',path:'/'});
  await p.goto('http://desarrollo-bamburu.localhost:3011'+process.argv[2],{waitUntil:'networkidle0'});
  await new Promise(x=>setTimeout(x,400));
  console.log(await p.evaluate(()=>{
    const sin=document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/gi,'');
    return (sin.match(/.{70}\son[a-z]+\s*=\s*"[^"]{0,40}/gi)||[]);
  }));
} finally { await browser.close(); db.prepare('DELETE FROM admin_sessions WHERE token=?').run(tok); db.close(); }
