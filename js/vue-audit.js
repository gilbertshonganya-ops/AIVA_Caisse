/* EvoBuskin - écran JOURNAL D'AUDIT (patron) */
const VueAudit = {
  nombre: 60, // nombre de lignes affichées (bouton "Voir plus")

  async afficher(conteneur) {
    const liste = (await DB.tout('audit')).sort((a, b) => b.id - a.id);
    const derniere = liste.length ? liste[0].hash : '';
    conteneur.innerHTML =
      App.htmlRetour() +
      '<div class="carte"><div class="ligne-flex"><div><div class="petit">Opérations enregistrées</div><div class="gras" style="font-size:1.2rem">' + liste.length + '</div></div>' +
      '<div class="droite"><div class="petit">Empreinte actuelle</div><div class="gras" style="font-family:monospace">' + esc(derniere ? derniere.slice(-8) : '-') + '</div></div></div>' +
      '<p class="petit" style="margin:10px 0 0">Chaque ligne est liée à la précédente. Notez l\'empreinte de temps en temps : si des lignes récentes disparaissaient, elle ne correspondrait plus.</p></div>' +
      '<div class="ligne-boutons" style="margin:0 0 12px"><button class="btn" id="aVerif">Vérifier le journal</button><button class="btn gris" id="aCsv">Exporter (CSV)</button></div>' +
      '<div id="aResultat"></div>' +
      (liste.length ? '<div class="liste">' + liste.slice(0, this.nombre).map((e) =>
        '<div class="ligne" style="cursor:default;align-items:flex-start"><div style="min-width:0"><div class="nom">' + esc(Audit.LIBELLES[e.action] || e.action) +
        (e.action === 'echec_connexion' ? ' <span class="badge rouge">!</span>' : '') + '</div>' +
        '<div class="sous">' + formatDateHeure(e.date) + ' &middot; ' + esc(e.acteur) + '</div>' +
        (Object.keys(e.detail || {}).length ? '<div class="sous" style="word-break:break-word">' + esc(Audit.resume(e)) + '</div>' : '') + '</div></div>').join('') + '</div>' +
        (liste.length > this.nombre ? '<button class="btn gris" id="aPlus">Voir plus</button>' : '')
        : '<div class="vide">Le journal est vide.</div>');

    $('#aVerif').addEventListener('click', async () => {
      const r = await Audit.verifier();
      const el = $('#aResultat');
      if (r.ok === true) el.innerHTML = '<div class="bandeau" style="background:#e1f3e8;color:#0b5a2e">Journal intact : ' + r.n + ' ligne(s) vérifiée(s), aucune modification détectée.</div>';
      else if (r.ok === false) el.innerHTML = '<div class="bandeau rouge"><b>Anomalie détectée</b> à la ligne n° ' + r.id + '. ' + esc(r.raison) + '</div>';
      else el.innerHTML = '<div class="bandeau">' + esc(r.raison) + '</div>';
    });
    $('#aCsv').addEventListener('click', async () => {
      const l = [['N°', 'Date', 'Heure', 'Acteur', 'Action', 'Détail', 'Empreinte']];
      [...liste].reverse().forEach((e) => l.push([e.id, formatDate(e.date), formatHeure(e.date), e.acteur, Audit.LIBELLES[e.action] || e.action, Audit.resume(e), e.hash.slice(-8)]));
      await enregistrerFichier('evobuskin-journal.csv', VueReglages.csv(l), 'text/csv');
    });
    const plus = $('#aPlus');
    if (plus) plus.addEventListener('click', () => { this.nombre += 60; this.afficher(conteneur); });
  }
};
