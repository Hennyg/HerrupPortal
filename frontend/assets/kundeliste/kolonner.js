// assets/kundeliste/kolonner.js
// Alle kolonner, kundelisten kan vise. Bruges både af kundelisten (visning)
// og af admin-siden (kolonnegrupper). "key" gemmes i Dataverse, så den må
// ikke ændres – "label" og "gruppe" må gerne.
// Knapperne Info / Åbn / Produkt vises altid til sidst.
//
// Kemi rabat-kolonnerne (rb_*) kommer fra lch_rabat_grupper (+ farve fra lch_rabat_struktur).
//
// Serviceaftale-kolonnerne (sa_*) kommer fra tabellen lch_serviceaftaler
// (+ aftaleteksten). En kunde kan have flere aftaler – så står der én linje
// pr. aftale, i samme rækkefølge i alle sa_-kolonner (nyeste start først).
window.KL_KOLONNER = [
  { key: 'kundenr',        label: 'Kundenr.',             gruppe: 'Kunde' },
  { key: 'navn',           label: 'Navn',                 gruppe: 'Kunde' },
  { key: 'omraade',        label: 'Område',               gruppe: 'Kunde' },
  { key: 'kundestatus',    label: 'Kundestatus',          gruppe: 'Kunde' },
  { key: 'kontrakt',       label: 'Kontrakt',             gruppe: 'Kunde' },
  { key: 'postnr',         label: 'Postnr.',              gruppe: 'Kunde' },
  { key: 'adresser',       label: 'Antal adresser',       gruppe: 'Kunde' },
  { key: 'produkter',      label: 'Antal produkter',      gruppe: 'Kunde' },
  { key: 'aktiv',          label: 'Aktiv',                gruppe: 'Kunde' },
  { key: 'importeret',     label: 'Sidst importeret',     gruppe: 'Kunde' },
  { key: 'infomail',       label: 'INFO Mail-adresse',    gruppe: 'Kunde' },
  { key: 'unicontanr',     label: 'Kundenr. Uniconta',    gruppe: 'Kunde' },

  { key: 'sa_aftaler',     label: 'Serviceaftaler',       gruppe: 'Serviceaftale' },
  { key: 'sa_antal',       label: 'Antal aftaler',        gruppe: 'Serviceaftale' },
  { key: 'sa_varenr',      label: 'Aftale varenr.',       gruppe: 'Serviceaftale' },
  { key: 'sa_servicetype', label: 'Servicetype',          gruppe: 'Serviceaftale' },
  { key: 'sa_afdeling',    label: 'Aftale afdeling',      gruppe: 'Serviceaftale' },
  { key: 'sa_start',       label: 'Aftale start',         gruppe: 'Serviceaftale' },
  { key: 'sa_slut',        label: 'Aftale slut',          gruppe: 'Serviceaftale' },
  { key: 'sa_note',        label: 'Aftale note',          gruppe: 'Serviceaftale' },

  { key: 'rb_gruppe',      label: 'Kemi rabat gr.',       gruppe: 'Kemi rabat' },
  { key: 'rb_robot',       label: 'Robot rengøring',      gruppe: 'Kemi rabat' },
  { key: 'rb_yver',        label: 'Yverpleje',            gruppe: 'Kemi rabat' },
  { key: 'rb_tank',        label: 'Tank rengøring',       gruppe: 'Kemi rabat' },
  { key: 'rb_aendring',    label: 'Rabat ændring',        gruppe: 'Kemi rabat' },
  { key: 'rb_kommentar',   label: 'Rabat kommentar',      gruppe: 'Kemi rabat' }
];

// Bruges, når der ingen kolonnegruppe er (eller ingen passer)
window.KL_STANDARD_KOLONNER = ['kundenr', 'navn', 'omraade', 'kundestatus', 'kontrakt'];
