# Claude Opus 5 végrehajtóprompt — LeadPilot és a végleges Bambu Slicer VPS

Készült: 2026-09-07. Az alábbi szöveg teljes egészében bemásolható Claude Opus 5-nek a LeadPilot projektbe. Ez végrehajtási megbízás; az olvasott kiinduló állapot bizonyítékhatárai a prompt részei.

---

Vedd kézbe a LeadPilot Slicer-integrációjának felzárkóztatását a jelenlegi, Bambu Studio alapú Slicer VPS szerződéséhez. Készítsd el a szükséges kódot, regressziós teszteket, operátori felületet és üzemeltetési csomagot, majd add át tesztelt, helyileg commitolt állapotban. Ne állj meg újabb auditnál vagy tervnél. A fő cél: a valóban alkalmazott Bambu-mérésből, a LeadPilot saját üzleti árpolitikájával, visszaellenőrizhetően keletkezzen aktuális gyártási kalkuláció, draft és ember által jóváhagyható előnézet.

## 1. Bizonyított kiindulópont és felhatalmazás

A „még Prusát használ” feltételezés a 2026-09-07-én olvasott forrás alapján nem igaz. A LeadPilot helyi munkafája tiszta `main`, HEAD `3eeb23778935797619b127e8c603e13eab091648` volt. A `docs/ALLAPOT.md` D171-et és 2026-09-07-et jelöl. Ez pillanatfelvétel: induláskor mérd újra a saját munkafád állapotát, és ne kényszerítsd vissza erre a SHA-ra.

Konkrét forrásbizonyíték a LeadPilot repóban:

| Meglévő működés / hiány | Forrás és szimbólum |
| --- | --- |
| Bambu a kódbeli alapmotor, P1S az alapnyomtató; az útvonal motorfüggő | `packages/shared/src/slicer-api.ts:18` — `SLICER_MOTOR_ALAP`; `:25` — `SLICER_BAMBU_NYOMTATO_ALAP`; `:32` — `slicerSliceVegpont` |
| A kliens ténylegesen a `/${motor}/slice` végpontot hívja, `x-slicer-api-key` hitelesítéssel | `apps/api/src/slicer/slicer.client.ts` — `HttpSlicerClient.szeletel` |
| A motor, nyomtató és támasz settingsből feloldott, sorba állításkor rögzített paraméter | `apps/api/src/slicer/slicer-feature-gate.service.ts`; `slicer-job.queue.ts` — `slicerJobPayloadSchema`, `profile` |
| A Bambu-válaszhoz még nem kötelező és nincs ellenőrizve a technikai bizonylat/generáció | `packages/shared/src/slicer-api.ts:142` — `slicerValaszSchema`, `.passthrough()`; nincs `technical_receipt` / `measurement_generation` validátor |
| Anyag/réteg/kitöltés ma a kérésből lesz „mérési” adat | `packages/shared/src/slicer-api.ts:266` — `slicerMerestKiolvas`; a `supports` még hiány esetén kérés/default fallbacket használ |
| Az igény és mérés összehasonlítása emiatt az anyag/réteg/kitöltés tényleges upstream eltérését nem tudja kimutatni | `apps/api/src/slicer/slicer-kalkulacio.service.ts` — `szeletelAutomatikusan`, `MEASUREMENT_REQUEST_MISMATCH` |
| Dedup és fizikai kulcs már motor-/nyomtató-/támasz-/fájl-/orientációfüggő, de producer-generációt és ellenőrzött bizonylatot nem köt | `slicer-job.queue.ts:134` — `slicerRequestDedupKey`, `slicerPayloadRequestDedupKey`; `gyartasi-igeny.service.ts:27` — `gyartasiFizikaiKulcs` |
| A tárolt kalkuláció és ár különböző objektum; a LeadPilot árát a saját modell számolja | `slicer-kalkulacio.service.ts` — `rogzit`, `sajatArazas`, `arazasSnapshotJson`; `gyartasi-igeny.service.ts` — `gyartasiAllapot` |
| A mostani kalibráció profil/verzió/anyag/réteg/kitöltés/támasz alapú, natív buildet és mérési generációt még nem köt | `packages/shared/src/slicer-kalibracio.ts` — `slicerProfilKalibracioSchema`, `slicerArazhato`; `slicer-api.ts` — `slicerAzonossag` |
| A gyártási modell alapja kézi elrendezési döntést kér | `packages/shared/src/settings/slicer.ts:16` — `slicer_gyartasi_modell_v1`; `packages/shared/src/gyartasi-igeny.ts` — `gyartasiHianyok` |

A telepített LeadPilot partnergép külön, olvasási ellenőrzése a felkészítéskor ezt mutatta: checkout `9aa0c80be461c4cbaed20453a56e28bc7d615932`, az API futó image-e `sha256:2a2c0ca89fc8730d7b3c2919ed5d5a50b9495601a5d3cd7ccf262cf83a88c610`, OCI revision label nincs; az API-ban mindkét Slicer env-változó jelen van. A checkout SHA önmagában nem image-provenance, az env jelenléte nem hitelesítési vagy végpontműködési bizonyíték. A futó adatbázisban feloldott motor/flag/kalibráció és a valódi adapterlánc elfogadási mérését külön rögzítsd; ne nevezd a helyi forrást élő működésnek.

A tényleges partner-DB read-only vizsgálata (exit 0): `slicer_enabled_v1=true`, `slicer_auto_slice_enabled_v1=true`, `slicer_render_enabled_v1=true`, `lead_gyartasi_igeny_enabled_v1=true`, **`slicer_tamasz_alap_v1=true`**. A motor, nyomtató és gyártási modell kulcsának nincs DB-felülírása; ezek a futó alkalmazás defaultját használják. A futó konténer telepített `packages/shared/src/settings.ts` tiszta `resolveSettingValue` exportját is meghívtuk: a hiányzó felülírásokat ténylegesen **Bambu/P1S/`elrendezes_szukseges`** értékre oldotta fel (exit 0). A „még Prusát használ” feltevést tehát az élő konfiguráció is cáfolja; új ügyfélmunkát nem indítottunk. Induláskor ezt a beállítási pillanatfelvételt frissítsd. A lényeges eltérés: a valóban tárolt supports **true**, miközben a kóddefault és a történeti támasz nélküli referencia **false**. Ezt ne változtasd meg automatikusan: a tényleges kalibráció paramétereivel egyeztesd. Ez a mérés konfigurációt igazol, nem ügyfél→Bambu→kiküldött ajánlat E2E-t.

Felhatalmazásod ebben a promptban:

- LeadPilot-forrás, tesztek, helyi dokumentáció, izolált tesztadatbázis/Redis, szintetikus modellfixture, helyi build és helyi commit készítése.
- A Slicer repó és végleges kiadási átadása olvasható összehasonlításra. Slicer-, R3DPlugin-, VPS-, DNS-, route-, allowlist- és titokmódosítás ebben a LeadPilot-szeletben nincs.
- Készíts konkrét, végrehajtható deploy/rollback/aktiválási csomagot. LeadPilot push/merge/tag/deploy, éles migráció, éles flag-/kalibráció-/árpolitika-módosítás és valódi külső küldés csak erre vonatkozó tulajdonosi GO-val. Ha ilyen GO a munkamenetben már megvan, annak pontos határáig dolgozz végig; ne kérj ugyanarra új engedélyt.
- Ügyfélfájl, valódi levél, Gmail, IMAP/SMTP, Telegram, LLM vagy WooCommerce-éles írás nem tesztfixture. Az árazási/regressziós teszteket kizárólag szintetikus adatokkal végezd. Titkot, valós infrastruktúracímet vagy ügyféladatot ne írj a repóba/jelentésbe.

## 2. Indulás és forráselsőség

LeadPilot projekt: `C:/Users/small/Documents/Claude/Projects/Lead feldolgozó rendszer/rocket3d-leadpilot`.

Olvasási sorrend: `AGENTS.md`, `docs/ALLAPOT.md`, `docs/AI-HANDOFF.md`, a releváns teljes deploy-naplóbejegyzések, `docs/03-donteslog.md` D161/D164 és az aktuális D171 utáni döntések, `CLAUDE.md`, `docs/19-github-repo-es-commit-rend.md`, `infra/deploy.md` 30. és 33. szakasza, majd a konkrét forrás. A gráf tájékozódást segíthet, de a végleges állítást aktuális forrás vagy futási bizonyíték adja.

Rögzíts root/branch/HEAD/remote/status/diff alapállapotot. Tiszta, aktuális alapból külön `claude/leadpilot-bambu-vps-catchup` vagy a helyi konvenció szerinti izolált munkaág/worktree; a fő munkafát és idegen változásokat őrizd. Váratlan párhuzamos módosítást ne nyelj be és ne állíts vissza. Párhuzamos munka esetén a shared schema, Prisma, Nest modul és közös dokumentáció csak egy kijelölt integrátorhoz tartozzon.

A Slicer repó `docs/integration-guide.md`, `app/docs/technical-receipt-openapi.js`, `app/docs/slice-openapi.js`, `app/services/slice/bambu-receipt.js`, `receipt-hash.js`, `bambu-generation.js`, `bambu-source.js`, `profile-catalogue.js`, `configs/bambu/printers.json` és a legfrissebb VPS-finalizálási/deploy-átadás a producer igazsága. Az előkészítés munkafája `C:/Users/small/Documents/Claude/Projects/3D-Printer-Slicer-API/.codex/worktrees/vps-finalization-20260907`; ha ezt már lezárták, használd a merge-elt kiadást és annak dokumentált SHA-ját.

Ne égess be egy korábbi `measurement_generation`, profile-digest, engine-build vagy image-digest értéket ebből a beszélgetésből. A Slicer ezen a napon további ellenőrzött finalizáláson esett/eshet át. A tényleges release/aktuális katalógus és az átadási bizonyíték egyezzen. Eltérésnél az érintett automatikus ár zárjon, miközben a független helyi implementációt folytatod.

## 3. A Bambu kliens és a katalógus lezárása

Tartsd meg és erősítsd meg a már létező Bambu útvonalat. Új automatikus Bambu FDM méréshez:

1. A hiteles, konfigurált szerver `GET /profiles` válaszából válassz pontos, támogatott Bambu/P1S vagy Bambu/H2D FDM sort. Szűk, verziózott, méretkorlátozott olvasó legyen; a v2/v3 katalógus Bambu-soraiban az `effective_profile_sha256`, `measurement_generation`, `engine_build_sha256`, `profile_bundle_sha256` új mezőit is ellenőrizd. A katalógus informational; a slice végpont végső befogadási döntését nem helyettesíti.
2. A kiválasztott sorhoz kötött, szerver által feloldott printer/process/material/layer identitás kerüljön a kérés-snapshotba. Ne bízz böngészőből, AI-szövegből vagy tetszőleges URL-ből érkező profile-hashben. A katalógus selectorait zárt paraméterlistával kezeld; endpoint/host/profilútvonal nem válhat SSRF- vagy fájlrendszer-bemenetté.
3. `POST /bambu/slice`, multipart `choosenFile`; `printerProfile=P1S` vagy `H2D`. A kitöltés százalék: a producer szabályos `20` és `20%` bemenetet is elfogad, a válasz `20%`. Ne 0..1 arányt küldj. Bambu nem kap `.ini` / Orca `.json` profilnevet, a 0,3 mm-t ne képezd át csendben. A támogatott listát az aktuális katalógus/registry adja, ne a régi hardcode legyen az egyetlen igazság.
4. A `supports` mindig explicit boolean request-snapshot legyen; a jelenlegi LeadPilot alapja `false`, a producer hiányzó mezőre `true`. A támogatási állást ne fordítsd át hallgatólagosan egy meglévő kalibráció kedvéért.
5. Kötelezően küldd a kiválasztott sorhoz tartozó `expectedProfileSha256` és `expectedMeasurementGeneration` előfeltételeket. A producerben opcionálisak, de az új automatikus consumer-úton legyenek kötelezők. Mindkettő 64 kisbetűs hex.
6. Adj a logikai mérési kísérlethez kötött `X-Request-Id`-t: 1–128 karakter, kezdő alfanumerikus, utána alfanumerikus és `._:-`. Őrizd meg a request–job–calculation kapcsolatot. Ez korreláció, nem szerveroldali idempotenciagarancia.
7. Anyagot a katalógus engedélyezett értékei szerint canonicalizálj (`trim`, case-insensitive bemenet, például `pla` → `PLA`). A bizonylat `applied.material` a canonical igazság. A felső szintű legacy `material` megtarthatja a kérés írásmódját; ne okozz emiatt hamis elutasítást, de valódi PLA/PETG-eltérésnél zárj.
8. Ne legyen automatikus fallback Prusára/Orcára vagy SLA-ra. Meglévő külön, kézi/historikus motortámogatást ne törölj szükségtelenül, de az új Bambu-ár bizonyítását az nem helyettesítheti.

## 4. Technikai bizonylat: egyetlen közös, ténylegesen használt validátor

Készíts tipizált, szigorú Bambu-válasz/receipt validátort, és minden mérésbefogadási, tároltvisszaolvasási, cache- és új automatikus árazási úton használd. Egy újabb típusdefiníció vagy `.passthrough()` önmagában nem javítás.

Kötelező bizonyítás:

- `success=true`, Bambu engine és az aktuális engine-version/build; érvényes job/artifact/request kötés, `applied_layer_height_mm`, `technical_receipt.schema='r3d-technical-receipt-v1'`, `identity.schema='r3d-slice-identity-v1'`, `identity.processing_schema='r3d-bambu-processing-v1'`.
- A receipt csoportjai és teljes mezősémája a producer OpenAPI-jával egyezzenek: `source`, `engine`, `profiles`, `applied`, `geometry`, `scope`, `estimates`, `artifact`, `warnings`, `identity`, request/job/generation/hash. Méret-, elemszám-, mélység-, string- és véges-szám korlátok; kötelező mező hiánya/hibás típusa ne legyen fallback.
- `receipt_sha256`: a teljes receiptből kizárólag ezt a mezőt elhagyva, rekurzívan rendezett objektumkulcsú, tömör UTF-8 JSON SHA-256-ja. Tömbsorrend megmarad; egész értékű float egésznek szerializálódik; `-0` → `0`, `null` megmarad. Használj a producerrel közös tesztvektorokat. A `job_sha256`-t is ellenőrizd a producer szerinti `{engine,profiles,applied,source,geometry,scope}` projekcióból. Hash önmagában nem aláírás vagy hiteles forrás: a TLS/konfigurált endpoint/kulcs/current-catalogue bizalom is szükséges.
- `measurement_generation` egyezzen a választott/pinnelt current-catalogue generációval; `engine.build_sha256` és `profiles.bundle_sha256` a katalógus megfelelő build/bundle mezőivel; printer/profil/process/filament és effective-profile identitás a konkrét kiválasztott recepttel. A recipe-digest nem teljes mérési identitás: Bambu esetén a réteg/kitöltés/support kérésfelülírások nincsenek mind a profilhashben.
- `source.sha256` a valóban kiküldött eredeti fájlbájtok SHA-ja legyen, és a source-format a kezelt valódi formátumnak feleljen meg. Az eredeti, normalizált geometria és végleg szeletelt geometria külön hash; ne követeld, hogy a három azonos legyen.
- `applied` alapján mérj: tényleges anyag, layer-mm, 0..100 egész infill, supports, `evidence='bambu_gcode_config'`. Ezeket egyeztesd az immutable kéréssel és a felső szintű mezőkkel; anyag írásmódját canonicalizálva. A `SlicerMeres` többé ne állítsa a requestből vett anyagról/rétegről/kitöltésről, hogy upstream mérési tény.
- `geometry`: valid/watertight/winding-consistent, egy komponens, pozitív volume, `validated_triangle_mesh`. `scope`: egy connected solid, egy source object, egy instance, egy plate, egy filament, `quantity=1`, `kind=single_part`. Több komponens/assembly/ambiguous 3MF/nesting nem bizonyított per-darab tény, kézi utat kap.
- Őrizd meg és ellenőrizd `model_transform.transform_schema=2`: eredeti/orientált/végső mm-méretek; eredeti méret csak akkor lehet null, ha `original_dimensions_available=false`; requested/automatic/effective rotation és mátrix; scale, sizing, orientation mode/outcome. A total matrix `R_requested * R_automatic`, ahol `R_requested=Rz*Ry*Rx`; a sorrend automatikus orientáció → orientált tengelyek menti méretezés → explicit forgatás → elhelyezés. Euler-szövegazonosság helyett a szerződés geometriai invariánsait ellenőrizd. Ne keverd az eredeti és végső méreteket.
- Unitless STL mm; `sizeUnit=inch` a kért célméret értelmezése, nem önálló „STL inch” bizonyíték. A meglevő LeadPilot rotation út mellé az `orientationMode` tényleges szándékát rögzítsd és verziózd; explicit auto/preserve megadás ne változtassa meg csendben a korábbi fizikai eredményt. Nem támogatott scaling/target-size igény kézi/specifikációs feladat legyen, ne vesszen el.
- Bambu-idő: pozitív egész `print_time_seconds`, `print_time_source='total_estimated_time'`, `time_basis='including_start_sequence'`. Tömeg: pozitív véges `material_used_g`, `material_used_g_source='total_filament_weight_g'`. A felső szintű stats egyezzen a receipt estimates értékeivel. Az óraváltás pontosan seconds/3600.
- `model_time_seconds`, `preparation_time_seconds`, `support_material_g` jelenleg null, nem nulla és nem becsülhető más mezőből. `calibration='raw_slicer_estimate'` nem fizikai kalibráció.
- Az artifact az igazi `.gcode.3mf` metaadata: id/hash/size/type/inner-gcode hash/access/retention. Metaadat-azonosságot ellenőrizz, hozzáférési jogot ebből ne gyárts. A lejáró Slicer artifact nem tartós rendeléstár; artifact-letöltéshez külön audience-jog szükséges, slice-kulcsból ne legyen admin/artifact-kulcs.
- `NATIVE_WARNING_UNCLASSIFIED` és `ORIENTATION_FALLBACK` maradjon meg path/log-adat nélkül, és fusson át az explicit warning/manual policy-n. Ne nyeld el a figyelmeztetést azért, hogy gépi árat kapj; ne találj ki fizikai kalibrációt a technikai receiptből.

Ismeretlen/hiányos/más generációjú receipt mellett nincs új automatikus ár. A hiba tartós, géppel és operátorral is értelmezhető következő lépést adjon; nem szabad fals „0 Ft”, kész kalkuláció vagy végtelen várakozás maradjon.

## 5. Cache, queue, migráció és a késői eredmény

Vezesd végig az új mérési identitást a produceren, BullMQ payloadon, consumeren, dedup kulcson, DB-kalkuláción, `paramsJson`/`resultsJson`, gyártási állapotolvasón, fact/draft és Telegram-előnézet útján. A saját cache/dedup sémáját bumpold; a régi payload/generation nélküli row nem lehet új generáció aktuális cache-találata.

Fizikai mérési kulcs: eredeti file-hash és formátum/egységértelmezés, motor, printer/recept/effektívprofil, natív build/bundle/measurement generation, minden tényleges slicer-paraméter, orientáció és igényelt transzformáció, scope/processing schema. Logikai üzleti kulcs: lead/source-message/attachment/tétel/igényverzió/mennyiség és aktuális árpolitika. A kettő különüljön el, de minden felhasználáskor legyen ellenőrzött kapcsolat. Az upstream job/artifact/random request ID és a HUF ár nem jó fizikai cache-kulcs.

Az `egyenkenti_fdm` modellen a darabszám önmagában nem igényel új natív mérést, ha az egydarabos mérés teljes fizikai identitása és generációja még aktuális; viszont új üzleti kalkulációt/factet/draftot/előnézetet igen. Más geometriánál, receptnél, supportsnál, orientációnál vagy producer-generációnál új mérés kell.

Különösen javítandó olvasók: `meglevoAutomatikusEredmeny`, `gyartasiAllapot`, visszatérő DB-dedup, notification/reconciliation és meglévő kalibrációs olvasás. Ne csak a HTTP-válasz kapuját zárd le, miközben a DB-ben egy régi ár továbbra is „aktuális”. Az aktuális generáció ismert, verziózott szerverállapot legyen; ne végezz hálózati hívást adatbázis-tranzakció vagy küldési lock alatt.

V1 → V2 migráció additív és visszaállítható legyen. Régi mérés/elfogadott ajánlat/rendelés immutable marad. Hiányzó receipt/build/generation nem tölthető ki a mai adatokkal; „legacy / új automatikus használathoz újramérés kell”. A régi kalibrációt nem szabad az új generációra átnevezni. Készíts számláló dry-run jelentést a remeasure/reprice/stale/manual kategóriákra, ügyféladat-lista nélkül; éles tömeges replay/törlés/stale-hullám nincs külön GO nélkül.

Egy újabb igény vagy draft után érkező régi slice-válasz nem írhatja felül az aktuális tényeket. A fizikai mérést auditként eltárolhatod, ha a kötése ellenőrzött, de aktuális státuszt csak a mostani igény–paraméter–generáció egyezése ad. Adatszintű unique/CAS és meglévő kommunikációs lock zárja a konkurens eredményfeldolgozást. Redis-redelivery és notification retry ne indítson új slice-ot vagy második ügyfélküldést.

## 6. Jó ár: műszaki becslés és üzleti árpolitika

Az árat a LeadPilot jelenlegi, verziózott `arazas_modell_v1`/V2 árazómagja és `arazasSnapshotJson` adja. A Slicer `estimated_price_huf` mezője kizárólag provenance/összehasonlítás; ne másold át ügyfélárnak, és ne használd fallback árként. Őrizd meg a minimum, kerekítés, mennyiség, felár/kiegészítő, adó/nettó-bruttó és lead/feladattípus szabályait; üzleti módosítást külön döntésként nevezz meg.

Minden tételnél az ellenőrzött Bambu idő és gramm az input. Az idő már tartalmazza a start sequence-et; a számítás auditjában ellenőrizd, hogy külön technikai indulási idővel nem számolják-e még egyszer ugyanazt. Önálló, tulajdonos által jóváhagyott üzleti setupdíj lehet más költség, de ne nevezd a null preparation mezőt mért beállási időnek. Ne változtass díjpolitikát bizonyíték/döntés nélkül.

`quantity=1` a Slicer bizonylatban, üzleti darabszám a LeadPilot tételben. Csak a már kifejezetten jóváhagyott `egyenkenti_fdm` modellen szorozz lineárisan; ez ismételt egyenkénti gyártás becslése, nem közös plate/nesting optimalizáció. `elrendezes_szukseges`, szerelvény, több darab egy bed-en, SLA vagy nem igazolt scope esetén célzott kézi gyártási feladat és ár nélküli/pontosan indokolt állapot. A globális modellt ne kapcsolgasd csak azért, hogy zöld legyen a teszt.

A meglévő kalibrációs kaput tartsd zárva, de egészítsd ki a Bambu engine/build/profile bundle/measurement generation és receipt-derived applied paraméterek identitásával. A `raw_slicer_estimate` és a korábbi GUI-összehasonlítás nem gyártott alkatrészen mért fizikai kalibráció. Ha a jelenlegi üzleti policy automatikus árhoz fizikai kalibrációt követel, a prompt nem oldja fel. Készíts pontos, tulajdonos által jóváhagyható kalibráció-import/ellenőrző csomagot; új generációra csak valós dokumentált kompatibilitási bizonyíték/döntés mellett kerülhet érvényes bejegyzés. A 15%/20% infill és supports-on/off eltérés nem azonos konfiguráció.

A felületen a felhasználó ezt értse: melyik nyomtató/recept, milyen anyag/réteg/kitöltés/támasz, hány darab, melyik gyártási modell, becsült idő/tömeg, aktuális vagy kézi döntést váró ár és konkrét következő lépés. SHA/receipt/stacktrace ne folyjon bele ügyfélszövegbe; a részletes provenance operátori diagnosztikában legyen hozzáférhető.

## 7. A LeadPilot teljes belső lánca

A D164/JV7-INT igény → kalkuláció → aktuális draft → Telegram revízió → friss emberi jóváhagyás láncát használd, ne építs párhuzamos ajánlatdomént.

- A késői mérés vagy mennyiségrevízió elavítja a korábbi árkötést, factet és jóváhagyást; új előnézet és új emberi döntés szükséges.
- Több fájl összesen csak akkor árazható, ha minden szükséges tétel aktuális és igazolt; a LeadPilot minimum egyszer, az aggregátumon érvényesül a létező szabály szerint.
- `20 helyett 30` a tétel igényverzióját és árát módosítsa, fizikailag változatlan egydarabos mérést biztonságosan újrahasználhat. `15% helyett 20%` új fizikai identitás és mérés. Más lead/attachment/file vagy generation soha nem cserélhető be.
- D171 aktuális csatolmány-kapuja megmarad: a csatolmányos Telegram-jóváhagyás tripwire-jét ne kerüld meg. A szükséges végleges előnézethez használd a jelenleg támogatott UI/jóváhagyási útvonalat, és külön mondd ki, ha a Telegramos csatolmányküldés másik szelethez tartozik.
- A `ReplyFactSnapshot`, send snapshot, aktor/ownership/CAS, MIME/címzett/törzs/csatolmány-hash kötés és `send_uncertain` védelem változatlanul szükséges. Árváltozás után egy régi jóváhagyó gomb pontosan 0 külső küldést eredményezzen.
- A hiba vagy kalibrációhiány ne indítson AI-ból kitalált árat; tartós, magyar operátori ok és egy konkrét következő teendő keletkezzen.

## 8. Hálózat, timeout és biztonságos újrapróba

Az API service használja a Slicer URL/token envet; a tényleges paraméterek és flag-ek a Settingsben élnek. A Slicer külön VPS-en van, nincs helyi `slicer` service vagy megosztott belső háló, ne állítsd vissza a régi vázat. Backend-only per-consumer kulcs, `x-slicer-api-key`; URL/kulcs a megfelelő Compose-envbe kerül, nem frontendbe, logba, fixture-be vagy `.env` commitba.

A Slicer finalizálási körének élő auth-ellenőrzésében a mód `migration`, a LeadPilot- és WooCommerce-principal slot egyaránt jelen van; a legacy shared-kulcs lejárata `2026-11-30T00:00:00Z`. A külön principalok szintetikus üres feltöltésre `400 NO_FILE_UPLOADED`, hiányzó/hibás kulcsra `401` választ adtak. Ez külön Slicer-auth bizonyíték, nem igazolja, hogy a LeadPilot envje már a saját principalját tartalmazza. A LeadPilot saját tokenjét bizalmas, csak boolean egyezést kiadó ellenőrzéssel vagy engedélyezett secret-provisioninggal kösd a saját principalhoz; nyers titkot és titokhash-t ne írj a jelentésbe. Shared/legacy kulcsot ne vonj vissza önállóan: a migrációs mód csak mindkét consumer igazolt átállása után zárható. A publikus route meglévő LeadPilot-only határát ne tágítsd.

Tartsd meg a külön connect-timeout/saját timeout/HTTP auth/edge allowlist/queue/resource/native geometry hibabesorolást. A jelenlegi kliens 900 000 ms slice- és 12 000 ms health-budgetjét az aktuális Slicer queue+preprocessing+native és proxy-budget alapján ellenőrizd. A HTTP-status önmagában nem bizonyít IP-allowlistet; a saját abort után a natív munka még futhat.

Új kódok: `400 INVALID_SLICE_IDENTITY` (kérésforma), `409 SLICE_IDENTITY_MISMATCH` (elavult selection/generation), `422 AMBIGUOUS_MANUFACTURING_SCOPE`, `422 BAMBU_RESULT_UNVERIFIED`, `503 SLICER_ENGINE_UNAVAILABLE`. Ezekhez konkrét magyar következő lépés. A 409 után bounded katalógusfrissítés és új, kifejezetten újraellenőrzött snapshot lehet; a régi kérést változatlanul loopban újraküldeni tilos. 422/unverified/sérült receipt/rossz source vagy hash nem átmeneti transporthiba.

A `X-Request-Id` nem idempotency API; nincs kitalált upstream job-status endpoint. Connect előtti hiba, upstream whitelist hiba, saját timeout és kapcsolatvesztés a feldolgozás után külön tesztelendő. Bizonytalan eredményre legyen tartós státusz és kontrollált helyreállítás; ne legyen szoros újrafeltöltési ciklus. Az üzleti DB- és BullMQ-idempotencia önállóan álljon meg, notification retry csak DB/outbox reconciliationt végezzen. Rate/queue/auth/path/timeout korlátot ne gyengíts.

## 9. Kötelező bizonyító tesztek

A legkisebb érintett tesztekkel kezdj, aztán a repo teljes releváns kapuja: shared/API/web, TypeScript a repo által előírt Node-verzióval, lint/format, build, dokumentációs kontraktus. A Node 22 és helyi Node 24 ismert típusellenőrzési eltérését pontosan címkézd. Ne találj ki tesztszámot, ne kezeld a skipet PASS-ként.

Kötelező regressziók:

1. Valós alakú, determinisztikus producer-receipt fixture helyes canonical hash-sel átmegy; canonical anyag és elfogadott kisbetűs/whitespace alias ugyanazt jelenti. Réteg/kitöltés/support és a felső szintű stats valódi eltérése elbukik.
2. Egyenként módosított source hash, request/job/artifact kötés, build/bundle/profile/generation, receipt hash/job hash, idő/tömeg/null/NaN/Infinity, scope/component count, unit/transform mező és warning: az érintett kapu zár. Egy hash-helyes, de másik forráshoz vagy requesthez kötött receipt is bukjon.
3. Hiányzó receipt vagy generation nem kap automatikus Bambu-árat; történeti sor tovább olvasható, de nem válik új current factté. Már létező DB/cache találat megkerülési kísérlete is bukjon.
4. Ugyanaz a file + más generation/build/profile/support/infill/orientáció/transzformáció külön fizikai identitás. Csak darabszámváltás az explicit egyenkénti modellen nem szeletel újra, de új ár/draft/approval kell.
5. Katalógusváltás sorba állítás és execution között: 409, kontrollált új snapshot, nincs régi/current keverés és korlátlan retry. Elérhetetlen katalógus/rossz schema/unsupported 0,3 mm/P1S–H2D keverés/rossz engine: fail closed.
6. Saját timeout, válaszvesztés sikeres upstream végrehajtás után, redelivery, consumer-restart és konkurens DB insert: nincs második aktuális kalkuláció és nincs automatikus újabb natív job bizonytalan kimenetnél. Whitelist átmeneti hiba továbbra is bounded retry; 422 és receipt-hiba terminális.
7. A Slicer `estimated_price_huf` tetszőleges módosítása nem változtatja a LeadPilot ügyfélárát. Saját árpolitika-változás ugyanabból az aktuális mérésből új üzleti árkötést ad; régi ár/jóváhagyás stale. Minimumot és mennyiséget ne alkalmazz kétszer.
8. Teljes szintetikus folyamat ténylegesen izolált PostgreSQL + Redis/BullMQ + valódi LeadPilot service/worker útvonalon: igény → queue → HTTP adapter kontrollált fixture-szerverhez → receipt validálás → DB → aktuális kalkuláció/draft → revízió → approval gate → fake send-port. Több komponens/missing calibration/hiányos igény és késői stale eredmény negatív eset is kell. Ne hívd ezt valódi VPS-szeletelésnek.
9. Valódi árazási/küldési kapun végzett legalább két source-mutation negatív kontroll: egy receipt/generation-ellenőrzés szándékos eltávolítása valóban bukjon a tesztben; egy régi árkötés/jóváhagyás engedélyezése bukjon és igazoljon 0 küldést. Ezután állítsd vissza a forrást és futtasd újra a pozitív tesztet. A tesztben átírt másolat vagy ugyanazt a feltételt lemásoló assertion nem negatív kontroll.
10. Tulajdonos által engedélyezett, kizárólag szintetikus külső próba esetén a LeadPilot tényleges adapterének szolgáltatáshálózatából a végleges VPS-re: aktuális katalógus, megfelelő consumer-kulcs, legalább egy támogatott P1S recept, pozitív idő/tömeg és teljes validált receipt; rögzített producer-release/generation. Ha ilyen GO/környezet nincs, ez `NOT_RUN`/`BLOCKED`, és a kész helyi csomagot ettől még add át. Külső SMTP/Telegram/LLM/ügyfélforgalom ekkor sem része a próbának.

A teszt PG külön tulajdonolt, friss adatbázis legyen; a meglévő magyar ICU/`hu-HU` és canonical board seed igényeit tartsd meg. Izolált Redis namespace/processz, kijelölt szintetikus fájltár, letiltott külső küldők. A meglévő dev/staging DB-t vagy élő queue-t ne ürítsd. A futtatás végi takarítás kizárólag a bizonyítottan saját erőforrásokat érintheti.

## 10. Kiadási és operátori csomag

Készíts rövid, végrehajtható, titokmentes runbookot: commit/SHA/image elvárás; build; szükséges additív migráció; kompatibilis régi image rollback; app/worker szerepek; API env jelenlét és audience; current-catalogue pin frissítés; kalibrációs és manufacturing-mode döntés; bounded szintetikus smoke; stale/cache migration dry-run; külön aktiválási lépések; visszaállás következményei.

A futó LeadPilot vizsgálatához a forrás szerint `/opt/r3d-leadpilot`, `infra/docker-compose.prod.yml`, `api` a releváns szerep. A default runtime munkakönyvtár `/app`; a Prisma workspace-csomag az API-ban érhető el, read-only `Setting.findMany` vizsgálatnál `/app/apps/api` munkakönyvtár vagy `/app/apps/api/node_modules/@prisma/client` import kell. Nest alkalmazást ne indíts csak konfigurációolvasásért. A DB tábla `settings`, oszlopok `kulcs`, `ertek_json`; csak szűk kulcslistát olvass. Env-érték helyett jelenlét, customer/model filename helyett összesítő darabszám és szükséges technikai identitás.

Feloldandó settings-lista: `slicer_enabled_v1`, `slicer_auto_slice_enabled_v1`, `slicer_render_enabled_v1`, `slicer_motor_v1`, `slicer_bambu_nyomtato_v1`, `slicer_tamasz_alap_v1`, `slicer_gyartasi_modell_v1`, `slicer_kalibracio_v1`, `lead_gyartasi_igeny_enabled_v1`, az érintett árpolitika és az új generation/receipt policy mezők. Hiányzó DB-sor nem nulla és nem false minden kulcsnál: az alkalmazás tényleges resolverével érvényes defaultot is mutasd. Éles SQL-upsert/flagváltás csak aktiválási GO után.

Ne kényszerítsd le a meglévő flag-eket pusztán azért, mert a kódbeli default false. Előbb olvasd a valós állapotot, készíts rollbacket és az átállási kockázatot záró tervet. Generációváltás az automatikus ár jogosultságát érintheti; a korábbi megrendeléseket és jóváhagyott ajánlatokat ne írd át.

Dokumentáció: `docs/ALLAPOT.md`, `docs/AI-HANDOFF.md`, új pontos D-bejegyzés a döntésnaplóban, indokolt integration/deploy runbook és tesztbizonyíték. A `CLAUDE.md` vagy `.codex/**` helyi tulajdonosi szabályait tartsd meg; ne állítsd, hogy Claude.ai Project-knowledge frissült csak azért, mert fájlt írtál. A régi történeti napló nem írható át új sikerré.

## 11. „Kész” feltétele és végső jelentés

Kész a helyi megvalósítás, ha a valódi LeadPilot belépési/queue/service/fact/approval út használja a receipt-ellenőrzést, a fizikai és üzleti identitás végig kötött, a régi mérés nem örökli az új bizalmat, a saját árpolitika megmarad, és a fentieket a regressziók és tényleges PostgreSQL/Redis-integráció igazolják. A szigorú új Bambu út nem kerülhető meg legacy DB sorral, régi queue payloaddal vagy „meglevo” visszatéréssel.

A végén magyarul, tényszerűen add át:

- Baseline, végleges branch/HEAD, saját commitok, módosított fájlok, megőrzött idegen változások.
- A Prusa/Bambu kérdés tényleges válasza külön: helyi forrás, dokumentált deploy, futó konténer/Settings és valódi adapterpróba.
- Javított konkrét rések és átmeneti/üzleti döntési pontok; milyen kombinációra gépi, melyikre kézi az ár.
- Pontos tesztparancs, exit code, PASS/FAIL/SKIP szám, mutációs negatív kontroll és helyreállítás; statikus/mock/valódi DB+Redis/native VPS bizonyíték külön.
- Implementált, tesztelt, commitolt, integrált, deployolt, aktivált státusz külön; `NOT_RUN` vagy `BLOCKED` ne legyen zöld.
- Konkrét deploy/rollback/activation csomag és ha még szükséges, a legszűkebb, végrehajtható tulajdonosi GO szövege. Ezt csak a felkészített és tesztelt csomag után kérd.
- 0 külső ügyfélküldés, 0 tiltott éles mutáció, 0 titok/ügyféladat az új forrásban és jelentésben.

Ne add vissza a problémát puszta javaslatként. A függetlenül elvégezhető implementációt, tesztelést, felületet és helyi commitot fejezd be akkor is, ha a végső aktiválást kalibrációs vagy tulajdonosi döntés tartja zárva.
