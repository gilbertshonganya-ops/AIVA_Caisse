/* EvoBuskin V9 - Auth robuste : refresh de session, email vérifié, MFA TOTP pour patron. */
const Auth = (() => {
  const STORAGE_KEY = 'evobuskin_auth_session_v2';
  const CONFIG = () => window.AUTH_CONFIG || {};
  let refreshTimer = null, refreshInFlight = null;
  function configure(){const c=CONFIG();return Boolean(c.supabaseUrl&&c.supabaseAnonKey)}
  function base(){return CONFIG().supabaseUrl.replace(/\/$/,'')}
  function headers(token){const c=CONFIG();const h={apikey:c.supabaseAnonKey,'Content-Type':'application/json'};if(token)h.Authorization='Bearer '+token;return h}
  async function request(path,options={}){if(!configure())throw new Error('Supabase n\'est pas encore configuré.');const r=await fetch(base()+path,{...options,headers:{...headers(options.accessToken),...(options.headers||{})},cache:'no-store'});let d=null;try{d=await r.json()}catch(_){}if(!r.ok){const e=new Error(d?.msg||d?.message||d?.error_description||d?.error||('Erreur '+r.status+' '+path));e.code=d?.code||d?.error||r.status;e.status=r.status;throw e}return d}
  function saveSession(s){if(!s){clearSession();return}const x={...s};delete x.password;localStorage.setItem(STORAGE_KEY,JSON.stringify(x));scheduleRefresh(x)}
  function getSession(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch(_){return null}}
  function clearSession(){if(refreshTimer)clearTimeout(refreshTimer);refreshTimer=null;localStorage.removeItem(STORAGE_KEY)}
  function scheduleRefresh(s=getSession()){if(refreshTimer)clearTimeout(refreshTimer);refreshTimer=null;if(!s?.refresh_token)return;const exp=Number(s.expires_at||0)*1000;const delay=Math.max(30000,exp?exp-Date.now()-60000:240000);refreshTimer=setTimeout(()=>refreshSession().catch(()=>{}),Math.min(delay,20*60*1000))}
  async function refreshSession(){if(refreshInFlight)return refreshInFlight;const s=getSession();if(!s?.refresh_token)return null;refreshInFlight=(async()=>{try{const d=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:s.refresh_token})});saveSession(d);return d}catch(e){clearSession();throw e}finally{refreshInFlight=null}})();return refreshInFlight}
  async function ensureFreshSession(){const s=getSession();if(!s)return null;const exp=Number(s.expires_at||0)*1000;if(exp&&exp-Date.now()<90000)return refreshSession();scheduleRefresh(s);return s}
  async function signUp({email,password,fullName,accountType,businessName,inviteCode}){if(accountType==='vendeur')throw new Error('La création d’un compte vendeur est réservée aux invitations validées par le serveur.');const d=await request('/auth/v1/signup',{method:'POST',body:JSON.stringify({email:email.trim().toLowerCase(),password,data:{full_name:fullName.trim(),requested_account_type:accountType,business_name:businessName.trim(),invite_code:inviteCode?inviteCode.trim():null}})});if(d.access_token)saveSession(d);return d}
  async function signIn(email,password){const d=await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:email.trim().toLowerCase(),password})});if(d.user&&d.user.email_confirmed_at===null)throw new Error('EMAIL_NOT_CONFIRMED');saveSession(d);return d}
  async function resetPassword(email){return request('/auth/v1/recover',{method:'POST',body:JSON.stringify({email:email.trim().toLowerCase()})})}
  async function updatePassword(token,newPassword){return request('/auth/v1/user',{method:'PUT',accessToken:token,body:JSON.stringify({password:newPassword})})}
  async function getProfile(userId,token){const rows=await request('/rest/v1/profiles?select=id,role,business_id,business_name&user_id=eq.'+encodeURIComponent(userId)+'&limit=1',{method:'GET',accessToken:token,headers:{Accept:'application/json'}});return Array.isArray(rows)?rows[0]||null:null}
  async function listFactors(){const s=await ensureFreshSession();if(!s?.access_token)throw new Error('AUTH_REQUIRED');return request('/auth/v1/factors',{method:'GET',accessToken:s.access_token})}
  async function enrollTotp(name='EvoBuskin Patron'){const s=await ensureFreshSession();if(!s?.access_token)throw new Error('AUTH_REQUIRED');return request('/auth/v1/factors',{method:'POST',accessToken:s.access_token,body:JSON.stringify({factor_type:'totp',friendly_name:name})})}
  async function challengeFactor(id){const s=await ensureFreshSession();return request('/auth/v1/factors/'+encodeURIComponent(id)+'/challenge',{method:'POST',accessToken:s.access_token,body:'{}'})}
  async function verifyFactor(id,challengeId,code){const s=await ensureFreshSession();const d=await request('/auth/v1/factors/'+encodeURIComponent(id)+'/verify',{method:'POST',accessToken:s.access_token,body:JSON.stringify({challenge_id:challengeId,code:String(code).replace(/\s/g,'')})});if(d?.access_token)saveSession(d);return d}
  async function requirePatronMfa(){const s=await ensureFreshSession();if(!s?.access_token)throw new Error('AUTH_REQUIRED');const f=await listFactors();const verified=(f?.all||[]).find(x=>x.factor_type==='totp'&&x.status==='verified');if(!verified)return{enrolled:false,aal2:false,factors:f};if(String(s.aal||'aal1')==='aal2')return{enrolled:true,aal2:true,factor:verified,factors:f};const challenge=await challengeFactor(verified.id);return{enrolled:true,aal2:false,factor:verified,challenge,factors:f}}
  async function signOut(){const s=getSession();if(s?.access_token&&configure()){try{await request('/auth/v1/logout',{method:'POST',accessToken:s.access_token})}catch(_){}}clearSession()}
  window.addEventListener('online',()=>{if(getSession()?.refresh_token)ensureFreshSession().catch(()=>{})});
  return{configure,signUp,signIn,resetPassword,updatePassword,getProfile,signOut,getSession,clearSession,refreshSession,ensureFreshSession,listFactors,enrollTotp,challengeFactor,verifyFactor,requirePatronMfa}
})();
window.Auth=Auth;
