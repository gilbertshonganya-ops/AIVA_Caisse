/* EvoBuskin V10 — façade de monitoring.
 * Le client ne décide jamais si une alerte est valide : PostgreSQL/RLS décide.
 */
const SecurityMonitor = (() => {
  async function getOpenAlerts(businessId) {
    if (!window.CloudDB?.listerAlertesSecurite) throw new Error('Le suivi de sécurité n’est pas disponible.');
    return window.CloudDB.listerAlertesSecurite(businessId, 'open');
  }

  async function acknowledge(businessId, alertId) {
    return window.CloudDB.resoudreAlerteSecurite({
      p_business_id: businessId,
      p_alert_id: Number(alertId),
      p_status: 'acknowledged'
    });
  }

  async function resolve(businessId, alertId) {
    return window.CloudDB.resoudreAlerteSecurite({
      p_business_id: businessId,
      p_alert_id: Number(alertId),
      p_status: 'resolved'
    });
  }

  return Object.freeze({ getOpenAlerts, acknowledge, resolve });
})();
window.SecurityMonitor = SecurityMonitor;
