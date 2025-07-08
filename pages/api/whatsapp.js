export default async function handler(req, res) {
  console.log("TRIVIAL HANDLER HIT", new Date());
  res.status(200).send("OK");
}


