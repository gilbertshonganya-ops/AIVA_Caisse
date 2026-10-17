/* EvoBuskin V18 — le serveur Supabase est la source de vérité multi-appareils.
 * Les écritures métier continuent à passer par les RPC sécurisées de SyncManager.
 * Ce module ne fait que télécharger un snapshot autorisé et le projeter dans IndexedDB.
 */
const CloudSnapshotSync = (() => {
  let businessId = null, running = false, lastSyncAt = 0, timer = null;
  const ms = (v) => {
    if (v === null || v === undefined || v === '') return Date.now();
    const n = typeof v === 'number' ? v : Date.parse(v);
    return Number.isFinite(n) ? n : Date.now();
  };
  const n = (v, d = 0) => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v);
  const arr = (v) => Array.isArray(v) ? v : [];
  const object = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};

  async function findByCloudId(table, cloudId) {
    if (cloudId === null || cloudId === undefined) return null;
    return (await DB.tout(table)).find((x) => String(x.cloudId) === String(cloudId)) || null;
  }
  async function findById(table, id) {
    if (!Number.isInteger(Number(id)) || Number(id) === 0) return null;
    return DB.lire(table, Number(id));
  }
  async function saveCloud(table, row, cloudId, preferredId, options = {}) {
    let local = await findByCloudId(table, cloudId);
    if (!local && options.match) local = (await DB.tout(table)).find(options.match) || null;
    if (!local && options.preferLocalId && Number.isInteger(Number(preferredId)) && Number(preferredId) !== 0) {
      const candidate = await findById(table, preferredId);
      if (candidate) {
        if (!options.collision || !options.collision(candidate, row)) local = candidate;
      } else {
        // Pour les entités au local_id stable (produits/clients/fournisseurs),
        // garder la clé locale canonique évite les doublons dans CatalogueSync.
        const fresh = Object.assign({}, row, { id: Number(preferredId), cloudId: cloudId == null ? null : cloudId });
        await DB.ecrire(table, fresh);
        return fresh;
      }
    }
    if (local) {
      const saved = Object.assign({}, local, row, { id: local.id, cloudId: cloudId == null ? local.cloudId : cloudId });
      await DB.ecrire(table, saved);
      return saved;
    }
    const fresh = Object.assign({}, row);
    delete fresh.id;
    const id = await DB.ajouter(table, fresh);
    const saved = Object.assign({}, fresh, { id, cloudId: cloudId == null ? null : cloudId });
    await DB.ecrire(table, saved);
    return saved;
  }

  async function tirer(options = {}) {
    if (running) return { ok: false, raison: 'sync-en-cours' };
    if (!businessId || !navigator.onLine || !CloudDB.ready()) return { ok: false, raison: 'hors-ligne' };
    if (!options.force && Date.now() - lastSyncAt < 15000) return { ok: true, cache: true };
    running = true;
    try {
      const linkedBusiness = await DB.lireParam('cloudBusinessId', null);
      if (linkedBusiness && String(linkedBusiness) !== String(businessId)) {
        return { ok: false, raison: 'appareil-autre-boutique' };
      }
      const snapshot = object(await CloudDB.rpc('v18_business_snapshot', { p_business_id: businessId }));
      if (snapshot.business_id && String(snapshot.business_id) !== String(businessId)) throw new Error('BUSINESS_ACCESS_DENIED');
      const rawProducts = arr(snapshot.products), rawCustomers = arr(snapshot.customers), rawSuppliers = arr(snapshot.suppliers);
      const productLocal = new Map(), customerLocal = new Map(), supplierLocal = new Map(), saleLocal = new Map(), purchaseLocal = new Map();
      const pending = await DB.syncQueueListe({ businessId });
      const pendingProductIds = new Set();
      const pendingCancelKeys = new Set();
      for (const op of pending.filter((x) => x.status !== 'synced')) {
        for (const line of arr(op.payload?.p_lignes)) {
          const id = n(line.produitLocalId || line.produitId, 0); if (id) pendingProductIds.add(id);
        }
        if (op.type === 'sale_cancel') {
          if (op.payload?.p_sale_idempotency_key) pendingCancelKeys.add(String(op.payload.p_sale_idempotency_key));
          const localSale = op.payload?.p_sale_local_id != null ? await DB.lire('ventes', Number(op.payload.p_sale_local_id)) : null;
          for (const line of arr(localSale?.lignes)) { const id = n(line.produitId, 0); if (id) pendingProductIds.add(id); }
        }
      }

      for (const r of rawProducts) {
        const localId = n(r.local_id, 0);
        const beforeProduct = localId ? await findById('produits', localId) : null;
        const p = {
          nom: r.nom || 'Produit', categorie: r.categorie || '', codeBarres: r.code_barres || '',
          unite: r.unite || '', devise: r.devise || 'USD', prixVente: n(r.prix_vente), prixAchat: n(r.prix_achat),
          stock: n(r.stock), seuil: n(r.stock_min), image: r.image_url || null, actif: r.actif !== false,
          prixGros: n(r.prix_gros ?? object(r.metadata).prixGros, null), seuilGros: n(r.seuil_gros ?? object(r.metadata).seuilGros, null),
          cartonQte: n(r.carton_qte ?? object(r.metadata).cartonQte, null), prixCarton: n(r.prix_carton ?? object(r.metadata).prixCarton, null)
        };
        const saved = await saveCloud('produits', p, r.id, localId || null, {
          preferLocalId: !!localId,
          collision: (candidate) => candidate.cloudId && String(candidate.cloudId) !== String(r.id)
        });
        // Une vente locale en attente garde son stock local jusqu'à sa confirmation serveur.
        if ((pendingProductIds.has(saved.id) || pendingProductIds.has(localId)) && beforeProduct) {
          await DB.ecrire('produits', Object.assign({}, saved, { stock: beforeProduct.stock }));
        }
        productLocal.set(String(r.id), saved.id);
        if (localId) productLocal.set(String(localId), saved.id);
      }

      for (const r of rawCustomers) {
        const localId = n(r.local_id, 0);
        const saved = await saveCloud('clients', {
          nom: r.nom || 'Client', tel: r.tel || '', email: r.email || '', adresse: r.adresse || '',
          actif: r.deleted_at ? false : r.actif !== false
        }, r.id, localId || null, { preferLocalId: !!localId, collision: (candidate) => candidate.cloudId && String(candidate.cloudId) !== String(r.id) });
        customerLocal.set(String(r.id), saved.id);
        if (localId) customerLocal.set('local:' + localId, saved.id);
      }
      for (const r of rawSuppliers) {
        const localId = n(r.local_id, 0);
        const saved = await saveCloud('fournisseurs', {
          nom: r.nom || 'Fournisseur', tel: r.tel || '', email: r.email || '', adresse: r.adresse || '', actif: r.deleted_at ? false : true
        }, r.id, localId || null, { preferLocalId: !!localId, collision: (candidate) => candidate.cloudId && String(candidate.cloudId) !== String(r.id) });
        supplierLocal.set(String(r.id), saved.id);
        if (localId) supplierLocal.set('local:' + localId, saved.id);
      }

      for (const r of arr(snapshot.sales)) {
        const meta = object(r.metadata), localId = n(r.local_id, 0), idem = r.idempotency_key || null;
        const lines = arr(r.lignes).map((l) => ({
          produitId: productLocal.get(String(l.produitLocalId || l.produitId)) || n(l.produitLocalId || l.produitId),
          nom: l.nom || 'Produit', qte: n(l.qte), facteur: n(l.facteur, 1),
          prixUnitaireUSD: n(l.prixUnitaireUSD ?? l.prixUnitaire ?? l.prix_unitaire),
          prixAchatUSD: n(l.prixAchatUSD ?? l.prixAchat ?? l.prix_achat)
        }));
        const existing = await findByCloudId('ventes', r.id) || (idem ? (await DB.tout('ventes')).find((v) => v.idempotencyKey === idem) : null);
        const preferred = localId ? await findById('ventes', localId) : null;
        const saved = await saveCloud('ventes', {
          date: ms(r.date), clientId: customerLocal.get(String(r.client_id)) || null, lignes: lines,
          totalUSD: n(r.total), payeUSD: n(r.paye), resteUSD: n(r.reste), coutUSD: n(meta.cost),
          mode: meta.mode || 'especes', devisePaiement: meta.devise_paiement || r.devise || 'USD',
          reference: meta.reference || '', vendeur: meta.vendeur || (r.vendeur_user_id ? 'Vendeur' : 'Patron'),
          annulee: r.annulee === true || (idem && pendingCancelKeys.has(String(idem))), idempotencyKey: idem, dateAnnulation: meta.cancelled_at ? ms(meta.cancelled_at) : null
        }, r.id, null, {
          match: (v) => (idem && v.idempotencyKey === idem) || String(v.cloudId) === String(r.id),
          collision: (candidate) => Boolean(candidate && existing && candidate.id !== existing.id)
        });
        // Si une vente locale est déjà connue par clé d'idempotence, saveCloud l'a mise à jour.
        saleLocal.set(String(r.id), saved.id);
        if (localId) saleLocal.set('local:' + localId, saved.id);
        if (preferred && existing && preferred.id === existing.id && preferred.id !== saved.id) saleLocal.set(String(r.id), preferred.id);
      }

      for (const r of arr(snapshot.customer_debts)) {
        const localId = n(r.local_id, 0), meta = object(r.metadata);
        const mappedSaleId = saleLocal.get(String(r.sale_id)) || null;
        const amountUSD = n(r.montant_usd ?? r.montant);
        await saveCloud('dettes', {
          clientId: customerLocal.get(String(r.customer_id)) || null,
          venteId: mappedSaleId,
          date: ms(r.date), type: r.type, montantUSD: amountUSD,
          devise: r.devise || 'USD', mode: meta.mode || null, note: r.note || '',
          cloudSaleId: r.sale_id || null
        }, r.id, localId || null, {
          preferLocalId: !!localId,
          match: (d) => r.type === 'dette' && mappedSaleId != null && d.venteId === mappedSaleId && d.type === 'dette' && Math.abs(n(d.montantUSD) - amountUSD) < 0.02,
          collision: () => true
        });
      }
      for (const r of arr(snapshot.purchases)) {
        const localId = n(r.local_id, 0), meta = object(r.metadata);
        const savedPurchase = await saveCloud('achats', {
          fournisseurId: supplierLocal.get(String(r.supplier_id)) || null, date: ms(r.date),
          totalUSD: n(r.total), payeUSD: n(r.paye), resteUSD: n(r.reste), devise: r.devise || 'USD',
          lignes: arr(r.lignes).map((l) => Object.assign({}, l, { produitId: productLocal.get(String(l.produitLocalId || l.produitId)) || n(l.produitLocalId || l.produitId) })),
          note: meta.note || '', cloudSellerId: r.vendeur_user_id || null
        }, r.id, localId || null, { preferLocalId: !!localId, collision: () => true });
        purchaseLocal.set(String(r.id), savedPurchase.id);
        if (localId) purchaseLocal.set('local:' + localId, savedPurchase.id);
      }
      for (const r of arr(snapshot.supplier_debts)) {
        await saveCloud('dettesFournisseurs', {
          fournisseurId: supplierLocal.get(String(r.supplier_id)) || null,
          achatId: purchaseLocal.get(String(r.purchase_id)) || null, date: ms(r.date), type: r.type,
          montantUSD: n(r.montant_usd ?? r.montant), devise: r.devise || 'USD', note: r.note || ''
        }, r.id, n(r.local_id, 0) || null, { preferLocalId: !!n(r.local_id, 0), collision: () => true });
      }
      for (const r of arr(snapshot.expenses)) {
        const meta = object(r.metadata);
        await saveCloud('depenses', {
          date: ms(r.date), categorie: r.categorie || 'Autre', montantUSD: n(r.montant_usd ?? r.montant),
          devise: r.devise || 'USD', note: r.note || meta.note || '',
          vendeur: r.author_user_id || null
        }, r.id, n(r.local_id, 0) || null, { preferLocalId: !!n(r.local_id, 0), collision: () => true });
      }
      for (const r of arr(snapshot.stock_movements)) {
        const productLocalId = productLocal.get(String(r.product_id)) || n(r.product_id);
        const localProduct = await DB.lire('produits', productLocalId);
        await saveCloud('mouvements', {
          produitId: productLocalId,
          nom: object(r.metadata).product_name || localProduct?.nom || '', date: ms(r.date), type: r.type, qte: n(r.qte),
          note: r.note || '', vendeur: r.vendeur_user_id || ''
        }, r.id, n(r.local_id, 0) || null, { preferLocalId: !!n(r.local_id, 0), collision: () => true });
      }

      const settingsRow = object(snapshot.business_settings);
      const settings = object(settingsRow.settings);
      if (Object.keys(settings).length) {
        for (const [k, v] of Object.entries(settings)) {
          if (['taux', 'nomBoutique', 'telBoutique', 'affichage', 'derniereSauvegarde'].includes(k)) {
            App.reglages[k] = v; await DB.ecrireParam(k, v);
          }
        }
        $('#nomBoutique').textContent = App.reglages.nomBoutique || App.reglages.business_name || 'EvoBuskin';
      }
      await DB.ecrireParam('cloudAuditLogs', arr(snapshot.audit_logs));
      await DB.ecrireParam('cloudBusinessId', businessId);
      await DB.ecrireParam('cloudSnapshotSyncedAt', Date.now());
      lastSyncAt = Date.now();
      return { ok: true, ventes: arr(snapshot.sales).length, dettes: arr(snapshot.customer_debts).length };
    } catch (e) {
      console.error('Téléchargement des données cloud :', e);
      return { ok: false, raison: 'erreur', erreur: e };
    } finally { running = false; }
  }
  async function demarrer(id) {
    arreter(); businessId = id || null;
    timer = setInterval(() => {
      if (window.TempsReel && TempsReel.actif() && Date.now() - lastSyncAt < 120000) return; // le temps réel s'en charge
      tirer().then((r) => { if (r.ok && !r.cache && window.TempsReel) TempsReel.rafraichirVue(); });
    }, 20000);
    window.addEventListener('online', onOnline);
    const result = await tirer({ force: true });
    if (!result.ok && result.raison !== 'hors-ligne') console.warn('Snapshot cloud non téléchargé :', result.erreur || result.raison);
    return result;
  }
  function onOnline() { tirer({ force: true }).then((r) => { if (r.ok && window.TempsReel) TempsReel.rafraichirVue(); }); }
  function arreter() { if (timer) clearInterval(timer); timer = null; window.removeEventListener('online', onOnline); businessId = null; lastSyncAt = 0; }
  return { tirer, demarrer, arreter };
})();
window.CloudSnapshotSync = CloudSnapshotSync;
