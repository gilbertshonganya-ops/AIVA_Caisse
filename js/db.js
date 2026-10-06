/* EvoBuskin - base de données locale (IndexedDB)
   Tout est stocké dans le téléphone. Aucune donnée n'est envoyée sur Internet.

   VERSION 2 (v1.1) : ajout des tables fournisseurs, achats, dettesFournisseurs, depenses, audit.
   Les données de la version 1 sont conservées automatiquement (migration).

   Tables ("stores") :
   - produits, ventes, clients, dettes, mouvements, params   (version 1)
   - fournisseurs        : nom, tel
   - achats              : date, fournisseurId, lignes[], totalUSD, payeUSD, resteUSD, note
   - dettesFournisseurs  : fournisseurId, date, type ('dette' | 'paiement'), montantUSD, achatId
   - depenses            : date, categorie, montantUSD, note
   - audit               : journal infalsifiable (chaîne de hachage SHA-256), voir audit.js
*/
const DB = (() => {
  const NOM = 'aiva-caisse'; // nom technique de la base : ne pas changer (sinon les données existantes ne seraient plus retrouvées)
  const VERSION = 2;
  const TABLES = ['produits', 'ventes', 'clients', 'dettes', 'mouvements', 'params',
                  'fournisseurs', 'achats', 'dettesFournisseurs', 'depenses', 'audit'];
  // Tables ajoutées en version 2 : une ancienne sauvegarde (v1) ne doit pas les vider
  const TABLES_V2 = ['fournisseurs', 'achats', 'dettesFournisseurs', 'depenses', 'audit'];
  let base = null;

  function ouvrir() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB non disponible sur ce téléphone')); return; }
      const rq = indexedDB.open(NOM, VERSION);
      rq.onupgradeneeded = (e) => {
        const d = rq.result;
        if (e.oldVersion < 1) {
          d.createObjectStore('produits', { keyPath: 'id', autoIncrement: true }).createIndex('codeBarres', 'codeBarres');
          d.createObjectStore('ventes', { keyPath: 'id', autoIncrement: true }).createIndex('date', 'date');
          d.createObjectStore('clients', { keyPath: 'id', autoIncrement: true });
          d.createObjectStore('dettes', { keyPath: 'id', autoIncrement: true }).createIndex('clientId', 'clientId');
          d.createObjectStore('mouvements', { keyPath: 'id', autoIncrement: true }).createIndex('produitId', 'produitId');
          d.createObjectStore('params', { keyPath: 'cle' });
        }
        if (e.oldVersion < 2) {
          d.createObjectStore('fournisseurs', { keyPath: 'id', autoIncrement: true });
          d.createObjectStore('achats', { keyPath: 'id', autoIncrement: true }).createIndex('date', 'date');
          d.createObjectStore('dettesFournisseurs', { keyPath: 'id', autoIncrement: true }).createIndex('fournisseurId', 'fournisseurId');
          d.createObjectStore('depenses', { keyPath: 'id', autoIncrement: true }).createIndex('date', 'date');
          d.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });
        }
      };
      rq.onsuccess = () => { base = rq.result; resolve(base); };
      rq.onerror = () => reject(rq.error);
      rq.onblocked = () => reject(new Error('Fermez les autres onglets de EvoBuskin puis rechargez'));
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

  // Transaction "tout ou rien" : résout au "complete", rejette à l'"abort"
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

  // Total d'unités de stock demandées par produit (une ligne "carton" compte qte x facteur)
  function besoinsParProduit(lignes) {
    const besoins = new Map();
    lignes.forEach((l) => besoins.set(l.produitId, arrondi((besoins.get(l.produitId) || 0) + l.qte * (l.facteur || 1), 3)));
    return besoins;
  }

  // ----- Enregistrer une vente : tout ou rien (stock, mouvements, vente, dette) -----
  function enregistrerVente(vente) {
    return transaction(['produits', 'ventes', 'mouvements', 'dettes'], (t, ctx, echec) => {
      if (!vente.lignes.length) { echec('Le panier est vide'); return; }
      const sp = t.objectStore('produits');
      const besoins = besoinsParProduit(vente.lignes);
      let restants = besoins.size;
      besoins.forEach((unites, produitId) => {
        const rq = sp.get(produitId);
        rq.onsuccess = () => {
          const p = rq.result;
          if (!p) { echec('Produit introuvable (supprimé ?)'); return; }
          if (p.stock < unites) { echec('Stock insuffisant pour « ' + p.nom + ' » (reste ' + formatQuantite(p.stock) + ')'); return; }
          p.stock = arrondi(p.stock - unites, 3);
          sp.put(p);
          t.objectStore('mouvements').add({
            produitId: p.id, nom: p.nom, date: vente.date, type: 'vente', qte: -unites, note: 'Vente', vendeur: vente.vendeur
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
        besoinsParProduit(v.lignes).forEach((unites, produitId) => {
          const rp = sp.get(produitId);
          rp.onsuccess = () => {
            const p = rp.result;
            if (!p) return; // produit supprimé depuis : rien à remettre
            p.stock = arrondi(p.stock + unites, 3);
            sp.put(p);
            t.objectStore('mouvements').add({
              produitId: p.id, nom: p.nom, date: Date.now(), type: 'annulation', qte: unites, note: 'Annulation vente n° ' + v.id
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

  // ----- Enregistrer un achat fournisseur : stock + prix d'achat + dette fournisseur -----
  // achat.lignes[i] = { produitId, nom, qte, prixSaisi (dans la devise du produit), devise, prixUnitaireUSD }
  //   ou, pour un produit qui n'existe pas encore : { produitId: null, nouveauProduit: {...}, nom, qte, ... }
  //   Le nouveau produit est créé tout de suite, avec comme stock la quantité achetée.
  // achat.majPrix : si vrai, le prix d'achat d'un produit existant devient le prix saisi
  function enregistrerAchat(achat) {
    return transaction(['produits', 'achats', 'mouvements', 'dettesFournisseurs'], (t, ctx, echec) => {
      if (!achat.lignes.length) { echec('Aucun produit dans l\'achat'); return; }
      const ids = achat.lignes.filter((l) => l.produitId).map((l) => l.produitId);
      if (new Set(ids).size !== ids.length) { echec('Un produit apparaît deux fois dans l\'achat'); return; }
      const sp = t.objectStore('produits');
      let restants = achat.lignes.length;
      const ligneTerminee = () => {
        restants -= 1;
        if (restants > 0) return;
        const ra = t.objectStore('achats').add(achat);
        ra.onsuccess = () => {
          achat.id = ra.result;
          ctx.resultat = achat;
          if (achat.resteUSD > 0.0001) {
            t.objectStore('dettesFournisseurs').add({
              fournisseurId: achat.fournisseurId, date: achat.date, type: 'dette',
              montantUSD: achat.resteUSD, note: 'Achat n° ' + achat.id, achatId: achat.id
            });
          }
        };
      };
      achat.lignes.forEach((l) => {
        if (l.nouveauProduit) { // nouveau produit : créé en stock immédiatement
          const np = Object.assign({}, l.nouveauProduit, { stock: arrondi(l.qte, 3) });
          const rn = sp.add(np);
          rn.onsuccess = () => {
            l.produitId = rn.result; l.nouveau = true; delete l.nouveauProduit;
            t.objectStore('mouvements').add({
              produitId: rn.result, nom: np.nom, date: achat.date, type: 'entree', qte: l.qte,
              note: 'Achat fournisseur (nouveau produit)', vendeur: achat.vendeur
            });
            ligneTerminee();
          };
          return;
        }
        const rq = sp.get(l.produitId);
        rq.onsuccess = () => {
          const p = rq.result;
          if (!p) { echec('Produit introuvable : ' + l.nom); return; }
          if (achat.majPrix) p.prixAchat = l.prixSaisi;
          p.stock = arrondi(p.stock + l.qte, 3);
          sp.put(p);
          t.objectStore('mouvements').add({
            produitId: p.id, nom: p.nom, date: achat.date, type: 'entree', qte: l.qte, note: 'Achat fournisseur', vendeur: achat.vendeur
          });
          ligneTerminee();
        };
      });
    });
  }

  // ----- Import de produits en lot (CSV) : tout ou rien -----
  // nouveaux : produits sans id (leur stock de départ est journalisé) ; misesAJour : produits avec id
  function importerProduits(nouveaux, misesAJour, auteur) {
    return transaction(['produits', 'mouvements'], (t, ctx) => {
      const sp = t.objectStore('produits');
      (misesAJour || []).forEach((p) => sp.put(p));
      (nouveaux || []).forEach((p) => {
        const rq = sp.add(p);
        rq.onsuccess = () => {
          if (p.stock > 0) {
            t.objectStore('mouvements').add({
              produitId: rq.result, nom: p.nom, date: Date.now(), type: 'entree', qte: p.stock, note: 'Stock de départ (import)', vendeur: auteur || ''
            });
          }
        };
      });
      ctx.resultat = (nouveaux || []).length + (misesAJour || []).length;
    });
  }

  // ----- Sauvegarde complète -----
  async function exporterTout() {
    const donnees = {};
    for (const t of TABLES) donnees[t] = await tout(t);
    return { application: 'EvoBuskin', version: 2, date: Date.now(), donnees };
  }

  // Remplace TOUTES les données par celles d'une sauvegarde (ou des données de démo).
  // Une sauvegarde de la version 1 ne touche pas aux tables de la version 2 (elles n'y existent pas).
  function importerTout(sauvegarde) {
    return new Promise((resolve, reject) => {
      if (!sauvegarde || !['EvoBuskin', 'AIVA Caisse'].includes(sauvegarde.application) || !sauvegarde.donnees) {
        reject(new Error('Ce fichier n\'est pas une sauvegarde EvoBuskin')); return;
      }
      const t = base.transaction(TABLES, 'readwrite');
      t.oncomplete = () => resolve();
      t.onabort = () => reject(t.error || new Error('Importation annulée'));
      TABLES.forEach((nom) => {
        const lignes = sauvegarde.donnees[nom];
        if (lignes === undefined && TABLES_V2.includes(nom)) return; // table absente d'une vieille sauvegarde : on garde l'existant
        const s = t.objectStore(nom);
        s.clear();
        (lignes || []).forEach((ligne) => s.put(ligne));
      });
    });
  }

  // Efface les tables, sauf celles de la liste "gardees" (ex. ['params', 'audit'] : réglages, PIN, journal).
  function toutEffacer(gardees = []) {
    return new Promise((resolve, reject) => {
      const t = base.transaction(TABLES, 'readwrite');
      t.oncomplete = () => resolve();
      t.onabort = () => reject(t.error);
      TABLES.filter((n) => !gardees.includes(n)).forEach((nom) => t.objectStore(nom).clear());
    });
  }

  return { ouvrir, tout, lire, ecrire, ajouter, supprimer, lireParam, ecrireParam, transaction,
           enregistrerVente, annulerVente, ajusterStock, enregistrerAchat, importerProduits,
           exporterTout, importerTout, toutEffacer };
})();
