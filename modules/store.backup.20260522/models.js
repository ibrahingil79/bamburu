export function runMigrations(db) {
  // Verify ERP tables exist
  db.prepare('SELECT 1 FROM products LIMIT 1').get();
  console.log('✅ Store: Conectado con ERP');
}
