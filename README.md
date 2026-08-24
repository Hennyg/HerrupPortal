# Lager Optælling (SWA)

Konvertering af Power Apps-appen "Lager status Hovedlager" til en Azure Static Web App
med dynamisk filvalg fra en SharePoint-mappe (i stedet for én hardcoded Excel-fil pr. app).

## Ny funktionalitet ift. Power Apps-versionen

- **Dynamisk filvalg:** Ved åbning viser appen en liste over Excel-filer i en fast SPO-mappe
  (fx `Optaellinger/`). Brugeren vælger hvilken bil/lager-optælling der skal arbejdes på.
  Begge hold (gul/grøn) arbejder i samme fil resten af sessionen.
- **Entra ID-login** med to grupper:
  - `portal_status` → adgang til at tælle op
  - `portal_admin` → fuld adgang (som altid i dine apps)
- Samme skærme og farvelogik som Power Apps-appen (Start/farvevalg, Datagalleri, Vare findes,
  Vare findes ikke).
- Difference-listen ligger som en ekstra tabel i samme Excel-fil (som `Tabel2` gør i dag).

## Mappestruktur

```
index.html, css/, js/, images/  -> Statisk frontend (HTML/CSS/JS), ingen build-step
/api                             -> Azure Functions (Node.js v4 programmeringsmodel)
staticwebapp.config.json
```

Frontend ligger i roden (app_location: "/"), API'et ligger i sin egen mappe (api_location: "api") —
det er den opdeling der reelt betyder noget for SWA, ikke om frontend-filerne ligger i en `src`-mappe.

## Krav til opsætning (skal udfyldes af dig)

1. **Entra ID App-registrering** (bruges til både login og app-only Graph-adgang – samme
   registrering, som i din nuværende opsætning):
   - `AZURE_TENANT_ID`
   - `AZURE_CLIENT_ID`
   - `AZURE_CLIENT_SECRET`
   - App-permissions (Application, admin consent givet): `Sites.ReadWrite.All`,
     `Files.ReadWrite.All`, `Application.Read.All` (til at slå service principal'en op),
     `Directory.Read.All` eller `AppRoleAssignment.ReadWrite.All` (til at slå brugerens
     `appRoleAssignments` op – se punkt 4)
   - **App Roles** på selve registreringen (Entra ID → App registrations → din app →
     App roles → Create app role): opret to roller med value `portal_status` og
     `portal_admin` (Allowed member types: Users/Groups)
   - Under **Enterprise Applications** → din app → **Users and groups**: tildel de relevante
     brugere/grupper til `portal_status` (og evt. `portal_admin` for fuld adgang)

2. **SharePoint:**
   - `SPO_SiteId` – site-id for det SharePoint-site hvor optællings-mapperne ligger
     (kan hentes via Graph: `GET /sites/{hostname}:/sites/{sitenavn}`)
   - `SPO_FolderPath` – sti til mappen med Excel-filerne, fx `Optaellinger`

3. **Excel-filformat pr. optælling** (samme kolonner som i dag):
   - Tabel "Tabel1" (hovedliste): Varenummer, Varenavn, Varegruppe, Lagersted, Enhed, På lager,
     Optalt gul, Optalt grøn, Optalt, BS, Notal - Områdeansvarlig, Notat
   - Tabel "Tabel2" (difference-liste / varer der ikke findes): Varenummer, Optalt gul,
     Optalt grøn, Notat
   - **Vigtigt:** Excel-tabellerne SKAL være formaterede som "Tabel" (Insert > Table) med disse
     præcise navne, ellers kan Graph API'et ikke finde dem.

4. **Adgangsstyring (portal_status / portal_admin):**
   `api/src/lib/roleCheck.js` bruger nu samme mønster som `api/employee-private/index.js` i
   HerrupPortal: brugerens `appRoleAssignments` slås op via Graph mod service principal'en for
   `AZURE_CLIENT_ID`, og `appRoleId` oversættes til rollenavn (`portal_status`/`portal_admin`)
   via App Roles-listen på samme registrering. Ingen gruppe-id'er skal sættes op som App
   Settings – rollerne styres udelukkende via App Roles + Enterprise Applications-tildelingen
   i Entra ID.

5. **Den nye "fjernes fra lager"-kolonne:** Ikke implementeret endnu – send navn og placering
   når du kender det, så tilføjer jeg den ét sted (`api/src/lib/varerMapping.js`), som resten af
   koden allerede er skrevet til at læse fra.

## Lokal test

```
cd api
npm install
func start
```

Frontend kan køres direkte som statiske filer, eller via SWA CLI:
```
npm install -g @azure/static-web-apps-cli
swa start . --api-location api
```
