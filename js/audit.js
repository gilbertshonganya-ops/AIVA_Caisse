/* AIVA Caisse - journal d'audit infalsifiable (version locale)
   Chaque opération sensible est écrite dans le journal avec : qui, quand, quoi.
   Chaque entrée contient l'empreinte SHA-256 de l'entrée précédente ("chaîne de hachage") :
   modifier ou supprimer une ancienne entrée casse la chaîne et la vérification le détecte.

   LIMITE HONNÊTE : sur le téléphone seul, quelqu'un qui maîtrise l'outil pourrait recalculer
   toute la chaîne. L'immuabilité complète viendra avec le cloud (étape suivante), qui gardera
   une copie de l'empreinte hors du téléphone. Aucun écran de l'application ne permet de modifier
   ou d'effacer le journal. */

// SHA-256 en JavaScript pur : identique partout (même sans HTTPS) et sans bibliothèque.
const Sha256 = (() => {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

  function hex(texte) {
    const octets = new TextEncoder().encode(texte);
    const l = octets.length;
    const total = ((l + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(total);
    m.set(octets); m[l] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(total - 8, Math.floor((l * 8) / 4294967296));
    dv.setUint32(total - 4, (l * 8) >>> 0);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    const rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let i = 0; i < total; i += 64) {
      for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
      for (let t = 16; t < 64; t++) {
        const s0 = rot(w[t - 15], 7) ^ rot(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        const s1 = rot(w[t - 2], 17) ^ rot(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const S1 = rot(e, 6) ^ rot(e, 11) ^ rot(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[t] + w[t]) | 0;
        const S0 = rot(a, 2) ^ rot(a, 13) ^ rot(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
  }
  return { hex };
})();

const Audit = (() => {
  const GENESE = '0'.repeat(64);

  // Libellés affichés dans l'écran Journal d'audit
  const LIBELLES = {
    connexion: 'Connexion', echec_connexion: 'Échec de connexion (mauvais PIN)',
    vente: 'Vente', vente_annulee: 'Vente annulée',
    stock_entree: 'Entrée de stock', stock_sortie: 'Sortie de stock', inventaire: 'Inventaire',
    produit_cree: 'Produit créé', produit_modifie: 'Produit modifié', produit_supprime: 'Produit supprimé',
    paiement_dette: 'Paiement de dette client', dette_ajoutee: 'Dette client ajoutée', client_supprime: 'Client supprimé',
    taux_modifie: 'Taux de change modifié', pin_modifie: 'PIN modifié',
    sauvegarde: 'Sauvegarde', restauration: 'Restauration d\'une sauvegarde', demo_chargee: 'Données de démonstration chargées',
    donnees_effacees: 'Toutes les données effacées',
    achat: 'Achat fournisseur', paiement_fournisseur: 'Paiement fournisseur', fournisseur_supprime: 'Fournisseur supprimé',
    depense_ajoutee: 'Dépense ajoutée', depense_supprimee: 'Dépense supprimée', import_produits: 'Import de produits'
  };
  // Pour Audit.noter('Achat', 'texte') : le titre en français est converti en code d'action
  const NOTES = { 'Achat': 'achat', 'Fournisseur supprimé': 'fournisseur_supprime', 'Paiement fournisseur': 'paiement_fournisseur',
                  'Dépense ajoutée': 'depense_ajoutee', 'Dépense supprimée': 'depense_supprimee', 'Import CSV': 'import_produits' };

  const contenu = (e) => JSON.stringify([e.prev, e.date, e.acteur, e.action, e.detail]);

  // Ajoute une ligne au journal. Ne bloque jamais l'opération métier : un échec est seulement noté en console.
  // detail : petit objet { clé: valeur } décrivant l'opération.
  function log(action, detail) {
    let acteur = 'Écran de connexion';
    if (typeof App !== 'undefined' && App.role) acteur = App.nomVendeur();
    return DB.transaction(['audit', 'params'], (t) => {
      const sa = t.objectStore('audit'), sp = t.objectStore('params');
      const c = sa.openCursor(null, 'prev'); // dernière ligne connue
      c.onsuccess = () => {
        const entree = {
          date: Date.now(), acteur, action, detail: detail || {},
          prev: c.result ? c.result.value.hash : GENESE, algo: 'sha256'
        };
        entree.hash = Sha256.hex(contenu(entree));
        const ra = sa.add(entree);
        ra.onsuccess = () => sp.put({ cle: 'auditTete', valeur: { id: ra.result, hash: entree.hash } });
      };
    }).catch((e) => console.error('Journal d\'audit : échec d\'écriture', e));
  }

  // Version "texte libre" : noter('Achat', 'n°12 total 40 $')
  function noter(titre, texte) {
    const code = NOTES[titre] || String(titre).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return log(code, { texte: String(texte || '') });
  }

  // Phrase lisible à partir du détail d'une ligne
  function resume(e) {
    const d = e.detail || {};
    if (typeof d.texte === 'string') return d.texte;
    return Object.keys(d).map((k) => {
      const v = d[k];
      return k + ' : ' + (Array.isArray(v) ? v.join(' → ') : (typeof v === 'boolean' ? (v ? 'oui' : 'non') : v));
    }).join(', ');
  }

  // Vérifie toute la chaîne. Retourne { ok: true, n } | { ok: false, id, raison } | { ok: null, raison }
  async function verifier() {
    const lignes = (await DB.tout('audit')).sort((a, b) => a.id - b.id);
    if (!lignes.length) return { ok: null, raison: 'Le journal est vide.' };
    let precedent = null;
    for (const e of lignes) {
      if (precedent !== null && e.prev !== precedent) {
        return { ok: false, id: e.id, raison: 'La chaîne est rompue : une ligne précédente a été supprimée ou remplacée.' };
      }
      if (Sha256.hex(contenu(e)) !== e.hash) {
        return { ok: false, id: e.id, raison: 'Le contenu de cette ligne a été modifié après coup.' };
      }
      precedent = e.hash;
    }
    const tete = await DB.lireParam('auditTete', null);
    if (tete && (tete.hash !== precedent)) {
      return { ok: false, id: tete.id, raison: 'Les dernières lignes du journal ont été supprimées.' };
    }
    return { ok: true, n: lignes.length };
  }

  return { LIBELLES, log, noter, resume, verifier };
})();

if (typeof module !== 'undefined') module.exports = { Sha256 };
