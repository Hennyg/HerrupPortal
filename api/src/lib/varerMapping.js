// varerMapping.js
// Central definition af kolonnenavne i "Tabel1" (hovedliste) og "Tabel2" (difference-liste).
// Hold ALT kolonnenavn-afhængig logik samlet her, så det er nemt at tilføje/ændre felter
// ét sted i stedet for i hver funktion.
//
// Når du kender navn/placering på den nye "skal fjernes fra lager"-kolonne, tilføjes den
// under TABEL1_KOLONNER, og resten af koden (getVarer/updateVare) skal ikke ændres, da de
// arbejder ud fra dette mapping-objekt.

const TABEL1_NAVN = "Tabel1";
const TABEL2_NAVN = "Tabel2";

const TABEL1_KOLONNER = {
    varenummer: "Varenummer",
    varenavn: "Varenavn",
    varegruppe: "Varegruppe",
    lagersted: "Lagersted",
    enhed: "Enhed",
    paaLager: "På lager",
    optaltGul: "Optalt gul",
    optaltGron: "Optalt grøn",
    optalt: "Optalt",
    bs: "BS",
    notatOmraadeansvarlig: "Notal - Områdeansvarlig",
    notat: "Notat"
    // skalFjernes: "<udfyldes når kolonnenavn kendes>"
};

const TABEL2_KOLONNER = {
    varenummer: "Varenummer",
    optaltGul: "Optalt gul",
    optaltGron: "Optalt grøn",
    notat: "Notat"
};

/**
 * Graph workbook API returnerer rækker som arrays af værdier i tabellens kolonnerækkefølge.
 * Denne funktion bygger en indeks-opslagstabel (kolonnenavn -> array-index) ud fra
 * tabellens header-række, så vi ikke er afhængige af en fast rækkefølge i Excel-filen.
 */
function buildColumnIndex(headerRowValues) {
    const index = {};
    headerRowValues.forEach((navn, i) => {
        index[navn] = i;
    });
    return index;
}

function rowToObject(rowValues, columnIndex, kolonneMap) {
    const obj = {};
    for (const [key, excelNavn] of Object.entries(kolonneMap)) {
        const i = columnIndex[excelNavn];
        obj[key] = i !== undefined ? rowValues[i] : null;
    }
    return obj;
}

module.exports = {
    TABEL1_NAVN,
    TABEL2_NAVN,
    TABEL1_KOLONNER,
    TABEL2_KOLONNER,
    buildColumnIndex,
    rowToObject
};
