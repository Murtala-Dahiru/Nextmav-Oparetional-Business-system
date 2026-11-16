import {writeFileSync} from 'node:fs';
const codes=Intl.supportedValuesOf('currency');
writeFileSync('src/lib/crm/currency.ts',`import {z} from 'zod';\n// ISO currency codes supported by the application's Intl runtime. No conversion rates.\nexport const DEAL_CURRENCIES = ${JSON.stringify(codes)} as const;\nexport const dealCurrencySchema=z.enum(DEAL_CURRENCIES);\n`);
writeFileSync('docs/pipeline-currency-codes.json',JSON.stringify(codes));
