import { sanitizePhoneNumber } from '../lib/phone.js';

describe('sanitizePhoneNumber', () => {
  test('removes whatsapp prefix and non-digit characters', () => {
    const input = 'whatsapp:+1 (234) 567-8900';
    const result = sanitizePhoneNumber(input);
    expect(result).toBe('+12345678900');
  });
});
