// Shopify Middleware – erstellt/aktualisiert Parfüm‑Metaobjects
// ⚙️  Node ≥18 (ES‑Modules)

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";

// ‑‑‑ ENV --------------------------------------------------------------------
const PORT  = process.env.PORT ?? 10000;
const SHOP  = process.env.SHOPIFY_SHOP   || "la-profumoteca-gmbh.myshopify.com";
const TOKEN = process.env.SHOPIFY_TOKEN  || "<YOUR_PRIVATE_APP_TOKEN>"; // 🔒 setzen!

// ‑‑‑ Basis ‑ Express ---------------------------------------------------------
const app = express();
app.use(cors({origin:true}));
app.use(bodyParser.json());

// ‑‑‑ Hilfsfunktionen ---------------------------------------------------------
const shopRest = (path, init = {}) => fetch(
  `https://${SHOP}/admin/api/2023-10/${path}`,
  {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
      ...(init.headers || {})
    },
    ...init
  }
);

const typeMap = {
  name:              "single_line_text_field",
  konzentration:     "single_line_text_field",
  menge_ml:          "integer",
  datum_erstellung:  "date",
  bemerkung:         "multi_line_text_field",
  duft_1_name:       "single_line_text_field",
  duft_1_anteil:     "integer",
  duft_1_gramm:      "number_decimal",
  duft_1_ml:         "number_decimal",
  duft_2_name:       "single_line_text_field",
  duft_2_anteil:     "integer",
  duft_2_gramm:      "number_decimal",
  duft_2_ml:         "number_decimal",
  duft_3_name:       "single_line_text_field",
  duft_3_anteil:     "integer",
  duft_3_gramm:      "number_decimal",
  duft_3_ml:         "number_decimal"
};

// ‑‑‑ Endpunkte ---------------------------------------------------------------

// ➕ 1. Kunde anlegen ----------------------------------------------------------
app.post("/create-customer", async (req, res) => {
  try {
    const r = await shopRest("customers.json", {
      method: "POST",
      body: JSON.stringify({ customer: req.body })
    });
    const d = await r.json();
    res.status(r.status).json(d);
  } catch (e) { res.status(500).json({ error: "Fehler bei Kundenanlage" }); }
});

// 🔍 2. Suche -----------------------------------------------------------------
app.get("/search-customer", async (req, res) => {
  try {
    const q = encodeURIComponent(req.query.query ?? "");
    const r = await shopRest(`customers/search.json?query=${q}`);
    const d = await r.json();
    res.status(r.status).json(d);
  } catch { res.status(500).json({ error: "Fehler bei Suche" }); }
});

// 📖 3. Kreationen eines Kunden lesen -----------------------------------------
app.get("/get-kreationen", async (req, res) => {
  const { customerId } = req.query;
  if (!customerId) return res.status(400).json({ error: "customerId fehlt" });

  try {
    // 1) Metafields des Kunden holen
    const mfRes = await shopRest(`customers/${customerId}/metafields.json`);
    const mfData = await mfRes.json();
    console.log("📦 Kundemetafelder", JSON.stringify(mfData, null, 2));

    const refs = (mfData.metafields || []).filter(m => m.key.startsWith("kreation_"));
    const kreationen = [];

    for (const { value } of refs) {
      const id = value.split("/").pop(); // gid://shopify/Metaobject/123 → 123
      // GraphQL‑Alleinfalls: wir brauchen Felder & Handle
      const gql = {
        query: `query Get($id:ID!){metaobject(id:$id){id handle type fields{key value}}}`,
        variables: { id: `gid://shopify/Metaobject/${id}` }
      };
      const gRes = await shopRest("graphql.json", {
        method: "POST", body: JSON.stringify(gql)
      });
      const gData = await gRes.json();

      const mo = gData.data?.metaobject;
      if (mo) kreationen.push(mo);
      else console.warn(`⚠️ Metaobject ${value} nicht gefunden`);
    }
    res.json({ kreationen });
  } catch (e) {
    res.status(500).json({ error: "Fehler beim Lesen", details: e.message });
  }
});

// 💾 4. Kreation speichern / aktualisieren ------------------------------------
app.post("/save-kreation", async (req, res) => {
  const { customerId, kreation, metaobjectId } = req.body;
  if (!customerId || !kreation) return res.status(400).json({ error: "Daten fehlen" });

  // 🗂 Felder vorbereiten
  const fields = Object.entries(kreation).map(([key, value]) => ({
    key,
    value: String(value),
    type: typeMap[key] || "single_line_text_field"
  }));

  const payload = { metaobject: { type: "parfumkreation", fields } };
  let id = metaobjectId;

  try {
    if (metaobjectId) {
      // UPDATE (PUT)
      const upRes = await shopRest(`metaobjects/${metaobjectId}.json`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      if (!upRes.ok) throw new Error(`Update‑Status ${upRes.status}`);
      console.log(`✏️  Kreation ${metaobjectId} aktualisiert`);
    } else {
      // NEU (POST)
      payload.metaobject.handle = `kreation-${Date.now()}`;
      payload.metaobject.published = true;
      const crRes = await shopRest("metaobjects.json", { method: "POST", body: JSON.stringify(payload) });
      const crData = await crRes.json();
      id = crData.metaobject?.id;
      if (!id) throw new Error("Metaobject‑Erstellung fehlgeschlagen");

      // Slot finden & Referenz hinzufügen
      const existing = await (await shopRest(`customers/${customerId}/metafields.json`)).json();
      const slots = ["kreation_1","kreation_2","kreation_3","kreation_4","kreation_5"];
      let chosen = null;
      for (const s of slots) if (!existing.metafields.find(m => m.key === s)) { chosen = s; break; }
      if (!chosen) return res.status(400).json({ error: "Alle Slots belegt" });

      await shopRest(`customers/${customerId}/metafields.json`, {
        method: "POST",
        body: JSON.stringify({
          metafield: {
            namespace: "custom",
            key: chosen,
            type: "metaobject_reference",
            value: id,
            owner_resource: "customer",
            owner_id: customerId
          }
        })
      });
      console.log(`📌 Referenz im Slot ${chosen} hinterlegt`);
    }

    res.json({ success: true, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Fehler beim Speichern" });
  }
});

// ‑‑‑ Start -------------------------------------------------------------------
app.listen(PORT, () => console.log(`🚀 Middleware läuft auf Port ${PORT}`));
