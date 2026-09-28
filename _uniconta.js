// api/_uniconta.js

const fetch = globalThis.fetch;

function getConfig() {
  const companyId = String(
    process.env.UNICONTA_COMPANY_ID || ""
  ).trim();

  const username = String(
    process.env.UNICONTA_USERNAME || ""
  ).trim();

  const password = String(
    process.env.UNICONTA_PASSWORD || ""
  );

  const baseUrl = String(
    process.env.UNICONTA_ODATA_BASE_URL ||
    "https://odata.uniconta.com/odata"
  )
    .trim()
    .replace(/\/+$/, "");

  const missing = [];

  if (!companyId) missing.push("UNICONTA_COMPANY_ID");
  if (!username) missing.push("UNICONTA_USERNAME");
  if (!password) missing.push("UNICONTA_PASSWORD");

  if (missing.length) {
    throw new Error(
      `Manglende Uniconta environment variables: ${missing.join(", ")}`
    );
  }

  return {
    companyId,
    username,
    password,
    baseUrl
  };
}

function createBasicAuth(username, password) {
  const credentials = Buffer.from(
    `${username}:${password}`,
    "utf8"
  ).toString("base64");

  return `Basic ${credentials}`;
}

function buildUrl(pathOrUrl, config) {
  const value = String(pathOrUrl || "").trim();

  if (!value) {
    throw new Error("Uniconta endpoint mangler.");
  }

  if (
    value.startsWith("https://") ||
    value.startsWith("http://")
  ) {
    return value;
  }

  return (
    `${config.baseUrl}/${encodeURIComponent(config.companyId)}/` +
    value.replace(/^\/+/, "")
  );
}

async function unicontaFetch(pathOrUrl, init = {}) {
  const config = getConfig();
  const url = buildUrl(pathOrUrl, config);

  const response = await fetch(url, {
    ...init,

    headers: {
      Authorization: createBasicAuth(
        config.username,
        config.password
      ),

      Accept: "application/json",
      ...init.headers
    },

    signal: AbortSignal.timeout(60000)
  });

  if (!response.ok) {
    const responseText = await response.text();

    throw new Error(
      `Uniconta OData fejl ${response.status} ${response.statusText}: ` +
      (responseText || "Tomt svar fra Uniconta")
    );
  }

  return response;
}

function firstValue(row, names) {
  for (const name of names) {
    const value = row?.[name];

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
      return value;
    }
  }

  return "";
}

function normalizeDebtor(row) {
  return {
    account: String(
      firstValue(row, [
        "Account",
        "account",
        "DebtorAccount"
      ])
    ),

    name: String(
      firstValue(row, [
        "Name",
        "name"
      ])
    ),

    address: String(
      firstValue(row, [
        "Address1",
        "Address",
        "address1",
        "address"
      ])
    ),

    address2: String(
      firstValue(row, [
        "Address2",
        "address2"
      ])
    ),

    zipCode: String(
      firstValue(row, [
        "ZipCode",
        "Zip",
        "zipCode",
        "zip"
      ])
    ),

    city: String(
      firstValue(row, [
        "City",
        "city"
      ])
    ),

    country: String(
      firstValue(row, [
        "Country",
        "CountryName",
        "country"
      ])
    ),

    phone: String(
      firstValue(row, [
        "Phone",
        "PhoneNumber",
        "phone"
      ])
    ),

    mobile: String(
      firstValue(row, [
        "Mobile",
        "MobilePhone",
        "mobile"
      ])
    ),

    email: String(
      firstValue(row, [
        "ContactEmail",
        "Email",
        "E-mail",
        "email"
      ])
    ),

    contactPerson: String(
      firstValue(row, [
        "ContactPerson",
        "ContactName",
        "Att",
        "contactPerson"
      ])
    ),

    vatNumber: String(
      firstValue(row, [
        "CompanyRegNo",
        "VatNumber",
        "CVR",
        "vatNumber"
      ])
    ),

    currency: String(
      firstValue(row, [
        "Currency",
        "CurrencyCode",
        "currency"
      ])
    ),

    payment: String(
      firstValue(row, [
        "Payment",
        "PaymentTerm",
        "PaymentTerms",
        "payment"
      ])
    ),

    blocked: Boolean(
      firstValue(row, [
        "Blocked",
        "Block",
        "blocked"
      ])
    ),

    raw: row
  };
}

module.exports = {
  unicontaFetch,
  normalizeDebtor
};



