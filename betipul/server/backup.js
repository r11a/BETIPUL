import express from 'express';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deriveBackupKey } from './crypto.js';

const execFileAsync = promisify(execFile);
const MAGIC = Buffer.from('BTPB01\n');
const DEFAULT_POLICY = { enabled:false, frequency:'daily', retention:14, hour:'02:00', destination:'share', relativePath:'BETIPUL/Backups' };

function safeSharePath(relativePath) {
  const root = path.resolve('/share');
  const parts = String(relativePath || DEFAULT_POLICY.relativePath).replace(/\\/g, '/').split('/').filter((part) => part && part !== '.');
  if (parts.includes('..')) throw Object.assign(new Error('נתיב הרשת אינו תקין'), { statusCode:400 });
  const resolved = path.resolve(root, ...parts);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw Object.assign(new Error('נתיב הרשת אינו מורשה'), { statusCode:400 });
  return resolved;
}

async function encryptFile(input, output, passphrase) {
  const salt = randomBytes(16); const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveBackupKey(passphrase, salt), iv);
  const target = createWriteStream(output, { mode:0o600 });
  target.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(createReadStream(input), cipher, target, { end:false });
  await new Promise((resolve, reject) => target.end(cipher.getAuthTag(), (error) => error ? reject(error) : resolve()));
}

async function decryptFile(input, output, passphrase) {
  const info = await stat(input);
  if (info.size < MAGIC.length + 16 + 12 + 16) throw new Error('קובץ הגיבוי קצר או פגום');
  const header = await new Promise((resolve, reject) => { const chunks=[]; const stream=createReadStream(input,{start:0,end:MAGIC.length+27}); stream.on('data',(c)=>chunks.push(c)); stream.on('end',()=>resolve(Buffer.concat(chunks))); stream.on('error',reject); });
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('פורמט גיבוי לא נתמך');
  const salt=header.subarray(MAGIC.length,MAGIC.length+16); const iv=header.subarray(MAGIC.length+16,MAGIC.length+28);
  const tag=await new Promise((resolve,reject)=>{const chunks=[];const stream=createReadStream(input,{start:info.size-16});stream.on('data',(c)=>chunks.push(c));stream.on('end',()=>resolve(Buffer.concat(chunks)));stream.on('error',reject);});
  const decipher=createDecipheriv('aes-256-gcm',deriveBackupKey(passphrase,salt),iv); decipher.setAuthTag(tag);
  await pipeline(createReadStream(input,{start:MAGIC.length+28,end:info.size-17}),decipher,createWriteStream(output,{mode:0o600}));
}

export async function createBackupRouter({ pool, authenticate, requireRoles, audit, dataDir, passphrase, appVersion }) {
  const router=express.Router(); const internalDir=path.join(dataDir,'backups'); await mkdir(internalDir,{recursive:true});
  const getPolicy=async()=>{const r=await pool.query("SELECT value FROM app_settings WHERE key='backupPolicy'");return {...DEFAULT_POLICY,...(r.rows[0]?.value||{})};};
  const destinationFor=(policy)=>policy.destination==='share'?safeSharePath(policy.relativePath):internalDir;
  const list=async(directory,source)=>{try{return (await Promise.all((await readdir(directory)).filter((name)=>/^betipul-.*\.btpbackup$/.test(name)).map(async(name)=>{const i=await stat(path.join(directory,name));return {name,source,size:i.size,createdAt:i.mtime.toISOString(),encrypted:true};}))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}catch{return [];}};
  const createBackup=async({automatic=false,userId=null}={})=>{if(!passphrase||passphrase==='change-this-backup-passphrase')throw Object.assign(new Error('יש להגדיר סיסמת גיבוי ייחודית בהגדרות היישום'),{statusCode:400});const policy=await getPolicy();const destination=destinationFor(policy);await mkdir(destination,{recursive:true});const temp=await mkdtemp('/tmp/betipul-backup-');const stamp=new Date().toISOString().replace(/[:.]/g,'-');const name=`betipul-${stamp}.btpbackup`;try{await execFileAsync('pg_dump',['--format=custom','--no-owner','--file',path.join(temp,'database.dump'),'betipul'],{env:process.env});await writeFile(path.join(temp,'manifest.json'),JSON.stringify({product:'BETIPUL',formatVersion:1,version:appVersion,createdAt:new Date().toISOString()}));await execFileAsync('tar',['-czf',path.join(temp,'package.tar.gz'),'-C',temp,'manifest.json','database.dump']);await encryptFile(path.join(temp,'package.tar.gz'),path.join(destination,name),passphrase);const items=await list(destination,policy.destination);for(const old of items.slice(Math.min(Math.max(Number(policy.retention)||14,1),100)))await unlink(path.join(destination,old.name));await pool.query('INSERT INTO audit_log(user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)',[userId,'backup_created','system',name,{automatic,destination:policy.destination}]);return {name,source:policy.destination,encrypted:true};}finally{await rm(temp,{recursive:true,force:true});}};
  router.use(authenticate,requireRoles('admin'));
  router.get('/system/backups',async(_q,res)=>{const policy=await getPolicy();const destination=destinationFor(policy);await mkdir(destination,{recursive:true});res.json({policy,backups:[...await list(destination,policy.destination),...(policy.destination==='internal'?[]:await list(internalDir,'internal'))]});});
  router.patch('/system/backup-policy',async(req,res)=>{const policy={...DEFAULT_POLICY,...req.body,enabled:Boolean(req.body.enabled),retention:Math.min(Math.max(Number(req.body.retention)||14,1),100),destination:req.body.destination==='internal'?'internal':'share',relativePath:String(req.body.relativePath||DEFAULT_POLICY.relativePath).replace(/\\/g,'/')};const target=destinationFor(policy);await mkdir(target,{recursive:true});const probe=path.join(target,`.betipul-test-${Date.now()}`);await writeFile(probe,'ok');await unlink(probe);await pool.query("INSERT INTO app_settings(key,value,updated_by) VALUES('backupPolicy',$1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=NOW()",[policy,req.user.id]);await audit(req,'backup_policy_updated','system','backup',policy);res.json({policy,resolvedPath:target});});
  router.post('/system/backups',async(req,res)=>res.status(201).json({backup:await createBackup({userId:req.user.id})}));
  router.post('/system/backups/:source/:name/verify',async(req,res)=>{const policy=await getPolicy();const directory=req.params.source==='share'?safeSharePath(policy.relativePath):internalDir;const name=path.basename(req.params.name);if(name!==req.params.name)throw Object.assign(new Error('שם קובץ לא תקין'),{statusCode:400});const temp=await mkdtemp('/tmp/betipul-verify-');try{await decryptFile(path.join(directory,name),path.join(temp,'package.tar.gz'),passphrase);const {stdout}=await execFileAsync('tar',['-tzf',path.join(temp,'package.tar.gz')]);if(!stdout.includes('database.dump')||!stdout.includes('manifest.json'))throw new Error('תוכן הגיבוי אינו תקין');res.json({ok:true,name,encrypted:true});}finally{await rm(temp,{recursive:true,force:true});}});
  router.post('/system/restore',async(req,res)=>{if(!passphrase||passphrase==='change-this-backup-passphrase')throw Object.assign(new Error('סיסמת הגיבוי אינה מוגדרת'),{statusCode:400});const policy=await getPolicy();const directory=req.body.source==='share'?safeSharePath(policy.relativePath):internalDir;const name=path.basename(String(req.body.name||''));if(name!==req.body.name||!/^betipul-.*\.btpbackup$/.test(name))throw Object.assign(new Error('שם קובץ לא תקין'),{statusCode:400});const temp=await mkdtemp('/tmp/betipul-restore-');try{const archive=path.join(temp,'package.tar.gz');await decryptFile(path.join(directory,name),archive,passphrase);await execFileAsync('tar',['-xzf',archive,'-C',temp,'database.dump','manifest.json']);const manifest=JSON.parse(await readFile(path.join(temp,'manifest.json'),'utf8'));if(manifest.product!=='BETIPUL'||Number(manifest.formatVersion)!==1)throw new Error('גרסת הגיבוי אינה נתמכת');const staged=path.join(internalDir,`restore-${Date.now()}.dump`);await pipeline(createReadStream(path.join(temp,'database.dump')),createWriteStream(staged,{mode:0o600}));await writeFile(path.join(dataDir,'restore.request'),staged,{mode:0o600});await audit(req,'restore_requested','system',name,{source:req.body.source||'internal'});res.status(202).json({status:'restarting'});setTimeout(async()=>{await pool.end();process.exit(0);},500);}finally{await rm(temp,{recursive:true,force:true});}});
  let busy=false;const scheduler=async()=>{if(busy)return;busy=true;try{const p=await getPolicy();if(!p.enabled)return;const now=new Date();const local=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit',year:'numeric',month:'2-digit',day:'2-digit',hourCycle:'h23'}).formatToParts(now);const x=Object.fromEntries(local.filter(v=>v.type!=='literal').map(v=>[v.type,v.value]));const date=`${x.year}-${x.month}-${x.day}`;if(`${x.hour}:${x.minute}`>=p.hour&&p.lastAutomaticDate!==date){await createBackup({automatic:true});await pool.query("UPDATE app_settings SET value=jsonb_set(value,'{lastAutomaticDate}',to_jsonb($1::text)),updated_at=NOW() WHERE key='backupPolicy'",[date]);}}catch(error){console.error('Backup failed',error.message);}finally{busy=false;}};setTimeout(scheduler,15000);setInterval(scheduler,60000);
  return router;
}
