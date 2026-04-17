import { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  const existing = await knex('consent_versions').where({ version: '1.0' }).first();
  if (!existing) {
    await knex('consent_versions').insert({
      version: '1.0',
      body_md: `# Privacy Consent and Terms of Use

By using the HarborStone Listings Operations Suite, you agree to the collection and processing of your personal data as described herein.

**Data Collection:** We collect information you provide directly, including your name, contact details, and transaction data related to real estate listings and operations.

**Data Use:** Your data is used to provide and improve our services, facilitate transactions, comply with legal obligations, and communicate important service updates.

**Data Sharing:** We do not sell your personal information. Data may be shared with service providers under strict confidentiality agreements, or as required by law.

**Data Retention:** Personal data is retained for the duration of your account and as required by applicable regulations.

**Your Rights:** You have the right to access, correct, or request deletion of your personal data, subject to legal and contractual limitations.

**Contact:** For privacy-related inquiries, contact privacy@harborstone.example.com.

By proceeding, you acknowledge that you have read and accept these terms.`,
      effective_from: new Date('2024-01-01T00:00:00.000Z'),
    });
  }
}
