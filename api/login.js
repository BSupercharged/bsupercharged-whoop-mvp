// File: /pages/login.js

import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function LoginRedirect() {
  const router = useRouter();
  const { whatsapp } = router.query;

  useEffect(() => {
    if (whatsapp) {
      const encoded = encodeURIComponent(whatsapp);
      window.location.href = `/api/login?whatsapp=${encoded}`;
    }
  }, [whatsapp]);

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', textAlign: 'center' }}>
      <h2>Connecting to WHOOP...</h2>
      <p>Please wait while we redirect you to authorize your WHOOP account.</p>
    </div>
  );
}
