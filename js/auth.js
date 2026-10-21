/* EvoBuskin V9 - Auth robuste : refresh de session, email vérifié, MFA TOTP pour patron. */
const Auth = (() => {
  const STORAGE_KEY = 'evobuskin_auth_session_v2';
  const CONFIG = () => window.AUTH_CONFIG || {};
  let refreshTimer = null, refreshInFlight = null;
  function configure(){const c=CONFIG();return Boolean(c.supabaseUrl&&c.supabaseAnonKey)}
  function base(){return CONFIG().supabaseUrl.replace(/\/$/,'')}
  function headers(token){const c=CONFIG();const h={apikey:c.supabaseAnonKey,'Content-Type':'application/json'};if(token)h.Authorization='Bearer '+token;return h}
  async function request(path,options={}){if(!configure())throw new Error('Le service n\'est pas encore configuré. Contactez le support.');if(typeof navigator!=='undefined'&&navigator.onLine===false)throw Reseau.erreur();let r;try{r=await fetch(base()+path,{...options,headers:{...headers(options.accessToken),...(options.headers||{})},cache:'no-store'})}catch(_){throw Reseau.erreur()}let d=null;try{d=await r.json()}catch(_){}if(!r.ok){const e=new Error(d?.msg||d?.message||d?.error_description||d?.error||('Erreur '+r.status+' '+path.split('?')[0]));e.code=d?.code||d?.error||r.status;e.status=r.status;throw e}return d}
  function saveSession(s){if(!s){clearSession();return}const x={...s};delete x.password;localStorage.setItem(STORAGE_KEY,JSON.stringify(x));scheduleRefresh(x)}
  function getSession(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch(_){return null}}
  function clearSession(){if(refreshTimer)clearTimeout(refreshTimer);refreshTimer=null;localStorage.removeItem(STORAGE_KEY)}
  function scheduleRefresh(s=getSession()){if(refreshTimer)clearTimeout(refreshTimer);refreshTimer=null;if(!s?.refresh_token)return;const exp=Number(s.expires_at||0)*1000;const delay=Math.max(30000,exp?exp-Date.now()-60000:240000);refreshTimer=setTimeout(()=>refreshSession().catch(()=>{if(getSession()?.refresh_token)scheduleRefresh(getSession())}),Math.min(delay,20*60*1000))}
  async function refreshSession(){if(refreshInFlight)return refreshInFlight;const s=getSession();if(!s?.refresh_token)return null;refreshInFlight=(async()=>{try{const d=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:s.refresh_token})});saveSession(d);return d}catch(e){if(!e.reseau&&(e.status===400||e.status===401||e.status===403))clearSession();throw e}finally{refreshInFlight=null}})();return refreshInFlight}
  async function ensureFreshSession(){const s=getSession();if(!s)return null;if(typeof navigator!=='undefined'&&navigator.onLine===false)return s;const exp=Number(s.expires_at||0)*1000;if(exp&&exp-Date.now()<90000)return refreshSession();scheduleRefresh(s);return s}
  async function signUp({email,password,fullName,accountType,businessName,inviteCode}){if(accountType==='vendeur'&&!(inviteCode&&String(inviteCode).trim()))throw new Error('Un code d’invitation est requis pour un vendeur.');const d=await request('/auth/v1/signup',{method:'POST',body:JSON.stringify({email:email.trim().toLowerCase(),password,data:{full_name:fullName.trim(),requested_account_type:accountType,business_name:businessName.trim(),invite_code:inviteCode?inviteCode.trim():null}})});if(d.access_token)saveSession(d);return d}
  async function signIn(email,password){const d=await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:email.trim().toLowerCase(),password})});if(d.user&&d.user.email_confirmed_at===null)throw new Error('EMAIL_NOT_CONFIRMED');saveSession(d);return d}
  // Appel d'une fonction publique du serveur (sans être connecté)
  async function rpcPublic(fn,args){return request('/rest/v1/rpc/'+fn,{method:'POST',body:JSON.stringify(args||{})})}
  // Changement de mot de passe : on vérifie l'ancien, puis on enregistre le nouveau
  // Changement de mot de passe. Si le compte est protégé par un code (MFA), Supabase exige une session « AAL2 » :
  // on demande alors le code à 6 chiffres, on le vérifie, puis on réessaie avec la session renforcée.
  async function changerMotDePasse(email,ancien,nouveau,codeMfa){
    const d=await signIn(email,ancien);
    saveSession(d);
    try{ await updatePassword(d.access_token,nouveau); }
    catch(e){
      if(!/AAL2|MFA|multi-?factor/i.test(String(e.message)))throw e;
      if(!codeMfa){const err=new Error('MFA_REQUIRED');err.mfaRequis=true;throw err}
      const f=await listFactors();
      const facteur=(f.all||[]).find(x=>x.factor_type==='totp'&&x.status==='verified');
      if(!facteur)throw e;
      const ch=await challengeFactor(facteur.id);
      await verifyFactor(facteur.id,ch.id,codeMfa);
      await updatePassword(getSession().access_token,nouveau);
    }
    return getSession()||d;
  }
  async function resetPassword(email){return request('/auth/v1/recover',{method:'POST',body:JSON.stringify({email:email.trim().toLowerCase()})})}
  async function updatePassword(token,newPassword){return request('/auth/v1/user',{method:'PUT',accessToken:token,body:JSON.stringify({password:newPassword})})}
  async function getProfile(userId,token){const rows=await request('/rest/v1/profiles?select=id,role,business_id,business_name&user_id=eq.'+encodeURIComponent(userId)+'&limit=1',{method:'GET',accessToken:token,headers:{Accept:'application/json'}});return Array.isArray(rows)?rows[0]||null:null}
  async function listFactors(){const s=await ensureFreshSession();if(!s?.access_token)throw new Error('AUTH_REQUIRED');const u=await request('/auth/v1/user',{method:'GET',accessToken:s.access_token});return{all:u?.factors||[]}}
  function aalOf(t){try{return JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).aal||'aal1'}catch(_){return 'aal1'}}
  async function enrollTotp(name='EvoBuskin '+Date.now()){const s=await ensureFreshSession();if(!s?.access_token)throw new Error('AUTH_REQUIRED');return request('/auth/v1/factors',{method:'POST',accessToken:s.access_token,body:JSON.stringify({factor_type:'totp',friendly_name:name})})}
  async function challengeFactor(id){const s=await ensureFreshSession();return request('/auth/v1/factors/'+encodeURIComponent(id)+'/challenge',{method:'POST',accessToken:s.access_token,body:'{}'})}
  async function verifyFactor(id,challengeId,code){const s=await ensureFreshSession();const d=await request('/auth/v1/factors/'+encodeURIComponent(id)+'/verify',{method:'POST',accessToken:s.access_token,body:JSON.stringify({challenge_id:challengeId,code:String(code).replace(/\s/g,'')})});if(d?.access_token)saveSession(d);return d}
  async function requirePatronMfa(){const s=await ensureFreshSession();if(!s?.access_token)throw new Error('AUTH_REQUIRED');const f=await listFactors();const verified=(f?.all||[]).find(x=>x.factor_type==='totp'&&x.status==='verified');if(!verified)return{enrolled:false,aal2:false,factors:f};if(aalOf(s.access_token)==='aal2')return{enrolled:true,aal2:true,factor:verified,factors:f};const challenge=await challengeFactor(verified.id);return{enrolled:true,aal2:false,factor:verified,challenge,factors:f}}
  async function signOut(){const s=getSession();if(s?.access_token&&configure()){try{await request('/auth/v1/logout',{method:'POST',accessToken:s.access_token})}catch(_){}}clearSession()}
  window.addEventListener('online',()=>{if(getSession()?.refresh_token)ensureFreshSession().catch(()=>{})});
  return{configure,signUp,signIn,rpcPublic,changerMotDePasse,resetPassword,updatePassword,getProfile,signOut,getSession,clearSession,refreshSession,ensureFreshSession,listFactors,enrollTotp,challengeFactor,verifyFactor,requirePatronMfa}
})();
window.Auth=Auth;
