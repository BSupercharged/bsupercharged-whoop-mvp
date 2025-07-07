// pages/login-redirect.js

export async function getServerSideProps(context) {
  const { whatsapp } = context.query;

  if (!whatsapp) {
    return {
      notFound: true,
    };
  }

  const encodedPhone = encodeURIComponent(whatsapp);
  const destination = `/api/login?whatsapp=${encodedPhone}`;

  return {
    redirect: {
      destination,
      permanent: false,
    },
  };
}

export default function LoginRedirect() {
  return <p>Redirecting to WHOOP login...</p>;
}

