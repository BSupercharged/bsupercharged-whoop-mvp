export function sanitizePhoneNumber(input = '') {
  return input
    .replace(/^whatsapp:/i, '')
    .replace(/[\s\-()]/g, '')
    .replace(/[^+\d]/g, '');
}
