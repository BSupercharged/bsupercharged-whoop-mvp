// pages/login.js
import { useRouter } from "next/router";
import { useEffect } from "react";

export default function Login() {
  const router = useRouter();
  const { whatsapp } = router.query;

  useEffect(() => {
    if (whatsapp) {
      // Redirect to backend login endpoint
      window.location.href = `/api/login?whatsapp=${encodeURIComponent(whatsapp)}`;
    }
  }, [whatsapp]);

  return (
    <div>
      <h2>Redirecting you to WHOOP login...</h2>
      <p>If you are not redirected, <a href={`/api/login?whatsapp=${encodeURIComponent(whatsapp || "")}`}>click here</a>.</p>
    </div>
  );
}

