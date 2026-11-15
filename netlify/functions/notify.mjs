// Revisor automático: cada 30 minutos mira cómo está cada mascota y los deberes pendientes, y avisa al celular del niño.
import { getStore } from "@netlify/blobs";
import { pushTo, toKid, petNow } from "../lib/push.mjs";

const H = 3.6e6;
const localHour = (tz, now) => { try { return +new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz || "America/Bogota" }).format(now) % 24; } catch { return (new Date(now).getUTCHours() + 19) % 24; } };
const localDay = (tz, now) => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "America/Bogota" }).format(now); } catch { return new Date(now - 5 * H).toISOString().slice(0, 10); } };

export default async () => {
  const fam = getStore({ name: "familias", consistency: "strong" });
  const push = getStore({ name: "push", consistency: "strong" });
  const now = Date.now();
  const { blobs } = await push.list({ prefix: "f/" });
  for (const b of blobs) {
    const family = b.key.slice(2);
    const rec = await push.get(b.key, { type: "json" });
    if (!rec || !rec.subs?.length) continue;
    const st = await fam.get(family, { type: "json" });
    if (!st) continue;
    rec.sent = rec.sent || {};
    let changed = false;
    for (const [kidId, kid] of Object.entries(st.kids || {})) {
      const subs = rec.subs.filter(s => s.role === "kid" && s.kidId === kidId);
      if (!subs.length) continue;
      const tz = subs[0].tz, hour = localHour(tz, now);
      if (hour >= 21 || hour < 7) continue; // de noche no molestamos
      const mem = rec.sent[kidId] = rec.sent[kidId] || {};
      const pets = Object.entries(st.pets || {}).filter(([id, p]) => id === kidId || p.kidId === kidId);
      for (const [petId, pet] of pets) {
      const s = petNow(pet, now), name = pet?.name || "Tu fichamigo", pm = petId === kidId ? mem : (mem[petId] = mem[petId] || {});
      const send = async (kind, coolH, title, body, tag) => {
        if (pm[kind] && now - pm[kind] < coolH * H) return;
        if (await pushTo(push, family, toKid(kidId), { title, body, tag: tag + "-" + petId, url: "/" })) { pm[kind] = now; changed = true; }
      };
      if (s) {
        if (s.h <= 20) await send("starving", 3, `¡${name} se muere de hambre!`, "Dale de comer ya. Si pasa mucho tiempo sin comer se puede enfermar.", "hambre");
        else if (s.h < 50) await send("hungry", 5, `${name} tiene hambre`, "Su barra de comida bajó de la mitad. ¡Dale algo rico!", "hambre");
        if (s.hp < 25) await send("sad", 5, `${name} está triste`, "Hace rato nadie juega con él. Tócalo, juega o sal a explorar.", "animo");
        else if (s.hp < 50) await send("bored", 6, `${name} está aburrido`, "¿Le enseñas un truco o salen a explorar?", "animo");
        if (s.c < 30) await send("dirty", 6, `La casa de ${name} está sucia`, "Toca Limpiar para dejarla brillante.", "limpieza");
      }
      }
      // Recordatorio de deberes: una vez al día, a partir de las 3 p. m.
      const pend = Object.values(st.tasks || {}).filter(t => t.kidId === kidId && t.status === "pendiente");
      const day = localDay(tz, now);
      if (pend.length && hour >= 15 && mem.tasksDay !== day) {
        const tok = pend.reduce((a, t) => a + (+t.tokens || 0), 0);
        if (await pushTo(push, family, toKid(kidId), { title: `Tienes ${pend.length} ${pend.length === 1 ? "deber pendiente" : "deberes pendientes"}`, body: `${pend.slice(0, 3).map(t => t.title).join(", ")}${pend.length > 3 ? "…" : ""} · ${tok} fichas por ganar`, tag: "deberes", url: "/" })) { mem.tasksDay = day; changed = true; }
      }
    }
    if (changed) {
      const r2 = await push.get(b.key, { type: "json" });
      if (r2) { r2.sent = rec.sent; await push.setJSON(b.key, r2); }
    }
  }
};

export const config = { schedule: "*/30 * * * *" };
