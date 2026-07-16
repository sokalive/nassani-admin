/**
 * Home Circular Logos — circular logo tiles on the app Home screen.
 */
export async function ensureHomeLogosTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS home_logos (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      subtitle TEXT NOT NULL DEFAULT '',
      image TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      redirect_channel_id INTEGER REFERENCES channels (id) ON DELETE SET NULL,
      link_url TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
  await client.query(`
    CREATE INDEX IF NOT EXISTS home_logos_sort_order_idx ON home_logos (sort_order);
  `)
  await client.query(`
    CREATE INDEX IF NOT EXISTS home_logos_active_idx ON home_logos (active);
  `)

  const alters = [
    `ALTER TABLE home_logos ADD COLUMN IF NOT EXISTS subtitle TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE home_logos ADD COLUMN IF NOT EXISTS link_url TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE home_logos ADD COLUMN IF NOT EXISTS redirect_channel_id INTEGER`,
    `ALTER TABLE home_logos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
  ]
  for (const sql of alters) {
    await client.query(sql)
  }
}
