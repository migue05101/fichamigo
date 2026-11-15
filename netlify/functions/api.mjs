import { getStore } from "@netlify/blobs";
import { vapid, pushTo, toKid, toParents, petNow } from "../lib/push.mjs";

const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
const rid = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), x => ALPHA[x % ALPHA.length]).join("");
const code6 = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
const COLORS = ["#7C5CFF", "#FF6B4A", "#16A37F", "#E8459B", "#2F8FE8", "#E2A11B"];
const COLS = ["kids", "pets", "tasks", "ledger", "goals", "config"];
const newPet = now => ({ bornAt: now, hatchedAt: null, species: null, name: "", hunger: 80, happy: 80, clean: 100, at: now, owned: [], equip: {}, house: 1, wall: "celeste", gen: 1 });
const okFam = f => typeof f === "string" && /^[a-z0-9]{12}$/.test(f);
const okT = t => typeof t === "string" && /^[a-z0-9]{12}$/.test(t);
const taskKey = (aid, kidId) => "sc_" + aid + "_" + kidId;

const BAD = ["hijueputa","hp","gonorrea","malparido","malparida","puta","puto","mierda","marica","pendejo","pendeja","idiota","estupido","estúpido","imbecil","imbécil","perra","verga","culo","huevon","huevón","guevon","boba","bobo","sapo","zorra"];
function clean(raw) {
  let t = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 300), flagged = false;
  const pats = [/\d[\d\s\-.()]{5,}\d/g, /[\w.+-]+@[\w-]+\.[\w.]+/g, /(https?:\/\/|www\.)\S+/gi, /\b\S+\.(com|co|net|org|me|io|ly|app|gg|tv)\b\S*/gi, /@\w{3,}/g,
    /\b(calle|carrera|cra|cll|kr|avenida|av|diagonal|transversal|barrio|conjunto|apto|apartamento|torre|manzana|mz|direcci[oó]n|vivo en|mi casa queda)\b[^.!?]*/gi,
    /\b(whats?app|wasap|wsp|insta(gram)?|tik ?tok|telegram|snap(chat)?|discord|facebook|face|messenger|correo|celular|n[uú]mero|tel[eé]fono)\b/gi];
  for (const p of pats) t = t.replace(p, () => { flagged = true; return "***"; });
  t = t.replace(new RegExp("(^|[^\\p{L}])(" + BAD.join("|") + ")(?=$|[^\\p{L}])", "giu"), (m, a, w) => { flagged = true; return a + "*".repeat(w.length); });
  return { text: t, flagged };
}
const pairKey = (a, b) => [a, b].sort().join("_");
const noAcc = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

async function update(store, key, fn, init) {
  for (let i = 0; i < 8; i++) {
    let cur = await store.getWithMetadata(key, { type: "json" });
    if (!cur) { if (!init) return null; const r = await store.setJSON(key, init, { onlyIfNew: true }); cur = await store.getWithMetadata(key, { type: "json" }); if (!cur) continue; }
    const st = cur.data;
    const out = fn(st);
    if (out === false) return st;
    st.v = (st.v || 0) + 1;
    const res = await store.setJSON(key, st, { onlyIfMatch: cur.etag });
    if (!res || res.modified !== false) return st;
    await new Promise(r => setTimeout(r, 40 + Math.random() * 120));
  }
  throw new Error("busy");
}

export default async req => {
  const url = new URL(req.url);
  const p = url.pathname.replace(/^\/api\/?/, "");
  const fam = getStore({ name: "familias", consistency: "strong" });
  const pairs = getStore({ name: "pairs", consistency: "strong" });
  const fotos = getStore({ name: "fotos" });
  const social = getStore({ name: "social", consistency: "strong" });
  const push = getStore({ name: "push", consistency: "strong" });
  const notify = (f, filter, payload) => pushTo(push, f, filter, { url: "/", ...payload }).catch(() => 0);
  const famState = async f => okFam(f) ? await fam.get(f, { type: "json" }) : null;
  const myKid = async (f, kidId) => { const st = await famState(f); return st && st.kids && st.kids[kidId] ? st : null; };
  const profile = id => social.get("k/" + id, { type: "json" });
  const upd = (key, fn, init) => update(social, key, fn, init);
  const doc = getStore({ name: "docentes", consistency: "strong" });
  const tGet = async t => okT(t) ? await doc.get("t/" + t, { type: "json" }) : null;
  const tUpd = (t, fn) => update(doc, "t/" + t, fn);
  // Quita el vínculo del colegio y las tareas de ese grupo que aún no se aprobaron
  const dropLink = (f, gid, kidId) => okFam(f) ? update(fam, f, s2 => {
    if (s2.school) delete s2.school[gid + "_" + kidId];
    for (const [k, t] of Object.entries(s2.tasks || {})) if (t.school && t.school.gid === gid && t.kidId === kidId && t.status !== "aprobada") delete s2.tasks[k];
  }).catch(() => null) : null;
  // Entrega una tarea del docente a un estudiante (en el estado de su familia)
  const deliver = async (tid, tname, aid, a, kidId, f) => {
    let added = false;
    await update(fam, f, s2 => {
      if (!s2.kids?.[kidId] || s2.school?.[a.gid + "_" + kidId]?.status !== "ok") return false;
      s2.tasks = s2.tasks || {}; const k = taskKey(aid, kidId); if (s2.tasks[k]) return false;
      added = true;
      s2.tasks[k] = { kidId, title: a.title, desc: a.desc || "", cat: "escuela", tokens: a.tokens, cur: "e", due: a.due || null, repeat: "none", status: "pendiente", note: "", needPhoto: a.needPhoto, createdAt: Date.now(), school: { tid, tname, gid: a.gid, gname: s2.school[a.gid + "_" + kidId].gname, aid } };
    }).catch(() => null);
    if (!added) return;
    await tUpd(tid, s2 => { if (s2.assigns?.[aid]) s2.assigns[aid].targets[kidId] = f; });
    await notify(f, toKid(kidId), { title: `Nueva tarea de ${tname} 📚`, body: `${a.title} · ${a.tokens} fichas de colegio`, tag: "sc-" + aid });
  };
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  try {
    if (p === "ping") return J({ ok: true });

    if (p === "family" && req.method === "POST") {
      if (!/^\d{4}$/.test(body.pin || "")) return J({ error: "pin" }, 400);
      const id = rid(12);
      const st = { v: 1, kids: {}, pets: {}, tasks: {}, ledger: {}, goals: {}, config: { main: { pin: body.pin } }, created: Date.now() };
      await fam.setJSON(id, st);
      return J({ family: id, state: st });
    }

    if (p === "join" && req.method === "POST") {
      const f = String(body.family || "").trim().toLowerCase();
      if (!okFam(f)) return J({ error: "notfound" }, 404);
      const st = await fam.get(f, { type: "json" });
      if (!st) return J({ error: "notfound" }, 404);
      if ((st.config?.main?.pin) !== body.pin) return J({ error: "pin" }, 403);
      return J({ family: f, state: st });
    }

    if (p === "state" && req.method === "GET") {
      const f = url.searchParams.get("f");
      if (!okFam(f)) return J({ error: "notfound" }, 404);
      const st = await fam.get(f, { type: "json" });
      if (!st) return J({ error: "notfound" }, 404);
      const since = +url.searchParams.get("since") || 0;
      if (since && since === st.v) return J({ same: true, v: st.v });
      return J({ state: st });
    }

    if (p === "op" && req.method === "POST") {
      const f = body.family;
      if (!okFam(f) || !Array.isArray(body.ops)) return J({ error: "bad" }, 400);
      const ev = [];
      const st = await update(fam, f, s => {
        ev.length = 0;
        for (const o of body.ops) {
          if (o.col === "tasks" && o.data) {
            const old = s.tasks?.[o.id], t = o.data, kid = s.kids?.[t.kidId];
            if (!old && t.status === "pendiente") ev.push(["kid", t.kidId, { title: "Nuevo deber 📝", body: `${t.title} · ${t.tokens} fichas`, tag: "deber-" + o.id }]);
            else if (old && old.status !== "revision" && t.status === "revision") ev.push(["parents", null, { title: `${kid?.name || "Tu hijo"} terminó un deber`, body: `${t.title}${t.proof ? " · con foto, toca para revisar" : ""}`, tag: "rev-" + o.id }]);
            else if (old && old.status !== "aprobada" && t.status === "aprobada") ev.push(["kid", t.kidId, { title: "¡Deber aprobado! ⭐", body: `${t.title} · +${t.tokens} fichas`, tag: "ok-" + o.id }]);
            else if (old && old.status === "revision" && t.status === "pendiente") ev.push(["kid", t.kidId, { title: "Te devolvieron un deber", body: `${t.title}: revísalo y vuelve a enviarlo`, tag: "dev-" + o.id }]);
          }
          if (o.col === "goals" && o.data) {
            const old = s.goals?.[o.id], g = o.data, kid = s.kids?.[g.kidId];
            if (old && old.status !== "solicitada" && g.status === "solicitada") ev.push(["parents", null, { title: `¡${kid?.name || "Tu hijo"} reclamó una meta!`, body: `${g.title} · ${g.cost} fichas`, tag: "meta-" + o.id }]);
            if (old && old.status !== "entregada" && g.status === "entregada") ev.push(["kid", g.kidId, { title: "¡Meta entregada! 🎁", body: g.title, tag: "meta-" + o.id }]);
          }
          if (!COLS.includes(o.col) || typeof o.id !== "string") continue;
          s[o.col] = s[o.col] || {};
          if (o.data === null) delete s[o.col][o.id]; else s[o.col][o.id] = o.data;
        }
      });
      if (!st) return J({ error: "notfound" }, 404);
      if (ev.length) await Promise.all(ev.map(([who, kidId, p]) => notify(f, who === "kid" ? toKid(kidId) : toParents, p)));
      return J({ v: st.v });
    }

    if (p === "pair" && req.method === "POST") {
      const name = String(body.name || "").slice(0, 20).trim();
      if (!name) return J({ error: "name" }, 400);
      let code;
      for (let i = 0; i < 10; i++) { code = code6(); if (!(await pairs.get(code))) break; }
      const kidId = rid(10);
      await pairs.setJSON(code, { name, age: String(body.age || "").slice(0, 3), kidId, created: Date.now(), family: null });
      return J({ code, kidId });
    }

    if (p === "pair" && req.method === "GET") {
      const pr = await pairs.get(url.searchParams.get("code") || "x", { type: "json" });
      if (!pr) return J({ error: "notfound" }, 404);
      return J({ family: pr.family, kidId: pr.kidId, name: pr.name });
    }

    if (p === "link" && req.method === "POST") {
      const f = body.family, code = String(body.code || "").trim();
      if (!okFam(f)) return J({ error: "notfound" }, 404);
      const pr = await pairs.get(code, { type: "json" });
      if (!pr) return J({ error: "nocode" }, 404);
      if (pr.family && pr.family !== f) return J({ error: "taken" }, 409);
      let pinBad = false;
      const st = await update(fam, f, s => {
        if ((s.config?.main?.pin) !== body.pin) { pinBad = true; return false; }
        if (s.kids[pr.kidId]) return false;
        const now = Date.now(), n = Object.keys(s.kids).length;
        s.kids[pr.kidId] = { name: pr.name, age: pr.age, color: COLORS[n % COLORS.length], code, linked: true, createdAt: now, linkedAt: now };
        s.pets[pr.kidId] = newPet(now);
      });
      if (!st) return J({ error: "notfound" }, 404);
      if (pinBad) return J({ error: "pin" }, 403);
      pr.family = f; await pairs.setJSON(code, pr);
      return J({ kidId: pr.kidId, name: pr.name, v: st.v });
    }

    /* ---------- notificaciones ---------- */
    if (p === "push/key" && req.method === "GET") { const k = await vapid(push); return J({ key: k.publicKey }); }
    if (p === "push/subscribe" && req.method === "POST") {
      const { family: f, role: r, kidId, sub, tz } = body;
      if (!okFam(f) || !sub || !sub.endpoint || !sub.keys) return J({ error: "bad" }, 400);
      if (!(await famState(f))) return J({ error: "notfound" }, 404);
      if (r === "kid" && !(await myKid(f, kidId))) return J({ error: "notfound" }, 404);
      await update(push, "f/" + f, s2 => { s2.subs = (s2.subs || []).filter(x => x.endpoint !== sub.endpoint); s2.subs.push({ endpoint: sub.endpoint, keys: sub.keys, role: r === "kid" ? "kid" : "parent", kidId: r === "kid" ? kidId : null, tz: String(tz || "America/Bogota").slice(0, 40), ts: Date.now() }); }, { subs: [], sent: {} });
      return J({ ok: true });
    }
    if (p === "push/unsubscribe" && req.method === "POST") {
      const { family: f, endpoint } = body; if (!okFam(f)) return J({ error: "bad" }, 400);
      await update(push, "f/" + f, s2 => { s2.subs = (s2.subs || []).filter(x => x.endpoint !== endpoint); });
      return J({ ok: true });
    }
    if (p === "push/test" && req.method === "POST") {
      const { family: f, endpoint } = body; if (!okFam(f)) return J({ error: "bad" }, 400);
      const n = await notify(f, s2 => s2.endpoint === endpoint, { title: "¡Notificaciones activadas! 🔔", body: "Así te avisará Fichamigo.", tag: "test" });
      return J({ sent: n });
    }

    /* ---------- social: perfil, mundo compartido, amigos y chat ---------- */
    if (p === "social/profile" && req.method === "POST") {
      const { family: f, kidId } = body;
      const st = await myKid(f, kidId); if (!st) return J({ error: "notfound" }, 404);
      const kid = st.kids[kidId], pet = st.pets[kidId] || {};
      const nick = String(kid.nick || pet.name || "Amigo").slice(0, 16);
      let prof = await profile(kidId), code = prof && prof.code;
      if (!code) {
        const base = (noAcc(pet.name || kid.name || "FIC").toUpperCase().replace(/[^A-Z]/g, "") + "FIC").slice(0, 3);
        for (let i = 0; i < 20; i++) { code = base + "-" + String(100 + Math.floor(Math.random() * 900)); if (!(await social.get("code/" + code))) break; }
        await social.setJSON("code/" + code, { kidId });
      }
      const look = { sp: pet.species || "blob", equip: pet.equip || {}, tint: pet.tint || null, av: pet.avatar || null, color: kid.color || "#7C5CFF" };
      await upd("k/" + kidId, s2 => { s2.family = f; s2.nick = nick; s2.look = look; s2.code = code; s2.world = kid.social?.world !== false; s2.chat = kid.social?.chat !== false; }, { friends: {} });
      return J({ code, nick });
    }

    if (p === "world" && req.method === "POST") {
      const { family: f, kidId } = body;
      const prof = await profile(kidId);
      if (!prof || prof.family !== f) return J({ error: "noprofile" }, 404);
      const now = Date.now();
      const me = { x: +body.x | 0, y: +body.y | 0, zone: String(body.zone || "").slice(0, 30), nick: prof.nick, look: prof.look, ts: now };
      if (body.emote) { me.emote = String(body.emote).slice(0, 12); me.et = now; }
      const w = await upd("world", s2 => {
        s2.p = s2.p || {};
        for (const k in s2.p) if (now - s2.p[k].ts > 30000) delete s2.p[k];
        if (body.leave || !prof.world) { delete s2.p[kidId]; return; }
        const old = s2.p[kidId];
        if (!me.emote && old && old.et && now - old.et < 4000) { me.emote = old.emote; me.et = old.et; }
        s2.p[kidId] = me;
      }, { p: {} });
      const others = [];
      if (prof.world) for (const [id, o] of Object.entries(w.p || {})) {
        if (id === kidId || now - o.ts > 12000) continue;
        const fr = prof.friends[id];
        if (fr && fr.st === "blocked") continue;
        others.push({ id, x: o.x, y: o.y, nick: o.nick, look: o.look, emote: o.et && now - o.et < 4000 ? o.emote : null, fr: fr ? fr.st : null });
      }
      return J({ others });
    }

    if (p === "friend/request" && req.method === "POST") {
      const { family: f, kidId } = body;
      const me = await profile(kidId);
      if (!me || me.family !== f) return J({ error: "noprofile" }, 404);
      let target = body.target;
      if (!target && body.code) { const c = await social.get("code/" + String(body.code).toUpperCase().trim(), { type: "json" }); target = c && c.kidId; }
      if (!target || target === kidId) return J({ error: "nocode" }, 404);
      const other = await profile(target);
      if (!other) return J({ error: "nocode" }, 404);
      if (other.family === f) return J({ error: "samefamily" }, 400);
      const cur = me.friends[target];
      if (cur) return J({ ok: true, st: cur.st, nick: other.nick });
      const entry = { st: "req", by: kidId, appr: {}, ts: Date.now() };
      await upd("k/" + kidId, s2 => { s2.friends[target] = { ...entry, fam: other.family }; });
      await upd("k/" + target, s2 => { s2.friends[kidId] = { ...entry, fam: f }; });
      await Promise.all([notify(f, toParents, { title: "Solicitud de amistad", body: `${me.nick} quiere ser amigo de ${other.nick}. Necesita tu permiso.`, tag: "fr-" + target }),
        notify(other.family, toParents, { title: "Solicitud de amistad", body: `${me.nick} quiere ser amigo de ${other.nick}. Necesita tu permiso.`, tag: "fr-" + kidId })]);
      return J({ ok: true, st: "req", nick: other.nick });
    }

    if (p === "friend/decide" && req.method === "POST") {
      const { family: f, kidId, other, action } = body;
      const st = await myKid(f, kidId); if (!st) return J({ error: "notfound" }, 404);
      if ((st.config?.main?.pin) !== body.pin) return J({ error: "pin" }, 403);
      const me = await profile(kidId), them = await profile(other);
      if (!me || !me.friends[other] || !them) return J({ error: "notfound" }, 404);
      if (action === "remove") {
        await upd("k/" + kidId, s2 => { delete s2.friends[other]; }); await upd("k/" + other, s2 => { delete s2.friends[kidId]; });
      } else if (action === "block") {
        await upd("k/" + kidId, s2 => { s2.friends[other] = { ...(s2.friends[other] || {}), st: "blocked", by: kidId, ts: Date.now() }; });
        await upd("k/" + other, s2 => { delete s2.friends[kidId]; });
      } else if (action === "approve") {
        let both = false;
        await upd("k/" + kidId, s2 => { const e = s2.friends[other]; if (!e || e.st === "blocked") return false; e.appr = { ...(e.appr || {}), [f]: true }; both = !!(e.appr[f] && e.appr[them.family]); if (both) e.st = "ok"; });
        await upd("k/" + other, s2 => { const e = s2.friends[kidId]; if (!e) return false; e.appr = { ...(e.appr || {}), [f]: true }; if (e.appr[f] && e.appr[them.family]) e.st = "ok"; });
      } else return J({ error: "bad" }, 400);
      return J({ ok: true });
    }

    if (p === "friends" && req.method === "GET") {
      const f = url.searchParams.get("f"), kidId = url.searchParams.get("kid");
      const me = await profile(kidId);
      if (!me || me.family !== f) return J({ friends: [], code: null });
      const list = [];
      for (const [id, e] of Object.entries(me.friends || {})) {
        const o = await profile(id);
        list.push({ id, st: e.st, mine: !!(e.appr || {})[f], theirs: !!(o && (e.appr || {})[o.family]), byMe: e.by === kidId, nick: o ? o.nick : "?", look: o ? o.look : null, ts: e.ts });
      }
      return J({ friends: list, code: me.code, nick: me.nick });
    }

    if (p === "inbox" && req.method === "GET") {
      const f = url.searchParams.get("f"), who = url.searchParams.get("who"), kidId = url.searchParams.get("kid"), since = +url.searchParams.get("since") || 0;
      let key;
      if (who === "parent") { if (!(await famState(f))) return J({ msgs: [] }); key = "inbox/p:" + f; }
      else { if (!(await myKid(f, kidId))) return J({ msgs: [] }); key = "inbox/k:" + kidId; }
      const box = await social.get(key, { type: "json" });
      return J({ msgs: (box?.msgs || []).filter(m => m.ts > since), now: Date.now() });
    }

    if (p === "chat" && req.method === "GET") {
      const f = url.searchParams.get("f"), kidId = url.searchParams.get("kid"), w = url.searchParams.get("with");
      if (w === "family") { if (!(await myKid(f, kidId))) return J({ error: "notfound" }, 404); const c = await social.get("fchat/" + kidId, { type: "json" }); return J({ msgs: c ? c.msgs : [] }); }
      const me = await profile(kidId);
      if (!me || me.family !== f || !me.friends[w]) return J({ error: "notfriends" }, 403);
      const c = await social.get("chat/" + pairKey(kidId, w), { type: "json" });
      return J({ msgs: c ? c.msgs : [], st: me.friends[w].st });
    }

    if (p === "chat" && req.method === "POST") {
      const { family: f, kidId, with: w, as } = body;
      const { text, flagged } = clean(body.text);
      if (!text) return J({ error: "empty" }, 400);
      const msg = { from: as === "parent" ? "parent" : kidId, text, flag: flagged || undefined, ts: Date.now() };
      let key;
      if (w === "family") {
        if (!(await myKid(f, kidId))) return J({ error: "notfound" }, 404);
        key = "fchat/" + kidId;
      } else {
        if (as === "parent") return J({ error: "readonly" }, 403);
        const me = await profile(kidId);
        if (!me || me.family !== f || !me.friends[w] || me.friends[w].st !== "ok") return J({ error: "notfriends" }, 403);
        if (me.chat === false) return J({ error: "chatoff" }, 403);
        const them = await profile(w); if (!them || !them.friends[kidId] || them.friends[kidId].st !== "ok") return J({ error: "notfriends" }, 403);
        key = "chat/" + pairKey(kidId, w);
      }
      await upd(key, s2 => { s2.msgs.push(msg); if (s2.msgs.length > 300) s2.msgs = s2.msgs.slice(-300); }, { msgs: [] });
      const preview = text.length > 80 ? text.slice(0, 80) + "…" : text;
      const inbox = (key, item) => upd("inbox/" + key, s2 => { s2.msgs.push(item); if (s2.msgs.length > 40) s2.msgs = s2.msgs.slice(-40); }, { msgs: [] });
      if (w === "family") {
        if (as === "parent") {
          await inbox("k:" + kidId, { name: "Papá/Mamá", with: "family", text: preview, ts: msg.ts });
          await notify(f, toKid(kidId), { title: "Mensaje de papá/mamá 💬", body: preview, tag: "fchat" });
        } else {
          const stF = await famState(f), nm = stF?.kids?.[kidId]?.name || "Tu hijo";
          await inbox("p:" + f, { name: nm, kidId, with: "family", text: preview, ts: msg.ts });
          await notify(f, toParents, { title: `${nm} te escribió 💬`, body: preview, tag: "fchat-" + kidId });
        }
      } else {
        const me2 = await profile(kidId), them2 = await profile(w);
        await inbox("k:" + w, { name: me2?.nick || "Un amigo", with: kidId, look: me2?.look || null, text: preview, ts: msg.ts });
        if (them2) await notify(them2.family, toKid(w), { title: `${me2?.nick || "Un amigo"} te escribió 💬`, body: preview, tag: "chat-" + kidId });
      }
      return J({ ok: true, msg, flagged });
    }

    /* ---------- docentes: grupos y tareas del colegio ---------- */
    if (p === "teacher" && req.method === "POST") {
      const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!name) return J({ error: "name" }, 400);
      if (!/^\d{4}$/.test(body.pin || "")) return J({ error: "pin" }, 400);
      const id = rid(12);
      await doc.setJSON("t/" + id, { v: 1, name, pin: body.pin, created: Date.now(), groups: {}, assigns: {} });
      return J({ teacher: id, name });
    }
    if (p === "teacher/join" && req.method === "POST") {
      const t = String(body.teacher || "").trim().toLowerCase(), T = await tGet(t);
      if (!T) return J({ error: "notfound" }, 404);
      if (T.pin !== body.pin) return J({ error: "pin" }, 403);
      return J({ teacher: t, name: T.name });
    }
    if (p === "teacher/state" && req.method === "GET") {
      const t = url.searchParams.get("t"), T = await tGet(t);
      if (!T) return J({ error: "notfound" }, 404);
      const cache = {}, fs = async f => (f in cache ? cache[f] : (cache[f] = await famState(f)));
      const groups = {};
      for (const [gid, g] of Object.entries(T.groups || {})) {
        const students = [];
        for (const [kidId, e] of Object.entries(g.students || {})) {
          const st = e.status === "ok" || e.status === "pendiente" ? await fs(e.family) : null;
          students.push({ kidId, name: st?.kids?.[kidId]?.name || e.name || "Estudiante", status: e.status, ts: e.ts });
        }
        groups[gid] = { name: g.name, created: g.created, students };
      }
      const assigns = {};
      for (const [aid, a] of Object.entries(T.assigns || {})) {
        const rows = [];
        for (const [kidId, f] of Object.entries(a.targets || {})) {
          const st = await fs(f), task = st?.tasks?.[taskKey(aid, kidId)];
          rows.push({ kidId, name: st?.kids?.[kidId]?.name || "Estudiante", status: task ? task.status : "borrada", doneAt: task?.doneAt || null, photo: !!task?.proof?.id, note: task?.note || "" });
        }
        assigns[aid] = { gid: a.gid, title: a.title, desc: a.desc, tokens: a.tokens, due: a.due, needPhoto: a.needPhoto, created: a.created, rows };
      }
      return J({ name: T.name, groups, assigns });
    }
    if (p === "teacher/group" && req.method === "POST") {
      const t = body.teacher, T = await tGet(t); if (!T) return J({ error: "notfound" }, 404);
      if (body.del) {
        const g = T.groups?.[body.gid]; if (!g) return J({ ok: true });
        for (const [kidId, e] of Object.entries(g.students || {})) await dropLink(e.family, body.gid, kidId);
        await tUpd(t, s2 => { delete s2.groups[body.gid]; for (const [aid, a] of Object.entries(s2.assigns || {})) if (a.gid === body.gid) delete s2.assigns[aid]; });
        return J({ ok: true });
      }
      const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 40); if (!name) return J({ error: "name" }, 400);
      const gid = rid(8);
      await tUpd(t, s2 => { s2.groups = s2.groups || {}; s2.groups[gid] = { name, created: Date.now(), students: {} }; });
      return J({ gid });
    }
    if (p === "teacher/student" && req.method === "POST") {
      const t = body.teacher, T = await tGet(t); if (!T) return J({ error: "notfound" }, 404);
      const g = T.groups?.[body.gid]; if (!g) return J({ error: "nogroup" }, 404);
      const pr = await pairs.get(String(body.code || "").trim(), { type: "json" });
      if (!pr || !pr.family) return J({ error: "nocode" }, 404);
      const st = await famState(pr.family), kid = st?.kids?.[pr.kidId];
      if (!kid) return J({ error: "nocode" }, 404);
      const cur = g.students?.[pr.kidId];
      if (cur && (cur.status === "ok" || cur.status === "pendiente")) return J({ ok: true, name: kid.name, status: cur.status });
      const now = Date.now(), linkId = body.gid + "_" + pr.kidId;
      await tUpd(t, s2 => { s2.groups[body.gid].students = s2.groups[body.gid].students || {}; s2.groups[body.gid].students[pr.kidId] = { family: pr.family, name: kid.name, status: "pendiente", ts: now }; });
      await update(fam, pr.family, s2 => { s2.school = s2.school || {}; s2.school[linkId] = { tid: t, tname: T.name, gid: body.gid, gname: g.name, kidId: pr.kidId, status: "pendiente", ts: now }; });
      await notify(pr.family, toParents, { title: "Solicitud del colegio 🏫", body: `${T.name} quiere agregar a ${kid.name} al grupo ${g.name}. Necesita tu permiso.`, tag: "school-" + linkId });
      return J({ ok: true, name: kid.name, status: "pendiente" });
    }
    if (p === "teacher/student/remove" && req.method === "POST") {
      const t = body.teacher, T = await tGet(t); if (!T) return J({ error: "notfound" }, 404);
      const e = T.groups?.[body.gid]?.students?.[body.kidId]; if (!e) return J({ ok: true });
      await dropLink(e.family, body.gid, body.kidId);
      await tUpd(t, s2 => { delete s2.groups[body.gid].students[body.kidId]; });
      return J({ ok: true });
    }
    if (p === "school/decide" && req.method === "POST") {
      const f = body.family, st = await famState(f); if (!st) return J({ error: "notfound" }, 404);
      if ((st.config?.main?.pin) !== body.pin) return J({ error: "pin" }, 403);
      const link = st.school?.[body.linkId]; if (!link) return J({ error: "notfound" }, 404);
      const T = await tGet(link.tid);
      if (body.action === "approve") {
        await update(fam, f, s2 => { if (s2.school?.[body.linkId]) s2.school[body.linkId].status = "ok"; });
        if (T) {
          await tUpd(link.tid, s2 => { const e = s2.groups?.[link.gid]?.students?.[link.kidId]; if (e) e.status = "ok"; });
          const day = new Date(Date.now() - 5 * 3.6e6).toISOString().slice(0, 10);
          for (const [aid, a] of Object.entries(T.assigns || {})) if (a.gid === link.gid && (!a.due || a.due >= day)) await deliver(link.tid, T.name, aid, a, link.kidId, f);
        }
        return J({ ok: true });
      }
      if (body.action === "reject" || body.action === "remove") {
        await dropLink(f, link.gid, link.kidId);
        if (T) await tUpd(link.tid, s2 => { const e = s2.groups?.[link.gid]?.students?.[link.kidId]; if (e) e.status = body.action === "reject" ? "rechazado" : "retirado"; });
        return J({ ok: true });
      }
      return J({ error: "bad" }, 400);
    }
    if (p === "teacher/assign" && req.method === "POST") {
      const t = body.teacher, T = await tGet(t); if (!T) return J({ error: "notfound" }, 404);
      const g = T.groups?.[body.gid]; if (!g) return J({ error: "nogroup" }, 404);
      const title = String(body.title || "").trim().slice(0, 80); if (!title) return J({ error: "title" }, 400);
      const a = { gid: body.gid, title, desc: String(body.desc || "").trim().slice(0, 400), tokens: Math.max(1, Math.min(500, parseInt(body.tokens) || 5)), due: /^\d{4}-\d{2}-\d{2}$/.test(body.due || "") ? body.due : null, needPhoto: body.needPhoto !== false, created: Date.now(), targets: {} };
      const aid = rid(10);
      await tUpd(t, s2 => { s2.assigns = s2.assigns || {}; s2.assigns[aid] = a; });
      let n = 0;
      for (const [kidId, e] of Object.entries(g.students || {})) if (e.status === "ok") { await deliver(t, T.name, aid, a, kidId, e.family); n++; }
      return J({ aid, sent: n });
    }
    if (p === "teacher/assign/delete" && req.method === "POST") {
      const t = body.teacher, T = await tGet(t); if (!T) return J({ error: "notfound" }, 404);
      const a = T.assigns?.[body.aid]; if (!a) return J({ ok: true });
      for (const [kidId, f] of Object.entries(a.targets || {})) await update(fam, f, s2 => { const k = taskKey(body.aid, kidId); if (s2.tasks?.[k] && s2.tasks[k].status !== "aprobada") delete s2.tasks[k]; else return false; });
      await tUpd(t, s2 => { delete s2.assigns[body.aid]; });
      return J({ ok: true });
    }
    if (p === "teacher/review" && req.method === "POST") {
      const t = body.teacher, T = await tGet(t); if (!T) return J({ error: "notfound" }, 404);
      const a = T.assigns?.[body.aid], f = a?.targets?.[body.kidId]; if (!f) return J({ error: "notfound" }, 404);
      const k = taskKey(body.aid, body.kidId), now = Date.now(); let title = a.title, ok = false;
      await update(fam, f, s2 => {
        const task = s2.tasks?.[k]; if (!task || task.school?.tid !== t) return false;
        if (body.ok) {
          if (task.status === "aprobada") return false;
          task.status = "aprobada"; task.approvedAt = now; task.note = ""; ok = true;
          s2.ledger = s2.ledger || {}; s2.ledger[rid(12)] = { kidId: body.kidId, type: "tarea", amount: task.tokens, label: task.title + " (" + T.name + ")", cat: "escuela", cur: "e", createdAt: now };
          for (const [pid, pet] of Object.entries(s2.pets || {})) {
            if (!(pid === body.kidId || pet.kidId === body.kidId) || !pet.species) continue;
            if (!pet.hatchedAt) Object.assign(pet, { hatchedAt: now, hunger: 85, happy: 90, clean: 100, at: now });
            else { const c = petNow(pet, now); if (c) Object.assign(pet, { hunger: c.h, happy: Math.min(100, c.hp + 15), clean: c.c, at: now }); }
          }
        } else {
          if (task.status !== "revision") return false;
          task.status = "pendiente"; task.proof = null; task.note = "Devuelto por " + T.name + (body.note ? ": " + String(body.note).slice(0, 120) : ": revísalo");
        }
      });
      await notify(f, toKid(body.kidId), ok ? { title: "¡Tarea del colegio aprobada! ⭐", body: `${title} · +${a.tokens} fichas de colegio`, tag: "sok-" + k } : { title: "Te devolvieron una tarea del colegio", body: `${title}: revísala y vuelve a enviarla`, tag: "sdev-" + k });
      return J({ ok: true });
    }
    if (p === "teacher/photo" && req.method === "GET") {
      const t = url.searchParams.get("t"), aid = url.searchParams.get("a"), kidId = url.searchParams.get("k"), T = await tGet(t);
      const f = T?.assigns?.[aid]?.targets?.[kidId]; if (!f) return J({ error: "notfound" }, 404);
      const st = await famState(f), pr = st?.tasks?.[taskKey(aid, kidId)]?.proof;
      if (!pr || !/^[a-z0-9]{14}$/.test(pr.id || "")) return J({ error: "notfound" }, 404);
      const r = await fotos.getWithMetadata(f + "/" + pr.id, { type: "arrayBuffer" });
      if (!r) return J({ error: "notfound" }, 404);
      return new Response(r.data, { headers: { "content-type": r.metadata?.type || "image/jpeg", "cache-control": "private, max-age=86400" } });
    }

    if (p === "photo" && req.method === "POST") {
      const f = body.family;
      if (!okFam(f) || typeof body.data !== "string") return J({ error: "bad" }, 400);
      const m = body.data.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
      if (!m) return J({ error: "type" }, 400);
      const bytes = Buffer.from(m[2], "base64");
      if (bytes.length > 2_500_000) return J({ error: "big" }, 413);
      if (!(await fam.getMetadata(f))) return J({ error: "notfound" }, 404);
      const id = rid(14);
      await fotos.set(f + "/" + id, bytes, { metadata: { type: "image/" + m[1], at: Date.now() } });
      return J({ id });
    }

    if (p === "photo" && req.method === "GET") {
      const f = url.searchParams.get("f"), id = url.searchParams.get("id");
      if (!okFam(f) || !/^[a-z0-9]{14}$/.test(id || "")) return J({ error: "bad" }, 400);
      const r = await fotos.getWithMetadata(f + "/" + id, { type: "arrayBuffer" });
      if (!r) return J({ error: "notfound" }, 404);
      return new Response(r.data, { headers: { "content-type": r.metadata?.type || "image/jpeg", "cache-control": "private, max-age=31536000, immutable" } });
    }
  } catch (e) {
    return J({ error: String(e && e.message || e) }, 500);
  }
  return J({ error: "notfound" }, 404);
};

export const config = { path: "/api/*" };
