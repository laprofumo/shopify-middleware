// server.js – sichere Middleware für Shopify API
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

// 🔒 Sicher speichern in .env Datei oder Render Environment
const SHOP = 'la-profumoteca-gmbh.myshopify.com';
const TOKEN = process.env.SHOPIFY_TOKEN;

app.use(cors({ origin: true }));
app.use(bodyParser.json());

// Kunden anlegen
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

// Kundensuche
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

// Kreation speichern
app.post('/save-kreation', async (req, res) => {
  const { customerId, kreation } = req.body;

  console.log("Empfangene Kreation:", kreation);
  console.log("Customer ID:", customerId);

  try {
    const fields = Object.entries(kreation)
      .filter(([_, value]) => value !== null && value !== undefined)
      .map(([key, value]) => {
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
        const safeValue = String(value).trim() === '' ? 'keine' : String(value);
        return {
          key,
          value: safeValue,
          type: typeMap[key] || 'single_line_text_field'
        };
      });

    const payload = {
      metaobject: {
        type: 'parfumkreation',
        published: true,
        handle: `kreation-${Date.now()}`,
        fields
      }
    };

    console.log("🔍 Vollständige Payload an Shopify:", JSON.stringify(payload, null, 2));

    const kreationRes = await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': TOKEN,
      },
      body: JSON.stringify(payload)
    });
    const kreationText = await kreationRes.text();
    console.log("Status von Shopify:", kreationRes.status);
    console.log("Antwort von Shopify:", kreationText);
    let kreationData;
    try {
      kreationData = JSON.parse(kreationText);
    } catch (e) {
      console.error("❌ Antwort konnte nicht geparsed werden:", kreationText);
      return res.status(500).json({ error: 'Shopify-Antwort nicht lesbar' });
    }
    const metaobjectId = kreationData?.metaobject?.id;

    if (!metaobjectId) return res.status(400).json({ error: 'Fehler beim Metaobject' });

    const slots = ['kreation_1', 'kreation_2', 'kreation_3', 'kreation_4', 'kreation_5'];
    const getMeta = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
      headers: {
        'X-Shopify-Access-Token': TOKEN,
        'Content-Type': 'application/json'
      }
    });
    const existing = await getMeta.json();

    for (const slot of slots) {
      const belegt = existing.metafields.find(f => f.key === slot);
      if (!belegt) {
        await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': TOKEN,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            metafield: {
              namespace: 'custom',
              key: slot,
              type: 'metaobject_reference',
              value: metaobjectId,
              owner_resource: 'customer',
              owner_id: customerId
            }
          })
        });
        return res.json({ success: true, slot });
      }
    }
    res.status(400).json({ error: 'Alle Slots belegt' });
  } catch (error) {
    console.error("Fehler beim Speichern der Kreation:", error);
    res.status(500).json({ error: error.message || 'Fehler beim Speichern' });
  }
});

app.listen(PORT, () => console.log(`🚀 Middleware läuft auf Port ${PORT}`));
