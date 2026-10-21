/* EvoBuskin — accès cloud V3.
   Couche volontairement séparée de db.js : IndexedDB reste la source offline pendant
   la phase de migration. Cette couche prépare la synchronisation Supabase sans exposer
   de secret serveur. */
const CloudDB = (() => {
  const CONFIG = () => window.AUTH_CONFIG || {};
  const session = () => window.Auth?.getSession?.() || null;

  function ready() {
    const c = CONFIG();
    return Boolean(c.supabaseUrl && c.supabaseAnonKey && session()?.access_token);
  }

  async function request(table, options = {}) {
    if (!ready()) throw new Error('Votre session n’est pas active. Reconnectez-vous.');
    const c = CONFIG();
    const s = session();
    const base = c.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + table;
    const headers = {
      apikey: c.supabaseAnonKey,
      Authorization: 'Bearer ' + s.access_token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {})
    };
    let response;
    try {
      response = await fetch(base + (options.query || ''), {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
    } catch (_) { throw Reseau.erreur(); }
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      throw new Error(data?.message || data?.hint || data?.details || data?.error || 'Erreur Supabase.');
    }
    return data;
  }

  async function profile() {
    const s = session();
    if (!s?.user?.id) throw new Error('Utilisateur non authentifié.');
    return window.Auth.getProfile(s.user.id, s.access_token);
  }

  async function list(table, businessId, query = '') {
    if (!businessId) throw new Error('Boutique inconnue.');
    const suffix = query ? '&' + query.replace(/^\?/, '') : '';
    return request(table, { query: '?select=*' + suffix + '&business_id=eq.' + encodeURIComponent(businessId) });
  }

  async function insert(table, row) {
    if (!row?.business_id) throw new Error('business_id obligatoire.');
    return request(table, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: row
    });
  }

  async function update(table, id, businessId, patch) {
    if (!businessId) throw new Error('Boutique inconnue.');
    return request(table, {
      method: 'PATCH',
      query: '?id=eq.' + encodeURIComponent(id) + '&business_id=eq.' + encodeURIComponent(businessId),
      headers: { Prefer: 'return=representation' },
      body: patch
    });
  }

  async function rpc(fn, args) {
    if (!ready()) throw new Error('Votre session n’est pas active. Reconnectez-vous.');
    const c = CONFIG();
    const s = session();
    let response;
    try {
      response = await fetch(c.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, {
        method: 'POST',
        headers: {
          apikey: c.supabaseAnonKey,
          Authorization: 'Bearer ' + s.access_token,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(args || {})
      });
    } catch (_) { throw Reseau.erreur(); }
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(data?.message || data?.hint || data?.details || data?.error || 'Erreur RPC Supabase.');
    return data;
  }

  async function enregistrerVenteAtomique(payload) {
    return rpc('create_sale_atomic', payload);
  }

  async function annulerVenteAtomique(businessId, saleId, idempotencyKey) {
    return rpc('v18_cancel_sale_idempotent', {
      p_business_id: businessId,
      p_sale_id: saleId,
      p_idempotency_key: idempotencyKey || undefined
    });
  }

  async function creerProduitSecurise(payload) {
    return rpc('create_product_secure', payload);
  }

  async function modifierProduitSecurise(payload) {
    return rpc('update_product_secure', payload);
  }

  async function ajusterStockSecurise(payload) {
    return rpc('adjust_product_stock_secure', payload);
  }

  async function definirStockSecurise(payload) {
    return rpc('set_product_stock_secure', payload);
  }

  async function desactiverProduitSecurise(payload) {
    return rpc('deactivate_product_secure', payload);
  }

  async function enregistrerFournisseurSecurise(payload) {
    return rpc('upsert_supplier_secure', payload);
  }

  async function desactiverFournisseurSecurise(payload) {
    return rpc('deactivate_supplier_secure', payload);
  }

  async function enregistrerAchatAtomique(payload) {
    return rpc('create_purchase_atomic', payload);
  }

  async function payerDetteFournisseurAtomique(payload) {
    return rpc('pay_supplier_debt_atomic', payload);
  }

  async function enregistrerDepenseAtomique(payload) {
    return rpc('create_expense_atomic', payload);
  }

  async function enregistrerClientSecurise(payload) {
    return rpc('upsert_customer_secure', payload);
  }

  function sansClientLocal(payload) {
    const p = Object.assign({}, payload);
    delete p.p_customer_local_id; // champ interne de l'app, inconnu du serveur
    return p;
  }

  async function desactiverClientSecurise(payload) {
    return rpc('deactivate_customer_secure', sansClientLocal(payload));
  }

  async function ajouterDetteClientAtomique(payload) {
    return rpc('create_customer_debt_atomic', sansClientLocal(payload));
  }

  async function payerDetteClientAtomique(payload) {
    return rpc('pay_customer_debt_atomic', sansClientLocal(payload));
  }

  async function modifierTauxSecurise(payload) {
    return rpc('update_exchange_rate_secure', payload);
  }

  async function listerAlertesSecurite(businessId, status) {
    if (!businessId) throw new Error('Boutique inconnue.');
    let query = '?select=*&business_id=eq.' + encodeURIComponent(businessId) + '&order=created_at.desc&limit=100';
    if (status) query += '&status=eq.' + encodeURIComponent(status);
    return request('security_alerts', { query });
  }

  async function resoudreAlerteSecurite(payload) {
    return rpc('resolve_security_alert', payload);
  }

  async function enregistrerVerificationBackup(payload) { return rpc('v11_record_backup_verification', payload); }
  async function statutRecuperation(businessId) { return rpc('v11_get_recovery_status', { p_business_id: businessId }); }

  async function produitsParLocalIds(businessId, ids) {
    if (!Array.isArray(ids) || !ids.length) return [];
    const propres = [...new Set(ids.map(Number).filter(Number.isInteger))];
    if (!propres.length) return [];
    return list('products', businessId, 'local_id=in.(' + propres.join(',') + ')');
  }

  return { ready, profile, list, insert, update, rpc, produitsParLocalIds, enregistrerVenteAtomique, annulerVenteAtomique, creerProduitSecurise, modifierProduitSecurise, ajusterStockSecurise, definirStockSecurise, desactiverProduitSecurise, enregistrerFournisseurSecurise, desactiverFournisseurSecurise, enregistrerAchatAtomique, payerDetteFournisseurAtomique, enregistrerDepenseAtomique, modifierTauxSecurise, listerAlertesSecurite, resoudreAlerteSecurite, enregistrerVerificationBackup, statutRecuperation, enregistrerClientSecurise, desactiverClientSecurise, ajouterDetteClientAtomique, payerDetteClientAtomique };
})();

window.CloudDB = CloudDB;
