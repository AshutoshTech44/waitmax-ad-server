import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.body || {};
    const user_uuid = String(body.user_uuid || body.userId || '').trim().slice(0, 64);
    const ad_id = body.ad_id || body.adId;
    const event_type = body.event_type || body.type || 'click';
    const batch_count = body.batch_count || body.count || 5;
    const referred_by = String(body.referred_by || '').trim().slice(0, 64);

    if (!process.env.DATABASE_URL) {
      return res.status(200).json({ ok: true, mode: 'offline' });
    }

    const sql = neon(process.env.DATABASE_URL);

    await sql`ALTER TABLE users_wallet ADD COLUMN IF NOT EXISTS daily_coins INTEGER DEFAULT 0`;
    await sql`ALTER TABLE users_wallet ADD COLUMN IF NOT EXISTS daily_reset_at TIMESTAMPTZ DEFAULT NOW()`;
    await sql`ALTER TABLE users_wallet ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`;
    await sql`ALTER TABLE users_wallet ADD COLUMN IF NOT EXISTS referred_by TEXT`;
    await sql`ALTER TABLE users_wallet ADD COLUMN IF NOT EXISTS referral_rewarded BOOLEAN DEFAULT FALSE`;

    if (event_type === 'click' && ad_id && !isNaN(Number(ad_id))) {
      await sql`UPDATE sponsor_ads SET clicks = clicks + 1 WHERE id = ${Number(ad_id)} AND active = TRUE`;
      return res.status(200).json({ ok: true, tracked: 'click' });
    }

    if (event_type === 'redeem_check' && user_uuid) {
      const rows = await sql`
        SELECT coins, COALESCE(created_at, NOW()) AS created_at
        FROM users_wallet
        WHERE user_uuid = ${user_uuid}
      `;
      if (rows.length === 0) {
        return res.status(200).json({ ok: false, unlocked: false, reason: 'Wallet not found' });
      }
      const totalCoins = Number(rows[0].coins || 0);
      const ageHours = (Date.now() - new Date(rows[0].created_at).getTime()) / 3600000;
      const unlocked = totalCoins >= 500 && ageHours >= 48;
      return res.status(200).json({
        ok: true,
        unlocked,
        coins: totalCoins,
        age_hours: Math.floor(ageHours),
        required_coins: 500,
        required_hours: 48
      });
    }

    if ((event_type === 'batch_sync' || event_type === 'view') && user_uuid) {
      const coinsToAdd = Math.min(Math.max(Number(batch_count) || 5, 1), 10);
      const existing = await sql`
        SELECT
          coins,
          COALESCE(daily_coins, 0) AS daily_coins,
          COALESCE(daily_reset_at, NOW()) AS daily_reset_at,
          COALESCE(last_sync_at, NOW() - INTERVAL '1 minute') AS last_sync_at,
          referred_by
        FROM users_wallet
        WHERE user_uuid = ${user_uuid}
      `;

      let currentDaily = 0;
      let resetNeeded = true;

      if (existing.length > 0) {
        const diffSec = (Date.now() - new Date(existing[0].last_sync_at).getTime()) / 1000;
        if (diffSec < 12) {
          return res.status(429).json({ ok: false, error: 'Rate limit active' });
        }

        const hoursSinceReset = (Date.now() - new Date(existing[0].daily_reset_at).getTime()) / 3600000;
        if (hoursSinceReset < 24) {
          resetNeeded = false;
          currentDaily = Number(existing[0].daily_coins || 0);
        }

        if (currentDaily >= 300) {
          return res.status(200).json({
            ok: true,
            capped: true,
            total_coins: Number(existing[0].coins || 0),
            daily_coins: currentDaily,
            daily_limit: 300,
            message: '24h 300-Ad Daily Cap reached'
          });
        }
      }

      const allowedAdd = Math.min(coinsToAdd, 300 - currentDaily);
      const refOwner = existing.length > 0
        ? existing[0].referred_by
        : (referred_by && referred_by !== user_uuid ? referred_by : null);

      const updated = await sql`
        INSERT INTO users_wallet (user_uuid, coins, daily_coins, daily_reset_at, created_at, last_sync_at, referred_by)
        VALUES (${user_uuid}, ${allowedAdd}, ${allowedAdd}, NOW(), NOW(), NOW(), ${refOwner})
        ON CONFLICT (user_uuid)
        DO UPDATE SET
          coins = users_wallet.coins + ${allowedAdd},
          daily_coins = ${resetNeeded ? allowedAdd : currentDaily + allowedAdd},
          daily_reset_at = ${resetNeeded ? sql`NOW()` : existing[0].daily_reset_at},
          last_sync_at = NOW()
        RETURNING coins, daily_coins, referred_by
      `;

      const activeRef = updated[0] ? updated[0].referred_by : null;
      if (activeRef) {
        const qualifiedFriends = await sql`
          SELECT COUNT(*)::int AS cnt
          FROM users_wallet
          WHERE referred_by = ${activeRef} AND coins >= 25
        `;
        const qCount = qualifiedFriends[0] ? Number(qualifiedFriends[0].cnt || 0) : 0;
        if (qCount >= 3) {
          const refRow = await sql`
            SELECT referral_rewarded FROM users_wallet WHERE user_uuid = ${activeRef}
          `;
          if (refRow.length > 0 && refRow[0].referral_rewarded === false) {
            await sql`
              UPDATE users_wallet
              SET coins = coins + 50, referral_rewarded = TRUE
              WHERE user_uuid = ${activeRef}
            `;
          }
        }
      }

      return res.status(200).json({
        ok: true,
        added: allowedAdd,
        total_coins: updated[0] ? Number(updated[0].coins) : allowedAdd,
        daily_coins: updated[0] ? Number(updated[0].daily_coins) : allowedAdd,
        daily_limit: 300
      });
    }

    return res.status(400).json({ ok: false, error: 'Invalid payload' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
