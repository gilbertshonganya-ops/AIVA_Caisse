/* AIVA Caisse - écran ACHATS et FOURNISSEURS (patron)
   Un achat augmente le stock, met à jour le prix d'achat (dernier prix payé) et crée,
   si tout n'est pas payé, une dette envers le fournisseur. */
const VueAchats = {
  onglet: 'achats',
  fournisseurs: [],
  dettesF: [],

  soldeF(id, liste) {
    return arrondi((liste || this.dettesF).filter((m) => m.fournisseurId === id)
      .reduce((s, m) => s + (m.type === 'dette' ? m.montantUSD : -m.montantUSD), 0), 6);
  },

  async afficher(conteneur) {
    const [fournisseurs, achats, dettesF] = await Promise.all([DB.tout('fournisseurs'), DB.tout('achats'), DB.tout('dettesFournisseurs')]);
    this.fournisseurs = fournisseurs; this.dettesF = dettesF;
    const totalDu = fournisseurs.reduce((s, f) => s + Math.max(0, this.soldeF(f.id)), 0);

    conteneur.innerHTML =
      App.entete('Achats et fournisseurs') +
      '<div class="carte ' + (totalDu > 0.005 ? 'danger' : '') + '"><div class="petit">Vous devez aux fournisseurs</div><div style="font-size:1.3rem">' + App.montantHtml(totalDu) + '</div></div>' +
      '<div class="segment" id="ongletsA"><button data-o="achats">Achats</button><button data-o="fournisseurs">Fournisseurs</button></div>' +
      '<div id="contenuA"></div>';
    $$('#ongletsA button').forEach((b) => {
      b.classList.toggle('actif', b.dataset.o === this.onglet);
      b.addEventListener('click', () => { this.onglet = b.dataset.o; this.afficher(conteneur); });
    });
    const zone = $('#contenuA');

    if (this.onglet === 'achats') {
      const tries = achats.sort((a, b) => b.date - a.date).slice(0, 60);
      zone.innerHTML = '<button class="btn" id="btnAchat" style="margin-bottom:12px">+ Nouvel achat</button>' +
        (tries.length ? '<div class="liste">' + tries.map((a) => {
          const f = fournisseurs.find((x) => x.id === a.fournisseurId);
          return '<div class="ligne" data-id="' + a.id + '"><div><div class="nom">Achat n° ' + a.id + (f ? ' &middot; ' + esc(f.nom) : '') + '</div>' +
            '<div class="sous">' + formatDate(a.date) + ' &middot; ' + a.lignes.length + ' produit(s)' + (a.resteUSD > 0.005 ? ' &middot; reste ' + formatUSD(a.resteUSD) : '') + '</div></div>' +
            '<div class="droite gras">' + formatUSD(a.totalUSD) + '</div></div>';
        }).join('') + '</div>' : '<div class="vide">Aucun achat enregistré.</div>');
      $('#btnAchat').addEventListener('click', () => this.formulaireAchat());
      $$('.liste .ligne[data-id]', zone).forEach((l) => l.addEventListener('click', () => this.detailAchat(achats.find((a) => a.id === Number(l.dataset.id)))));
    } else {
      zone.innerHTML = '<button class="btn" id="btnFour" style="margin-bottom:12px">+ Nouveau fournisseur</button>' +
        (fournisseurs.length ? '<div class="liste">' + fournisseurs.map((f) => ({ f, s: this.soldeF(f.id) })).sort((a, b) => b.s - a.s).map((x) =>
          '<div class="ligne" data-id="' + x.f.id + '"><div><div class="nom">' + esc(x.f.nom) + '</div><div class="sous">' + esc(x.f.tel || 'Pas de téléphone') + '</div></div>' +
          '<div class="droite">' + (x.s > 0.005 ? '<span class="rouge-txt gras">' + formatUSD(x.s) + '</span>' : '<span class="badge">À jour</span>') + '</div></div>').join('') + '</div>'
          : '<div class="vide">Aucun fournisseur.</div>');
      $('#btnFour').addEventListener('click', () => this.formulaireFournisseur(null));
      $$('.liste .ligne[data-id]', zone).forEach((l) => l.addEventListener('click', () => this.detailFournisseur(Number(l.dataset.id))));
    }
    App.brancherRetour(conteneur);
  },

  formulaireFournisseur(f0) {
    const f = ouvrirFenetre(f0 ? 'Modifier le fournisseur' : 'Nouveau fournisseur',
      '<label class="champ"><span>Nom *</span><input id="fNom" autocomplete="off" value="' + esc(f0 ? f0.nom : '') + '"></label>' +
      '<label class="champ"><span>Téléphone</span><input id="fTel" inputmode="tel" autocomplete="off" value="' + esc(f0 ? f0.tel : '') + '"></label>' +
      '<button class="btn" id="fOk">Enregistrer</button>');
    $('#fOk', f.el).addEventListener('click', async () => {
      const nom = $('#fNom', f.el).value.trim();
      if (!nom) { toast('Le nom est obligatoire', 'erreur'); return; }
      await DB.ecrire('fournisseurs', Object.assign({}, f0 || {}, { nom, tel: $('#fTel', f.el).value.trim() }));
      f.fermer(); toast('Fournisseur enregistré', 'ok'); this.afficher($('#vue'));
    });
  },

  detailAchat(a) {
    if (!a) return;
    const f0 = this.fournisseurs.find((x) => x.id === a.fournisseurId);
    ouvrirFenetre('Achat n° ' + a.id,
      '<p class="petit">' + formatDateHeure(a.date) + (f0 ? ' &middot; ' + esc(f0.nom) : '') + '</p>' +
      '<div class="liste">' + a.lignes.map((l) =>
        '<div class="ligne" style="cursor:default"><div><div class="nom">' + esc(l.nom) + '</div><div class="sous">' + formatQuantite(l.qte) + ' x ' + (l.devise === 'CDF' ? formatCDF(l.prixSaisi) : formatUSD(l.prixSaisi)) + '</div></div>' +
        '<div class="gras">' + formatUSD(l.qte * l.prixUnitaireUSD) + '</div></div>').join('') + '</div>' +
      '<div class="ligne-flex"><span>Total</span><span class="gras">' + formatUSD(a.totalUSD) + '</span></div>' +
      '<div class="ligne-flex"><span>Payé</span><span>' + formatUSD(a.payeUSD) + '</span></div>' +
      (a.resteUSD > 0.005 ? '<div class="ligne-flex"><span>Reste dû</span><span class="rouge-txt gras">' + formatUSD(a.resteUSD) + '</span></div>' : '') +
      (a.note ? '<p class="petit" style="margin-top:8px">' + esc(a.note) + '</p>' : ''));
  },

  // ---------- Nouvel achat ----------
  async formulaireAchat() {
    const produits = (await DB.tout('produits')).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    if (!produits.length) { toast('Ajoutez d\'abord des produits dans le Stock', 'erreur'); return; }
    const taux = App.taux();
    const lignes = [{ produitId: '', qte: '', prix: '' }];
    let deviseP = 'USD', payeModifie = false;

    const f = ouvrirFenetre('Nouvel achat',
      '<label class="champ"><span>Fournisseur</span><select id="aF"><option value="">-- Sans fournisseur --</option>' +
        this.fournisseurs.map((x) => '<option value="' + x.id + '">' + esc(x.nom) + '</option>').join('') + '<option value="new">+ Nouveau fournisseur</option></select></label>' +
      '<div id="aNouveau" hidden><div class="deux-colonnes"><label class="champ"><span>Nom</span><input id="aNom" autocomplete="off"></label>' +
        '<label class="champ"><span>Téléphone</span><input id="aTel" inputmode="tel" autocomplete="off"></label></div></div>' +
      '<h3 style="margin:4px 0 8px">Produits achetés</h3><div id="aLignes"></div>' +
      '<button class="btn gris" id="aAj" style="margin-bottom:12px">+ Ajouter un produit</button>' +
      '<div class="ligne-flex" style="margin-bottom:8px"><span>Total de l\'achat</span><span class="total-grand" id="aTotal">0,00 $</span></div>' +
      '<div class="segment" id="devises"><button data-dev="USD" class="actif">Payé en $</button><button data-dev="CDF">Payé en FC</button></div>' +
      '<label class="champ"><span>Montant payé maintenant</span><input id="aPaye" inputmode="decimal" autocomplete="off"></label>' +
      '<div id="aInfo" class="petit" style="margin:-6px 0 10px"></div>' +
      '<label class="champ"><span>Note (facultatif)</span><input id="aNote" autocomplete="off"></label>' +
      '<label class="case"><input type="checkbox" id="aMaj" checked> Mettre à jour le prix d\'achat des produits</label>' +
      '<button class="btn" id="aOk">Enregistrer l\'achat</button>', { verrouille: true });
    const el = f.el;

    const coutUSD = (l) => {
      const p = produits.find((x) => x.id === Number(l.produitId));
      const q = lireNombre(l.qte), pr = lireNombre(l.prix);
      if (!p || isNaN(q) || isNaN(pr)) return 0;
      return q * versUSD(pr, p.devise, taux);
    };
    const total = () => lignes.reduce((s, l) => s + coutUSD(l), 0);
    const majTotaux = () => {
      const t = total();
      $('#aTotal', el).textContent = formatUSD(t);
      if (!payeModifie) $('#aPaye', el).value = t > 0 ? String(deviseP === 'CDF' ? Math.round(t * taux) : arrondi(t, 2)) : '';
      const paye = lireNombre($('#aPaye', el).value);
      const info = $('#aInfo', el);
      if (isNaN(paye)) { info.textContent = ''; return; }
      const reste = t - versUSD(paye, deviseP, taux);
      info.className = 'petit ' + (reste > 0.005 ? 'rouge-txt' : '');
      info.textContent = reste > 0.005 ? 'Reste dû au fournisseur : ' + formatUSD(reste) + ' (' + formatCDF(reste * taux) + ')' : '';
    };
    const dessinerLignes = () => {
      $('#aLignes', el).innerHTML = lignes.map((l, i) => {
        const p = produits.find((x) => x.id === Number(l.produitId));
        return '<div class="carte" style="padding:10px;margin-bottom:8px"><select data-p="' + i + '" style="width:100%;padding:10px;border:1.5px solid var(--couleur-bordure);border-radius:10px;margin-bottom:8px">' +
          '<option value="">-- Choisir le produit --</option>' + produits.map((x) => '<option value="' + x.id + '"' + (x.id === Number(l.produitId) ? ' selected' : '') + '>' + esc(x.nom) + '</option>').join('') + '</select>' +
          '<div class="deux-colonnes"><label class="champ" style="margin:0"><span>Quantité</span><input data-q="' + i + '" inputmode="decimal" value="' + esc(l.qte) + '"></label>' +
          '<label class="champ" style="margin:0"><span>Prix d\'achat unitaire (' + (p ? (p.devise === 'CDF' ? 'FC' : '$') : '...') + ')</span><input data-pr="' + i + '" inputmode="decimal" value="' + esc(l.prix) + '"></label></div>' +
          (lignes.length > 1 ? '<button class="btn gris petit-btn" data-x="' + i + '" style="margin-top:8px">Retirer</button>' : '') + '</div>';
      }).join('');
      $$('[data-p]', el).forEach((s) => s.addEventListener('change', () => {
        const l = lignes[Number(s.dataset.p)]; l.produitId = s.value;
        const p = produits.find((x) => x.id === Number(s.value));
        l.prix = p ? String(p.prixAchat || '') : '';
        dessinerLignes(); majTotaux();
      }));
      $$('[data-q]', el).forEach((s) => s.addEventListener('input', () => { lignes[Number(s.dataset.q)].qte = s.value; majTotaux(); }));
      $$('[data-pr]', el).forEach((s) => s.addEventListener('input', () => { lignes[Number(s.dataset.pr)].prix = s.value; majTotaux(); }));
      $$('[data-x]', el).forEach((s) => s.addEventListener('click', () => { lignes.splice(Number(s.dataset.x), 1); dessinerLignes(); majTotaux(); }));
    };
    dessinerLignes(); majTotaux();

    $('#aAj', el).addEventListener('click', () => { lignes.push({ produitId: '', qte: '', prix: '' }); dessinerLignes(); });
    $('#aF', el).addEventListener('change', (e) => { $('#aNouveau', el).hidden = e.target.value !== 'new'; });
    $('#aPaye', el).addEventListener('input', () => { payeModifie = true; majTotaux(); });
    $$('#devises button', el).forEach((b) => b.addEventListener('click', () => {
      deviseP = b.dataset.dev; payeModifie = false;
      $$('#devises button', el).forEach((x) => x.classList.toggle('actif', x === b)); majTotaux();
    }));

    $('#aOk', el).addEventListener('click', async () => {
      const ids = new Set();
      const lignesOk = [];
      for (const l of lignes) {
        const p = produits.find((x) => x.id === Number(l.produitId));
        const q = lireNombre(l.qte), pr = lireNombre(l.prix);
        if (!p) { toast('Choisissez le produit pour chaque ligne', 'erreur'); return; }
        if (ids.has(p.id)) { toast('« ' + p.nom + ' » apparaît deux fois : regroupez les quantités', 'erreur'); return; }
        if (isNaN(q) || q <= 0) { toast('Quantité invalide pour « ' + p.nom + ' »', 'erreur'); return; }
        if (isNaN(pr) || pr < 0) { toast('Prix invalide pour « ' + p.nom + ' »', 'erreur'); return; }
        ids.add(p.id);
        lignesOk.push({ produitId: p.id, nom: p.nom, qte: arrondi(q, 3), prixSaisi: pr, devise: p.devise, prixUnitaireUSD: arrondi(versUSD(pr, p.devise, taux), 6) });
      }
      const t = arrondi(lignesOk.reduce((s, l) => s + l.qte * l.prixUnitaireUSD, 0), 6);
      const payeSaisi = lireNombre($('#aPaye', el).value);
      if (isNaN(payeSaisi) || payeSaisi < 0) { toast('Montant payé invalide (mettez 0 si rien n\'est payé)', 'erreur'); return; }
      let paye = Math.min(versUSD(payeSaisi, deviseP, taux), t);
      let reste = t - paye;
      if (reste * taux < 0.5) { reste = 0; paye = t; }
      let fournisseurId = null;
      const choix = $('#aF', el).value;
      if (choix === 'new') {
        const nom = $('#aNom', el).value.trim();
        if (!nom) { toast('Écrivez le nom du nouveau fournisseur', 'erreur'); return; }
        fournisseurId = await DB.ajouter('fournisseurs', { nom, tel: $('#aTel', el).value.trim() });
      } else if (choix) fournisseurId = Number(choix);
      if (reste > 0 && !fournisseurId) { toast('Choisissez le fournisseur : il reste ' + formatUSD(reste) + ' à lui payer', 'erreur'); return; }
      const achat = {
        date: Date.now(), fournisseurId, lignes: lignesOk, totalUSD: t, payeUSD: arrondi(paye, 6), resteUSD: arrondi(reste, 6),
        taux, majPrix: $('#aMaj', el).checked, note: $('#aNote', el).value.trim(), vendeur: App.nomVendeur()
      };
      try {
        await DB.enregistrerAchat(achat);
        Audit.noter('Achat', 'n°' + achat.id + ' total ' + formatUSD(t) + (reste > 0 ? ', reste dû ' + formatUSD(reste) : ''));
        f.fermer(); toast('Achat enregistré : le stock est à jour', 'ok'); this.afficher($('#vue'));
      } catch (e) { toast(e.message, 'erreur'); }
    });
  },

  async detailFournisseur(id) {
    this.dettesF = await DB.tout('dettesFournisseurs');
    const fo = await DB.lire('fournisseurs', id);
    if (!fo) return;
    const solde = this.soldeF(id);
    const histo = this.dettesF.filter((m) => m.fournisseurId === id).sort((a, b) => b.date - a.date);
    const f = ouvrirFenetre(fo.nom,
      '<div class="carte ' + (solde > 0.005 ? 'danger' : '') + '" style="margin-bottom:10px"><div class="petit">Vous lui devez</div><div style="font-size:1.3rem">' + App.montantHtml(Math.max(0, solde)) + '</div><div class="petit">' + esc(fo.tel || 'Pas de téléphone') + '</div></div>' +
      '<div class="pile">' + (solde > 0.005 ? '<button class="btn" id="fPaie">Enregistrer un paiement</button>' : '') +
      '<div class="ligne-boutons"><button class="btn gris" id="fModif">Modifier</button><button class="btn rouge" id="fSuppr">Supprimer</button></div></div>' +
      '<h3 style="margin:16px 0 6px">Historique</h3>' +
      (histo.length ? '<div class="liste">' + histo.map((m) =>
        '<div class="ligne" style="cursor:default"><div><div class="nom">' + (m.type === 'dette' ? 'Dette' : 'Paiement') + '</div><div class="sous">' + formatDateHeure(m.date) + (m.note ? ' &middot; ' + esc(m.note) : '') + '</div></div>' +
        '<div class="gras ' + (m.type === 'dette' ? 'rouge-txt' : 'vert-txt') + '">' + (m.type === 'dette' ? '+' : '-') + formatUSD(m.montantUSD) + '</div></div>').join('') + '</div>' : '<p class="petit">Aucun mouvement.</p>'));
    const paie = $('#fPaie', f.el);
    if (paie) paie.addEventListener('click', () => { f.fermer(); this.formulairePaiementF(fo, solde); });
    $('#fModif', f.el).addEventListener('click', () => { f.fermer(); this.formulaireFournisseur(fo); });
    $('#fSuppr', f.el).addEventListener('click', async () => {
      const msg = solde > 0.005 ? 'Vous lui devez encore ' + formatUSD(solde) + '. Supprimer efface aussi son historique de dettes.' : 'Supprimer ce fournisseur ?';
      if (!(await confirmer('Supprimer le fournisseur', msg, 'Supprimer', true))) return;
      for (const m of histo) await DB.supprimer('dettesFournisseurs', m.id);
      await DB.supprimer('fournisseurs', fo.id);
      Audit.noter('Fournisseur supprimé', fo.nom);
      f.fermer(); toast('Fournisseur supprimé'); this.afficher($('#vue'));
    });
  },

  formulairePaiementF(fo, solde) {
    let devise = 'USD';
    const f = ouvrirFenetre('Paiement à ' + fo.nom,
      '<p class="petit">Reste dû : <b>' + formatUSD(solde) + '</b> (' + formatCDF(solde * App.taux()) + ')</p>' +
      '<div class="segment" id="devises"><button data-dev="USD" class="actif">Dollars ($)</button><button data-dev="CDF">Francs (FC)</button></div>' +
      '<label class="champ"><span>Montant</span><input id="pMontant" inputmode="decimal" autocomplete="off" value="' + arrondi(solde, 2) + '"></label>' +
      '<label class="champ"><span>Note (facultatif)</span><input id="pNote" autocomplete="off"></label><button class="btn" id="pOk">Enregistrer le paiement</button>');
    $$('#devises button', f.el).forEach((b) => b.addEventListener('click', () => { devise = b.dataset.dev; $$('#devises button', f.el).forEach((x) => x.classList.toggle('actif', x === b)); }));
    $('#pOk', f.el).addEventListener('click', async () => {
      const v = lireNombre($('#pMontant', f.el).value);
      if (isNaN(v) || v <= 0) { toast('Entrez un montant supérieur à 0', 'erreur'); return; }
      const usd = arrondi(versUSD(v, devise, App.taux()), 6);
      if (usd > solde + 0.01) { toast('Le montant dépasse ce que vous devez (' + formatUSD(solde) + ')', 'erreur'); return; }
      await DB.ajouter('dettesFournisseurs', { fournisseurId: fo.id, date: Date.now(), type: 'paiement', montantUSD: Math.min(usd, solde), devise, note: $('#pNote', f.el).value.trim() });
      Audit.noter('Paiement fournisseur', fo.nom + ' ' + formatUSD(Math.min(usd, solde)));
      f.fermer(); toast('Paiement enregistré', 'ok'); this.afficher($('#vue'));
    });
  }
};
