import {randomBytes,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';import {StudioStore} from './store.js';
const passwordSchema=z.string().min(12).max(128);const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
// Node/OpenSSL scrypt; OWASP scrypt N=2^15, r=8, p=3 profile (~32 MiB).
function derive(password:string,salt:string):Promise<Buffer>{return new Promise((resolve,reject)=>scrypt(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key)));}
export interface Session{token:string;csrf:string;authenticated:boolean;expiresAt:number;}
export class StudioAuth{
 constructor(readonly store:StudioStore,private readonly now=Date.now){}
 configured(){return this.store.get('password')!==null;}
 open(authenticated=false):Session{
  const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex'),expiresAt=this.now()+(authenticated?8*3600000:15*60000);
  this.store.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(this.now());this.store.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token),csrf,authenticated?1:0,expiresAt);return{token,csrf,authenticated,expiresAt};
 }
 resolve(token:string):Session|null{if(!/^[a-f0-9]{64}$/.test(token))return null;const row=this.store.db.prepare('SELECT * FROM sessions WHERE hash=? AND expires_at>?').get(digest(token),this.now()) as {csrf:string;authenticated:number;expires_at:number}|undefined;return row?{token,csrf:row.csrf,authenticated:!!row.authenticated,expiresAt:row.expires_at}:null;}
 revoke(token:string){this.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token));}
 csrf(session:Session,received:string){const a=Buffer.from(session.csrf),b=Buffer.from(received);return a.length===b.length&&timingSafeEqual(a,b);}
 private async encoded(password:string){passwordSchema.parse(password);const salt=randomBytes(32).toString('hex');return JSON.stringify({algorithm:'scrypt-N32768-r8-p3',salt,hash:(await derive(password,salt)).toString('hex')});}
 async setup(session:Session,password:string){const encoded=await this.encoded(password);this.store.db.transaction(()=>{if(this.configured()||!this.resolve(session.token))throw new Error('Setup unavailable');this.store.set('password',encoded);}).immediate();}
 async login(session:Session,password:string):Promise<Session>{
  const current=this.store.get('password');if(!current||!this.resolve(session.token))throw new Error('Login rejected');
  const rate=JSON.parse(this.store.get('login-rate')??'{"attempts":0,"until":0}') as {attempts:number;until:number};if(rate.until>this.now()&&rate.attempts>=5)throw new Error('Login temporarily limited');
  const next=rate.until>this.now()?{attempts:rate.attempts+1,until:rate.until}:{attempts:1,until:this.now()+15*60000};this.store.set('login-rate',JSON.stringify(next));
  if(typeof password!=='string'||password.length>128)throw new Error('Login rejected');const saved=JSON.parse(current) as {salt:string;hash:string};const actual=await derive(password,saved.salt);
  if(!timingSafeEqual(actual,Buffer.from(saved.hash,'hex')))throw new Error('Login rejected');
  // Recheck after asynchronous hashing so recovery/logout cannot resurrect a revoked session.
  if(this.store.get('password')!==current||!this.resolve(session.token))throw new Error('Login rejected');
  this.store.set('login-rate','{"attempts":0,"until":0}');this.revoke(session.token);return this.open(true);
 }
 async recover(password:string,operatorAuthorized:boolean){if(!operatorAuthorized)throw new Error('Explicit local operator authorization required');const encoded=await this.encoded(password);this.store.db.transaction(()=>{this.store.set('password',encoded);this.store.db.exec('DELETE FROM sessions');this.store.set('login-rate','{"attempts":0,"until":0}');}).immediate();}
}
