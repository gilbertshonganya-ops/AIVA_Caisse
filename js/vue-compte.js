/* EvoBuskin - écran MON COMPTE (patron et vendeur) : informations et changement de mot de passe.
   Le changement est noté dans le journal d'activité du patron (qui, quand). */
const VueCompte = {
  async afficher(conteneur, integre) {
    const session = Auth.getSession();
    const email = session?.user?.email || App.utilisateurLocal?.email || '';
    const nom = App.nomComplet || (App.estPatron() ? 'Patron' : 'Vendeur');
    conteneur.innerHTML = (integre ? '' : '<h2>Réglages</h2>') +
      '<div class="carte"><h3>Mon compte</h3><div class="ligne-flex"><span class="petit">Nom</span><b>' + esc(nom) + '</b></div>' +
      '<div class="ligne-flex"><span class="petit">Adresse email</span><b>' + esc(email) + '</b></div>' +
      '<div class="ligne-flex"><span class="petit">Rôle</span><b>' + (App.estPatron() ? 'Patron' : 'Vendeur') + '</b></div></div>' +
      '<div class="carte"><h3>Changer mon mot de passe</h3>' +
      '<p class="petit">Il vous servira à vous connecter, avec Internet comme sans Internet.' + (App.estPatron() ? '' : ' Votre patron verra ce changement dans son journal d’activité.') + '</p>' +
      '<label class="champ"><span>Mot de passe actuel</span><input id="mcAncien" type="password" autocomplete="current-password"></label>' +
      '<label class="champ"><span>Nouveau mot de passe</span><input id="mcNouveau" type="password" autocomplete="new-password"></label>' +
      '<label class="champ"><span>Confirmer le nouveau mot de passe</span><input id="mcConfirm" type="password" autocomplete="new-password"></label>' +
      '<p class="petit">12 caractères minimum, avec majuscule, minuscule, chiffre et caractère spécial.</p>' +
      '<div class="bandeau rouge" id="mcErreur" hidden></div>' +
      '<button class="btn" id="mcOk">Changer mon mot de passe</button></div>' +
      (this.sectionSuppression ? await this.sectionSuppression() : '');
    this.brancherSuppression(conteneur, email, integre);
    const erreur = (m) => { const e = $('#mcErreur'); e.textContent = m; e.hidden = !m; };
    $('#mcOk').addEventListener('click', async () => {
      erreur('');
      const ancien = $('#mcAncien').value, nouveau = $('#mcNouveau').value, confirm = $('#mcConfirm').value;
      if (AuthHorsLigne.attente('mdp') > 0) return erreur('Trop de tentatives. Patientez ' + AuthHorsLigne.attente('mdp') + ' secondes avant de réessayer.');
      if (!ancien) return erreur('Tapez votre mot de passe actuel.');
      if (!AuthUI.validPassword(nouveau)) return erreur(AuthUI.MESSAGE_MDP);
      if (nouveau !== confirm) return erreur('Les deux nouveaux mots de passe ne sont pas identiques.');
      if (nouveau === ancien) return erreur('Le nouveau mot de passe doit être différent de l’ancien.');
      if (!navigator.onLine) return erreur(Reseau.MESSAGE);
      if (!email) return erreur('Compte introuvable. Reconnectez-vous.');
      const bouton = $('#mcOk'); bouton.disabled = true;
      try {
        const data = await Auth.changerMotDePasse(email, ancien, nouveau);
        await AuthHorsLigne.mettreAJourMotDePasse(email, nouveau, data.user);
        AuthHorsLigne.effacerEssais('mdp');
        await Audit.log('mot_de_passe_modifie', {});
        $('#mcAncien').value = $('#mcNouveau').value = $('#mcConfirm').value = '';
        toast('Mot de passe modifié', 'ok');
      } catch (e) {
        if (/invalid login credentials/i.test(String(e.message))) {
          AuthHorsLigne.compterEchec('mdp');
          Audit.log('mot_de_passe_incorrect', { texte: 'Mot de passe actuel incorrect lors d’un changement de mot de passe' });
          erreur('Le mot de passe actuel est incorrect.');
        } else erreur(Reseau.traduire(e));
      } finally { bouton.disabled = false; }
    });
  },

  // ----- Suppression du compte : effacement définitif 30 jours après la demande -----
  async sectionSuppression() {
    let quand = null;
    try { if (navigator.onLine && Auth.getSession()) quand = await CloudDB.rpc('v19_account_deletion_status', {}); App.suppressionPrevue = quand || null; } catch (_) {}
    this.quand = quand;
    if (quand) {
      return '<div class="carte danger"><h3>Suppression de votre compte prévue</h3>' +
        '<p>Votre compte et vos données seront effacés définitivement le <b>' + esc(formatDate(new Date(quand).getTime())) + '</b>.</p>' +
        '<p class="petit">D\'ici là, vous pouvez changer d\'avis : le compte reste intact.</p>' +
        '<button class="btn" id="scAnnuler">Annuler la suppression</button></div>';
    }
    return '<div class="carte danger"><h3>Supprimer mon compte</h3>' +
      (App.estPatron()
        ? '<p class="petit">Toutes vos boutiques et leurs données (produits, ventes, clients, dettes, journal) seront effacées définitivement après <b>30 jours</b>. Vos vendeurs perdront l\'accès. Pensez à faire une sauvegarde avant.</p>'
        : '<p class="petit">Votre compte sera effacé définitivement après <b>30 jours</b>. Les ventes que vous avez faites restent dans la boutique de votre patron, sans votre identité.</p>') +
      '<p class="petit">Pendant ces 30 jours, vous pouvez annuler.</p>' +
      '<button class="btn rouge" id="scDemander">Supprimer mon compte</button></div>';
  },

  brancherSuppression(conteneur, email, integre) {
    const annuler = $('#scAnnuler', conteneur), demander = $('#scDemander', conteneur);
    if (annuler) annuler.addEventListener('click', async () => {
      try {
        if (!navigator.onLine) throw Reseau.erreur();
        await CloudDB.rpc('v19_cancel_account_deletion', {});
        App.suppressionPrevue = null; toast('Suppression annulée : votre compte est conservé', 'ok');
        this.afficher(conteneur, integre);
      } catch (e) { toast(Reseau.traduire(e), 'erreur'); }
    });
    if (demander) demander.addEventListener('click', () => {
      if (!navigator.onLine) { toast(Reseau.MESSAGE, 'erreur'); return; }
      const f = ouvrirFenetre('Supprimer mon compte',
        '<p class="petit">Cette action effacera votre compte définitivement dans 30 jours. Pour confirmer, tapez votre mot de passe puis le mot SUPPRIMER.</p>' +
        '<label class="champ"><span>Mot de passe</span><input id="sdMdp" type="password" autocomplete="current-password"></label>' +
        '<label class="champ"><span>Tapez SUPPRIMER</span><input id="sdMot" autocomplete="off" autocapitalize="characters"></label>' +
        '<div class="bandeau rouge" id="sdErr" hidden></div><button class="btn rouge" id="sdOk">Demander la suppression</button>');
      const err = (m) => { const e = $('#sdErr', f.el); e.textContent = m; e.hidden = !m; };
      $('#sdOk', f.el).addEventListener('click', async () => {
        err('');
        if ($('#sdMot', f.el).value.trim().toUpperCase() !== 'SUPPRIMER') return err('Tapez le mot SUPPRIMER pour confirmer.');
        if (!$('#sdMdp', f.el).value) return err('Tapez votre mot de passe.');
        if (AuthHorsLigne.attente('suppr') > 0) return err('Trop de tentatives. Patientez ' + AuthHorsLigne.attente('suppr') + ' secondes.');
        try {
          await Auth.signIn(email, $('#sdMdp', f.el).value);   // vérifie le mot de passe
          const quand = await CloudDB.rpc('v19_request_account_deletion', {});
          App.suppressionPrevue = quand; AuthHorsLigne.effacerEssais('suppr');
          Audit.log('compte_suppression_demandee', {});
          f.fermer(); toast('Suppression programmée. Vous pouvez l\'annuler pendant 30 jours.', 'ok');
          this.afficher(conteneur, integre);
        } catch (e) {
          if (/invalid login credentials/i.test(String(e.message))) { AuthHorsLigne.compterEchec('suppr'); err('Mot de passe incorrect.'); }
          else err(Reseau.traduire(e));
        }
      });
    });
  }
};
