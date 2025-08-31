// server.js – Shopify Middleware (GraphQL-basiert, Create/Update + Verknüpfung)
// -------------------------------------------------------------
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 10000;

// <<< ANPASSEN falls nötig >>>
const SHOP = 'la-profumoteca-gmbh.myshopify.com';
const TOKEN = process.env.SHOPIFY_TOKEN; // in Render als Secret gesetzt

if (!TOKEN) {
  console.error('❌ SHOPIFY_TOKEN fehlt in den Umgebungsvariablen.');
}

app.use(cors({ origin: true }));
app.use(bodyParser.json());

// Hilfsfunktion: Admin GraphQL call
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
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    console.error('🟣 GraphQL RAW:', text);
    throw new Error('GraphQL-Antwort nicht parsebar');
  }

  if (!res.ok || json.errors) {
    console.error('🟣 GraphQL', res.status, JSON.stringify(json));
    const errList = json.errors?.map(e => e.message) || [];
    throw new Error(JSON.stringify(errList.length ? errList : ['Unbekannter GraphQL Fehler']));
  }
  // Debug
  console.log('🟣 GraphQL 200', JSON.stringify(json));
  return json.data;
}

// --- Kunden anlegen (REST belassen, funktioniert bereits) ---
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

// --- Kundensuche (REST belassen) ---
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

// --- Kreationen eines Kunden lesen (REST + GraphQL Mix) ---
app.get('/get-kreationen', async (req, res) => {
  const customerId = req.query.customerId;
  if (!customerId) return res.status(400).json({ error: 'CustomerId fehlt' });
  try {
    // 1) Kundenslots lesen (REST)
    const r = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
      headers: {
        'X-Shopify-Access-Token': TOKEN,
        'Content-Type': 'application/json'
      }
    });
    const data = await r.json();
    console.log('📦 Kundemetafelder', JSON.stringify(data));
    const slots = (data.metafields || []).filter(m => m.namespace === 'custom' && m.key.startsWith('kreation_'));

    // 2) Für jeden Slot versuchen Metaobject per GraphQL zu lesen
    const kreationen = [];
    for (const m of slots) {
      const gid = m.value; // z.B. gid://shopify/Metaobject/123
      try {
        const q = `
          query M($id: ID!) {
            metaobject(id: $id) {
              id
              handle
              type
              fields { key value }
            }
          }`;
        const d = await shopifyGraphQL(q, { id: gid });
        const mo = d.metaobject;
        if (mo) {
          kreationen.push({ slotKey: m.key, metaobject: mo });
        } else {
          console.warn(`⚠️ Metaobject ${gid} nicht gefunden – Platzhalter angelegt`);
          kreationen.push({ slotKey: m.key, metaobject: { id: gid, handle: '(unbekannt)', type: 'parfumkreation', fields: [] } });
        }
      } catch (e) {
        console.warn(`⚠️ Metaobject ${gid} nicht gefunden – Platzhalter angelegt`);
        kreationen.push({ slotKey: m.key, metaobject: { id: gid, handle: '(unbekannt)', type: 'parfumkreation', fields: [] } });
      }
    }

    res.json({ kreationen });
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Lesen der Kreationen', details: error.message });
  }
});

// --- Kreation speichern (CREATE oder UPDATE + Verknüpfen im Kundenslot) ---
app.post('/save-kreation', async (req, res) => {
  const { customerId, kreation, kreationId, handle } = req.body;
  try {
    if (!customerId || !kreation) {
      return res.status(400).json({ error: 'customerId oder kreation fehlt' });
    }

    // Felder vorbereiten (nur key/value – Typen sind in der Def. hinterlegt)
    const allowedKeys = new Set([
      'name','konzentration','menge_ml','datum_erstellung','bemerkung',
      'duft_1_name','duft_1_anteil','duft_1_gramm','duft_1_ml',
      'duft_2_name','duft_2_anteil','duft_2_gramm','duft_2_ml',
      'duft_3_name','duft_3_anteil','duft_3_gramm','duft_3_ml'
    ]);

    const fields = Object.entries(kreation)
      .filter(([k,v]) => allowedKeys.has(k) && v !== null && v !== undefined && String(v).trim() !== '')
      .map(([key, value]) => ({ key, value: String(value) }));

    let metaobjectId = kreationId; // falls Frontend eine gid liefert (Update-Fall)

    if (metaobjectId) {
      // UPDATE existierendes Metaobject
      const mutation = `
        mutation U($id: ID!, $meta: MetaobjectUpdateInput!) {
          metaobjectUpdate(id: $id, metaobject: $meta) {
            metaobject { id handle }
            userErrors { field message }
          }
        }`;
      const vars = { id: metaobjectId, meta: { fields } };
      const d = await shopifyGraphQL(mutation, vars);
      const errs = d.metaobjectUpdate.userErrors || [];
      if (errs.length) throw new Error(JSON.stringify(errs.map(e=>e.message)));
      metaobjectId = d.metaobjectUpdate.metaobject.id;
    } else {
      // CREATE neues Metaobject
     const mutation = `
  mutation C($meta: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $meta) {
      metaobject { id handle }
      userErrors { field message }
    }
  }`;
      const vars = {
        meta: {
          type: 'parfumkreation',
          handle: handle || `kreation-${Date.now()}`,
          fields
        }
      };
      console.log('🆕 CREATE payload', JSON.stringify({metaobject: vars.meta}, null, 2));
      const d = await shopifyGraphQL(mutation, vars);
      const errs = d.metaobjectCreate.userErrors || [];
      console.log('🆕 CREATE status OK');
      if (errs.length) throw new Error(JSON.stringify(errs.map(e=>e.message)));
      metaobjectId = d.metaobjectCreate.metaobject.id;
    }

    // Kundenslots prüfen (REST ok)
    const r = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
      headers: {
        'X-Shopify-Access-Token': TOKEN,
        'Content-Type': 'application/json'
      }
    });
    const metaData = await r.json();
    console.log('📦 Kundemetafelder', JSON.stringify(metaData));

    const existing = (metaData.metafields || []).filter(m => m.namespace === 'custom' && m.key.startsWith('kreation_'));
    const slotNames = ['kreation_1','kreation_2','kreation_3','kreation_4','kreation_5'];

    // Slot finden (falls Update: denselben Slot wiederverwenden)
    let chosenKey = null;
    const metaGid = metaobjectId; // bereits gid://shopify/Metaobject/...

    const foundSame = existing.find(m => m.value === metaGid);
    if (foundSame) {
      chosenKey = foundSame.key;
    } else {
      // ersten freien Slot nehmen
      for (const s of slotNames) {
        if (!existing.find(m => m.key === s)) { chosenKey = s; break; }
      }
      // falls alle belegt -> überschreibe kreation_5
      if (!chosenKey) chosenKey = 'kreation_5';
    }

    // Verknüpfen via GraphQL metafieldsSet (mixed_reference!)
    const customerGid = `gid://shopify/Customer/${customerId}`;
    const mfMutation = `
      mutation M($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id key type value }
          userErrors { field message }
        }
      }`;
    const mfVars = {
      metafields: [
        {
          namespace: 'custom',
          key: chosenKey,
          ownerId: customerGid,
          type: 'mixed_reference',
          value: metaGid
        }
      ]
    };
    const mfData = await shopifyGraphQL(mfMutation, mfVars);
    const mfErrs = mfData.metafieldsSet.userErrors || [];
    if (mfErrs.length) throw new Error(JSON.stringify(mfErrs.map(e=>e.message)));

    return res.json({ success: true, metaobjectId, slot: chosenKey });
  } catch (error) {
    console.error('❌ SAVE ERROR', error);
    return res.status(500).json({ error: String(error.message || error) });
  }
});

app.listen(PORT, () => console.log(`🚀 Middleware läuft auf Port ${PORT}`));
