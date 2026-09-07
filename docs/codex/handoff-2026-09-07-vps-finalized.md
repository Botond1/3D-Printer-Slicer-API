# Slicer VPS — véglegesített kiadás, 2026-09-07

## Eredmény és pontos kiadási azonosság

**DEPLOYED_NATIVE_AND_PERIMETER_VERIFIED.** A javított Bambu Slicer élesben fut;
a két fogyasztó saját slice-kulcsával végzett szintetikus natív kontroll sikeres.
A plugin/LeadPilot teljes üzleti folyamata és WordPress-aktiválás külön feladat;
azokhoz az alább hivatkozott Opus-promptok készültek.

- Telepített forrás: `8bf11c9661c4c6bab7ff2b8343db40a6134f15a0`.
- Image: `ghcr.io/botond1/3d-printer-slicer-api@sha256:b3b7a616daa34f2635a9df8040d4b26b13a4cdd32c341de7023565a26d3eab99`.
- Registry config digest: `sha256:490eb0fab6b793257394f54118ff74e76d9d17ecce341007bc5e3689149a9549`.
- API-konténer: `a93a5efdc97b7825cfc3a4dc27166f908fa59d7cccc09f2c2fd632bc84ae7a34`.
- Indulás: `2026-09-07T17:16:02.666158552Z`; végső azonosságellenőrzés:
  `2026-09-07T17:22:46.892196+00:00`.
- Healthy, 0 restart/OOM, UID/GID `999:999`, read-only root, 4 GiB/2 CPU/512 PID,
  0 publikált API-port. A proxy és service-env változatlan.
- API Compose pack: `4fb770d792eac932f02a6c9b3f407a7822a1996b`;
  élő router pack: `9e9621a3f6110192aeb77a5c182da5aad79c80e7`. Az image,
  az operátori pack és a router külön azonosság marad.

A VPS Docker-tárolója a manifest digestet adja vissza runtime image ID-ként.
Ezért a `.Image`/`.Id` itt `b3b7a616…`, nem a config digest. A nyers registry
manifest SHA-256-a pontosan `b3b7a616…`, a benne szereplő config digest `490eb0fa…`;
a host image- és konténer-descriptorai, RepoDigests és revision label mind ehhez
kötöttek. A két digest szerepe nincs összemosva.

Géppel olvasható, titokmentes bizonyíték:
[`evidence/vps-finalization-20260907-deployed.json`](evidence/vps-finalization-20260907-deployed.json).
A korábbi, csak elkülönített próbáig jutott image külön történeti rekordja
[`vps-finalization-20260907-prepromotion.json`](evidence/vps-finalization-20260907-prepromotion.json).

## Javítások és Git-baseline

Az eredeti munkafa `codex/calculator-profile-parity-20260906`, HEAD
`714193bea52e4a6413e318e69f0b4b56916370b6`, 11 korábbi módosított tracked fájllal
és saját untracked anyagaival megmaradt. Nem történt reset, stash vagy ezek
beolvasztása. A munka külön linked worktree-ben indult az
`fc968206b426a6ca0b099decd8d09c23f61623d3` main baseline-ról.

1. [PR27](https://github.com/Botond1/3D-Printer-Slicer-API/pull/27): commit
   `619022e6d32e19d749c275d8bb91ee472496478b`, merge
   `4f7af888d45a0fa1def59db9c85edd82addcb5e9`.
   `app/services/slice/bambu-receipt.js::validateAppliedConfig` a már elfogadott
   kérésoldali anyagot trim/uppercase formára hozza a natív canonical anyaggal
   való összehasonlítás előtt. A kisbetű/whitespace többé nem okoz hamis
   `BAMBU_RESULT_UNVERIFIED` hibát. Más natív anyag továbbra is elutasított.
   A receipt-regresszió, OpenAPI/catalogue leírás, integrációs útmutató,
   changelog, Codex-tudás és a két consumer-prompt frissült.
2. [PR28](https://github.com/Botond1/3D-Printer-Slicer-API/pull/28): commit
   `125a961ce055cc7ecd9de25d4f5c9fbe57928194`, merge a telepített `8bf11c966…`.
   `.github/release-rehearsal-policy.json` a ténylegesen telepített, aláírt
   `4539c539d15dacb19cde7e246aab690cc11170e7` previous image-et rögzíti.
   `scripts/i9-staging-contract.js` a valós modern readiness-sémát ellenőrzi,
   kötelező Bambu/common-dependency bizonyítékkal és opcionális Prusa/Orca
   motorokkal. Négy kapcsolódó tesztfájl és a Codex-handoffok frissültek.
   Az ancestry, configs/Compose, aláírás, storage-only hibainjektálás és
   automatikus rollback kapui változatlanul kötelezőek.

A completion-dokumentáció saját ága `codex/slicer-deployment-evidence-20260907`.
Egy későbbi, csak dokumentációt integráló main commit nem címkézi át a futó
image-et: annak forrása továbbra is a fenti `8bf11c966…`.

## Pontos ellenőrzések

| Kapu | Eredmény |
| --- | --- |
| `git diff --check` | exit0 |
| `npm run check:syntax` | exit0; 311 JS, 64 Python |
| `npm run test:js` | exit0; 2817/2817, 0 skip |
| `npm run test:python` | exit0; 226 esetből 218 pass, 8 környezeti skip |
| `npm test` | exit0; ugyanaz a 2817 JS és 218 Python pass/8 skip |
| `node --test tests/unit/js/instruction-mirrors.test.js` | exit0; 2/2 |
| `npm run check:repository-safety` | exit0; 606 tracked fájl az új evidence stagingje előtt |
| `npm run check:repository-safety:staged` | exit0; a PR28 12 saját fájlja |
| `npm ci --ignore-scripts --no-audit --no-fund` | exit0; 132 csomag; a qualification nem változtatott lockfile-t |
| Receipt regresszió | javítás előtt 22 pass/3 fail; utána 25/25 |
| Policy/materializer/publication regresszió | régi policy mellett 17 pass/5 fail; végül 23/23 |
| I9 readiness | modern pozitívak előtte 58 pass/4 fail; végső teljes I9: 279/279 |
| Független quality/security review | PASS; nincs guard-gyengítés; contract 218/test 248 sor, új helper 60 sor alatt |

A Python skip-ek 7 hiányzó helyi geometry dependency és 1 Windows/POSIX
környezeti eset; nem natív-image PASS-ok. Helyi Docker-daemon nem volt
használható; a tényleges konténeres bizonyíték a hosted gatekből és a VPS-ről jön.

A későbbi, hét fájlos completion-dokumentáció külön ellenőrzése: staged diff
whitespace ellenőrzés exit 0; instruction-mirrors 2/2, exit 0; repository-safety
609 tracked és 7 staged fájl, mindkettő exit 0. A fenti teljes lokális suite-ok
a kiadási forrás javításait ellenőrizték; a dokumentáció nem változtat runtime kódot.

Minden következő hosted run **success**, a pontos PR/main SHA-hoz kötve:

| Kapu | Run |
| --- | --- |
| PR28 Source / Image | [34143908455](https://github.com/Botond1/3D-Printer-Slicer-API/actions/runs/34143908455) / [34143908407](https://github.com/Botond1/3D-Printer-Slicer-API/actions/runs/34143908407) |
| Main Source / Image | [34144459943](https://github.com/Botond1/3D-Printer-Slicer-API/actions/runs/34144459943) / [34144459936](https://github.com/Botond1/3D-Printer-Slicer-API/actions/runs/34144459936) |
| Aláírt publication | [34145006742](https://github.com/Botond1/3D-Printer-Slicer-API/actions/runs/34145006742) |
| Automatikus hibainjektálás és rollback | [34145708341](https://github.com/Botond1/3D-Printer-Slicer-API/actions/runs/34145708341) |

Provenance és SPDX aláírás: exact repository/workflow/ref/source/digest,
GitHub API, OCI és offline bundle verifikáció; a rossz repo/digest negatív
kontrollja is PASS. A helyi `gh attestation verify` mindkét predicate-re exit0.
Grype 0.110.0, DB `2026-09-07T06:38:20Z`: 0 High, 0 Critical.
Az automata próbában a `0700 -> 0500` pricing-state módváltás a várt
`STORAGE_UNSAFE`/503 állapotot okozta; az automatikus rollback visszaállította
a previous image-et, módot és szintetikus állapotot. A natív Orca-próbák,
readiness, auth, queue-idle és saját erőforrások takarítása is sikeres.

## Bambu ár és éles kontroll

Bambu Studio `02.08.02.61`, P1S, PLA, 0.2 mm, 20% infill, preserve orientáció;
kizárólag saját, zárt szintetikus kockák. Az új image elkülönített négy
kontrollja mindkét audience-t, anyag-alakokat és supports on/off esetet lefedett.
A `.gcode.3mf` belső G-code hashét, anyagát, idejét, grammját és az abból
számított összeget külön archive-olvasás is visszaellenőrizte.

| Modell | Natív idő | Natív tömeg | Slicer-ár 800 HUF/óra mellett |
| --- | --- | --- | --- |
| 20 mm kocka | 1262 s | 3.96 g | 290 HUF |
| 40 mm kocka | 2453 s | 24 g | 550 HUF |

Az éles WooCommerce- és LeadPilot-kulcsos kérés egyaránt HTTP200 és a 20 mm-es
sorral egyező eredmény. Teljes receipt-hash, source/profile/generation/build/
bundle és applied-config kötés ellenőrizve. A kérés ideje a VPS loopbackén
5328 és 5166 ms volt; ez nem a fogyasztói felület teljes hálózati ideje.

Generation: `4b2ee8ea76405cc7a999fff5c7fc30c0f25c844e3d9574fe32054b1d44a08544`.
A kontroll profilja: `70e87eaff59a65d93fbfddd507eaa08d2ee52e5857e222757f32199d7fc9f06f`.
A díjképlet megmaradt: `ceil(max(seconds,900)*hourlyRate/3600)`, majd felfelé
kerekítés 10 HUF-ra. A gramm pozitív, natív adat, a Slicer díja időalapú.
A fogyasztók saját kereskedelmi árpolitikája és a fizikai kalibráció külön tény.

Az első éles promotion kontrollja exit1-et adott, ezért automatikusan a régi,
healthy image-re állt vissza. Az első subprocess stdoutja nem maradt meg, ezért
annak pontos assertionje utólag nem állítható bizonyítottként. Elkülönített,
azonos beállítású, szintetikus kulcsos környezetben a readiness folyamatos
lekérdezése reprodukálta a kontroll hibáját: két HTTP200 natív eredmény után a
cache még 1 aktív jobot mutatott. A kontroll az üres sort ezután a friss,
védett `/health/detailed` válaszból igazolja. Normál és readiness-polling esetben
4/4 kontroll PASS; a külön mentéssel végzett második éles promotion 2/2 PASS.
Az API cache-szerződése és a biztonsági kapuk emiatt nem változtak.

## Perem, megőrzött állapot és visszaállás

Két teljes privát-peer próba igazolta az ingress/readiness és hiányzó/hibás
operations-kulcs elutasítását. Működő saját DNS/TCP/UDP pozitív kontroll után
az API és a natív Python child mindhárom kimenete kétszer tiltott volt.
Traefik nem engedélyezett hívóra 403; perimeter service aktív. A saját sentinel,
peer-konténerek és teszthálózat eltávolítva, API-konténer azonossága megmaradt.
Végső health/ready 200, catalogue 88 sor; hiányzó/hibás slice-kulcs 401,
mindkét principal üres feltöltésre 400 `NO_FILE_UPLOADED`.

Rollback image: `ghcr.io/botond1/3d-printer-slicer-api@sha256:1c784b627fc5783b633b9a0b7c2b086588fbe149c00770d7f0cac5594860efb9`.
Az image, az eredeti operator/service-env és a pricing/input/output mentés
megmaradt a VPS feladathoz tartozó, privát recovery könyvtárában. A két
promotion külön recovery rekordot használ. Visszaállításnál csak a rögzített
image/operator értéket kell atomikusan helyreállítani a meglévő explicit
`slicer-api` Compose-projekttel; későbbi futási adatot nem szabad vakon felülírni.
A végleges image a tartós operator-envben is rögzített, nem egyszeri shell override.

Nincs DNS-, route-, allowlist-, kulcs-, profil- vagy díjtábla-változás.
Nincs consumer-kód/DB-módosítás, ügyfélmodell-küldés vagy külső üzleti üzenet.
Az új forrás és bizonyíték nem tartalmaz hitelesítő adatot vagy ügyfélanyagot.

## Consumer-átadás és fennmaradó határok

LeadPilot ellenőrzött telepített konfigurációja már **Bambu/P1S**, nem Prusa.
Hiányzó engine/printer settings esetén az installált resolver adta ezt az
alapértéket. A tényleges hiány a receipt/generation ellenőrzése és annak
DB/cache/ár/jóváhagyás láncon átvezetése. Az ellenőrzés nem új üzleti E2E.

- [LeadPilot Opus 5 végrehajtóprompt](claude-opus-5-leadpilot-bambu-catchup-20260907.md).
- [R3DPlugin V2 Opus 5 végrehajtóprompt](claude-opus-5-r3dplugin-bambu-finalization-20260907.md).

Mindkettő friss baseline-t és célból visszaolvasott identityt kér, megőrzi a
saját üzleti árpolitikát, tényleges DB/queue/order bizonyítékot követel, és
elkülöníti a helyi kész csomagot az éles aktiválástól. A WordPress szerver
hozzáférése/aktiválása itt **NOT_RUN**; a route továbbra is LeadPilot-only.
A közös slice-kulcs migrációja `2026-11-30T00:00:00Z`-ig véges; lezárása előtt
mindkét tényleges caller saját principal-kulcsra váltását kell igazolni.
A fogyasztói munkák egymástól függetlenül folytathatók a promptokkal.
