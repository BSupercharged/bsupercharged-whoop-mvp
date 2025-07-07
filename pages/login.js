/**
 * File: /pages/login.js
 * Purpose: User-facing page that redirects to WHOOP OAuth (with embedded WhatsApp number)
 */

import { useRouter } from 'next/router';
import { useEffect } from 'react';

export default function Login() {
  const router = useRouter();
  const { whatsapp } = router.query;

  useEffect(() => {
    if (whatsapp) {
      fetch(`/api/login?whatsapp=${encodeURIComponent(whatsapp)}`)
        .then(res => res.json())
        .then(data => {
          if (data.url) {
            window.location.href = data.url;
          }
        });
    }
  }, [whatsapp]);

  return <p>Redirecting to WHOOP login...</p>;
}
