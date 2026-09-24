// /api/sms-send/index.js
// Sender SMS via Sveve og logger forsendelsen i Dataverse (cr175_lch_sms_service).
const S = require("../_sms");

const MAX_RECIPIENTS = 2000;
const MAX_PARTS = 6;

module.exports = async function (context, req) {
  const user = S.requireAccess(context, req);
  if (!user) return;

  try {
    const b = req.body || {};
    const { valid, invalid } = S.parseNumbers(b.recipients);
    const msg = String(b.message || "").replace(/\r\n/g, "\n").trim();
    const from = String(b.from || "Lely Center").trim();
    const test = b.test === true;

    if (!valid.length) return S.json(context, 400, { error: "Ingen gyldige modtagere" });
    if (valid.length > MAX_RECIPIENTS) return S.json(context, 400, { error: `Maks ${MAX_RECIPIENTS} modtagere pr. forsendelse` });
    if (!msg) return S.json(context, 400, { error: "Beskeden er tom" });

    const info = S.smsInfo(msg);
    if (info.parts > MAX_PARTS) return S.json(context, 400, { error: `Beskeden er for lang (${info.parts} SMS'er pr. modtager, maks ${MAX_PARTS})` });

    // Afsendernavn: maks 11 tegn (bogstaver/tal/mellemrum) eller et nummer på maks 15 cifre.
    if (!/^([A-Za-z0-9 ÆØÅæøå.\-]{1,11}|\d{1,15})$/.test(from)) {
      return S.json(context, 400, { error: "Afsender skal være maks 11 tegn (bogstaver/tal) eller et nummer" });
    }

    const result = await S.sveveSend({ to: valid, from, msg, test });
    const antalSms = result.smsCount || valid.length * info.parts;
    const status = result.fatalError
      ? "Fejl"
      : (result.errors.length ? "Delvist sendt" : (test ? "Test OK" : "Sendt"));

    // Log — fejl her må ikke skjule, at SMS'en faktisk er sendt.
    let logError = null;
    try {
      await S.dvFetch(S.TABLE, {
        method: "POST",
        body: {
          [S.COL.titel]: S.formatTitle(new Date()),
          [S.COL.modtagere]: valid.join("\n"),
          [S.COL.besked]: msg,
          [S.COL.afsender]: user.name,
          [S.COL.afsenderMail]: user.email,
          [S.COL.fra]: from,
          [S.COL.test]: test,
          [S.COL.antalSms]: antalSms,
          [S.COL.antalModtagere]: valid.length,
          [S.COL.sendt]: new Date().toISOString(),
          [S.COL.status]: status,
          [S.COL.svar]: result.raw
        }
      });
    } catch (e) {
      logError = e.message;
      context.log.warn("SMS-log kunne ikke gemmes:", e.message);
    }

    return S.json(context, result.fatalError ? 502 : 200, {
      ok: !result.fatalError,
      status,
      test,
      recipients: valid.length,
      skippedInvalid: invalid,
      okCount: result.okCount,
      smsCount: antalSms,
      price: Math.round(antalSms * S.SMS_PRICE * 100) / 100,
      errors: result.errors,
      error: result.fatalError || null,
      logError
    });
  } catch (e) {
    context.log.error("sms-send:", e);
    return S.json(context, 500, { error: e.message });
  }
};
