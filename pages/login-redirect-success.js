// pages/login-redirect-success.js

import { useRouter } from "next/router";
import { useEffect, useState } from "react";

export default function LoginSuccess() {
  const router = useRouter();
  const [whatsapp, setWhatsapp] = useState("");

  useEffect(() => {
    if (router.isReady) {
      const { whatsapp } = router.query;
      setWhatsapp(whatsapp);
    }
  }, [router.isReady]);

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif", textAlign: "center" }}>
      <h1>🎉 WHOOP Login Successful</h1>
      {whatsapp ? (
        <>
          <p>Thanks! Your WHOOP account is now linked with:</p>
          <p style={{ fontWeight: "bold" }}>{whatsapp}</p>
          <p>You can now return to WhatsApp and ask about your recovery, sleep, or health insights.</p>
        </>
      ) : (
        <p>Login complete. You can now return to WhatsApp.</p>
      )}
    </div>
  );
}

