// server.js – Shopify Middleware vollständig
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 10000;

// 🔒  Produktionsdaten unbedingt via Render‑Environment / .env hinterlegen
const SHOP = 'la-profumoteca-gmbh.myshopify.com';
const TOKEN = process.env.SHOPIFY_TOKEN;

app.use(cors({ origin: true }));
app.use(bodyParser.json());

/* -------------------------------------------------
   1)  Kunden anlegen (REST‑API)
--------------------------------------------------*/
app.post('/create-customer', async (req, res) => {
  try {
    const r = await fetch(`https://${SHOP}/admin/api/2023-10/customers.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': TOKEN,
        'Accept': 'application/json'
      },
      body: JSON.stringify({ customer: req.body })
    });
    const d = await r.json();
    return res.status(r.status).json(d);
  } catch (e) {
    res.status(500).json({ error: 'Fehler bei Kundenanlage', details: e.message });
  }
});

/* -------------------------------------------------
   2)  Kundensuche (REST‑API „/search.json")
--------------------------------------------------*/
app.get('/search-customer', async (req, res) => {
  const query = req.query.query || '';
  try {
    const r = await fetch(`https://${SHOP}/admin/api/2023-10/customers/search.json?query=${encodeURIComponent(query)}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': TOKEN,
        'Accept': 'application/json'
      }
    });
    const d = await r.json();
    res.status(r.status).json(d);
  } catch (e) {
    res.status(500).json({ error: 'Fehler bei Suche', details: e.message });
  }
});

/* -------------------------------------------------
   3)  Kreationen (Metaobjects) eines Kunden laden
--------------------------------------------------*/
app.get('/get-kreationen', async (req, res) => {
  const customerId = req.query.customerId;
  if (!customerId) return res.status(400).json({ error: 'customerId fehlt' });

  try {
    // Alle kundenspezifischen Metafelder lesen – hier liegen die Referenzen
    const r = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
      headers: {
        'X-Shopify-Access-Token': TOKEN,
        'Accept': 'application/json'
      }
    });
    const meta = await r.json();
    console.log('📦 Kundemetafelder', JSON.stringify(meta, null, 2));

    const refs = (meta.metafields || []).filter(f => f.key.startsWith('kreation_'));
    const kreationen = [];
    for (const ref of refs) {
      const gid = ref.value;
      const id = gid.toString().split('/').pop();
      const m = await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects/${id}.json`, {
        headers: { 'X-Shopify-Access-Token': TOKEN, 'Accept': 'application/json' }
      });
      if (m.status === 200) {
        const data = await m.json();
        kreationen.push(data.metaobject);
      } else {
        console.warn(`⚠️ Metaobject ${gid} nicht gefunden – Platzhalter angelegt`);
        kreationen.push({ id: gid, handle: gid, fields: [] });
      }
    }
    res.json({ kreationen });
  } catch (e) {
    res.status(500).json({ error: 'Fehler beim Laden', details: e.message });
  }
});

/* -------------------------------------------------
   4)  Kreation speichern / updaten
--------------------------------------------------*/
app.post('/save-kreation', async (req, res) => {
  const { customerId, kreation, metaobjectId } = req.body;
  if (!customerId || !kreation) return res.status(400).json({ error: 'customerId oder kreation fehlt' });

  // Feld‑Mapping → Shopify‑Feldtypen
  const typeMap = {
    name: 'single_line_text_field',
    konzentration: 'single_line_text_field',
    menge_ml: 'integer',
    datum_erstellung: 'date',
    bemerkung: 'multi_line_text_field',
    duft_1_name: 'single_line_text_field',
    duft_1_anteil: 'integer',
    duft_1_gramm: 'number_decimal',
    duft_1_ml: 'number_decimal',
    duft_2_name: 'single_line_text_field',
    duft_2_anteil: 'integer',
    duft_2_gramm: 'number_decimal',
    duft_2_ml: 'number_decimal',
    duft_3_name: 'single_line_text_field',
    duft_3_anteil: 'integer',
    duft_3_gramm: 'number_decimal',
    duft_3_ml: 'number_decimal'
  };

  const fields = Object.entries(kreation)
    .filter(([_, v]) => v !== null && v !== undefined)
    .map(([key, value]) => ({ key, value: String(value), type: typeMap[key] || 'single_line_text_field' }));

  try {
    /* ---------- UPDATE bestehendes Metaobject ---------- */
    if (metaobjectId) {
      const numericId = metaobjectId.toString().split('/').pop();
      const upd = await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects/${numericId}.json`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Shopify-Access-Token': TOKEN
        },
        body: JSON.stringify({ metaobject: { fields } })
      });
      if (upd.status >= 400) throw new Error('Update‑Status ' + upd.status);
      return res.json({ success: true, updated: true });
    }

    /* ---------- NEUES Metaobject anlegen ---------- */
    const payload = {
      metaobject: {
        type: 'parfumkreation',
        published: true,
        handle: `parfumkreation-${Math.random().toString(36).substring(2, 10)}`,
        fields
      }
    };

    const post = await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Shopify-Access-Token': TOKEN
      },
      body: JSON.stringify(payload)
    });
    const postData = await post.json();
    const newId = postData?.metaobject?.id;
    if (!newId) throw new Error('Metaobject‑POST fehlgeschlagen');

    // freien Slot (kreation_1…5) anhängen
    const slots = ['kreation_1','kreation_2','kreation_3','kreation_4','kreation_5'];
    const m = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
      headers: { 'X-Shopify-Access-Token': TOKEN, 'Accept': 'application/json' }
    });
    const existing = await m.json();
    for (const slot of slots) {
      if (!(existing.metafields||[]).some(f=>f.key===slot)) {
        await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            metafield: {
              namespace: 'custom',
              key: slot,
              type: 'metaobject_reference',
              value: newId,
              owner_resource: 'customer',
              owner_id: customerId
            }
          })
        });
        return res.json({ success: true, slot });
      }
    }
    res.status(400).json({ error: 'Alle Slots belegt' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Fehler beim Speichern' });
  }
});

/* -------------------------------------------------*/
app.listen(PORT, () => console.log(`🚀 Middleware läuft auf Port ${PORT}`));
