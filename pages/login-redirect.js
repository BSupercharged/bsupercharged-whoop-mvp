// pages/login-redirect.js

export async function getServerSideProps(context) {
  const { whatsapp } = context.query;
  const encodedPhone = encodeURIComponent(whatsapp || '');

  return {
    redirect: {
      destination: `/api/login?whatsapp=${encodeURIComponent(whatsapp || '')}`,
      permanent: false,
    },
  };
}

export default function LoginRedirect() {
  return <p>Redirecting to WHOOP login...</p>;
}
