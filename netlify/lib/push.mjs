// Envío de notificaciones push (Web Push). Las llaves VAPID se crean solas la primera vez y se guardan en Netlify Blobs.
import webpush from "web-push";

const SUBJECT = "mailto:fichamigo@example.com";
let ready = null;

export async function vapid(store) {
  if (ready) return ready;
  let k = await store.get("vapid", { type: "json" });
  if (!k) {
    const gen = webpush.generateVAPIDKeys();
    await store.setJSON("vapid", gen, { onlyIfNew: true });
    k = await store.get("vapid", { type: "json" });
  }
  webpush.setVapidDetails(SUBJECT, k.publicKey, k.privateKey);
  ready = k;
  return k;
}

// Envía a las suscripciones que cumplan el filtro. Borra las que ya no existen.
export async function pushTo(store, family, filter, payload) {
  const key = "f/" + family;
  const rec = await store.get(key, { type: "json" });
  if (!rec || !rec.subs || !rec.subs.length) return 0;
  await vapid(store);
  let sent = 0;
  const dead = [];
  await Promise.all(rec.subs.filter(filter).map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 3600, urgency: "normal" });
      sent++;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) dead.push(s.endpoint);
    }
  }));
  if (dead.length) {
    const r2 = await store.get(key, { type: "json" });
    if (r2) { r2.subs = r2.subs.filter(s => !dead.includes(s.endpoint)); await store.setJSON(key, r2); }
  }
  return sent;
}

export const toKid = kidId => s => s.role === "kid" && s.kidId === kidId;
export const toParents = s => s.role === "parent";

// Estado de la mascota (mismas reglas que la app)
const HR = 3.6e6, HUNGER_H = 30, HAPPY_H = 36, CLEAN_H = 24;
export function petNow(p, now = Date.now()) {
  if (!p || !p.hatchedAt) return null;
  const hrs = Math.max(0, (now - (p.at || now)) / HR);
  return {
    h: Math.max(0, (p.hunger ?? 80) - hrs * 100 / HUNGER_H),
    hp: Math.max(0, (p.happy ?? 80) - hrs * 100 / HAPPY_H),
    c: Math.max(0, (p.clean ?? 100) - hrs * 100 / CLEAN_H),
  };
}
