import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-WaitMax-Host');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const slash = String.fromCharCode(47);
  const fallbackAd = [{
    id: 'sp-1',
    badge: 'SPONSORED',
    title: 'Bolt.new AI',
    description: 'Build & deploy full-stack web apps from a single prompt in seconds.',
    ctaText: 'Try Free',
    ctaUrl: 'https:' + slash + slash + 'bolt.new',
    payoutPerAd: 1
  }];

  try {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      return res.status(200).json(fallbackAd);
    }

    const sql = neon(dbUrl);

    await sql`ALTER TABLE sponsor_ads ADD COLUMN IF NOT EXISTS bid_price NUMERIC DEFAULT 1.0`;
    await sql`ALTER TABLE sponsor_ads ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'all'`;

    const rawHost = String(
      (req.query && req.query.host) ||
      req.headers['x-waitmax-host'] ||
      req.headers.referer ||
      ''
    ).toLowerCase();

    let detectedIntent = 'all';
    if (
      rawHost.includes('bolt') ||
      rawHost.includes('lovable') ||
      rawHost.includes('v0') ||
      rawHost.includes('replit') ||
      rawHost.includes('cursor') ||
      rawHost.includes('windsurf') ||
      rawHost.includes('github') ||
      rawHost.includes('claude') ||
      rawHost.includes('deepseek')
    ) {
      detectedIntent = 'dev';
    } else if (
      rawHost.includes('sora') ||
      rawHost.includes('suno') ||
      rawHost.includes('runway') ||
      rawHost.includes('kling') ||
      rawHost.includes('midjourney') ||
      rawHost.includes('udio') ||
      rawHost.includes('pika') ||
      rawHost.includes('luma') ||
      rawHost.includes('leonardo')
    ) {
      detectedIntent = 'creator';
    }

    const rows = await sql`
      SELECT
        id,
        title,
        description,
        cta_text,
        target_url,
        COALESCE(views, 0) AS views,
        COALESCE(clicks, 0) AS clicks,
        COALESCE(bid_price, 1.0) AS bid_price,
        COALESCE(category, 'all') AS category
      FROM sponsor_ads
      WHERE active = TRUE
    `;

    if (!rows || rows.length === 0) {
      return res.status(200).json(fallbackAd);
    }

    const scored = rows.map((r) => {
      const views = Number(r.views || 0);
      const clicks = Number(r.clicks || 0);
      const bid = Number(r.bid_price || 1.0);
      const titleLower = String(r.title || '').toLowerCase();

      let adCat = String(r.category || 'all').toLowerCase();
      if (adCat === 'all') {
        if (titleLower.includes('bolt') || titleLower.includes('lovable') || titleLower.includes('v0') || titleLower.includes('n8n')) {
          adCat = 'dev';
        } else if (titleLower.includes('suno') || titleLower.includes('sora') || titleLower.includes('runway')) {
          adCat = 'creator';
        }
      }

      const intentBoost = (detectedIntent !== 'all' && adCat === detectedIntent) ? 2.5 : 1.0;
      const ctrScore = (clicks + 1) / (views + 10);
      const finalRankScore = bid * ctrScore * intentBoost;

      return {
        row: r,
        score: finalRankScore
      };
    });

    scored.sort((a, b) => b.score - a.score);

    const topAdId = (scored[0] && scored[0].row) ? Number(scored[0].row.id) : NaN;
    if (!isNaN(topAdId)) {
      await sql`UPDATE sponsor_ads SET views = COALESCE(views, 0) + 1 WHERE id = ${topAdId}`;
    }

    const formatted = scored.map((item) => {
      const r = item.row;
      return {
        id: String(r.id),
        badge: 'SPONSORED',
        title: r.title,
        description: r.description,
        ctaText: r.cta_text || 'Try Free',
        ctaUrl: r.target_url,
        payoutPerAd: 1
      };
    });

    return res.status(200).json(formatted);
  } catch (e) {
    return res.status(200).json(fallbackAd);
  }
}
