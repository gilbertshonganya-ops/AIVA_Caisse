/* AIVA Caisse - écran RÉGLAGES (patron) : boutique, taux, PIN, sauvegarde, démo */
const VueReglages = {
  async afficher(conteneur) {
    const r = App.reglages;
    conteneur.innerHTML =
      '<div class="carte"><h3>Ma boutique</h3><div style="height:8px"></div>' +
        '<label class="champ"><span>Nom de la boutique (sur les reçus)</span><input id="rNom" autocomplete="off" value="' + esc(r.nomBoutique) + '"></label>' +
        '<label class="champ"><span>Téléphone de la boutique</span><input id="rTel" inputmode="tel" autocomplete="off" value="' + esc(r.telBoutique) + '"></label>' +
        '<button class="btn" id="rSaveBoutique">Enregistrer</button></div>' +

      '<div class="carte"><h3>Taux de change</h3><div style="height:8px"></div>' +
        '<label class="champ"><span>1 dollar ($) = combien de francs (FC) ?</span><input id="rTaux" inputmode="decimal" autocomplete="off" value="' + esc(r.taux) + '"></label>' +
        '<label class="champ"><span>Devise affichée en grand</span><select id="rAff"><option value="USD">Dollars ($)</option><option value="CDF">Francs (FC)</option></select></label>' +
        '<p class="petit">Les anciennes ventes gardent le taux du jour où elles ont été faites. Pensez à mettre à jour le taux chaque matin.</p>' +
        '<button class="btn" id="rSaveTaux">Enregistrer</button></div>' +

      '<div class="carte"><h3>Codes PIN</h3><div style="height:8px"></div>' +
        '<label class="champ"><span>Nouveau PIN du patron (4 chiffres)</span><input id="rPinP" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></label>' +
        '<label class="champ"><span>Nouveau PIN du vendeur (4 chiffres)</span><input id="rPinV" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></label>' +
        '<p class="petit">Laissez vide ce que vous ne voulez pas changer. Le PIN protège contre un regard curieux : gardez aussi le téléphone en lieu sûr.</p>' +
        '<button class="btn" id="rSavePin">Changer les PIN</button></div>' +

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

      '<div class="carte"><h3>Imprimante de tickets</h3><div style="height:8px"></div>' +
        '<label class="champ"><span>Mode d\'impression</span><select id="rImpMode">' +
          '<option value="systeme">Impression du téléphone / PDF</option>' +
          '<option value="ble">Bluetooth direct (imprimante Bluetooth LE)</option>' +
          '<option value="rawbt">Application RawBT (Bluetooth classique)</option></select></label>' +
        '<label class="champ"><span>Largeur du papier</span><select id="rImpLarg"><option value="32">58 mm (32 caractères)</option><option value="48">80 mm (48 caractères)</option></select></label>' +
        '<div class="pile"><button class="btn" id="rImpSave">Enregistrer</button><button class="btn gris" id="rImpTest">Imprimer un ticket de test</button><button class="btn gris" id="rImpOublier">Choisir une autre imprimante</button></div>' +
        '<p class="petit" style="margin-top:10px">Le mode Bluetooth direct ne marche qu\'avec les imprimantes Bluetooth LE, dans Chrome Android. Si votre imprimante n\'apparaît pas, installez l\'application gratuite RawBT et choisissez ce mode.</p></div>' +

      '<div class="carte"><h3>Données</h3><div style="height:8px"></div><div class="pile">' +
        '<button class="btn contour" id="rDemo">Charger les données de démonstration</button>' +
        '<button class="btn rouge" id="rEffacer">Tout effacer</button></div></div>' +

      '<div class="carte"><h3>Application</h3><div style="height:8px"></div><div class="pile">' +
        '<button class="btn gris" id="rInstall">Installer sur l\'écran d\'accueil</button>' +
        '<p class="petit texte-centre">AIVA Caisse version 1.1.0 &middot; fonctionne hors connexion</p></div></div>';

    $('#rAff').value = r.affichage;
    $('#rImpMode').value = r.imprimeMode || 'systeme';
    $('#rImpLarg').value = String(r.imprimeLargeur || 32);

    $('#rSaveBoutique').addEventListener('click', async () => {
      const nom = $('#rNom').value.trim();
      if (!nom) { toast('Le nom de la boutique est obligatoire', 'erreur'); return; }
      await App.sauverReglage('nomBoutique', nom);
      await App.sauverReglage('telBoutique', $('#rTel').value.trim());
      toast('Boutique enregistrée', 'ok');
    });

    $('#rSaveTaux').addEventListener('click', async () => {
      const t = lireNombre($('#rTaux').value);
      if (isNaN(t) || t < 1 || t > 100000) { toast('Taux invalide (exemple : 2800)', 'erreur'); return; }
      const ancienTaux = r.taux;
      await App.sauverReglage('taux', t);
      if (Number(ancienTaux) !== t) Audit.log('taux_modifie', { taux: [ancienTaux, t] });
      await App.sauverReglage('affichage', $('#rAff').value);
      toast('Taux enregistré : 1 $ = ' + formatCDF(t), 'ok');
      VueCaisse.panier = []; // les prix du panier dépendent du taux : on repart propre
    });

    $('#rSavePin').addEventListener('click', async () => {
      const p = $('#rPinP').value.trim(), v = $('#rPinV').value.trim();
      if (!p && !v) { toast('Rien à changer', 'erreur'); return; }
      if ((p && !/^\d{4}$/.test(p)) || (v && !/^\d{4}$/.test(v))) { toast('Un PIN doit avoir exactement 4 chiffres', 'erreur'); return; }
      const hp = p ? hacher(p) : r.pinPatron, hv = v ? hacher(v) : r.pinVendeur;
      if (hp === hv) { toast('Le PIN du patron et du vendeur doivent être différents', 'erreur'); return; }
      if (p) { await App.sauverReglage('pinPatron', hp); await App.sauverReglage('pinChange', true); }
      if (v) await App.sauverReglage('pinVendeur', hv);
      Audit.log('pin_modifie', { patron: !!p, vendeur: !!v });
      toast('PIN modifié(s)', 'ok'); App.rafraichir();
    });

    $('#rExport').addEventListener('click', async () => {
      const sauvegarde = await DB.exporterTout();
      await enregistrerFichier('aiva-caisse-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(sauvegarde), 'application/json');
      await App.sauverReglage('derniereSauvegarde', Date.now());
      Audit.log('sauvegarde', { chiffree: false });
      toast('Sauvegarde créée. Gardez le fichier en lieu sûr.', 'ok'); App.rafraichir();
    });
    $('#rExportChiffre').addEventListener('click', () => this.sauvegardeChiffree());
    $('#rImpSave').addEventListener('click', async () => {
      await App.sauverReglage('imprimeMode', $('#rImpMode').value);
      await App.sauverReglage('imprimeLargeur', Number($('#rImpLarg').value));
      toast('Imprimante enregistrée', 'ok');
    });
    $('#rImpTest').addEventListener('click', async () => {
      await App.sauverReglage('imprimeMode', $('#rImpMode').value);
      await App.sauverReglage('imprimeLargeur', Number($('#rImpLarg').value));
      Imprimante.imprimerTest();
    });
    $('#rImpOublier').addEventListener('click', () => { Imprimante.oublier(); toast('Au prochain ticket, choisissez votre imprimante'); });
    $('#rImport').addEventListener('click', () => $('#fichierImport').click());
    $('#fichierImport').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; this.restaurer(f); }); // value vidée : on peut rechoisir le même fichier
    $('#rCsvVentes').addEventListener('click', () => this.exporterCsvVentes());
    $('#rCsvStock').addEventListener('click', () => this.exporterCsvStock());
    $('#rDemo').addEventListener('click', () => this.chargerDemo());
    $('#rEffacer').addEventListener('click', () => this.toutEffacer());
    $('#rInstall').addEventListener('click', async () => {
      if (App.invitationInstall) { App.invitationInstall.prompt(); App.invitationInstall = null; }
      else toast('Dans Chrome : menu ⋮ puis « Ajouter à l\'écran d\'accueil »');
    });
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
      await enregistrerFichier('aiva-caisse-sauvegarde-protegee-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(fichier), 'application/json');
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
      if (!sauvegarde || sauvegarde.application !== 'AIVA Caisse') throw new Error('Ce fichier n\'est pas une sauvegarde AIVA Caisse');
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
      App.verrouiller(); // les PIN ont peut-être changé : on redemande le code
    } catch (e) {
      toast(e instanceof SyntaxError ? 'Fichier illisible' : e.message, 'erreur');
    }
  },

  async chargerDemo() {
    if (!(await confirmer('Données de démonstration', 'Cela remplace vos produits, ventes et clients actuels par un exemple de boutique. Vos PIN et réglages sont gardés. Continuer ?', 'Charger la démo'))) return;
    const params = await DB.tout('params');
    const demo = Demo.generer(App.taux(), params);
    demo.donnees.audit = await DB.tout('audit'); // le journal d'audit n'est jamais remplacé par la démo
    await DB.importerTout(demo);
    await Audit.log('demo_chargee', {});
    VueCaisse.panier = [];
    toast('Démonstration chargée', 'ok');
    App.aller('caisse');
  },

  async toutEffacer() {
    if (!(await confirmer('Tout effacer', 'Produits, ventes, clients et dettes seront supprimés pour toujours. Avez-vous fait une sauvegarde ?', 'Tout effacer', true))) return;
    if (!(await confirmer('Dernière question', 'Cette action est irréversible. Effacer vraiment ?', 'Oui, effacer', true))) return;
    await DB.toutEffacer(['params', 'audit']); // on garde les réglages, les PIN et le journal d'audit
    await Audit.log('donnees_effacees', {});
    VueCaisse.panier = [];
    toast('Toutes les données ont été effacées');
    App.aller('caisse');
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
    await enregistrerFichier('aiva-caisse-ventes.csv', this.csv(lignes), 'text/csv');
  },
  async exporterCsvStock() {
    const produits = (await DB.tout('produits')).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    const lignes = [['Produit', 'Catégorie', 'Code-barres', 'Devise', 'Prix achat', 'Prix vente', 'Stock', 'Seuil alerte']];
    produits.forEach((p) => lignes.push([p.nom, p.categorie, p.codeBarres, p.devise, p.prixAchat, p.prixVente, p.stock, p.seuil]));
    await enregistrerFichier('aiva-caisse-stock.csv', this.csv(lignes), 'text/csv');
  }
};
