import{StudioSettings}from'./settings.js';import{CliPage}from'./cli.js';import{StudioShell,EmptyState,type StudioView,type ProjectView,type V3View}from'./ui.js';
import{useEffect,useState,type ComponentType,type ReactNode}from'react';import{api,configureStudio}from'./api.js';
import{AppShell}from'./shell.js';
import{OrchestratorPage}from'./orchestrator.js';
import{TicketsPage}from'./tickets.js';
import{KnowledgePage}from'./knowledge.js';
interface Project{id:string;name:string;path:string;lastOpenedAt:number|null;status?:string;}
interface Projects{projects:Project[];selected:string|null;roots:string[];}
interface Auth{configured:boolean;authenticated:boolean;csrf:string;}
type AppProps={studioBar?:ReactNode;onGlobal?:(v:'projects'|'settings'|'logout')=>void;embedded?:boolean;initialView?:ProjectView;initialPlanId?:string;initialRunId?:string;testMode?:'new'|'existing';freshStory?:boolean;onNavigate?:(v:ProjectView,id?:string)=>void};
export function Studio({ProjectApp}:{ProjectApp:ComponentType<AppProps>}){
 const[auth,setAuth]=useState<Auth|null>(null),[legacy,setLegacy]=useState(false),[error,setError]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[data,setData]=useState<Projects>({projects:[],selected:null,roots:[]}),[view,setView]=useState<StudioView>('projects'),[v3View,setV3View]=useState<V3View>('orchestrator'),[engineMode,setEngineMode]=useState<boolean>(false),[hash,setHash]=useState<string>(()=>typeof window!=='undefined'?window.location.hash:''),[name,setName]=useState(''),[directory,setDirectory]=useState(''),[origin,setOrigin]=useState('http://127.0.0.1:4317'),[environmentName,setEnvironmentName]=useState('QA'),[importName,setImportName]=useState(''),[importPath,setImportPath]=useState(''),[notice,setNotice]=useState(''),[references,setReferences]=useState(''),[completed,setCompleted]=useState(false),[intent,setIntent]=useState({key:0,mode:'new' as 'new'|'existing',plan:'',run:''});
 async function refresh(){const value=await api<Projects>('/api/studio/projects');setData(value);configureStudio(auth?.csrf??'',value.selected??'');return value;}
 useEffect(()=>{const onHash=()=>setHash(window.location.hash);window.addEventListener('hashchange',onHash);void fetch('/api/v1/health').then(r=>{if(r.ok)setEngineMode(true);}).catch(()=>{});return()=>window.removeEventListener('hashchange',onHash);},[]);
 useEffect(()=>{void fetch('/api/studio/auth').then(async response=>{if(response.headers.get('x-qaspider-service')==='project'){const token=new URLSearchParams(location.hash.slice(1)).get('token');if(token){sessionStorage.setItem('qaspider-token',token);history.replaceState(null,'',location.pathname);}setLegacy(true);return;}if(!response.ok)throw new Error('Studio unavailable');const value=await response.json()as Auth;sessionStorage.removeItem('qaspider-token');configureStudio(value.csrf);history.replaceState(null,'',location.pathname);setAuth(value);}).catch(e=>setError(e.message));},[]);
 useEffect(()=>{if(auth?.authenticated)void refresh().then(value=>setView(value.selected?'overview':'projects')).catch(e=>setError(e.message));},[auth?.authenticated]);
 useEffect(()=>{const expired=()=>{setAuth(null);setData({projects:[],selected:null,roots:[]});void fetch('/api/studio/auth').then(r=>r.json()).then((value:Auth)=>{configureStudio(value.csrf);setAuth(value);}).catch(()=>setError('Studio connection unavailable'));};window.addEventListener('studio-session-expired',expired);return()=>window.removeEventListener('studio-session-expired',expired);},[]);
 async function action(work:()=>Promise<void>){setBusy(true);setError('');try{await work();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function operation(body:unknown){const value=await api<Projects>('/api/studio/projects',body);setData(value);configureStudio(auth!.csrf,value.selected??'');}
 function navigate(v:StudioView,id?:string){setNotice('');if(!data.selected&&!['projects','settings','cli'].includes(v)){setView('projects');setNotice('Create or open a project to continue.');return;}setIntent(old=>({key:old.key+1,mode:v==='studio'&&id?'existing':'new',plan:v==='studio'&&id&&id!=='existing'?id:'',run:v==='runs'?id??'':''}));setView(v);window.scrollTo(0,0);}
 async function logout(){await action(async()=>{await api('/api/studio/logout',{});const next=await fetch('/api/studio/auth').then(r=>r.json())as Auth;configureStudio(next.csrf);setAuth(next);setData({projects:[],selected:null,roots:[]});setPassword('');});}
 const selected=data.projects.find(p=>p.id===data.selected);
 const bar=<label className="studio-switch">Project<select aria-label="Studio project" value={data.selected??''} onChange={e=>void action(async()=>{await operation({operation:'select',id:e.target.value});setIntent(old=>({...old,key:old.key+1,plan:'',run:''}));setView('overview');setNotice('');})}><option value="" disabled>Select project</option>{data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>;
 if(legacy)return<ProjectApp/>;
 if(!auth)return<div role="status" className="empty card">{error||'Loading Studio…'}</div>;
 if(!auth.authenticated)return<div className="auth-page"><div className="login card"><div className="brand"><span className="brand-mark">Q</span><strong>QASpider Studio</strong></div><div className="eyebrow">LOCAL QA · PERSISTENT MEMORY</div><h1>{auth.configured?'Login':'First-run administrator setup'}</h1><p>{auth.configured?'Welcome back. Open your projects and pick up where your tests left off.':'Set up your private QA workspace. Create the local administrator to get started.'}</p>{error&&<p role="alert" className="alert error">{error}</p>}<form onSubmit={e=>{e.preventDefault();void action(async()=>{const next=await api<Auth>(auth.configured?'/api/studio/login':'/api/studio/setup',{password});setPassword('');configureStudio(next.csrf);setAuth(next);});}}><label>Studio password<input type="password" autoComplete={auth.configured?'current-password':'new-password'} minLength={12} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)}/><small>12–128 characters. Separate from target application credentials.</small></label><button className="primary" disabled={busy}>{auth.configured?'Login':'Create administrator'}</button></form><p className="security-note">Local-only access. No default password. Session credentials stay out of URLs and browser storage.</p></div></div>;
 const isV3 = hash === '#v2' ? false : (hash === '#v3' || engineMode);
 if (isV3) {
  return (
   <AppShell
    view={v3View}
    projects={data.projects}
    selectedProjectId={data.selected}
    onSelectProject={id => void action(async () => {
     await operation({ operation: 'select', id });
     setV3View('orchestrator');
    })}
    onNavigate={setV3View}
    onLogout={() => void logout()}
   >
    {error && <p role="alert" className="alert error">{error}</p>}
    {notice && <p role="status" className="alert">{notice}</p>}
    {!selected ? (
     <div style={{ padding: '28px 32px' }}>
      <div className="orc-empty">
       <span className="brand-mark" style={{ fontSize: 32 }}>Q</span>
       <h2>Welcome to QASpider Studio</h2>
       <p>Select or create a project above to get started.</p>
      </div>
      {data.roots.length > 0 && (
       <div className="onboarding-grid" style={{ maxWidth: 640, margin: '24px auto' }}>
        <section className="card project-card">
         <div className="eyebrow">NEW WORKSPACE</div>
         <h2>Create Project</h2>
         <form onSubmit={e => {
          e.preventDefault();
          void action(async () => {
           const target = new URL(origin);
           if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Use a valid HTTP(S) application URL without embedded credentials.');
           await operation({ operation: 'create', input: { name, ...(directory.trim() ? { directory: directory.trim() } : {}), origin: target.origin, environmentName, ...(references.trim() ? { references: JSON.parse(references) } : {}) } });
           setNotice('Project created.');
           setName('');
           setDirectory('');
           setV3View('orchestrator');
          });
         }}>
          <label>Project name<input required value={name} onChange={e => setName(e.target.value)} placeholder="Customer portal QA" /></label>
          <label>Application URL<input aria-label="Application URL" type="url" required value={origin} onChange={e => setOrigin(e.target.value)} placeholder="https://qa.example.test" /></label>
          <label>Environment name<select value={environmentName} onChange={e => setEnvironmentName(e.target.value)}><option>QA</option><option>Development</option></select></label>
          <button className="primary" disabled={busy || !data.roots.length}>Create project</button>
         </form>
        </section>
       </div>
      )}
     </div>
    ) : v3View === 'orchestrator' ? (
     <OrchestratorPage projectId={selected.id} />
    ) : v3View === 'tickets' ? (
     <TicketsPage projectId={selected.id} />
    ) : v3View === 'knowledge' ? (
     <KnowledgePage projectId={selected.id} />
    ) : v3View === 'settings' ? (
     <StudioSettings key={selected.id} projectId={selected.id} />
    ) : null}
   </AppShell>
  );
 }
 return<StudioShell view={view} projectSelector={bar} projectName={selected?.name??''} hasProject={!!selected} onNavigate={v=>{navigate(v);if(v==='projects')void action(async()=>{await refresh();});}} onNewTest={()=>navigate('studio')} onLogout={()=>void logout()}>
 {error&&<p role="alert" className="alert error">{error}</p>}{notice&&<p role="status" className="alert">{notice}</p>}
 {view==='settings'?<StudioSettings key={data.selected??'global'} projectId={data.selected}/>:view==='cli'?<CliPage key={data.selected??'global'} projectId={data.selected}/>:view!=='projects'&&data.selected?<ProjectApp key={data.selected+':'+view+':'+intent.key} embedded initialView={view as ProjectView} initialPlanId={intent.plan} initialRunId={intent.run} testMode={intent.mode} onNavigate={(v,id)=>navigate(v,id)}/>:<>
 <div className="headline"><div><div className="eyebrow">YOUR QA WORKSPACES</div><h1>Projects</h1><p>Keep each product's applications, tests and evidence together.</p></div><button onClick={()=>void action(async()=>{await refresh();})}>Refresh projects</button></div>
 <div className="hierarchy-guide"><span><strong>Project</strong> · workspace and evidence</span><span>→</span><span><strong>Application</strong> · product under test</span><span>→</span><span><strong>Environment</strong> · permitted deployment</span><span>→</span><span><strong>Role</strong> · test identity</span></div>
 {!data.projects.length?<EmptyState title="Start with your first project">Create a workspace below, or import one you already initialized through the CLI.</EmptyState>:<div className="project-grid">{data.projects.map(p=><section className="card project-tile" data-testid="project-record" key={p.id}><div className="project-tile-top"><span className="project-avatar">{p.name.charAt(0).toUpperCase()}</span><span className={'status '+(p.status==='available'?'approved':'suspect')}>{p.status==='available'?'Ready':'Unavailable'}</span></div><h2>{p.name}</h2><p>{p.lastOpenedAt?`Last opened ${new Date(p.lastOpenedAt).toLocaleDateString()}`:'Not opened yet'}</p><div className="tile-actions"><button className="primary" disabled={p.status!=='available'} onClick={()=>void action(async()=>{await operation({operation:'select',id:p.id});setView('overview');setNotice('');setIntent(old=>({...old,key:old.key+1,plan:'',run:''}));})}>Open {p.name}</button><details><summary>Manage project</summary><code>{p.path}</code><label>Rename project<input aria-label={`Rename ${p.name}`} defaultValue={p.name} onBlur={e=>{if(e.target.value!==p.name)void action(()=>operation({operation:'rename',id:p.id,name:e.target.value}));}}/></label><button onClick={()=>void action(()=>operation({operation:'archive',id:p.id}))}>Archive {p.name}</button><small>Archive keeps every workspace file.</small></details></div></section>)}</div>}
 <div className="onboarding-grid"><section className="card project-card"><div className="eyebrow">NEW WORKSPACE</div><h2>Create Project</h2><p>Connect a product and discover its safe navigation. Technical identifiers are generated for you.</p><ol className="stepper"><li>Project</li><li>Application & environment</li><li>Roles</li><li>Discover</li></ol>{!data.roots.length&&<p className="alert">Browser creation/import needs an approved directory. Restart Studio with --projects-root, or use npm run start.</p>}
 <form onSubmit={e=>{e.preventDefault();void action(async()=>{const target=new URL(origin);if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw new Error('Use a valid HTTP(S) application URL without embedded credentials.');await operation({operation:'create',input:{name,...(directory.trim()?{directory:directory.trim()}:{}),origin:target.origin,environmentName,...(references.trim()?{references:JSON.parse(references)}:{})}});setNotice('Project created. Your application, environment and credential references are saved.');setCompleted(true);setName('');setDirectory('');});}}>
 <label>Project name<input required value={name} onChange={e=>setName(e.target.value)} placeholder="Customer portal QA"/></label><label>Application URL<input aria-label="Application URL" type="url" required value={origin} onChange={e=>setOrigin(e.target.value)} placeholder="https://qa.example.test"/><small>This declares the navigable application origin. External CDN/resource origins are not separately supported; undeclared origins remain blocked.</small></label><label>Environment name<select value={environmentName} onChange={e=>setEnvironmentName(e.target.value)}><option>QA</option><option>Development</option></select></label>
 <p>Start with the guest role. Admin and standard-user profiles are created with environment-variable references; authenticated discovery needs an explicit login configuration.</p><details><summary>Advanced Settings · storage and role references</summary><p>Approved directory: <code>{data.roots[0]??'not configured'}</code></p><label>Workspace directory<input value={directory} onChange={e=>setDirectory(e.target.value)} placeholder="Generated automatically below the approved directory"/></label><label>Role secret references (optional JSON)<textarea value={references} onChange={e=>setReferences(e.target.value)} placeholder='{"adminEmail":"QA_ADMIN_EMAIL","adminPassword":"QA_ADMIN_PASSWORD","userEmail":"QA_USER_EMAIL","userPassword":"QA_USER_PASSWORD"}'/></label><small>Names only. Never enter passwords or credential values.</small></details><button className="primary" disabled={busy||!data.roots.length}>Create project</button></form>
 {completed&&<div className="onboarding-complete"><h3>Workspace ready</h3><p>The target origin is declared. Next, discover navigation before creating tests.</p><button className="primary" onClick={()=>navigate('applications')}>Discover application</button></div>}</section>
 <section className="card project-card"><div className="eyebrow">BRING YOUR EXISTING WORK</div><h2>Import Existing Project</h2><p>Open a CLI-created workspace. Graphs, approved tests and evidence stay in place.</p><form onSubmit={e=>{e.preventDefault();void action(async()=>{await operation({operation:'import',path:importPath,name:importName});setNotice('Existing workspace registered; project files and evidence retained.');});}}><label>Import project name<input required value={importName} onChange={e=>setImportName(e.target.value)}/></label><label>Existing workspace directory<input required value={importPath} onChange={e=>setImportPath(e.target.value)}/></label><button disabled={busy||!data.roots.length}>Import project</button></form></section></div></>}
 </StudioShell>;
}
