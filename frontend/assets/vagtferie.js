// vagtferie.js
// Denne fil er med for at sikre, at gamle referencer ikke fejler på herrup.html.
// Den fulde Vagt/Ferie-visning i medarbejdermodalen styres af herrup-vagtferie.js.
window.renderVagtFerie = window.renderVagtFerie || function(container){
  if (container) container.innerHTML = '<div class="vf-loading">Vagt/Ferie-komponenten bruges fra herrup-vagtferie.js.</div>';
};
