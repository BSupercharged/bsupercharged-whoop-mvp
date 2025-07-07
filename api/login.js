export default function handler(req, res) {
  const url = new URL("https://api.prod.whoop.com/oauth/oauth2/auth");
  url.searchParams.set("client_id", process.env.WHOOP_CLIENT_ID);
  url.searchParams.set("redirect_uri", process.env.WHOOP_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "read:recovery read:sleep read:profile read:body read:workout read:workout_rating");
  url.searchParams.set("state", "bsc-" + Date.now());
  res.redirect(url);
}