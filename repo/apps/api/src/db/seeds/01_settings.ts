import { Knex } from 'knex';

const DEFAULT_SETTINGS = [
  { key: 'security.bcrypt_cost', value: '12', description: 'bcrypt cost factor' },
  { key: 'security.lockout_attempts', value: '10', description: 'max login fails per window' },
  { key: 'security.lockout_window_minutes', value: '15', description: 'lockout observation window' },
  { key: 'security.lockout_duration_minutes', value: '30', description: 'lockout duration' },
  { key: 'security.jwt_access_ttl_minutes', value: '30', description: 'JWT inactivity TTL' },
  { key: 'security.session_absolute_max_hours', value: '8', description: 'absolute session limit' },
  { key: 'listing.price_per_sqft_min', value: '50', description: 'anomaly floor' },
  { key: 'listing.price_per_sqft_max', value: '5000', description: 'anomaly ceiling' },
  { key: 'promo.max_slots', value: '20', description: 'max promo collection slots' },
  { key: 'listing.max_attachments', value: '25', description: 'max files per listing' },
  { key: 'risk.score_initial', value: '100', description: 'starting credit score' },
  { key: 'risk.decay_days', value: '7', description: 'days of clean activity per +1' },
  { key: 'offline_captcha.enabled', value: 'false', description: 'enable offline CAPTCHA' },
  { key: 'timezone', value: 'America/New_York', description: 'install timezone' },
];

export async function seed(knex: Knex): Promise<void> {
  for (const setting of DEFAULT_SETTINGS) {
    const exists = await knex('settings').where({ key: setting.key }).first();
    if (!exists) {
      await knex('settings').insert(setting);
    }
  }
}
