/* EvoBuskin V22 — abonnements + démarrage du paiement (pawaPay).
 * Le frontend ne choisit jamais le prix et ne confirme jamais un paiement : le serveur décide et vérifie auprès de pawaPay.
 */
const Subscriptions = (() => {
  async function listPlans(){ return CloudDB.rpc('v13_list_plans',{}); }
  async function getEntitlement(businessId){ return CloudDB.rpc('v15_get_entitlement',{p_business_id:businessId}); }
  async function canUse(businessId, feature=null){ return CloudDB.rpc('v15_can_use',{p_business_id:businessId,p_feature:feature}); }
  async function createCheckoutRequest({businessId,planId,provider,idempotencyKey}){
    if(!businessId||!planId||!provider||!idempotencyKey) throw new Error('Paramètres de paiement incomplets.');
    return CloudDB.rpc('v13_create_checkout_request',{p_business_id:businessId,p_plan_id:planId,p_provider:provider,p_idempotency_key:idempotencyKey});
  }
  async function startCheckout({businessId,planId,idempotencyKey}){
    if(!businessId||!planId) throw new Error('Business et plan requis.');
    const key = idempotencyKey || crypto.randomUUID();
    if(!window.AUTH_CONFIG?.supabaseUrl || !window.AUTH_CONFIG?.supabaseAnonKey) throw new Error('Le service n’est pas encore configuré. Contactez le support.');
    const session = await window.Auth?.ensureFreshSession?.();
    const accessToken = session?.access_token;
    if(!accessToken) throw new Error('Session expirée.');
    const res = await fetch(`${window.AUTH_CONFIG.supabaseUrl}/functions/v1/pawapay-checkout`,{
      method:'POST',
      headers:{'content-type':'application/json','authorization':`Bearer ${accessToken}`,'apikey':window.AUTH_CONFIG.supabaseAnonKey},
      body:JSON.stringify({business_id:businessId,plan_id:planId,idempotency_key:key})
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok || !data.payment_url){
      const err = new Error(data.error || 'Impossible de démarrer le paiement.');
      err.status = res.status; err.providerCode = data.provider_code || data.code || '';
      try{Diag.noter('paiement',err,{prestataire:err.providerCode})}catch(_){}
      throw err;
    }
    // Sécurité : on n'ouvre qu'une page https appartenant au prestataire de paiement (jamais une adresse inattendue)
    let cible;
    try{cible=new URL(data.payment_url)}catch(_){cible=null}
    if(!cible||cible.protocol!=='https:'||!/(^|\.)pawapay\.io$/i.test(cible.hostname)){
      const err = new Error('PAYMENT_URL_REFUSED'); try{Diag.noter('paiement',err,{hote:cible?cible.hostname:'?'})}catch(_){}
      throw err;
    }
    try{localStorage.setItem('evobuskin_paiement_attente',data.payment_id||'')}catch(_){}
    window.location.assign(cible.href);
    return data;
  }
  // Au retour de la page de paiement : demande au serveur de vérifier le paiement auprès de pawaPay (n'échoue jamais bruyamment ;
  // le statut affiché vient ensuite de la base). Marche même si la notification de pawaPay n'est pas arrivée.
  async function verifyPayment(paymentId){
    try{
      if(!paymentId||!window.AUTH_CONFIG?.supabaseUrl) return null;
      const session = await window.Auth?.ensureFreshSession?.();
      if(!session?.access_token) return null;
      const res = await fetch(`${window.AUTH_CONFIG.supabaseUrl}/functions/v1/pawapay-webhook`,{
        method:'POST',
        headers:{'content-type':'application/json','authorization':`Bearer ${session.access_token}`,'apikey':window.AUTH_CONFIG.supabaseAnonKey},
        body:JSON.stringify({payment_id:paymentId})
      });
      return await res.json().catch(()=>null);
    }catch(_){ return null; }
  }
  return {listPlans,getEntitlement,canUse,createCheckoutRequest,startCheckout,verifyPayment};
})();
window.Subscriptions=Subscriptions;
