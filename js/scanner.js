/* AIVA Caisse - scan de code-barres par la caméra
   Utilise l'API native "BarcodeDetector" (Chrome Android récent). Si elle n'existe pas
   sur le téléphone, on propose la saisie manuelle du code.
   Les scanners USB/Bluetooth fonctionnent aussi : ils "tapent" le code dans le champ de recherche. */
const Scanner = (() => {
  const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];

  function cameraDisponible() {
    return 'BarcodeDetector' in window && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  // Ouvre le scanner. Retourne une promesse : le code lu (texte) ou null si annulé.
  function scanner() {
    return new Promise((resolve) => {
      let flux = null, actif = true, resultat = null, minuteur = null;

      const arreter = () => {
        actif = false;
        clearTimeout(minuteur);
        if (flux) flux.getTracks().forEach((t) => t.stop());
      };

      const fenetre = ouvrirFenetre('Scanner un code-barres',
        (cameraDisponible()
          ? '<div class="scan-zone"><video id="scanVideo" playsinline muted></video><div class="scan-cadre"></div></div>' +
            '<p id="scanEtat" class="texte-centre petit">Placez le code-barres devant la caméra.</p>'
          : '<p class="texte-centre petit">Le scan par caméra n\'est pas disponible sur ce téléphone. Saisissez le code à la main.</p>') +
        '<label class="champ"><span>Ou saisissez le code</span>' +
        '<input id="scanManuel" type="text" inputmode="numeric" autocomplete="off" placeholder="Ex : 6001234567890"></label>' +
        '<button class="btn" id="scanValider">Valider le code</button>',
        { auFermer: () => { arreter(); resolve(resultat); }, verrouille: true });

      const terminer = (code) => { resultat = code; fenetre.fermer(); };

      $('#scanValider', fenetre.el).addEventListener('click', () => {
        const code = $('#scanManuel', fenetre.el).value.trim();
        if (!code) { toast('Saisissez un code', 'erreur'); return; }
        terminer(code);
      });
      $('#scanManuel', fenetre.el).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('#scanValider', fenetre.el).click();
      });

      if (!cameraDisponible()) return;

      const video = $('#scanVideo', fenetre.el);
      const etat = $('#scanEtat', fenetre.el);
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        .then(async (f) => {
          if (!actif) { f.getTracks().forEach((t) => t.stop()); return; }
          flux = f;
          video.srcObject = f;
          await video.play().catch(() => {});
          let detecteur;
          try { detecteur = new BarcodeDetector({ formats: FORMATS }); } catch (e) { detecteur = new BarcodeDetector(); }
          const boucle = async () => {
            if (!actif) return;
            try {
              const codes = await detecteur.detect(video);
              if (codes.length && codes[0].rawValue) { terminer(codes[0].rawValue); return; }
            } catch (e) { /* image pas encore prête : on réessaie */ }
            minuteur = setTimeout(boucle, 250);
          };
          boucle();
        })
        .catch(() => {
          if (etat) etat.textContent = 'Caméra refusée ou indisponible. Autorisez la caméra ou saisissez le code.';
        });
    });
  }

  return { scanner, cameraDisponible };
})();
