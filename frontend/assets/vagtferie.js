// assets/vagtferie.js
// Bevidst lille og læsbar fallback-fil.
// Herrup-modalens Vagt/Ferie-visning styres i assets/herrup-vagtferie.js.

(function () {
    if (typeof window.renderVagtFerie === "function") {
        return;
    }

    window.renderVagtFerie = function renderVagtFerieFallback(container) {
        const target = typeof container === "string" ? document.querySelector(container) : container;

        if (!target) {
            return;
        }

        target.innerHTML = "<div class=\"vf-loading\">Vagt/Ferie-komponenten bruges fra herrup-vagtferie.js.</div>";
    };
})();
