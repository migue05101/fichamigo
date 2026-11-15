import { getStore } from "@netlify/blobs";

const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
const rid = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), x => ALPHA[x % ALPHA.length]).join("");
const code6 = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
const COLORS = ["#7C5CFF", "#FF6B4A", "#16A37F", "#E8459B", "#2F8FE8", "#E2A11B"];
const COLS = ["kids", "pets", "tasks", "ledger", "goals", "config"];
const newPet = now => ({ bornAt: now, hatchedAt: null, species: null, name: "", hunger: 80, happy: 80, clean: 100, at: now, owned: [], equip: {}, house: 1, wall: "celeste", gen: 1 });
const okFam = f => typeof f === "string" && /^[a-z0-9]{12}$/.test(f);

async function update(store, key, fn) {
  for (let i = 0; i < 8; i++) {
    const cur = await store.getWithMetadata(key, { type: "json" });
    if (!cur) return null;
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
      const st = await update(fam, f, s => {
        for (const o of body.ops) {
          if (!COLS.includes(o.col) || typeof o.id !== "string") continue;
          s[o.col] = s[o.col] || {};
          if (o.data === null) delete s[o.col][o.id]; else s[o.col][o.id] = o.data;
        }
      });
      if (!st) return J({ error: "notfound" }, 404);
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
