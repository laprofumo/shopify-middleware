// server.js – Middleware für Shopify (Create/Update von Metaobjects & Kundenzuordnung)
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 10000;

// === Konfiguration ===
const SHOP = 'la-profumoteca-gmbh.myshopify.com';
const TOKEN = process.env.SHOPIFY_TOKEN;

// === Middleware ===
app.use(cors({ origin: true }));
app.use(bodyParser.json());

// === Helper: Shopify GraphQL ===
async function shopifyGraphQL(query, variables = {}) {
  const url = `https://${SHOP}/admin/api/2025-04/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });
  const text = await res.text();
  console.log('🟣 GraphQL', res.status, text);
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error(`GraphQL parse error: ${text}`);
  }
  if (json.errors && json.errors.length) {
    throw new Error(JSON.stringify(json.errors));
  }
  return json.data;
}

// === Helper: Kreations-Objekt -> Metaobject-Felder (Strings) ===
function buildFieldsFromKreation(kreation) {
  return Object.entries(kreation)
    .filter(([_, v]) => v !== null && v !== undefined && `${v}`.trim() !== '')
    .map(([key, value]) => ({ key, value: String(value) }));
}

// === Kunden anlegen ===
app.post('/create-customer', async (req, res) => {
  try {
    const response = await fetch(`https://${SHOP}/admin/api/2023-10/customers.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': TOKEN,
      },
      body: JSON.stringify({ customer: req.body })
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Fehler bei Kundenanlage' });
  }
});

// === Kundensuche ===
app.get('/search-customer', async (req, res) => {
  const query = req.query.query || '';
  try {
    const response = await fetch(`https://${SHOP}/admin/api/2023-10/customers/search.json?query=${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': TOKEN,
      },
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Fehler bei Suche' });
  }
});

// === Kreationen eines Kunden lesen ===
app.get('/get-kreationen', async (req, res) => {
  const customerId = req.query.customerId;
  if (!customerId) return res.status(400).json({ error: 'CustomerId fehlt' });

  try {
    // 1) Kundemetafelder (REST), um Referenzen zu holen
    const response = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
      headers: {
        'X-Shopify-Access-Token': TOKEN,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    console.log('📦 Kundemetafelder', JSON.stringify(data, null, 2));

    const kreationRefs = (data.metafields || [])
      .filter(f => (f.key || '').startsWith('kreation_') && (f.value || '').includes('gid://shopify/Metaobject/'));

    const kreationen = [];
    // 2) Für jede Referenz das Metaobject via GraphQL holen
    for (const ref of kreationRefs) {
      const metaobjectId = ref.value; // GID
      const q = `
        query Q($id: ID!) {
          metaobject(id: $id) {
            id
            handle
            type
            fields { key value }
          }
        }
      `;
      try {
        const d = await shopifyGraphQL(q, { id: metaobjectId });
        const mo = d?.metaobject;
        if (mo) {
          kreationen.push({
            id: mo.id,
            handle: mo.handle,
            type: mo.type,
            fields: mo.fields || []
          });
        }
      } catch (e) {
        console.log(`⚠️ Metaobject ${metaobjectId} nicht lesbar:`, e.message);
      }
    }

    res.json({ kreationen });
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Lesen der Kreationen', details: error.message });
  }
});

// === Kreation speichern (Update ODER Create) ===
app.post('/save-kreation', async (req, res) => {
  const { customerId, kreation, metaobjectId } = req.body;

  if (!customerId) {
    return res.status(400).json({ error: 'customerId fehlt' });
  }
  if (!kreation || typeof kreation !== 'object') {
    return res.status(400).json({ error: 'kreation fehlt/ungültig' });
  }

  try {
    const fields = buildFieldsFromKreation(kreation);

    // --- UPDATE (bestehendes Metaobject überschreiben) ---
    if (metaobjectId) {
      const mutationUpdate = `
        mutation U($id: ID!, $fields: [MetaobjectFieldInput!]!) {
          metaobjectUpdate(id: $id, fields: $fields) {
            metaobject { id handle }
            userErrors { field message }
          }
        }
      `;
      const dataU = await shopifyGraphQL(mutationUpdate, { id: metaobjectId, fields });
      const errsU = dataU?.metaobjectUpdate?.userErrors || [];
      if (errsU.length) {
        return res.status(400).json({ error: errsU.map(e => e.message).join('; ') });
      }
      return res.json({ success: true, updated: true, id: dataU.metaobjectUpdate.metaobject.id });
    }

    // --- CREATE (neues Metaobject) ---
    const handle = `kreation-${Date.now()}`;
    const mutationCreate = `
      mutation C($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id handle }
          userErrors { field message }
        }
      }
    `;
    const createInput = {
      type: 'parfumkreation',
      handle,
      fields
    };
    console.log('🆕 CREATE payload', JSON.stringify({ metaobject: createInput }, null, 2));
    const dataC = await shopifyGraphQL(mutationCreate, { metaobject: createInput });
    const errsC = dataC?.metaobjectCreate?.userErrors || [];
    if (errsC.length) {
      return res.status(400).json({ error: errsC.map(e => e.message).join('; ') });
    }
    const newId = dataC?.metaobjectCreate?.metaobject?.id;
    if (!newId) return res.status(500).json({ error: 'Metaobject ID fehlt nach Create' });
    console.log('🆕 CREATE status OK');

    // --- Kunden-Metafield-Slot mit mixed_reference setzen (GraphQL) ---
    // Vorher vorhandene Slots prüfen (REST, wie bisher)
    const metaRes = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
      headers: {
        'X-Shopify-Access-Token': TOKEN,
        'Content-Type': 'application/json'
      }
    });
    const existing = await metaRes.json();
    console.log('📦 Kundemetafelder', JSON.stringify(existing, null, 2));

    const slots = ['kreation_1','kreation_2','kreation_3','kreation_4','kreation_5'];
    let freieKey = null;
    for (const k of slots) {
      const belegt = (existing.metafields || []).find(m => m.key === k);
      if (!belegt) { freieKey = k; break; }
    }
    if (!freieKey) freieKey = 'kreation_1';

    const ownerGID = `gid://shopify/Customer/${customerId}`;
    const mutationMF = `
      mutation M($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id key type value }
          userErrors { field message }
        }
      }
    `;
    const mfInput = [{
      ownerId: ownerGID,
      namespace: 'custom',
      key: freieKey,
      type: 'mixed_reference',
      value: newId
    }];
    const dataM = await shopifyGraphQL(mutationMF, { metafields: mfInput });
    const errsM = dataM?.metafieldsSet?.userErrors || [];
    if (errsM.length) {
      return res.status(400).json({ error: errsM.map(e => e.message).join('; '), metaobjectId: newId });
    }

    // Nachsetzen & Rücklesen zur Kontrolle
    const metaRes2 = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
      headers: {
        'X-Shopify-Access-Token': TOKEN,
        'Content-Type': 'application/json'
      }
    });
    const after = await metaRes2.json();
    console.log('📦 Kundemetafelder', JSON.stringify(after, null, 2));

    return res.json({ success: true, created: true, slot: freieKey, metaobjectId: newId });
  } catch (error) {
    console.error('❌ SAVE ERROR', error);
    return res.status(500).json({ error: error?.message || String(error) });
  }
});

app.listen(PORT, () => console.log(`🚀 Middleware läuft auf Port ${PORT}`));
