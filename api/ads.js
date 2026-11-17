import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const slash = String.fromCharCode(47);
  const fallback = [
    {
      id: 'sp-1',
      badge: 'SPONSORED',
      title: 'Bolt.new AI',
      description: 'Build and deploy full-stack web apps from a single prompt.',
      ctaText: 'Build Now',
      ctaUrl: 'https:' + slash + slash + 'bolt.new',
      payoutPerAd: 1
    }
  ];

  try {
    if (!process.env.DATABASE_URL) return res.status(200).json(fallback);
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT id, title, description, cta_text, target_url FROM sponsor_ads WHERE active = TRUE ORDER BY id ASC LIMIT 20`;
    if (!rows.length) return res.status(200).json(fallback);

    const formatted = rows.map(r => ({
      id: String(r.id),
      badge: 'SPONSORED',
      title: r.title,
      description: r.description,
      ctaText: r.cta_text || 'Try Free',
      ctaUrl: r.target_url,
      payoutPerAd: 1
    }));

    return res.status(200).json(formatted);
  } catch (e) {
    return res.status(200).json(fallback);
  }
}
