/* AIVA Caisse - base de données locale (IndexedDB)
   Tout est stocké dans le téléphone. Aucune donnée n'est envoyée sur Internet.

   Tables ("stores") :
   - produits    : nom, codeBarres, categorie, devise, prixAchat, prixVente, stock, seuil
   - ventes      : date, lignes[], totalUSD, coutUSD, taux, mode, reference, clientId, payeUSD, resteUSD, vendeur, annulee
   - clients     : nom, tel
   - dettes      : clientId, date, type ('dette' | 'paiement'), montantUSD, mode, note, venteId
   - mouvements  : produitId, date, type ('entree' | 'sortie' | 'vente' | 'inventaire' | 'annulation'), qte (+/-), note
   - params      : cle / valeur (réglages)
*/
const DB = (() => {
  const NOM = 'aiva-caisse';
  const VERSION = 1;
  const TABLES = ['produits', 'ventes', 'clients', 'dettes', 'mouvements', 'params'];
  let base = null;

  function ouvrir() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB non disponible sur ce téléphone')); return; }
      const rq = indexedDB.open(NOM, VERSION);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        d.createObjectStore('produits', { keyPath: 'id', autoIncrement: true }).createIndex('codeBarres', 'codeBarres');
        d.createObjectStore('ventes', { keyPath: 'id', autoIncrement: true }).createIndex('date', 'date');
        d.createObjectStore('clients', { keyPath: 'id', autoIncrement: true });
        d.createObjectStore('dettes', { keyPath: 'id', autoIncrement: true }).createIndex('clientId', 'clientId');
        d.createObjectStore('mouvements', { keyPath: 'id', autoIncrement: true }).createIndex('produitId', 'produitId');
        d.createObjectStore('params', { keyPath: 'cle' });
      };
      rq.onsuccess = () => { base = rq.result; resolve(base); };
      rq.onerror = () => reject(rq.error);
    });
  }

  const promesse = (rq) => new Promise((resolve, reject) => {
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });

  // ----- Opérations simples -----
  const tout = (table) => promesse(base.transaction(table).objectStore(table).getAll());
  const lire = (table, id) => promesse(base.transaction(table).objectStore(table).get(id));
  const ecrire = (table, objet) => promesse(base.transaction(table, 'readwrite').objectStore(table).put(objet));
  const ajouter = (table, objet) => promesse(base.transaction(table, 'readwrite').objectStore(table).add(objet));
  const supprimer = (table, id) => promesse(base.transaction(table, 'readwrite').objectStore(table).delete(id));

  async function lireParam(cle, defaut) {
    const r = await lire('params', cle);
    return r ? r.valeur : defaut;
  }
  const ecrireParam = (cle, valeur) => ecrire('params', { cle, valeur });

  // Termine une transaction : résout au "complete", rejette à l'"abort"
  function transaction(tables, travail) {
    return new Promise((resolve, reject) => {
      const t = base.transaction(tables, 'readwrite');
      const ctx = { erreur: null, resultat: null };
      t.oncomplete = () => resolve(ctx.resultat);
      t.onabort = () => reject(ctx.erreur || t.error || new Error('Opération annulée'));
      const echec = (message) => { ctx.erreur = new Error(message); try { t.abort(); } catch (e) { /* déjà annulée */ } };
      try { travail(t, ctx, echec); } catch (e) { ctx.erreur = e; try { t.abort(); } catch (x) { /* rien */ } }
    });
  }

  // ----- Enregistrer une vente : tout ou rien (stock, mouvements, vente, dette) -----
  function enregistrerVente(vente) {
    return transaction(['produits', 'ventes', 'mouvements', 'dettes'], (t, ctx, echec) => {
      if (!vente.lignes.length) { echec('Le panier est vide'); return; }
      const sp = t.objectStore('produits');
      let restants = vente.lignes.length;
      vente.lignes.forEach((l) => {
        const rq = sp.get(l.produitId);
        rq.onsuccess = () => {
          const p = rq.result;
          if (!p) { echec('Produit introuvable : ' + l.nom); return; }
          if (p.stock < l.qte) { echec('Stock insuffisant pour « ' + p.nom + ' » (reste ' + formatQuantite(p.stock) + ')'); return; }
          p.stock = arrondi(p.stock - l.qte, 3);
          sp.put(p);
          t.objectStore('mouvements').add({
            produitId: p.id, nom: p.nom, date: vente.date, type: 'vente', qte: -l.qte, note: 'Vente', vendeur: vente.vendeur
          });
          restants -= 1;
          if (restants === 0) {
            const rv = t.objectStore('ventes').add(vente);
            rv.onsuccess = () => {
              vente.id = rv.result;
              ctx.resultat = vente;
              if (vente.resteUSD > 0.0001 && vente.clientId) {
                t.objectStore('dettes').add({
                  clientId: vente.clientId, date: vente.date, type: 'dette',
                  montantUSD: vente.resteUSD, note: 'Vente n° ' + vente.id, venteId: vente.id
                });
              }
            };
          }
        };
      });
    });
  }

  // ----- Annuler une vente : on remet le stock et on retire la dette liée -----
  function annulerVente(venteId) {
    return transaction(['produits', 'ventes', 'mouvements', 'dettes'], (t, ctx, echec) => {
      const sv = t.objectStore('ventes');
      const rq = sv.get(venteId);
      rq.onsuccess = () => {
        const v = rq.result;
        if (!v) { echec('Vente introuvable'); return; }
        if (v.annulee) { echec('Cette vente est déjà annulée'); return; }
        v.annulee = true;
        v.dateAnnulation = Date.now();
        sv.put(v);
        const sp = t.objectStore('produits');
        v.lignes.forEach((l) => {
          const rp = sp.get(l.produitId);
          rp.onsuccess = () => {
            const p = rp.result;
            if (!p) return; // produit supprimé depuis : rien à remettre
            p.stock = arrondi(p.stock + l.qte, 3);
            sp.put(p);
            t.objectStore('mouvements').add({
              produitId: p.id, nom: p.nom, date: Date.now(), type: 'annulation', qte: l.qte, note: 'Annulation vente n° ' + v.id
            });
          };
        });
        const sd = t.objectStore('dettes');
        const curseur = sd.openCursor();
        curseur.onsuccess = () => {
          const c = curseur.result;
          if (!c) return;
          if (c.value.venteId === v.id) c.delete();
          c.continue();
        };
      };
    });
  }

  // ----- Ajuster le stock (entrée, sortie, inventaire) sans jamais passer sous zéro -----
  function ajusterStock(produitId, delta, type, note, vendeur) {
    return transaction(['produits', 'mouvements'], (t, ctx, echec) => {
      const sp = t.objectStore('produits');
      const rq = sp.get(produitId);
      rq.onsuccess = () => {
        const p = rq.result;
        if (!p) { echec('Produit introuvable'); return; }
        const nouveau = arrondi(p.stock + delta, 3);
        if (nouveau < 0) { echec('Impossible : le stock deviendrait négatif (stock actuel ' + formatQuantite(p.stock) + ')'); return; }
        p.stock = nouveau;
        sp.put(p);
        t.objectStore('mouvements').add({ produitId: p.id, nom: p.nom, date: Date.now(), type, qte: delta, note: note || '', vendeur: vendeur || '' });
        ctx.resultat = p;
      };
    });
  }

  // ----- Sauvegarde complète -----
  async function exporterTout() {
    const donnees = {};
    for (const t of TABLES) donnees[t] = await tout(t);
    return { application: 'AIVA Caisse', version: 1, date: Date.now(), donnees };
  }

  // Remplace TOUTES les données par celles d'une sauvegarde (ou des données de démo)
  function importerTout(sauvegarde) {
    return new Promise((resolve, reject) => {
      if (!sauvegarde || sauvegarde.application !== 'AIVA Caisse' || !sauvegarde.donnees) {
        reject(new Error('Ce fichier n\'est pas une sauvegarde AIVA Caisse')); return;
      }
      const t = base.transaction(TABLES, 'readwrite');
      t.oncomplete = () => resolve();
      t.onabort = () => reject(t.error || new Error('Importation annulée'));
      TABLES.forEach((nom) => {
        const s = t.objectStore(nom);
        s.clear();
        (sauvegarde.donnees[nom] || []).forEach((ligne) => s.put(ligne));
      });
    });
  }

  function toutEffacer() {
    return new Promise((resolve, reject) => {
      const t = base.transaction(TABLES, 'readwrite');
      t.oncomplete = () => resolve();
      t.onabort = () => reject(t.error);
      TABLES.forEach((nom) => t.objectStore(nom).clear());
    });
  }

  return { ouvrir, tout, lire, ecrire, ajouter, supprimer, lireParam, ecrireParam,
           enregistrerVente, annulerVente, ajusterStock, exporterTout, importerTout, toutEffacer };
})();
