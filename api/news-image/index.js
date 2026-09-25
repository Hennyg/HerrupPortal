// /api/news-image
//   GET    /api/news-image/{id}  → selve billedet (alle der er logget ind)
//   POST   /api/news-image       → upload { name, mime, data (base64) } (alle der er logget ind)
//   DELETE /api/news-image/{id}  → slet (redaktør)
const N = require("../_news");
const { I } = N;

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"];

module.exports = async function (context, req) {
  const method = (req.method || "GET").toUpperCase();
  const id = String(context.bindingData?.id || "").trim();
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) return N.json(context, 400, { error: "Ugyldigt id" });

  try {
    const { entitySet } = await N.imageMeta();

    if (method === "GET") {
      if (!N.getPrincipal(req)) return N.json(context, 401, { error: "Ikke logget ind" });
      if (!id) return N.json(context, 400, { error: "Mangler id" });
      const meta = await N.dv(`${entitySet}(${id})?$select=${I.mimetype},${I.navn}`);
      const r = await N.dv(`${entitySet}(${id})/${I.fil}/$value`, { raw: true });
      const buf = Buffer.from(await r.arrayBuffer());
      context.res = {
        status: 200,
        isRaw: true,
        headers: {
          "Content-Type": meta?.[I.mimetype] || "image/jpeg",
          // Et billed-id ændrer aldrig indhold, så det må caches længe.
          "Cache-Control": "private, max-age=2592000, immutable"
        },
        body: buf
      };
      return;
    }

    if (method === "POST") {
      // Alle der er logget ind må uploade (bruges også af "Opret nyhed").
      // Billeder der aldrig bliver brugt i en nyhed, ryddes op efter 2 dage.
      if (!N.getPrincipal(req)) return N.json(context, 401, { error: "Ikke logget ind" });
      const b = req.body || {};
      const mime = String(b.mime || "").toLowerCase();
      if (!ALLOWED.includes(mime)) return N.json(context, 400, { error: "Kun JPG, PNG, GIF og WEBP" });
      const buf = Buffer.from(String(b.data || "").replace(/^data:[^,]+,/, ""), "base64");
      if (!buf.length) return N.json(context, 400, { error: "Tomt billede" });
      if (buf.length > MAX_BYTES) return N.json(context, 400, { error: "Billedet er for stort (maks 8 MB)" });

      const ext = mime.split("/")[1].replace("jpeg", "jpg");
      const name = (String(b.name || "billede").replace(/[^\w.\- æøåÆØÅ]/g, "").slice(0, 150) || "billede").replace(/\.[^.]+$/, "") + "." + ext;

      const created = await N.dv(entitySet, { method: "POST", body: { [I.navn]: name, [I.mimetype]: mime } });
      const newId = created?.id;
      if (!newId) throw new Error("Billedet blev ikke oprettet");

      try {
        await N.dv(`${entitySet}(${newId})/${I.fil}`, {
          method: "PATCH",
          binary: buf,
          headers: { "Content-Type": "application/octet-stream", "x-ms-file-name": encodeURIComponent(name) }
        });
      } catch (e) {
        try { await N.dv(`${entitySet}(${newId})`, { method: "DELETE" }); } catch { /* ignoreres */ }
        throw e;
      }
      return N.json(context, 200, { ok: true, id: newId, url: `/api/news-image/${newId}` });
    }

    if (method === "DELETE") {
      const user = await N.requireEditor(context, req);
      if (!user) return;
      if (!id) return N.json(context, 400, { error: "Mangler id" });
      await N.dv(`${entitySet}(${id})`, { method: "DELETE" });
      return N.json(context, 200, { ok: true });
    }

    return N.json(context, 405, { error: "Metode ikke tilladt" });
  } catch (e) {
    if (e.status === 404) return N.json(context, 404, { error: "Billedet findes ikke" });
    context.log.error("news-image:", e);
    return N.json(context, 500, { error: e.message });
  }
};
