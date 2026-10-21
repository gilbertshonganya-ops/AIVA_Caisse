/* EvoBuskin V5 — synchronisation offline/online sécurisée.
 * Le mobile n'est jamais l'autorité : cette couche ne fait que rejouer
 * des opérations locales déjà validées. Le serveur recalcule et autorise.
 */
const SyncManager = (() => {
  let businessId = null;
  let running = false;
  let timer = null;
  const MAX_ATTEMPTS = 12;
  const BASE_DELAY = 2000;
  const MAX_DELAY = 15 * 60 * 1000;

  function configure(id) {
    businessId = id || null;
  }

  function uuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    a[6] = (a[6] & 0x0f) | 0x40;
    a[8] = (a[8] & 0x3f) | 0x80;
    return [...a].map((x, i) => [4,6,8,10].includes(i) ? '-' + x.toString(16).padStart(2,'0') : x.toString(16).padStart(2,'0')).join('');
  }

  function nextDelay(attempts) {
    const n = Math.max(0, Number(attempts) || 0);
    const jitter = Math.floor(Math.random() * 1000);
    return Math.min(MAX_DELAY, BASE_DELAY * (2 ** Math.min(n, 8)) + jitter);
  }

  function normalizeError(error) {
    const message = Reseau.estErreurReseau(error) ? Reseau.MESSAGE : String(error?.message || error || 'Erreur de synchronisation');
    return message.slice(0, 500);
  }

  function permanent(message) {
    return /BUSINESS_ACCESS_DENIED|CUSTOMER_ACCESS_DENIED|PRODUCT_NOT_FOUND|PRODUCT_ID_REQUIRED|OWNER_REQUIRED|IDEMPOTENCY_KEY_REUSE|INVALID_SALE_LINE|INSUFFICIENT_STOCK|CUSTOMER_REQUIRED_FOR_DEBT|STOCK_CONFLICT|STOCK_NEGATIVE|INVALID_PRODUCT_VALUES|INVALID_WHOLESALE_PRICE|INVALID_WHOLESALE_THRESHOLD|INVALID_CARTON_QUANTITY|CARTON_QUANTITY_REQUIRED|INVALID_CURRENCY|PRODUCT_NAME_REQUIRED|INVALID_STOCK_MOVEMENT_TYPE|ZERO_STOCK_ADJUSTMENT|IDEMPOTENCY_RESULT_MISSING|EMPTY_PURCHASE|INVALID_PURCHASE_QUANTITY|INVALID_PURCHASE_PRICE|PRODUCT_CURRENCY_MISMATCH|SUPPLIER_REQUIRED_FOR_DEBT|SUPPLIER_ACCESS_DENIED|SUPPLIER_NOT_FOUND|PAYMENT_EXCEEDS_SUPPLIER_BALANCE|INVALID_EXPENSE_AMOUNT|EXPENSE_CATEGORY_REQUIRED|EXPENSE_LIMIT_EXCEEDED|PURCHASE_LIMIT_EXCEEDED|EXCHANGE_RATE_NOT_CONFIGURED|INVALID_EXCHANGE_RATE|SUPPLIER_NAME_REQUIRED|CUSTOMER_NAME_REQUIRED|CUSTOMER_FIELD_TOO_LONG|CUSTOMER_NOT_FOUND|CUSTOMER_REQUIRED|INVALID_CUSTOMER_DEBT_AMOUNT|INVALID_CUSTOMER_PAYMENT_AMOUNT|PAYMENT_EXCEEDS_CUSTOMER_BALANCE|INVALID_PAYMENT_MODE|INVALID_ACTION|PAYLOAD_TOO_LARGE|CUSTOMER_HAS_DEBT/i.test(message);
  }

  async function envoyer(operation) {
    if (!businessId || operation.businessId !== businessId) return false;
    if (!navigator.onLine || !CloudDB.ready()) return false;

    await DB.marquerSync(operation.id, { status: 'sending', attempts: (operation.attempts || 0) + 1 });
    const tentative = (operation.attempts || 0) + 1;
    try {
      const payload = Object.assign({}, operation.payload, {
        p_business_id: operation.businessId,
        p_idempotency_key: operation.idempotencyKey
      });
      let result;
      switch (operation.type) {
        case 'sale_cancel': {
          let serverSaleId = payload.p_sale_id || null;
          if (!serverSaleId && payload.p_sale_idempotency_key) {
            const found = await CloudDB.list('sales', operation.businessId, 'idempotency_key=eq.' + encodeURIComponent(payload.p_sale_idempotency_key) + '&limit=1');
            if (found.length) serverSaleId = found[0].id;
          }
          if (!serverSaleId && payload.p_sale_local_id != null) {
            const found = await CloudDB.list('sales', operation.businessId, 'local_id=eq.' + encodeURIComponent(payload.p_sale_local_id) + '&limit=1');
            if (found.length) serverSaleId = found[0].id;
          }
          if (!serverSaleId) throw new Error('SALE_NOT_SYNCED');
          result = await CloudDB.annulerVenteAtomique(operation.businessId, serverSaleId, operation.idempotencyKey);
          const localSale = payload.p_sale_local_id != null ? await DB.lire('ventes', Number(payload.p_sale_local_id)) : null;
          if (localSale && result?.id) await DB.ecrire('ventes', Object.assign({}, localSale, { cloudId: result.id, annulee: true }));
          break;
        }
        case 'sale': {
          // Une vente à crédit peut contenir un nouveau client créé directement depuis la caisse.
          // Synchroniser la fiche client avant la vente permet au serveur de créer la dette liée.
          if (!payload.p_client_id && payload.p_client_local_id != null) {
            const localCustomer = await DB.lire('clients', Number(payload.p_client_local_id));
            if (!localCustomer) throw new Error('CUSTOMER_NOT_FOUND');
            let cloudCustomerId = localCustomer.cloudId || null;
            if (!cloudCustomerId) {
              const customer = await CloudDB.enregistrerClientSecurise({
                p_business_id: operation.businessId,
                p_idempotency_key: SyncManager.uuid(),
                p_local_id: localCustomer.id,
                p_nom: localCustomer.nom,
                p_tel: localCustomer.tel || null,
                p_email: localCustomer.email || null,
                p_adresse: localCustomer.adresse || null
              });
              cloudCustomerId = customer?.id || null;
              if (!cloudCustomerId) throw new Error('CUSTOMER_NOT_SYNCED');
              await DB.ecrire('clients', Object.assign({}, localCustomer, { cloudId: cloudCustomerId }));
            }
            payload.p_client_id = cloudCustomerId;
          }
          result = await CloudDB.enregistrerVenteAtomique(payload);
          break;
        }
        case 'audit_event': result = await CloudDB.rpc('v19_log_event', { p_business_id: operation.businessId, p_action: payload.p_action, p_payload: payload.p_payload || {}, p_op_id: operation.idempotencyKey }); break;
        case 'product_create': result = await CloudDB.creerProduitSecurise(payload); break;
        case 'product_update': result = await CloudDB.modifierProduitSecurise(payload); break;
        case 'stock_adjust': result = await CloudDB.ajusterStockSecurise(payload); break;
        case 'stock_set': result = await CloudDB.definirStockSecurise(payload); break;
        case 'product_deactivate': result = await CloudDB.desactiverProduitSecurise(payload); break;
        case 'supplier_upsert': result = await CloudDB.enregistrerFournisseurSecurise(payload); break;
        case 'supplier_deactivate': result = await CloudDB.desactiverFournisseurSecurise(payload); break;
        case 'purchase': result = await CloudDB.enregistrerAchatAtomique(payload); break;
        case 'supplier_payment': result = await CloudDB.payerDetteFournisseurAtomique(payload); break;
        case 'expense': result = await CloudDB.enregistrerDepenseAtomique(payload); break;
        case 'exchange_rate': result = await CloudDB.modifierTauxSecurise(payload); break;
        case 'settings_update': result = await CloudDB.rpc('v18_update_business_settings_secure', { p_business_id: operation.businessId, p_settings: payload.p_settings || {} }); break;
        case 'customer_upsert': result = await CloudDB.enregistrerClientSecurise(payload); break;
        case 'customer_deactivate': {
          let customerId = payload.p_customer_id || null;
          if (!customerId && payload.p_customer_local_id != null) {
            const localCustomer = await DB.lire('clients', Number(payload.p_customer_local_id));
            if (localCustomer) {
              const customer = await CloudDB.enregistrerClientSecurise({
                p_business_id: operation.businessId, p_idempotency_key: SyncManager.uuid(),
                p_local_id: localCustomer.id, p_customer_id: localCustomer.cloudId || null,
                p_nom: localCustomer.nom, p_tel: localCustomer.tel || null, p_email: localCustomer.email || null, p_adresse: localCustomer.adresse || null
              });
              customerId = customer?.id || null;
              if (customerId) await DB.ecrire('clients', Object.assign({}, localCustomer, { cloudId: customerId }));
            }
          }
          if (!customerId) throw new Error('CUSTOMER_NOT_SYNCED');
          result = await CloudDB.desactiverClientSecurise(Object.assign({}, payload, { p_customer_id: customerId }));
          break;
        }
        case 'customer_debt': {
          let customerId = payload.p_customer_id || null;
          if (!customerId && payload.p_customer_local_id != null) {
            const localCustomer = await DB.lire('clients', Number(payload.p_customer_local_id));
            if (localCustomer) {
              const customer = await CloudDB.enregistrerClientSecurise({
                p_business_id: operation.businessId, p_idempotency_key: SyncManager.uuid(),
                p_local_id: localCustomer.id, p_customer_id: localCustomer.cloudId || null,
                p_nom: localCustomer.nom, p_tel: localCustomer.tel || null, p_email: localCustomer.email || null, p_adresse: localCustomer.adresse || null
              });
              customerId = customer?.id || null;
              if (customerId) await DB.ecrire('clients', Object.assign({}, localCustomer, { cloudId: customerId }));
            }
          }
          if (!customerId) throw new Error('CUSTOMER_NOT_SYNCED');
          result = await CloudDB.ajouterDetteClientAtomique(Object.assign({}, payload, { p_customer_id: customerId }));
          break;
        }
        case 'customer_payment': {
          let customerId = payload.p_customer_id || null;
          if (!customerId && payload.p_customer_local_id != null) {
            const localCustomer = await DB.lire('clients', Number(payload.p_customer_local_id));
            if (localCustomer) {
              const customer = await CloudDB.enregistrerClientSecurise({
                p_business_id: operation.businessId, p_idempotency_key: SyncManager.uuid(),
                p_local_id: localCustomer.id, p_customer_id: localCustomer.cloudId || null,
                p_nom: localCustomer.nom, p_tel: localCustomer.tel || null, p_email: localCustomer.email || null, p_adresse: localCustomer.adresse || null
              });
              customerId = customer?.id || null;
              if (customerId) await DB.ecrire('clients', Object.assign({}, localCustomer, { cloudId: customerId }));
            }
          }
          if (!customerId) throw new Error('CUSTOMER_NOT_SYNCED');
          result = await CloudDB.payerDetteClientAtomique(Object.assign({}, payload, { p_customer_id: customerId }));
          break;
        }
        default: throw new Error('TYPE_SYNC_NON_SUPPORTE');
      }
      // Conserve la correspondance local -> cloud pour les futurs appels sécurisés.
      try {
        const serverId = result?.id || null;
        if (serverId && operation.payload?.p_local_id != null) {
          const map = {
            supplier_upsert: 'fournisseurs',
            purchase: 'achats',
            supplier_payment: 'dettesFournisseurs',
            expense: 'depenses',
            customer_upsert: 'clients',
            customer_debt: 'dettes',
            customer_payment: 'dettes',
            customer_deactivate: 'clients'
          };
          const table = map[operation.type];
          if (table) {
            const local = await DB.lire(table, Number(operation.payload.p_local_id));
            if (local) { await DB.ecrire(table, Object.assign({}, local, { cloudId: serverId })); }
          }
        }
      } catch (_) { /* le mapping local n'est pas une autorité de sécurité */ }
      await DB.marquerSync(operation.id, {
        status: 'synced',
        serverId: result?.id || null,
        lastError: null,
        syncedAt: Date.now()
      });
      return true;
    } catch (e) {
      const message = normalizeError(e);
      if (Reseau.estErreurReseau(e)) { // simple coupure : on ne compte pas d'échec et on réessaie dans 3 secondes
        await DB.marquerSync(operation.id, { status: 'pending', attempts: operation.attempts || 0, lastError: message, nextAttemptAt: Date.now() + 3000 });
        return 'reseau';
      }
      const blocked = permanent(message);
      await DB.marquerSync(operation.id, {
        status: blocked ? 'blocked' : (tentative >= MAX_ATTEMPTS ? 'failed' : 'pending'),
        lastError: message,
        nextAttemptAt: Date.now() + (blocked ? MAX_DELAY : nextDelay(tentative))
      });
      return false;
    }
  }

  let relancer = false;
  async function syncNow() {
    if (!businessId || !navigator.onLine || !CloudDB.ready()) return;
    if (running) { relancer = true; return; } // une opération arrivée pendant un envoi part juste après, sans attendre
    running = true;
    try {
      do {
        relancer = false;
        const rows = await DB.syncQueueListe({ businessId, userId: DB.uidCourant(), readyOnly: true });
        for (const row of rows) {
          if (!navigator.onLine) break;
          if ((await envoyer(row)) === 'reseau') break; // on garde l'ordre : on reprend dans 3 secondes
        }
      } while (relancer);
    } finally {
      running = false;
    }
  }

  async function retryBlocked() {
    const rows = await DB.syncQueueListe({ businessId });
    for (const row of rows.filter((r) => r.status === 'blocked' || r.status === 'failed')) {
      await DB.marquerSync(row.id, { status: 'pending', nextAttemptAt: Date.now(), lastError: null, attempts: 0 });
    }
    return syncNow();
  }

  async function mettreEnFile(type, payload) {
    if (!businessId) throw new Error('Boutique introuvable. Reconnectez-vous.');
    const idempotencyKey = uuid();
    await DB.mettreEnFileSync({ type, businessId, idempotencyKey, payload });
    syncNow().catch(() => {});
    return idempotencyKey;
  }

  // Remet immédiatement « à envoyer » tout ce qui attendait (retour d'Internet, retour dans l'application)
  async function forcer() {
    if (!businessId) return;
    const rows = await DB.syncQueueListe({ businessId, userId: DB.uidCourant() });
    for (const r of rows.filter((x) => x.status === 'pending')) await DB.marquerSync(r.id, { status: 'pending', nextAttemptAt: Date.now() });
    return syncNow();
  }

  let ecouteOnline = null, ecouteVisible = null;
  function start() {
    stop();
    ecouteOnline = () => forcer().catch(() => {});
    ecouteVisible = () => { if (!document.hidden) forcer().catch(() => {}); };
    window.addEventListener('online', ecouteOnline);
    document.addEventListener('visibilitychange', ecouteVisible);
    timer = setInterval(() => syncNow().catch(() => {}), 5000); // envoi quasi immédiat, même après une coupure
    forcer().catch(() => {});
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (ecouteOnline) window.removeEventListener('online', ecouteOnline);
    if (ecouteVisible) document.removeEventListener('visibilitychange', ecouteVisible);
    ecouteOnline = ecouteVisible = null;
  }

  function etat() {
    return { businessId, running };
  }

  return { configure, uuid, mettreEnFile, syncNow, forcer, retryBlocked, start, stop, etat };
})();

window.SyncManager = SyncManager;
