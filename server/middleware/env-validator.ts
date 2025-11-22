// Environment variable validation at startup
export function validateEnvironment() {
  const required = {
    DATABASE_URL: process.env.DATABASE_URL,
    SHOPIFY_SHOP_DOMAIN: process.env.SHOPIFY_SHOP_DOMAIN,
    SHOPIFY_ACCESS_TOKEN: process.env.SHOPIFY_ACCESS_TOKEN,
    SHOPIFY_WEBHOOK_SECRET: process.env.SHOPIFY_WEBHOOK_SECRET,
  };

  const productionRequired = {
    SESSION_SECRET: process.env.SESSION_SECRET,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };

  const missing: string[] = [];
  const missingProduction: string[] = [];

  // Check required variables
  for (const [key, value] of Object.entries(required)) {
    if (!value) {
      missing.push(key);
    }
  }

  // Check production-required variables
  if (process.env.NODE_ENV === 'production') {
    for (const [key, value] of Object.entries(productionRequired)) {
      if (!value) {
        missingProduction.push(key);
      }
    }
  }

  // Fail fast for any missing required variables
  const allMissing = [...missing, ...missingProduction];
  if (allMissing.length > 0) {
    console.error('❌ FATAL: Missing required environment variables:');
    allMissing.forEach(key => console.error(`   - ${key}`));
    if (process.env.NODE_ENV === 'production') {
      console.error('\nPRODUCTION MODE: SESSION_SECRET and ADMIN_PASSWORD are required.');
    }
    console.error('\nPlease set these environment variables before starting the application.');
    process.exit(1);
  }

  // Validate format of certain variables
  if (process.env.SHOPIFY_SHOP_DOMAIN && !process.env.SHOPIFY_SHOP_DOMAIN.includes('.myshopify.com')) {
    console.warn(`⚠️  WARNING: SHOPIFY_SHOP_DOMAIN should include '.myshopify.com'`);
  }

  // Validate password format in production
  if (process.env.NODE_ENV === 'production' && process.env.ADMIN_PASSWORD) {
    if (!process.env.ADMIN_PASSWORD.startsWith('$2')) {
      console.error('❌ FATAL: In production, ADMIN_PASSWORD must be a bcrypt hash (not plain text)');
      console.error('   Generate a hash with: npx bcryptjs-cli <your-password>');
      process.exit(1);
    }
    
    if (process.env.ADMIN_PASSWORD.length < 8) {
      console.warn('⚠️  WARNING: ADMIN_PASSWORD should be at least 8 characters');
    }
  }

  console.log('✅ Environment variables validated successfully');
}
