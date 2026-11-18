// assets/kundeliste/kolonner.js
// Alle kolonner, kundelisten kan vise. Bruges både af kundelisten (visning)
// og af admin-siden (kolonnegrupper). "key" gemmes i Dataverse, så den må
// ikke ændres – "label" må gerne.
// Knapperne Info / Åbn / Produkt vises altid til sidst.
window.KL_KOLONNER = [
  { key: 'kundenr',    label: 'Kundenr.' },
  { key: 'navn',       label: 'Navn' },
  { key: 'omraade',    label: 'Område' },
  { key: 'kundestatus',label: 'Kundestatus' },
  { key: 'kontrakt',   label: 'Kontrakt' },
  { key: 'postnr',     label: 'Postnr.' },
  { key: 'adresser',   label: 'Antal adresser' },
  { key: 'produkter',  label: 'Antal produkter' },
  { key: 'aktiv',      label: 'Aktiv' },
  { key: 'importeret', label: 'Sidst importeret' }
];

// Bruges, når der ingen kolonnegruppe er (eller ingen passer)
window.KL_STANDARD_KOLONNER = ['kundenr', 'navn', 'omraade', 'kundestatus', 'kontrakt'];
