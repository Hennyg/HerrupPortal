module.exports = async function (context, req) {
  // Hvis du lige nu kun har links-admin med in-memory array,
  // så lav i stedet løsning A (brug links-admin direkte).
  context.res = { status: 501, body: { error: "use_links_admin_for_now" } };
};
