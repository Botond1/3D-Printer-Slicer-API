# S3a-B1 — image liveness diagnosztika és fail-closed kapuaggregálás

## Végrehajtói profil

- Modell: `gpt-5.6-sol`
- Effort: `high`
- Ne használj `xhigh`/`max` effortot, hacsak a bizonyított root cause több
  biztonsági invariáns között valódi ellentmondást nem tár fel.

## Küldetés

Diagnosztizáld és — kizárólag bizonyított ok esetén — minimálisan javítsd az I0
integráció után jelentkező hosted container-liveness regressziót. Közben alakítsd
át az image validation vezérlését úgy, hogy egy runtime smoke-hiba ne rejtse el a
tőle független SBOM/Grype eredményt és a biztonságosan korlátozott diagnosztikát,
de a teljes job továbbra is kötelezően fail-closed maradjon.

Ez nem általános Docker-refaktor, dependency maintenance, action-upgrade,
production deployment vagy promotion etap.

## Rögzített bemenetek

- `CODE_BASELINE`: `58dcf1065ff39b6da1ba72d0d9c910d788a843ab`
- `WORK_BASELINE`: az indítóüzenetben megadott S3a-B1 prompt-commit SHA
- Forráság: `codex/i0-s1a-s3a-integration`
- Célág: `codex/s3a-b1-image-liveness-diagnostics`
- Origin: `https://github.com/Botond1/3D-Printer-Slicer-API.git`

I0 hosted bizonyíték az exact baseline-on:

- Source Validation `PASS`:
  <https://github.com/Botond1/3D-Printer-Slicer-API/actions/runs/29683094252>
- Image Validation `FAIL-CLOSED`:
  <https://github.com/Botond1/3D-Printer-Slicer-API/actions/runs/29683094245>
- Image job: `88182625487`
- Exact head SHA: `58dcf1065ff39b6da1ba72d0d9c910d788a843ab`

A publikus job API és a run annotációi alapján:

1. exact candidate resolution, checkout, identity proof, Buildx setup, build,
   image identity és az inert container indítása zöld;
2. `Wait for the bounded liveness-only health check` piros (`exit 1`);
3. SBOM, SPDX-validáció, Grype és scan gate skipped;
4. az evidence boundary másodlagosan piros (`exit 2`), mert a skipped lépések
   kötelező fájljai hiányoznak;
5. cleanup zöld; artifact nem került feltöltésre.

Összehasonlításként az S3a.1 önálló exact commit
`4f55062096d57a9245282b686fd8619c29c473e8` Image Validation futása
`29680527711` eljutott a scanner enforcement lépésig. Ez erős, de még
bizonyítandó hipotézis arra, hogy az I0-ban integrált S1a runtime/startup delta
hozta felszínre a liveness regressziót. Ne írd le root cause-ként dinamikus
bizonyíték nélkül.

Az I0 exact helyi újraellenőrzése:

- célzott workflow/startup/path tesztek: `166/166`;
- teljes JavaScript: `293/293`;
- teljes Python: `22/22`;
- a lokális Docker daemon nem volt elérhető;
- az első célzott Windows-próba kizárólag hiányzó abszolút
  `PYTHON_EXECUTABLE` miatt hibázott, majd a változtatás nélküli rerun a bundled
  Python 3.12.13 exact abszolút útjával zöld lett.

## Kötelező preflight

1. Olvasd el teljesen a gyökér `AGENTS.md`-t, a három kanonikus
   `docs/codex/` tudásfájlt, a read-only `CLAUDE.md`-t, valamint az alkalmazandó
   `.github/instructions/**`, Docker- és testing skill/agent fájlokat.
2. Ellenőrizd a repository rootot, origin URL-t, exact `WORK_BASELINE`-t és azt,
   hogy az a fenti `CODE_BASELINE` közvetlen prompt-leszármazottja.
3. Új, tiszta linked worktree-ben indulj a `WORK_BASELINE` exact SHA-ról az új
   `codex/s3a-b1-image-liveness-diagnostics` ágon. A célág nem létezhet sem
   lokálisan, sem az origin alatt.
4. Idegen dirty worktree-t ne resetelj, stash-elj, cleanelj, mozgasd vagy olvaszd
   be. Váratlan baseline-delta esetén `STATUS: BLOCKED`.
5. Read-only módon kérd le a két fenti hosted run/job step-mátrixát. Ha hiteles
   joblog elérhető, olvasd el, de sem hitelesítő adatot, sem teljes környezeti
   dumpot ne jeleníts meg vagy ments el.
6. Ellenőrizd a Docker daemon elérhetőségét. A daemon hiánya nem jogosít fel
   root cause kitalálására és nem teszi zölddé a runtime kaput.

## Először karakterizálj

Módosítás előtt rögzítsd a következő összehasonlítást:

- `4f55062096d57a9245282b686fd8619c29c473e8` és a jelenlegi baseline Docker/
  workflow/startup szempontból releváns eltérései;
- az eredeti S1a runtime commit
  `e7a409566bb8795a22f38bbf9f514b42c51bda74` integrált megfelelőjének
  (`a266526335f9e20bb5b447e97505feabbe653ca8`) startup- és path-deltája;
- `Dockerfile` `USER`, `CMD`, `HEALTHCHECK`, `/app/input`, `/app/output`,
  `/app/configs`, Python resolution és portkötés;
- `app/config/paths.js`, `app/server.js`, `app/services/slice/workspace.js`,
  `app/config/python.js` indulási sorrendje és lehetséges hibapontjai;
- az inert `docker run` exact security flagjeinek hatása.

Ha Docker elérhető, buildeld az exact candidate-et egyszer, és ugyanazzal az
izolációs konfigurációval reprodukáld a futást. Bizonyítékként kizárólag
allowlistelt container state/health mezőket és méretkorlátos startup logot
használj. Customer modell, távoli slicer, host port, host bind, külső hálózat és
valódi secret tilos.

## Kötelező workflow-korrekció

Úgy rendezd át `.github/workflows/image-validation.yml` lépéseit, hogy az alábbi
kontraktus egyszerre teljesüljön:

1. Az exact image továbbra is pontosan egyszer épül, csak lokálisan töltődik be,
   és sem registry push, sem deploy nem történik.
2. A runtime smoke eredménye megfigyelhető legyen későbbi lépések számára. A
   smoke technikailag visszaadhatja a vezérlést diagnosztikai célból, de egy
   kötelező, `if: always()` végső enforcement gate-nek pirosra kell állítania a
   jobot minden nem-success smoke outcome esetén.
3. Build-success után az SBOM és Grype kapu fusson le akkor is, ha a runtime smoke
   piros. A smoke-hiba soha nem jelenthet scan-bypasszt.
4. Az SPDX és Grype ellenőrzés továbbra is különböztesse meg az infrastruktúra-
   hibát a HIGH/CRITICAL találattól. Hiányzó, üres, túl nagy, malformed vagy
   szerkezetileg hibás eredmény fail-closed.
5. A diagnosztikai lépés `if: always()` mellett csak az exact run containerre
   dolgozhat, és kizárólag a következő allowlistelt adatokat rögzítheti:
   `running`, `exitCode`, `oomKilled`, bounded engine error, start/finish idő,
   Docker health státusz és bounded health-log kimenet, valamint bounded
   container stdout/stderr. Teljes `docker inspect`, container environment,
   secret, hostadat vagy más container felsorolása tilos.
6. Diagnosztikai fájlok kizárólag a már használt exact run-scoped
   `runner.temp` evidence könyvtárban, szabályos nem-symlink fájlként jöhetnek
   létre, szigorú név- és méretlimittel. A publikus step summary csak rövid,
   redaktált osztályozást tartalmazhat; nyers környezetet vagy korlátlan logot
   nem.
7. Az artifact boundary a dokumentált exact fájllistát követelje meg, és hiba
   esetén ne okozzon félrevezető másodlagos zajt azért, mert egy független gate
   skipped. A final enforcement külön, egyértelműen jelentse:
   `runtime_liveness_failure`, `sbom_infrastructure_failure`,
   `scanner_infrastructure_failure`, `vulnerability_gate_failure`,
   `evidence_boundary_failure` vagy ezek igaz kombinációját.
8. Az evidence upload csak sikeres exact boundary után történhet, rövid
   retentionnel. A végső gate után a job akkor is piros, ha az evidence feltöltés
   sikerült, de bármely kötelező smoke/SBOM/scan kapu piros.
9. Cleanup mindig fusson és csak az exact run containerét, exact image tagjét és
   exact evidence könyvtárának allowlistelt szabályos fájljait távolítsa el.
   Broad prune továbbra is tilos.
10. `contents: read`, credentials-disabled checkout, pinned action SHA-k,
    no-token scanner/build beállítások, `--network none`, `--cap-drop ALL`,
    `no-new-privileges`, PID-limit és tmpfs izoláció maradjon meg.

## Root-cause javítási szabály

Workflow-diagnosztikán kívüli runtime/Docker módosítás csak akkor engedélyezett,
ha egy reprodukció vagy az új hosted diagnosztikai checkpoint egyetlen konkrét
okot bizonyít. Ekkor:

- előbb írj bukó karakterizációs tesztet vagy exact reprodukciós bizonyítékot;
- a legkisebb, kontraktusőrző javítást készítsd el;
- ne kapcsold ki az S1a canonical path/symlink/workspace auditot;
- ne lazítsd a container izolációját vagy a health timeoutot tünetelfedésként;
- ne változtasd a `/health` liveness jelentését production readinessre;
- ne adj capabilityt, host hálózatot/portot/bindot, privilegizált módot vagy
  valódi secretet;
- bizonyíték nélkül maradj diagnosztikai checkpointnál, és jelents
  `ROOT_CAUSE: UNVERIFIED` értéket.

## Engedélyezett fájlfelület

Elsődleges scope:

- `.github/workflows/image-validation.yml`;
- `tests/unit/js/s3a-workflow-contracts.test.js`;
- legfeljebb egy új célzott JS teszt a diagnosztikai/final-gate viselkedéshez;
- `docs/codex/evidence/` alatt legfeljebb egy S3a-B1 bizonyítékfájl;
- `docs/codex/hardening-plan.md`, `project-map.md`, `security-model.md` és
  `AGENTS.md` csak az igazolt új állapot rövid rekonsziliációjához.

Feltételes runtime scope kizárólag bizonyított root cause esetén:

- `app/config/paths.js`;
- `app/server.js`;
- `app/services/slice/workspace.js`;
- `app/config/python.js`;
- a közvetlenül kapcsolódó meglévő startup/workspace tesztek;
- `Dockerfile`, kizárólag ha az ok bizonyítottan image/runtime contract-hiba és
  az alkalmazáskódos javítás nem helyesebb.

Bármely más fájl igénye esetén állj meg és jelents scope-bővítési igényt.

## Tiltott scope és mellékhatás

- `package.json`, `package-lock.json`, `requirements.txt` vagy dependency update;
- base image, Apt/NodeSource/Python/AppImage vagy GitHub Action verzió/SHA
  frissítése ebben az etapban;
- pricing, slicer profile vagy runtime artifact módosítása;
- `main` push/merge, PR, force push, tag, release;
- registry login/push, image promotion, deploy, VPS/SSH;
- customer/private modell, valódi secret vagy production API/slicer hívás;
- a LeadPilot repó módosítása;
- branch protection vagy required-check állapot igazoltnak állítása pusztán
  workflow-szövegből.

A GitHub Actions Node.js 20 deprecation warningot rögzítsd külön későbbi
supply-chain maintenance tételként; action SHA-kat ebben a scope-ban ne
változtass.

## Kötelező tesztek

Írj statikus és adversarial mutation teszteket legalább ezekre:

- smoke-failure után a diagnosztika, SBOM és scan nem skipped;
- smoke-failure a final enforcementnél kötelezően piros;
- hiányzó final gate, `if: always()`, outcome-check vagy fail-closed ág bukik;
- diagnosztika nem olvas environmentet, nem futtat broad inspect/list/prune
  parancsot, exact containert használ és bounded outputot ír;
- diagnosztikai fájl path/symlink/realpath/név/méret boundary;
- SBOM/scanner infrastructure, HIGH/CRITICAL finding és runtime failure külön
  stabil osztályozása;
- evidence upload nem kerülheti meg a boundaryt és nem teheti zölddé a jobot;
- exact-image, no-push/no-deploy, permissions, credential, isolation és cleanup
  korábbi mutációs bizonyítékai megmaradnak;
- ha runtime-fix készül, a konkrét korábbi hibát reprodukáló teszt a javítás előtt
  bukik, utána zöld, miközben a symlink/path/workspace invariánsok megmaradnak.

Ezután futtasd és pontos darabszámmal jelentsd:

1. exact npm 10.9.8 clean install;
2. új/célzott S3a-B1 és meglévő S3a/S3a.1 tesztek;
3. S1a startup/workspace/path célzott tesztek;
4. teljes `npm test`, külön JS/Python számmal;
5. minden trackelt JS/Python szintaxis;
6. instruction mirror;
7. tracked és nem üres staged repository safety;
8. `npm audit --omit=dev --audit-level=moderate`;
9. `git diff --check`, staged diff-check, exact candidate-range whitespace gate;
10. `actionlint`, ha ellenőrzötten elérhető;
11. exact Docker build/run/health/SBOM/scan reprodukció, ha daemon elérhető.

Windows helyi futásnál a repository szabályának megfelelő, létező abszolút
`PYTHON_EXECUTABLE` értéket használd; ne változtass kódot pusztán azért, mert a
host PATH nem tartalmaz Pythont.

## Két engedélyezett hosted checkpoint

A felhasználó korábbi GitHub-push engedélye alapján legfeljebb két normál,
non-force push engedélyezett, kizárólag a
`codex/s3a-b1-image-liveness-diagnostics` ágra:

1. **A checkpoint:** diagnosztikai/final-gate workflow és tesztjei, minden helyi
   kapu után. Figyeld meg az exact SHA Source és Image futását.
2. **B checkpoint:** csak akkor, ha A hosted bizonyítéka egyértelmű root cause-t
   ad és a minimális runtime/Docker javítás minden helyi kapun átmegy. Új commit,
   normál push; amend és force push tilos.

Ha A nem ad bizonyított okot, vagy scanner/advisory dependency-változást
igényel, ne találgass és ne készíts B push-t. Állj meg auditálható
`CHECKPOINT_PUSHED` állapotban. Semmilyen más refet ne pusholj.

## Státuszszabály

- `STATUS: COMPLETED`: a végső exact SHA-n minden helyi kapu, hosted Source,
  runtime liveness, valid SBOM, Grype infrastructure és HIGH/CRITICAL gate,
  evidence boundary/upload és cleanup zöld.
- `STATUS: CHECKPOINT_PUSHED`: a helyi kapuk zöldek és legalább A push sikeres,
  de a hosted image gate piros/pending, vagy a bizonyított további javítás külön
  dependency/scope etapot igényel.
- `STATUS: CHECKPOINT_COMMITTED`: helyi kapuk zöldek, commit kész, de az első
  normál push auth/network okból nem sikerült.
- `STATUS: BLOCKED`: baseline/scope/mandatory local gate vagy biztonsági
  invariáns sérül. Ilyenkor ne pusholj.

## Kötelező zárójelentés

```text
STATUS:
CODE_BASELINE:
WORK_BASELINE:
BRANCH:
COMMITS:
PUSH_COUNT_AND_REMOTE_RESULT:
MODIFIED_FILES:
I0_REPORT_VERIFICATION:
GRAPHIFY_OR_DIRECT_SOURCE_MAP:
HOSTED_BASELINE_STEP_MATRIX:
CHARACTERIZATION_AND_COMPARISON:
ROOT_CAUSE:
DIAGNOSTIC_EVIDENCE_CONTRACT:
FINAL_FAIL_CLOSED_AGGREGATION_PROOF:
RUNTIME_OR_DOCKER_FIX:
CONTRACT_PRESERVATION_PROOF:
FOCUSED_TESTS_AND_COUNTS:
FULL_TESTS_AND_COUNTS:
SYNTAX_AND_REPOSITORY_GATES:
DEPENDENCY_AUDIT:
LOCAL_DOCKER_EVIDENCE:
CHECKPOINT_A_HOSTED_SOURCE:
CHECKPOINT_A_HOSTED_IMAGE:
CHECKPOINT_B_HOSTED_SOURCE:
CHECKPOINT_B_HOSTED_IMAGE:
ARTIFACT_AND_CLEANUP_EVIDENCE:
UNRUN_OR_BLOCKED_GATES:
KNOWN_REMAINING_RISKS:
NEXT_PARALLEL_ETAPS:
FORBIDDEN_SIDE_EFFECTS_CHECK:
```

`NEXT_PARALLEL_ETAPS` jelezheti, hogy az S1b továbbra is külön, párhuzamos
runtime lane-ként tervezhető, de ebben az etapban ne módosíts queue/deadline/
AbortSignal kódot. S3a-B2 action/dependency pinning csak a diagnosztizált image
kapu után, külön serialized promptban indulhat.
