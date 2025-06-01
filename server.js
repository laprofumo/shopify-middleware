// server.js – Middleware für Shopify (REST 2023-10)

import express   from 'express';
import cors      from 'cors';
import bodyParser from 'body-parser';
import fetch     from 'node-fetch';

const app  = express();
const PORT = process.env.PORT || 3000;

// →   .env  oder Render-“Environment” Variablen
const SHOP  = 'la-profumoteca-gmbh.myshopify.com';
const TOKEN = process.env.SHOPIFY_TOKEN;

app.use(cors({ origin: true }));
app.use(bodyParser.json());

/* =========== Helfer =========== */
const headers = {
   'X-Shopify-Access-Token': TOKEN,
   'Content-Type': 'application/json',
+  'Accept': 'application/json'          //  ←  neu: verhindert 406
};


function kreationToFields(kre) {
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

  return Object.entries(kre)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => ({
      key,
      value: String(value),
      type: typeMap[key] || 'single_line_text_field'
    }));
}

/* =========== Kunden anlegen =========== */
app.post('/create-customer', async (req, res) => {
  try {
    const shopRes = await fetch(
      `https://${SHOP}/admin/api/2023-10/customers.json`,
      { method: 'POST', headers, body: JSON.stringify({ customer: req.body }) }
    );
    const data = await shopRes.json();
    res.status(shopRes.status).json(data);
  } catch (e) {
    res.status(500).json({ error: 'Fehler bei Kundenanlage', details: e.message });
  }
});

/* =========== Kundensuche =========== */
app.get('/search-customer', async (req, res) => {
  try {
    const q   = encodeURIComponent(req.query.query || '');
    const rsp = await fetch(
      `https://${SHOP}/admin/api/2023-10/customers/search.json?query=${q}`,
      { headers }
    );
    const data = await rsp.json();
    res.status(rsp.status).json(data);
  } catch (e) {
    res.status(500).json({ error: 'Fehler bei Suche', details: e.message });
  }
});

/* =========== Kreationen eines Kunden =========== */
app.get('/get-kreationen', async (req, res) => {
  const { customerId } = req.query;
  if (!customerId) return res.status(400).json({ error: 'customerId fehlt' });

  try {
    // 1) Metafields des Kunden lesen
    const mfRes = await fetch(
      `https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`,
      { headers }
    );
    const mfData = await mfRes.json();
    console.log('📦 Kundemetafelder', JSON.stringify(mfData, null, 2));

    // 2) Alle Kreations-Referenzen sammeln
    const kreRefs = (mfData.metafields || []).filter(f => f.key.startsWith('kreation_'));

    // 3) Jeden Verweis auflösen
    const kreationen = [];
    for (const ref of kreRefs) {
      const id = ref.value.replace(/^gid:\/\/shopify\/Metaobject\//, '');
      const kRes = await fetch(
        `https://${SHOP}/admin/api/2023-10/metaobjects/${id}.json`,
        { headers }
      );
      if (kRes.status === 404) {
        console.warn(`⚠️ Metaobject ${ref.value} nicht gefunden – Platzhalter angelegt`);
        kreationen.push({ id: ref.value, fields: [] });
        continue;
      }
      const kData = await kRes.json();
      // REST liefert {metaobject:{id,fields:[]...}}
      kreationen.push(kData.metaobject ?? kData);
    }

    res.json({ kreationen });
  } catch (e) {
    res.status(500).json({ error: 'Fehler beim Lesen', details: e.message });
  }
});

/* =========== Kreation speichern =========== */
app.post('/save-kreation', async (req, res) => {
  const { customerId, metaobjectId, kreation } = req.body;
  if (!customerId || !kreation) return res.status(400).json({ error: 'Parameter fehlen' });

  const fields = kreationToFields(kreation);

  // -------   1) Metaobject neu oder updaten   -------
  try {
    let metaId   = metaobjectId;
    let created  = false;
    let updated  = false;
    /* ---- create ---- */
    if (!metaId) {
      const payload = {
        metaobject: {
          type: 'parfumkreation',
          handle: `kreation-${Date.now()}`,
          published: true,
          fields
        }
      };
      console.log('🆕 CREATE payload', JSON.stringify(payload, null, 2));
      const r = await fetch(
        `https://${SHOP}/admin/api/2023-10/metaobjects.json`,
        { method: 'POST', headers, body: JSON.stringify(payload) }
      );
      const txt = await r.text();
      console.log('🆕 CREATE status', r.status, txt);
      if (r.status >= 400) return res.status(r.status).json({ error: txt, status: r.status });
      created = true;
      metaId  = (JSON.parse(txt)).metaobject.id;
    } else {
      /* ---- update ---- */
      const payload = {
        metaobject: {
          id: metaId.replace(/^gid:\/\/shopify\/Metaobject\//, ''),
          fields
        }
      };
      console.log('✏️ UPDATE payload', JSON.stringify(payload, null, 2));
      const r = await fetch(
        `https://${SHOP}/admin/api/2023-10/metaobjects/${payload.metaobject.id}.json`,
        { method: 'PUT', headers, body: JSON.stringify(payload) }
      );
      const txt = await r.text();
      console.log('✏️ UPDATE status', r.status, txt || '(leer)');
      if (r.status >= 400) return res.status(r.status).json({ error: txt, status: r.status });
      updated = true;
    }

    // -------   2) Referenz beim Kunden setzen   -------
    if (created) {
      // freien Slot suchen
      const slots = ['kreation_1', 'kreation_2', 'kreation_3', 'kreation_4', 'kreation_5'];
      const cur   = await fetch(
        `https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`,
        { headers }
      ).then(r => r.json());

      let chosen = null;
      for (const s of slots) {
        if (!cur.metafields.find(m => m.key === s)) { chosen = s; break; }
      }
      if (!chosen) return res.status(400).json({ error: 'Alle Kreations-Slots belegt' });

      const mfPayload = {
        metafield: {
          namespace: 'custom',
          key: chosen,
          type: 'metaobject_reference',
          value: metaId,
          owner_resource: 'customer',
          owner_id: customerId
        }
      };
      const mfRes = await fetch(
        `https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`,
        { method: 'POST', headers, body: JSON.stringify(mfPayload) }
      );
      const mfTxt = await mfRes.text();
      console.log('🔗 Link-Slot', chosen, 'Status', mfRes.status, mfTxt);
      if (mfRes.status >= 400) return res.status(mfRes.status).json({ error: mfTxt });
    }

    res.json({ success: true, created, updated });
  } catch (e) {
    console.error('❌ Save-Error', e);
    res.status(500).json({ error: e.message });
  }
});

/* =========== Server-start =========== */
app.listen(PORT, () => console.log(`🚀 Middleware läuft auf Port ${PORT}`));
