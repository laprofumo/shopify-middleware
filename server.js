// server.js – Shopify Middleware v5
//  • REST für basic Ops
//  • Fallback GraphQL‑Fetch, wenn Metaobject per REST 404 liefert
// -------------------------------------------------------------
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 10000;

const SHOP = 'la-profumoteca-gmbh.myshopify.com';
const TOKEN = process.env.SHOPIFY_TOKEN;

app.use(cors({ origin: true }));
app.use(bodyParser.json());

/*======================== 1) Kunden anlegen ========================*/
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
    return res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(500).json({ error: 'Fehler bei Kundenanlage', details: e.message });
  }
});

/*======================== 2) Kundensuche ===========================*/
app.get('/search-customer', async (req, res) => {
  const query = req.query.query || '';
  try {
    const r = await fetch(`https://${SHOP}/admin/api/2023-10/customers/search.json?query=${encodeURIComponent(query)}`, {
      headers: {
        'X-Shopify-Access-Token': TOKEN,
        'Accept': 'application/json'
      }
    });
    return res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(500).json({ error: 'Fehler bei Suche', details: e.message });
  }
});

/*======================== 3) Kreationen eines Kunden laden =========*/
app.get('/get-kreationen', async (req, res) => {
  const customerId = req.query.customerId;
  if (!customerId) return res.status(400).json({ error: 'customerId fehlt' });

  try {
    // 3.1  Kundenspezifische Metafelder → Referenzen
    const mfRes = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
      headers: { 'X-Shopify-Access-Token': TOKEN, 'Accept': 'application/json' }
    });
    const meta = await mfRes.json();
    console.log('📦 Kundemetafelder', JSON.stringify(meta, null, 2));

    const refs = (meta.metafields || []).filter(f => f.key.startsWith('kreation_'));
    const kreationen = [];

    for (const ref of refs) {
      const gid = ref.value; // gid://shopify/Metaobject/123
      const numeric = gid.toString().split('/').pop();

      // 3.2  REST‑Versuch
      const rest = await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects/${numeric}.json`, {
        headers: { 'X-Shopify-Access-Token': TOKEN, 'Accept': 'application/json' }
      });

      if (rest.status === 200) {
        const d = await rest.json();
        kreationen.push(d.metaobject);
        continue;
      }

      // 3.3  Fallback GraphQL – einige Shops liefern 404 auf REST
      const gqlRes = await fetch(`https://${SHOP}/admin/api/2023-10/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: `query($id: ID!) {\n  metaobject(id: $id) {\n    id handle type\n    fields { key value }\n  }\n}`,
          variables: { id: gid }
        })
      });
      const gqlData = await gqlRes.json();
      if (gqlData.data?.metaobject) {
        kreationen.push(gqlData.data.metaobject);
      } else {
        console.warn(`⚠️ Metaobject ${gid} weder REST noch GraphQL gefunden`);
      }
    }

    res.json({ kreationen });
  } catch (e) {
    res.status(500).json({ error: 'Fehler beim Laden', details: e.message });
  }
});

/*======================== 4) Kreation speichern / updaten =========*/
app.post('/save-kreation', async (req, res) => {
  const { customerId, kreation, metaobjectId } = req.body;
  if (!customerId || !kreation) return res.status(400).json({ error: 'customerId oder kreation fehlt' });

  // Mapping → Feldtypen
  const typeMap = {
    name: 'single_line_text_field', konzentration: 'single_line_text_field', menge_ml: 'integer', datum_erstellung: 'date', bemerkung: 'multi_line_text_field',
    duft_1_name: 'single_line_text_field', duft_1_anteil: 'integer', duft_1_gramm: 'number_decimal', duft_1_ml: 'number_decimal',
    duft_2_name: 'single_line_text_field', duft_2_anteil: 'integer', duft_2_gramm: 'number_decimal', duft_2_ml: 'number_decimal',
    duft_3_name: 'single_line_text_field', duft_3_anteil: 'integer', duft_3_gramm: 'number_decimal', duft_3_ml: 'number_decimal'
  };

  const fields = Object.entries(kreation)
    .filter(([_, v]) => v !== null && v !== undefined)
    .map(([key, value]) => ({ key, value: String(value), type: typeMap[key] || 'single_line_text_field' }));

  try {
    /* ---- UPDATE ---- */
    if (metaobjectId) {
      const num = metaobjectId.toString().split('/').pop();
      const u = await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects/${num}.json`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Shopify-Access-Token': TOKEN
        },
        body: JSON.stringify({ metaobject: { fields } })
      });
      if (u.status >= 400) throw new Error('Update‑Status ' + u.status);
      return res.json({ success: true, updated: true });
    }

    /* ---- NEU ---- */
    const payload = {
      metaobject: {
        type: 'parfumkreation',
        published: true,
        handle: `parfumkreation-${Math.random().toString(36).slice(2,10)}`,
        fields
      }
    };
    const p = await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Shopify-Access-Token': TOKEN
      },
      body: JSON.stringify(payload)
    });
    const pData = await p.json();
    const newId = pData?.metaobject?.id;
    if (!newId) throw new Error('Metaobject‑POST fehlgeschlagen');

    // freien Slot anhängen
    const slots = ['kreation_1','kreation_2','kreation_3','kreation_4','kreation_5'];
    const metaRes = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
      headers: { 'X-Shopify-Access-Token': TOKEN, 'Accept': 'application/json' }
    });
    const exist = await metaRes.json();

    for (const slot of slots) {
      if (!(exist.metafields||[]).some(f=>f.key===slot)) {
        await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ metafield: { namespace:'custom', key:slot, type:'metaobject_reference', value:newId, owner_resource:'customer', owner_id:customerId } })
        });
        return res.json({ success:true, slot });
      }
    }
    res.status(400).json({ error: 'Alle Slots belegt' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Fehler beim Speichern' });
  }
});

/*========================*/
app.listen(PORT, () => console.log(`🚀 Middleware läuft auf Port ${PORT}`));
