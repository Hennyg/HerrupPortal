module.exports = async function (context) {
    context.res = {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: {
            error: "missing_api_file",
            message: "api/vagtferieplan/index.js mangler i denne pakke. Brug den eksisterende index.js fra din løsning."
        }
    };
};
