/* EvoBuskin V14 — abonnements + démarrage CinetPay.
 * Le frontend ne choisit jamais le prix et ne confirme jamais un paiement.
 */
const Subscriptions = (() => {
  async function listPlans(){ return CloudDB.rpc('v13_list_plans',{}); }
  async function getEntitlement(businessId){ return CloudDB.rpc('v15_get_entitlement',{p_business_id:businessId}); }
  async function canUse(businessId, feature=null){ return CloudDB.rpc('v15_can_use',{p_business_id:businessId,p_feature:feature}); }
  async function createCheckoutRequest({businessId,planId,provider,idempotencyKey}){
    if(!businessId||!planId||!provider||!idempotencyKey) throw new Error('Paramètres de paiement incomplets.');
    return CloudDB.rpc('v13_create_checkout_request',{p_business_id:businessId,p_plan_id:planId,p_provider:provider,p_idempotency_key:idempotencyKey});
  }
  async function startCinetPayCheckout({businessId,planId,idempotencyKey}){
    if(!businessId||!planId) throw new Error('Business et plan requis.');
    const key = idempotencyKey || crypto.randomUUID();
    if(!window.AUTH_CONFIG?.supabaseUrl || !window.AUTH_CONFIG?.supabaseAnonKey) throw new Error('Supabase non configuré.');
    const session = await window.Auth.ensureFreshSession();
const accessToken = session?.access_token;
    if(!accessToken) throw new Error('Session expirée.');
    const res = await fetch(`${window.AUTH_CONFIG.supabaseUrl}/functions/v1/cinetpay-checkout`,{
      method:'POST',
      headers:{'content-type':'application/json','authorization':`Bearer ${accessToken}`,'apikey':window.AUTH_CONFIG.supabaseAnonKey},
      body:JSON.stringify({business_id:businessId,plan_id:planId,idempotency_key:key})
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok || !data.payment_url) throw new Error(data.error || 'Impossible de démarrer le paiement.');
    window.location.assign(data.payment_url);
    return data;
  }
  return {listPlans,getEntitlement,canUse,createCheckoutRequest,startCinetPayCheckout};
})();
window.Subscriptions=Subscriptions;
