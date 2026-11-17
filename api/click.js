import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.body || {};
    const user_uuid = body.user_uuid || body.userId;
    const ad_id = body.ad_id || body.adId;
    const event_type = body.event_type || body.type || 'click';
    const batch_count = body.batch_count || body.count || 5;

    if (!process.env.DATABASE_URL) return res.status(200).json({ ok: true, mode: 'offline' });
    const sql = neon(process.env.DATABASE_URL);

    if (event_type === 'click' && ad_id && !isNaN(Number(ad_id))) {
      await sql`UPDATE sponsor_ads SET clicks = clicks + 1 WHERE id = ${Number(ad_id)}`;
      return res.status(200).json({ ok: true, tracked: 'click' });
    }

    if ((event_type === 'batch_sync' || event_type === 'view') && user_uuid) {
      const coinsToAdd = Math.min(Math.max(Number(batch_count) || 5, 1), 10);
      const existing = await sql`SELECT last_sync_at FROM users_wallet WHERE user_uuid = ${String(user_uuid)}`;

      if (existing.length > 0) {
        const diffSec = (Date.now() - new Date(existing[0].last_sync_at).getTime()) / 1000;
        if (diffSec < 12) return res.status(429).json({ ok: false, error: 'Rate limit active' });
      }

      await sql`
        INSERT INTO users_wallet (user_uuid, coins, last_sync_at)
        VALUES (${String(user_uuid)}, ${coinsToAdd}, NOW())
        ON CONFLICT (user_uuid)
        DO UPDATE SET coins = users_wallet.coins + ${coinsToAdd}, last_sync_at = NOW()
      `;

      if (ad_id && !isNaN(Number(ad_id))) {
        await sql`UPDATE sponsor_ads SET views = views + ${coinsToAdd} WHERE id = ${Number(ad_id)}`;
      }
      return res.status(200).json({ ok: true, synced_coins: coinsToAdd });
    }

    return res.status(200).json({ ok: true, ignored: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Sync error' });
  }
}
