
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

const corsOptions = {
  origin: 'https://flourishing-malabi-acba8d.netlify.app',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
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

  try {
    const kreationRes = await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': TOKEN,
      },
      body: JSON.stringify({ metaobject: { type: 'parfumkreation', fields: kreation } })
    });
    const kreationData = await kreationRes.json();
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
    res.status(500).json({ error: 'Fehler beim Speichern' });
  }
});

app.listen(PORT, () => console.log(`🚀 Middleware läuft auf Port ${PORT}`));
