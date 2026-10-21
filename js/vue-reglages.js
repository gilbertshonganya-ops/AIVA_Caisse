/* EvoBuskin - écran RÉGLAGES (patron) : boutique, taux, sauvegarde, démo */
const VueReglages = {
  async afficher(conteneur) {
    const r = App.reglages;
    conteneur.innerHTML =
      '<div class="carte"><h3>Ma boutique</h3><div style="height:8px"></div>' +
        '<label class="champ"><span>Nom de la boutique (sur les reçus)</span><input id="rNom" autocomplete="off" value="' + esc(r.nomBoutique) + '"></label>' +
        '<label class="champ"><span>Téléphone de la boutique</span><input id="rTel" inputmode="tel" maxlength="17" autocomplete="off" placeholder="0895006995" value="' + esc(r.telBoutique) + '"></label>' +
        '<button class="btn" id="rSaveBoutique">Enregistrer</button></div>' +

      '<div class="carte"><h3>Taux de change</h3><div style="height:8px"></div>' +
        '<label class="champ"><span>1 dollar ($) = combien de francs (FC) ?</span><input id="rTaux" inputmode="decimal" autocomplete="off" value="' + esc(r.taux) + '"></label>' +
        '<label class="champ"><span>Devise affichée en grand</span><select id="rAff"><option value="USD">Dollars ($)</option><option value="CDF">Francs (FC)</option></select></label>' +
        '<p class="petit">Les anciennes ventes gardent le taux du jour où elles ont été faites. Pensez à mettre à jour le taux chaque matin.</p>' +
        '<button class="btn" id="rSaveTaux">Enregistrer</button></div>' +

      '<div class="carte"><h3>Sauvegarde</h3><div style="height:8px"></div>' +
        '<p class="petit">' + (r.derniereSauvegarde ? 'Dernière sauvegarde : ' + formatDateHeure(r.derniereSauvegarde) : 'Aucune sauvegarde faite.') + '</p>' +
        '<div class="pile">' +
          '<button class="btn" id="rExportChiffre">Sauvegarde protégée par mot de passe</button>' +
          '<button class="btn contour" id="rExport">Sauvegarde simple (non protégée)</button>' +
          '<button class="btn contour" id="rImport">Restaurer une sauvegarde</button>' +
          '<input type="file" id="fichierImport" accept="application/json,.json" hidden>' +
          '<button class="btn gris" id="rCsvVentes">Exporter les ventes (Excel/CSV)</button>' +
          '<button class="btn gris" id="rCsvStock">Exporter le stock (Excel/CSV)</button>' +
        '</div><p class="petit" style="margin-top:10px">La sauvegarde protégée est chiffrée (AES-256). Sans le mot de passe, personne ne peut la rouvrir, pas même nous.</p></div>' +
      '<div id="zoneCompte"></div>' +
      '<p class="petit texte-centre" style="margin:14px 0">EvoBuskin &middot; vos données sur tous vos appareils<br><a href="conditions.html" target="_blank" rel="noopener">Conditions d’utilisation</a> &middot; <a href="confidentialite.html" target="_blank" rel="noopener">Politique de confidentialité</a></p>';

    $('#rAff').value = r.affichage;
    VueCompte.afficher($('#zoneCompte'), true); // mot de passe et suppression de compte

    $('#rSaveBoutique').addEventListener('click', async () => {
      const nom = $('#rNom').value.trim();
      if (!nom) { toast('Le nom de la boutique est obligatoire', 'erreur'); return; }
      const vt = validerTelRDC($('#rTel').value);
      if (!vt.ok) { toast(MESSAGE_TEL_RDC, 'erreur'); return; }
      const avant = { nom: App.reglages.nomBoutique || '', tel: App.reglages.telBoutique || '' };
      await App.sauverReglage('nomBoutique', nom);
      await App.sauverReglage('telBoutique', vt.local);
      const d = {};
      if (avant.nom !== nom) d['nom de la boutique'] = [avant.nom || '-', nom];
      if (avant.tel !== vt.local) d['téléphone de la boutique'] = [avant.tel || '-', vt.local || '-'];
      if (Object.keys(d).length) Audit.log('reglages_modifies', d);
      toast('Boutique enregistrée', 'ok');
    });

    $('#rSaveTaux').addEventListener('click', async () => {
      const t = lireNombre($('#rTaux').value);
      if (isNaN(t) || t < 1 || t > 100000) { toast('Taux invalide (exemple : 2800)', 'erreur'); return; }
      const ancienTaux = r.taux;
      await App.sauverReglage('taux', t);
      if (Number(ancienTaux) !== t) {
        try {
          await SyncManager.mettreEnFile('exchange_rate', { p_rate: t });
        } catch (_) {}
        Audit.log('taux_modifie', { taux: [ancienTaux, t] });
      }
      const affAvant = r.affichage, affApres = $('#rAff').value;
      await App.sauverReglage('affichage', affApres);
      if (affAvant !== affApres) Audit.log('reglages_modifies', { 'devise affichée': [affAvant === 'CDF' ? 'Francs (FC)' : 'Dollars ($)', affApres === 'CDF' ? 'Francs (FC)' : 'Dollars ($)'] });
      toast('Taux enregistré : 1 $ = ' + formatCDF(t), 'ok');
      VueCaisse.panier = []; // les prix du panier dépendent du taux : on repart propre
    });

    $('#rExport').addEventListener('click', async () => {
      const sauvegarde = await DB.exporterTout();
      await enregistrerFichier('evobuskin-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(sauvegarde), 'application/json');
      await App.sauverReglage('derniereSauvegarde', Date.now());
      Audit.log('sauvegarde', { chiffree: false });
      toast('Sauvegarde créée. Gardez le fichier en lieu sûr.', 'ok'); App.rafraichir();
    });
    $('#rExportChiffre').addEventListener('click', () => this.sauvegardeChiffree());
    $('#rImport').addEventListener('click', () => $('#fichierImport').click());
    $('#fichierImport').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; this.restaurer(f); }); // value vidée : on peut rechoisir le même fichier
    $('#rCsvVentes').addEventListener('click', () => this.exporterCsvVentes());
    $('#rCsvStock').addEventListener('click', () => this.exporterCsvStock());
  },

  // Demande un mot de passe dans une fenêtre. Retourne le texte saisi, ou null si annulé.
  demanderMotDePasse(titre, message, confirmation) {
    return new Promise((resolve) => {
      let valeur = null;
      const f = ouvrirFenetre(titre,
        '<p class="petit">' + esc(message) + '</p>' +
        '<label class="champ"><span>Mot de passe</span><input id="mdp1" type="password" autocomplete="off"></label>' +
        (confirmation ? '<label class="champ"><span>Répétez le mot de passe</span><input id="mdp2" type="password" autocomplete="off"></label>' : '') +
        '<button class="btn" id="mdpOk">Valider</button>', { auFermer: () => resolve(valeur), verrouille: true });
      $('#mdp1', f.el).focus();
      $('#mdpOk', f.el).addEventListener('click', () => {
        const a = $('#mdp1', f.el).value;
        if (a.length < 6) { toast('Le mot de passe doit avoir au moins 6 caractères', 'erreur'); return; }
        if (confirmation && a !== $('#mdp2', f.el).value) { toast('Les deux mots de passe sont différents', 'erreur'); return; }
        valeur = a; f.fermer();
      });
    });
  },

  async sauvegardeChiffree() {
    if (!Coffre.disponible()) { toast('Le chiffrement exige HTTPS (ou localhost). Hébergez l\'application en HTTPS.', 'erreur'); return; }
    const mdp = await this.demanderMotDePasse('Protéger la sauvegarde',
      'Choisissez un mot de passe (6 caractères minimum). ATTENTION : si vous le perdez, la sauvegarde sera impossible à ouvrir.', true);
    if (!mdp) return;
    try {
      toast('Chiffrement en cours...');
      const donnees = await DB.exporterTout();
      const fichier = await Coffre.chiffrer(JSON.stringify(donnees), mdp);
      await enregistrerFichier('evobuskin-sauvegarde-protegee-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(fichier), 'application/json');
      await App.sauverReglage('derniereSauvegarde', Date.now());
      Audit.log('sauvegarde', { chiffree: true });
      toast('Sauvegarde protégée créée', 'ok'); App.rafraichir();
    } catch (e) { toast(e.message, 'erreur'); }
  },

  async restaurer(fichier) {
    if (!fichier) return;
    try {
      let sauvegarde = JSON.parse(await fichier.text());
      if (sauvegarde && sauvegarde.chiffre) {
        const mdp = await this.demanderMotDePasse('Sauvegarde protégée', 'Entrez le mot de passe choisi lors de la sauvegarde.', false);
        if (!mdp) return;
        sauvegarde = JSON.parse(await Coffre.dechiffrer(sauvegarde, mdp));
      }
      if (!sauvegarde || !['EvoBuskin', 'AIVA Caisse'].includes(sauvegarde.application)) throw new Error('Ce fichier n\'est pas une sauvegarde EvoBuskin');
      const n = (sauvegarde.donnees.produits || []).length;
      if (!(await confirmer('Restaurer la sauvegarde', 'Cela REMPLACE toutes les données actuelles par celles du fichier (' + n + ' produits). Continuer ?', 'Restaurer', true))) return;
      // Le journal d'audit de ce téléphone est conservé s'il existe (sinon on prend celui de la sauvegarde)
      const auditActuel = await DB.tout('audit');
      if (auditActuel.length) sauvegarde.donnees.audit = auditActuel;
      await DB.importerTout(sauvegarde);
      await App.chargerReglages();
      VueCaisse.panier = [];
      await Audit.log('restauration', { produits: n, fichier: fichier.name });
      toast('Sauvegarde restaurée', 'ok');
      App.verrouiller(); // la session est fermée par précaution
    } catch (e) {
      toast(e instanceof SyntaxError ? 'Fichier illisible' : e.message, 'erreur');
    }
  },

  // CSV avec « ; » et BOM : s'ouvre correctement dans Excel en français
  csv(lignes) {
    const cellule = (x) => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
    return '\uFEFF' + lignes.map((l) => l.map(cellule).join(';')).join('\r\n');
  },
  async exporterCsvVentes() {
    const ventes = (await DB.tout('ventes')).sort((a, b) => a.date - b.date);
    const lignes = [['N°', 'Date', 'Heure', 'Articles', 'Total USD', 'Total FC', 'Bénéfice USD', 'Mode', 'Référence', 'Payé USD', 'Reste USD', 'Vendeur', 'Annulée']];
    ventes.forEach((v) => lignes.push([
      v.id, formatDate(v.date), formatHeure(v.date), v.lignes.map((l) => formatQuantite(l.qte) + ' x ' + l.nom).join(' | '),
      arrondi(v.totalUSD, 2), Math.round(v.totalUSD * v.taux), arrondi(v.totalUSD - (v.coutUSD || 0), 2),
      LIBELLES_MODE[v.mode] || v.mode, v.reference || '', arrondi(v.payeUSD, 2), arrondi(v.resteUSD || 0, 2), v.vendeur || '', v.annulee ? 'oui' : 'non'
    ]));
    await enregistrerFichier('evobuskin-ventes.csv', this.csv(lignes), 'text/csv');
  },
  async exporterCsvStock() {
    const produits = (await DB.tout('produits')).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    const lignes = [['Produit', 'Catégorie', 'Code-barres', 'Devise', 'Prix achat', 'Prix vente', 'Stock', 'Seuil alerte']];
    produits.forEach((p) => lignes.push([p.nom, p.categorie, p.codeBarres, p.devise, p.prixAchat, p.prixVente, p.stock, p.seuil]));
    await enregistrerFichier('evobuskin-stock.csv', this.csv(lignes), 'text/csv');
  }
};
