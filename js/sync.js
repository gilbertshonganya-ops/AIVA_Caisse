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
    const message = String(error?.message || error || 'Erreur de synchronisation');
    return message.slice(0, 500);
  }

  function permanent(message) {
    return /BUSINESS_ACCESS_DENIED|CUSTOMER_ACCESS_DENIED|PRODUCT_NOT_FOUND|PRODUCT_ID_REQUIRED|OWNER_REQUIRED|IDEMPOTENCY_KEY_REUSE|INVALID_SALE_LINE|INSUFFICIENT_STOCK|CUSTOMER_REQUIRED_FOR_DEBT|STOCK_CONFLICT|STOCK_NEGATIVE|INVALID_PRODUCT_VALUES|INVALID_WHOLESALE_PRICE|INVALID_WHOLESALE_THRESHOLD|INVALID_CARTON_QUANTITY|CARTON_QUANTITY_REQUIRED|INVALID_CURRENCY|PRODUCT_NAME_REQUIRED|INVALID_STOCK_MOVEMENT_TYPE|ZERO_STOCK_ADJUSTMENT|IDEMPOTENCY_RESULT_MISSING|EMPTY_PURCHASE|INVALID_PURCHASE_QUANTITY|INVALID_PURCHASE_PRICE|PRODUCT_CURRENCY_MISMATCH|SUPPLIER_REQUIRED_FOR_DEBT|SUPPLIER_ACCESS_DENIED|SUPPLIER_NOT_FOUND|PAYMENT_EXCEEDS_SUPPLIER_BALANCE|INVALID_EXPENSE_AMOUNT|EXPENSE_CATEGORY_REQUIRED|EXPENSE_LIMIT_EXCEEDED|PURCHASE_LIMIT_EXCEEDED|EXCHANGE_RATE_NOT_CONFIGURED|INVALID_EXCHANGE_RATE|SUPPLIER_NAME_REQUIRED|CUSTOMER_NAME_REQUIRED|CUSTOMER_FIELD_TOO_LONG|CUSTOMER_NOT_FOUND|CUSTOMER_REQUIRED|INVALID_CUSTOMER_DEBT_AMOUNT|INVALID_CUSTOMER_PAYMENT_AMOUNT|PAYMENT_EXCEEDS_CUSTOMER_BALANCE|INVALID_PAYMENT_MODE/i.test(message);
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
        case 'sale': result = await CloudDB.enregistrerVenteAtomique(payload); break;
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
      const blocked = permanent(message);
      await DB.marquerSync(operation.id, {
        status: blocked ? 'blocked' : (tentative >= MAX_ATTEMPTS ? 'failed' : 'pending'),
        lastError: message,
        nextAttemptAt: Date.now() + (blocked ? MAX_DELAY : nextDelay(tentative))
      });
      return false;
    }
  }

  async function syncNow() {
    if (running || !businessId || !navigator.onLine || !CloudDB.ready()) return;
    running = true;
    try {
      const rows = await DB.syncQueueListe({ businessId, readyOnly: true });
      for (const row of rows) {
        if (!navigator.onLine) break;
        await envoyer(row);
      }
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
    if (!businessId) throw new Error('Boutique cloud inconnue.');
    const idempotencyKey = uuid();
    await DB.mettreEnFileSync({ type, businessId, idempotencyKey, payload });
    syncNow().catch(() => {});
    return idempotencyKey;
  }

  function start() {
    stop();
    const run = () => syncNow().catch(() => {});
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
    timer = setInterval(run, 30000);
    run();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function etat() {
    return { businessId, running };
  }

  return { configure, uuid, mettreEnFile, syncNow, retryBlocked, start, stop, etat };
})();

window.SyncManager = SyncManager;
