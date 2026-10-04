/* AIVA Caisse - impression de tickets thermiques
   Trois méthodes (choisies dans Réglages > Imprimante) :
   1) Bluetooth direct (Web Bluetooth) : imprimantes ESC/POS 58 mm ou 80 mm en Bluetooth LOW ENERGY (BLE),
      dans Chrome Android sur une adresse HTTPS. Ne marche PAS avec les imprimantes Bluetooth "classiques" (SPP),
      ni sur iPhone, ni dans l'APK Capacitor (il faudra alors un plugin Bluetooth).
   2) Impression système : ouvre la fenêtre d'impression du téléphone (imprimante installée, ou "Enregistrer en PDF").
   3) Application RawBT (gratuite, Android) : elle sait parler aux imprimantes Bluetooth "classiques" (SPP), les plus courantes.
      AIVA Caisse lui envoie le ticket ; RawBT l'imprime. (Non testé ici : à vérifier avec votre imprimante.) */
const Imprimante = (() => {
  // Services Bluetooth utilisés par la plupart des imprimantes thermiques bon marché
  const SERVICES = [
    '000018f0-0000-1000-8000-00805f9b34fb',
    '0000ff00-0000-1000-8000-00805f9b34fb',
    '0000ffe0-0000-1000-8000-00805f9b34fb',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2'
  ];
  // Lettres accentuées en page de code CP858 (ESC t 19)
  const CP858 = { 'é': 0x82, 'è': 0x8A, 'ê': 0x88, 'ë': 0x89, 'à': 0x85, 'â': 0x83, 'ä': 0x84, 'ç': 0x87, 'ô': 0x93, 'ö': 0x94, 'î': 0x8C, 'ï': 0x8B, 'û': 0x96, 'ù': 0x97, 'ü': 0x81, 'É': 0x90, 'È': 0xD4, 'Ê': 0xD2, 'À': 0xB7, 'Â': 0xB6, 'Ç': 0x80, 'Ô': 0xE2, 'Î': 0xD7, 'Ï': 0xD8, 'Û': 0xEA, 'Ù': 0xEB };

  let appareil = null, caracteristique = null;

  const disponible = () => !!navigator.bluetooth;

  // ---------- Contenu du ticket (commun aux deux méthodes) ----------
  function simplifier(s) {
    return String(s == null ? '' : s).replace(/[\u202F\u00A0\u2009]/g, ' ').replace(/[\u2018\u2019]/g, "'").replace(/\u2026/g, '...').replace(/\s+/g, ' ');
  }
  function lignesTicket(vente, client, cols) {
    const L = [];
    const sep = '-'.repeat(cols);
    const deux = (g, d) => {
      g = simplifier(g); d = simplifier(d);
      if (g.length + d.length + 1 > cols) g = g.slice(0, Math.max(0, cols - d.length - 1));
      return g + ' '.repeat(Math.max(1, cols - g.length - d.length)) + d;
    };
    const t = vente.taux || App.taux();
    L.push({ t: simplifier(App.reglages.nomBoutique || 'AIVA Caisse'), a: 'c', g: true, gr: true });
    if (App.reglages.telBoutique) L.push({ t: 'Tel : ' + App.reglages.telBoutique, a: 'c' });
    L.push({ t: 'Reçu n° ' + vente.id, a: 'c' });
    L.push({ t: formatDateHeure(vente.date), a: 'c' });
    L.push({ t: sep });
    vente.lignes.forEach((l) => {
      decoupeMots(simplifier(l.nom), cols).forEach((m) => L.push({ t: m }));
      L.push({ t: deux('  ' + formatQuantite(l.qte) + ' x ' + formatUSD(l.prixUnitaireUSD), formatUSD(l.qte * l.prixUnitaireUSD)) });
    });
    L.push({ t: sep });
    L.push({ t: deux('TOTAL', formatUSD(vente.totalUSD)), g: true });
    L.push({ t: deux('', formatCDF(vente.totalUSD * t)) });
    L.push({ t: deux('Paiement', LIBELLES_MODE[vente.mode] || vente.mode) });
    if (vente.reference) L.push({ t: 'Réf : ' + vente.reference });
    if (vente.payeUSD > 0.0001) L.push({ t: deux('Payé', formatUSD(vente.payeUSD)) });
    if (vente.resteUSD > 0.0001) L.push({ t: deux('RESTE A PAYER', formatUSD(vente.resteUSD)), g: true });
    if (client) L.push({ t: 'Client : ' + simplifier(client.nom) });
    L.push({ t: sep });
    L.push({ t: 'Merci de votre confiance !', a: 'c' });
    return L;
  }
  function decoupeMots(s, max) {
    const res = []; let cour = '';
    s.split(' ').forEach((m) => {
      while (m.length > max) { if (cour) { res.push(cour); cour = ''; } res.push(m.slice(0, max)); m = m.slice(max); }
      const essai = cour ? cour + ' ' + m : m;
      if (cour && essai.length > max) { res.push(cour); cour = m; } else cour = essai;
    });
    if (cour) res.push(cour);
    return res.length ? res : [''];
  }

  // ---------- Commandes ESC/POS ----------
  function encoder(s, accents) {
    const sortie = [];
    for (const c of simplifier(s)) {
      const code = c.charCodeAt(0);
      if (code < 128) { sortie.push(code); continue; }
      if (c === '\u00B0') { sortie.push(accents ? 0xF8 : 0x6F); continue; } // ° (n° devient no)
      if (accents && CP858[c]) { sortie.push(CP858[c]); continue; }
      const base = c.normalize('NFD')[0];
      sortie.push(base && base.charCodeAt(0) < 128 ? base.charCodeAt(0) : 63);
    }
    return sortie;
  }
  function versEscPos(lignes, accents) {
    const o = [0x1B, 0x40];                         // initialiser
    if (accents) o.push(0x1B, 0x74, 19);             // page de code CP858
    lignes.forEach((l) => {
      o.push(0x1B, 0x61, l.a === 'c' ? 1 : 0);       // alignement
      o.push(0x1B, 0x45, l.g ? 1 : 0);               // gras
      o.push(0x1D, 0x21, l.gr ? 0x11 : 0);           // double taille
      o.push(...encoder(l.t, accents), 0x0A);
    });
    o.push(0x1B, 0x45, 0, 0x1D, 0x21, 0, 0x1B, 0x61, 0);
    o.push(0x0A, 0x0A, 0x0A, 0x0A);                 // avancer le papier
    o.push(0x1D, 0x56, 0x42, 0x00);                 // couper (ignoré si pas de coupe-papier)
    return new Uint8Array(o);
  }

  // ---------- Bluetooth direct ----------
  async function connecter(forcer) {
    if (!disponible()) throw new Error('Le Bluetooth direct n\'est pas disponible ici (utilisez Chrome sur Android, en HTTPS)');
    if (!forcer && appareil && appareil.gatt.connected && caracteristique) return;
    if (!appareil || forcer) {
      appareil = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
      appareil.addEventListener('gattserverdisconnected', () => { caracteristique = null; });
    }
    const serveur = await appareil.gatt.connect();
    const services = await serveur.getPrimaryServices();
    caracteristique = null;
    for (const s of services) {
      const cars = await s.getCharacteristics();
      const bonne = cars.find((c) => c.properties.writeWithoutResponse || c.properties.write);
      if (bonne) { caracteristique = bonne; break; }
    }
    if (!caracteristique) throw new Error('Cette imprimante n\'accepte pas l\'impression directe. Essayez l\'impression système.');
  }
  async function envoyer(octets) {
    const c = caracteristique;
    const sansReponse = c.properties.writeWithoutResponse;
    const taille = 100;
    for (let i = 0; i < octets.length; i += taille) {
      const morceau = octets.slice(i, i + taille);
      if (sansReponse && c.writeValueWithoutResponse) await c.writeValueWithoutResponse(morceau);
      else if (c.writeValueWithResponse) await c.writeValueWithResponse(morceau);
      else await c.writeValue(morceau);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  async function imprimerBluetooth(lignes) {
    await connecter(false);
    try { await envoyer(versEscPos(lignes, !!App.reglages.accentsTicket)); }
    catch (e) { caracteristique = null; await connecter(false); await envoyer(versEscPos(lignes, !!App.reglages.accentsTicket)); }
  }

  // ---------- Impression système ----------
  function imprimerSysteme(lignes, cols) {
    const largeurMm = cols >= 48 ? 80 : 58;
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket</title><style>' +
      '@page{size:' + largeurMm + 'mm auto;margin:2mm}body{margin:0;font-family:"Courier New",monospace;font-size:12px;width:' + (largeurMm - 4) + 'mm}' +
      'pre{margin:0;white-space:pre-wrap;font-family:inherit}.c{text-align:center}.g{font-weight:bold}.gr{font-size:17px}</style></head><body>' +
      lignes.map((l) => '<pre class="' + (l.a === 'c' ? 'c ' : '') + (l.g ? 'g ' : '') + (l.gr ? 'gr' : '') + '">' + esc(l.t) + '</pre>').join('') +
      '</body></html>';
    const cadre = document.createElement('iframe');
    cadre.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(cadre);
    cadre.contentDocument.open(); cadre.contentDocument.write(html); cadre.contentDocument.close();
    setTimeout(() => {
      try { cadre.contentWindow.focus(); cadre.contentWindow.print(); } catch (e) { toast('Impression impossible', 'erreur'); }
      setTimeout(() => cadre.remove(), 60000);
    }, 300);
  }

  // ---------- Point d'entrée ----------
  async function imprimerLignes(lignes) {
    const mode = App.reglages.imprimeMode || 'systeme';
    const cols = Number(App.reglages.imprimeLargeur) || 32;
    if (mode === 'rawbt') { imprimerRawBT(lignes); return; }
    if (mode === 'ble') {
      try { await imprimerBluetooth(lignes); toast('Ticket envoyé à l\'imprimante', 'ok'); return; }
      catch (e) {
        if (e && e.name === 'NotFoundError') return; // l'utilisateur a fermé la fenêtre de choix
        toast(e.message || 'Impression Bluetooth impossible', 'erreur');
      }
      return;
    }
    imprimerSysteme(lignes, cols);
  }
  const imprimerVente = (vente, client) => imprimerLignes(lignesTicket(vente, client, Number(App.reglages.imprimeLargeur) || 32));

  function ticketTest() {
    const cols = Number(App.reglages.imprimeLargeur) || 32;
    return [
      { t: simplifier(App.reglages.nomBoutique || 'AIVA Caisse'), a: 'c', g: true, gr: true },
      { t: 'TEST D\'IMPRESSION', a: 'c', g: true },
      { t: '-'.repeat(cols) },
      { t: 'Accents : é è à ç ô ù' },
      { t: 'Largeur : ' + cols + ' caractères' },
      { t: '1234567890'.repeat(5).slice(0, cols) },
      { t: '-'.repeat(cols) },
      { t: 'Si ce ticket est lisible,', a: 'c' },
      { t: 'l\'imprimante est prête.', a: 'c' }
    ];
  }


  // ---------- Application RawBT (Bluetooth classique) ----------
  function imprimerRawBT(lignes) {
    const octets = versEscPos(lignes, false);
    let binaire = '';
    octets.forEach((o) => { binaire += String.fromCharCode(o); });
    // Lien "intent" Android : ouvre RawBT qui imprime les octets reçus
    window.location.href = 'intent:base64,' + btoa(binaire) + '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;';
  }

  const imprimerTest = () => imprimerLignes(ticketTest());
  // Oublie l'imprimante Bluetooth mémorisée : le prochain ticket redemandera de choisir
  function oublier() {
    try { if (appareil && appareil.gatt && appareil.gatt.connected) appareil.gatt.disconnect(); } catch (e) { /* rien */ }
    appareil = null; caracteristique = null;
  }

  return { disponible, connecter, imprimerLignes, imprimerVente, imprimerTest, oublier, ticketTest, lignesTicket, versEscPos };
})();
