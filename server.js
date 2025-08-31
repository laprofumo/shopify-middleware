// server.js – Shopify Middleware (GraphQL only): Create/Update Metaobject + link via metafieldsSet (mixed_reference)
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';

const app  = express();
const PORT = process.env.PORT || 3000;

// ✅ Shop-Konfiguration – Access Token in Render als SHOPIFY_TOKEN setzen
const SHOP  = 'la-profumoteca-gmbh.myshopify.com';
const TOKEN = process.env.SHOPIFY_TOKEN;

app.use(cors({ origin: true }));
app.use(bodyParser.json());

/* ───────────────────────────── Helper ───────────────────────────── */
async function shopifyGraphQL(query, variables = {}) {
  const res = await fetch(`https://${SHOP}/admin/api/2023-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query, variables })
  });
  const raw = await res.text();
  console.log('🟣 GraphQL', res.status, raw.slice(0, 300));
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('Antwort kein JSON'); }
  if (data.errors && data.errors.length) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

/* ───────────────────────────── Kunden ───────────────────────────── */
app.post('/create-customer', async (req, res) => {
  try {
    const r = await fetch(`https://${SHOP}/admin/api/2023-10/customers.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
      body: JSON.stringify({ customer: req.body })
    });
    const j = await r.json();
    res.status(r.status).json(j);
  } catch (e) {
    res.status(500).json({ error: 'Fehler bei Kundenanlage', details: e.message });
  }
});

app.get('/search-customer', async (req, res) => {
  try {
    const r = await fetch(`https://${SHOP}/admin/api/2023-10/customers/search.json?query=${encodeURIComponent(req.query.query || '')}`,
      { headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN } }
    );
    const j = await r.json();
    res.status(r.status).json(j);
  } catch (e) { res.status(500).json({ error: 'Fehler bei Suche', details: e.message }); }
});

/* ───────────────────── Kreationen lesen (Customer → Metaobjects) ───────────────────── */
app.get('/get-kreationen', async (req, res) => {
  const customerId = req.query.customerId;
  if (!customerId) return res.status(400).json({ error: 'customerId fehlt' });
  try {
    const metaRes = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
      headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' }
    });
    const meta = await metaRes.json();
    console.log('📦 Kundemetafelder', JSON.stringify(meta));

    const refs = (meta.metafields || []).filter(m => m.key.startsWith('kreation_'));
    const kreationen = [];

    const q = `query Get($id: ID!) { metaobject(id: $id) { id handle type fields { key value } } }`;
    for (const r of refs) {
      try {
        const d = await shopifyGraphQL(q, { id: r.value });
        if (d && d.metaobject) kreationen.push(d.metaobject);
        else console.warn('⚠️ metaobject leer', r.value);
      } catch (e) {
        console.warn('⚠️ metaobject fehlend', r.value, e.message);
      }
    }
    res.json({ kreationen });
  } catch (e) { res.status(500).json({ error: 'Fehler beim Laden', details: e.message }); }
});

/* ───────────────────── Kreation speichern (Create/Update + Link) ───────────────────── */
app.post('/save-kreation', async (req, res) => {
  const { customerId, metaobjectId, kreation, slotKey } = req.body;
  if (!customerId || !kreation) return res.status(400).json({ error: 'Pflichtdaten fehlen' });

  try {
    // 1) Felder für GraphQL aufbereiten (ohne "type")
    const fields = Object.entries(kreation).map(([key, value]) => ({
      key,
      value: String(value ?? '')
    }));

    // 2) Create oder Update
    let savedId = metaobjectId || null;

    if (metaobjectId) {
      const MUT_UPDATE = `mutation M($id: ID!, $fields: [MetaobjectFieldInput!]!) {
        metaobjectUpdate(metaobject: { id: $id, fields: $fields }) {
          metaobject { id handle }
          userErrors { field message }
        }
      }`;
      const up = await shopifyGraphQL(MUT_UPDATE, { id: metaobjectId, fields });
      const errs = up.metaobjectUpdate.userErrors || [];
      if (errs.length) return res.status(400).json({ error: errs.map(e => e.message).join(', ') });
      savedId = up.metaobjectUpdate.metaobject.id;
      console.log('✅ UPDATE OK', savedId);
    } else {
      const handle = `kreation-${Date.now()}`;
      const MUT_CREATE = `mutation C($handle: String!, $fields: [MetaobjectFieldInput!]!) {
        metaobjectCreate(metaobject: { definitionHandle: "parfumkreation", handle: $handle, fields: $fields }) {
          metaobject { id handle }
          userErrors { field message }
        }
      }`;
      const cr = await shopifyGraphQL(MUT_CREATE, { handle, fields });
      const errs = cr.metaobjectCreate.userErrors || [];
      if (errs.length) return res.status(400).json({ error: errs.map(e => e.message).join(', ') });
      savedId = cr.metaobjectCreate.metaobject.id;
      console.log('✅ CREATE OK', savedId);
    }

    // 3) Kunden‑Slot setzen/verknüpfen (GraphQL metafieldsSet, type: mixed_reference)
    //    Falls slotKey mitgegeben, genau den verwenden; sonst ersten freien finden
    let useKey = slotKey;
    if (!useKey) {
      const existing = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
        headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' }
      }).then(r => r.json());
      const slotNames = ['kreation_1', 'kreation_2', 'kreation_3', 'kreation_4', 'kreation_5'];
      useKey = slotNames.find(k => !(existing.metafields || []).some(m => m.key === k));
      if (!useKey) useKey = 'kreation_1'; // notfalls überschreiben – besser als gar nicht verlinken
    }

    const ownerId = `gid://shopify/Customer/${customerId}`;
    const MUT_SET = `mutation Set($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key type value }
        userErrors { field message }
      }
    }`;
    const setPayload = [{ ownerId, namespace: 'custom', key: useKey, type: 'mixed_reference', value: savedId }];
    const setRes = await shopifyGraphQL(MUT_SET, { metafields: setPayload });
    const setErrs = setRes.metafieldsSet.userErrors || [];
    if (setErrs.length) return res.status(400).json({ error: setErrs.map(e => e.message).join(', ') });
    console.log('🔗 SLOT OK', useKey, '→', savedId);

    res.json({ success: true, id: savedId, slot: useKey });
  } catch (e) {
    console.error('❌ SAVE ERROR', e);
    res.status(500).json({ error: e.message || 'Fehler beim Speichern' });
  }
});

app.listen(PORT, () => console.log(`🚀 Middleware läuft auf Port ${PORT}`));
