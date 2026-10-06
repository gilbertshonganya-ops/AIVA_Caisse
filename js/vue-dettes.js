/* EvoBuskin - écran DETTES : carnet de dettes clients, paiements, rappel WhatsApp */
const VueDettes = {
  recherche: '',
  clients: [],
  mouvements: [],

  // Solde = somme des dettes - somme des paiements
  solde(idClient) {
    return arrondi(this.mouvements.filter((m) => m.clientId === idClient)
      .reduce((s, m) => s + (m.type === 'dette' ? m.montantUSD : -m.montantUSD), 0), 6);
  },

  async afficher(conteneur) {
    this.clients = await DB.tout('clients');
    this.mouvements = await DB.tout('dettes');
    const soldes = this.clients.map((c) => ({ c, solde: this.solde(c.id) }));
    const totalDu = soldes.reduce((s, x) => s + Math.max(0, x.solde), 0);
    const nbDebiteurs = soldes.filter((x) => x.solde > 0.005).length;

    conteneur.innerHTML =
      '<div class="carte ' + (totalDu > 0 ? 'danger' : '') + '"><div class="petit">Total que les clients vous doivent</div>' +
      '<div style="font-size:1.3rem">' + App.montantHtml(totalDu) + '</div><div class="petit">' + nbDebiteurs + ' client(s) avec une dette</div></div>' +
      '<div class="recherche"><input id="rechClient" type="search" placeholder="Chercher un client" autocomplete="off" value="' + esc(this.recherche) + '">' +
      '<button class="btn" id="btnClient" aria-label="Nouveau client">+</button></div>' +
      '<div id="listeClients"></div>';
    $('#rechClient').addEventListener('input', (e) => { this.recherche = e.target.value; this.dessinerListe(); });
    $('#btnClient').addEventListener('click', () => this.formulaireClient(null));
    this.dessinerListe();
  },

  dessinerListe() {
    const mots = this.recherche.trim().toLowerCase();
    const liste = this.clients
      .map((c) => ({ c, solde: this.solde(c.id) }))
      .filter((x) => !mots || x.c.nom.toLowerCase().includes(mots) || (x.c.tel || '').includes(mots))
      .sort((a, b) => b.solde - a.solde || a.c.nom.localeCompare(b.c.nom, 'fr'));
    const el = $('#listeClients');
    if (!liste.length) { el.innerHTML = '<div class="vide">' + (this.clients.length ? 'Aucun client trouvé.' : 'Aucun client. Touchez + pour en ajouter un.') + '</div>'; return; }
    el.innerHTML = '<div class="liste">' + liste.map((x) => {
      const derniere = this.mouvements.filter((m) => m.clientId === x.c.id).reduce((mx, m) => Math.max(mx, m.date), 0);
      return '<div class="ligne" data-id="' + x.c.id + '"><div><div class="nom">' + esc(x.c.nom) + '</div>' +
        '<div class="sous">' + esc(x.c.tel || 'Pas de téléphone') + (derniere ? ' &middot; dernier mouvement le ' + formatDate(derniere) : '') + '</div></div>' +
        '<div class="droite">' + (x.solde > 0.005 ? '<span class="rouge-txt gras">' + formatUSD(x.solde) + '</span>' : '<span class="badge">À jour</span>') + '</div></div>';
    }).join('') + '</div>';
    $$('.ligne', el).forEach((l) => l.addEventListener('click', () => this.detail(Number(l.dataset.id))));
  },

  // Refuse un client qui ressemble à un autre : même nom OU même numéro de téléphone.
  // Retourne un message d'erreur, ou null si tout va bien. "idExclu" : le client en cours de modification.
  verifierClient(nom, tel, clients, idExclu) {
    const n = normaliserNom(nom), t = normaliserTel(tel);
    for (const c of clients) {
      if (c.id === idExclu) continue;
      if (n && normaliserNom(c.nom) === n) {
        return 'Un client s\'appelle déjà « ' + c.nom + ' ». Deux personnes ne peuvent pas avoir le même nom : ajoutez une différence (prénom, quartier, surnom...).';
      }
      if (t && c.tel && normaliserTel(c.tel) === t) {
        return 'Ce numéro est déjà utilisé par « ' + c.nom + ' ». Chaque personne doit avoir son propre numéro.';
      }
    }
    return null;
  },

  formulaireClient(client) {
    const f = ouvrirFenetre(client ? 'Modifier le client' : 'Nouveau client',
      '<label class="champ"><span>Nom *</span><input id="cNom" autocomplete="off" value="' + esc(client ? client.nom : '') + '"></label>' +
      '<label class="champ"><span>Téléphone WhatsApp</span><input id="cTel" inputmode="tel" autocomplete="off" placeholder="Ex : 0895006995" value="' + esc(client ? client.tel : '') + '"></label>' +
      '<div class="bandeau rouge" id="cErreur" hidden></div>' +
      '<button class="btn" id="cOk">Enregistrer</button>');
    const montrerErreur = (m) => { const e = $('#cErreur', f.el); e.textContent = m; e.hidden = false; toast('Client non enregistré', 'erreur'); };
    $('#cOk', f.el).addEventListener('click', async () => {
      const nom = $('#cNom', f.el).value.trim();
      const tel = $('#cTel', f.el).value.trim();
      if (!nom) { toast('Le nom est obligatoire', 'erreur'); return; }
      if (tel && normaliserTel(tel).length < 11) { montrerErreur('Numéro de téléphone trop court.'); return; }
      const doublon = this.verifierClient(nom, tel, await DB.tout('clients'), client ? client.id : null);
      if (doublon) { montrerErreur(doublon); return; }
      await DB.ecrire('clients', Object.assign({}, client || {}, { nom, tel }));
      f.fermer(); toast('Client enregistré', 'ok'); App.rafraichir();
    });
  },

  async detail(idClient) {
    this.mouvements = await DB.tout('dettes');
    const client = await DB.lire('clients', idClient);
    if (!client) return;
    const solde = this.solde(idClient);
    const histo = this.mouvements.filter((m) => m.clientId === idClient).sort((a, b) => b.date - a.date);
    const f = ouvrirFenetre(client.nom,
      '<div class="carte ' + (solde > 0.005 ? 'danger' : '') + '" style="margin-bottom:10px"><div class="petit">Reste à payer</div><div style="font-size:1.3rem">' + App.montantHtml(Math.max(0, solde)) + '</div>' +
      '<div class="petit">' + esc(client.tel || 'Pas de téléphone') + '</div></div>' +
      '<div class="pile">' +
        (solde > 0.005 ? '<button class="btn" id="dPaie">Enregistrer un paiement</button>' : '') +
        (solde > 0.005 ? '<button class="btn contour" id="dRappel">Envoyer un rappel WhatsApp</button>' : '') +
        '<button class="btn gris" id="dDette">Ajouter une dette (ancien cahier)</button>' +
        '<div class="ligne-boutons"><button class="btn gris" id="dModif">Modifier</button>' +
        (App.estPatron() ? '<button class="btn rouge" id="dSuppr">Supprimer</button>' : '') + '</div>' +
      '</div>' +
      '<h3 style="margin:16px 0 6px">Historique</h3>' +
      (histo.length ? '<div class="liste">' + histo.map((m) =>
        '<div class="ligne" style="cursor:default"><div><div class="nom">' + (m.type === 'dette' ? 'Dette' : 'Paiement' + (m.mode ? ' (' + (LIBELLES_MODE[m.mode] || m.mode) + ')' : '')) + '</div>' +
        '<div class="sous">' + formatDateHeure(m.date) + (m.note ? ' &middot; ' + esc(m.note) : '') + '</div></div>' +
        '<div class="gras ' + (m.type === 'dette' ? 'rouge-txt' : 'vert-txt') + '">' + (m.type === 'dette' ? '+' : '-') + formatUSD(m.montantUSD) + '</div></div>').join('') + '</div>'
        : '<p class="petit">Aucun mouvement.</p>'));

    const paie = $('#dPaie', f.el);
    if (paie) paie.addEventListener('click', () => { f.fermer(); this.formulairePaiement(client, solde); });
    const rappel = $('#dRappel', f.el);
    if (rappel) rappel.addEventListener('click', () => {
      const msg = 'Bonjour ' + client.nom + ', ici ' + (App.reglages.nomBoutique || 'la boutique') + '. Petit rappel : vous avez une dette de ' +
        formatUSD(solde) + ' (' + formatCDF(solde * App.taux()) + '). Merci de passer la régler dès que possible. Merci beaucoup !';
      ouvrirLien(lienWhatsApp(client.tel, msg));
    });
    $('#dDette', f.el).addEventListener('click', () => { f.fermer(); this.formulaireDette(client); });
    $('#dModif', f.el).addEventListener('click', () => { f.fermer(); this.formulaireClient(client); });
    const suppr = $('#dSuppr', f.el);
    if (suppr) suppr.addEventListener('click', async () => {
      const msg = solde > 0.005 ? client.nom + ' doit encore ' + formatUSD(solde) + '. Supprimer quand même efface aussi son historique.' : 'Supprimer ce client et son historique ?';
      if (await confirmer('Supprimer le client', msg, 'Supprimer', true)) {
        for (const m of histo) await DB.supprimer('dettes', m.id);
        await DB.supprimer('clients', client.id);
        Audit.log('client_supprime', { nom: client.nom, soldeUSD: arrondi(solde, 2) });
        f.fermer(); toast('Client supprimé'); App.rafraichir();
      }
    });
  },

  // Montant + devise, partagé entre « paiement » et « nouvelle dette »
  champsMontant() {
    return '<div class="segment" id="devises"><button data-dev="USD" class="actif">Dollars ($)</button><button data-dev="CDF">Francs (FC)</button></div>' +
      '<label class="champ"><span>Montant</span><input id="mMontant" inputmode="decimal" autocomplete="off"></label>';
  },
  brancherDevises(el) {
    const etat = { devise: 'USD' };
    $$('#devises button', el).forEach((b) => b.addEventListener('click', () => {
      etat.devise = b.dataset.dev;
      $$('#devises button', el).forEach((x) => x.classList.toggle('actif', x === b));
    }));
    return etat;
  },

  formulairePaiement(client, solde) {
    const f = ouvrirFenetre('Paiement de ' + client.nom,
      '<p class="petit">Reste à payer : <b>' + formatUSD(solde) + '</b> (' + formatCDF(solde * App.taux()) + ')</p>' +
      this.champsMontant() +
      '<label class="champ"><span>Moyen de paiement</span><select id="mMode"><option value="especes">Espèces</option><option value="mpesa">M-Pesa</option><option value="airtel">Airtel Money</option><option value="orange">Orange Money</option></select></label>' +
      '<label class="champ"><span>Note ou référence (facultatif)</span><input id="mNote" autocomplete="off"></label>' +
      '<button class="btn" id="mOk">Enregistrer le paiement</button>');
    const etat = this.brancherDevises(f.el);
    $('#mMontant', f.el).value = String(arrondi(solde, 2));
    $('#mOk', f.el).addEventListener('click', async () => {
      const v = lireNombre($('#mMontant', f.el).value);
      if (isNaN(v) || v <= 0) { toast('Entrez un montant supérieur à 0', 'erreur'); return; }
      const usd = arrondi(versUSD(v, etat.devise, App.taux()), 6);
      if (usd > solde + 0.01) { toast('Le montant dépasse la dette (' + formatUSD(solde) + ')', 'erreur'); return; }
      await DB.ajouter('dettes', {
        clientId: client.id, date: Date.now(), type: 'paiement', montantUSD: Math.min(usd, solde),
        mode: $('#mMode', f.el).value, devise: etat.devise, note: $('#mNote', f.el).value.trim()
      });
      Audit.log('paiement_dette', { client: client.nom, montant: arrondi(Math.min(usd, solde), 2) + ' USD' });
      f.fermer(); toast('Paiement enregistré', 'ok'); App.rafraichir();
    });
  },

  formulaireDette(client) {
    const f = ouvrirFenetre('Nouvelle dette : ' + client.nom,
      this.champsMontant() +
      '<label class="champ"><span>Note (facultatif)</span><input id="mNote" autocomplete="off" placeholder="Ex : ancien cahier, marchandises du 12"></label>' +
      '<button class="btn" id="mOk">Enregistrer la dette</button>');
    const etat = this.brancherDevises(f.el);
    $('#mOk', f.el).addEventListener('click', async () => {
      const v = lireNombre($('#mMontant', f.el).value);
      if (isNaN(v) || v <= 0) { toast('Entrez un montant supérieur à 0', 'erreur'); return; }
      await DB.ajouter('dettes', {
        clientId: client.id, date: Date.now(), type: 'dette', montantUSD: arrondi(versUSD(v, etat.devise, App.taux()), 6),
        devise: etat.devise, note: $('#mNote', f.el).value.trim()
      });
      Audit.log('dette_ajoutee', { client: client.nom, montant: arrondi(versUSD(v, etat.devise, App.taux()), 2) + ' USD' });
      f.fermer(); toast('Dette enregistrée', 'ok'); App.rafraichir();
    });
  }
};
