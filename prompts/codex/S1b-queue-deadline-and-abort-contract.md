# S1b — valódi queue deadline és AbortSignal kontraktus

## Végrehajtói profil

- Modell: `gpt-5.6-sol`
- Effort: `high`
- Ne használj `xhigh` vagy `max` effortot, hacsak egy bizonyított race condition
  több biztonsági invariáns között valódi tervezési ellentmondást nem tár fel.

## Küldetés

Az S1a request-owned workspace határára építve készíts valódi, a worker
felszabadulásától független queue-wait deadline-ot, valamint egyetlen,
single-settlement `AbortSignal` kontraktust a klienskapcsolat megszakításához és
a queue-szintű leállításhoz.

Az S1b feladata a sor, a request és a feldolgozó task közötti abort-kontraktus
létrehozása. A natív Prusa/Orca/Python process tree tényleges TERM/KILL
leállítása és a subprocess environment minimalizálása kizárólag a következő
S1c etap tulajdona.

## Rögzített baseline és ágak

- `CODE_BASELINE`: `58dcf1065ff39b6da1ba72d0d9c910d788a843ab`
- `WORK_BASELINE`: az indítóüzenetben megadott S1b prompt-commit SHA
- Forráság: `codex/i0-s1a-s3a-integration`
- Célág: `codex/s1b-queue-deadline-abort`
- Origin: `https://github.com/Botond1/3D-Printer-Slicer-API.git`
- Kiinduló helyi bizonyíték: JavaScript `293/293`, Python `22/22`, exact npm
  `10.9.8`, production audit `0`.

Az etap az S3a-B1 image-diagnosztikával párhuzamosan fut. A két lane nem írhat
azonos workflow-, startup-, workspace-, kanonikus tudás- vagy Graphify-fájlt.

## Kötelező preflight

1. Olvasd el teljesen a gyökér `AGENTS.md`-t, a három kanonikus
   `docs/codex/` tudásfájlt, a read-only `CLAUDE.md`-t, az `app/CLAUDE.md`-t,
   valamint az alkalmazandó repository/testing instrukciókat és skill/agent
   fájlokat.
2. Futtasd a repository által előírt Graphify-frissesség/lekérdezés lépést, majd
   célzottan térképezd fel:
   `slice.routes.js -> slice.service.js -> queue.js -> processSlice ->
   response-lifecycle.js -> workspace cleanup`.
3. Ellenőrizd a repository rootot, origin URL-t, clean státuszt, exact
   `WORK_BASELINE`-t és azt, hogy az közvetlen prompt-leszármazottja a fenti
   `CODE_BASELINE`-nak.
4. Új, tiszta linked worktree-ben indulj az exact `WORK_BASELINE`-ról, az új
   `codex/s1b-queue-deadline-abort` ágon. Az ág nem létezhet sem lokálisan, sem
   az origin alatt.
5. Idegen dirty worktree-t ne resetelj, stash-elj, cleanelj vagy olvassz be.
   Váratlan baseline-delta esetén `STATUS: BLOCKED`.
6. Rögzítsd a jelenlegi hibát dinamikus karakterizációval: egy blokkolt aktív
   worker mellett a mögötte váró job a konfigurált queue-wait határ után is
   pending marad, és csak egy későbbi dequeue-kísérletkor kap
   `SLICE_QUEUE_TIMEOUT` hibát.

## Kötelező szemantikai kontraktus

### 1. Queue-wait deadline

- Minden ténylegesen sorba helyezett job saját, azonnal felépített deadline
  timerrel rendelkezzen.
- A timer a worker állapotától függetlenül, a konfigurált
  `MAX_SLICE_QUEUE_WAIT_MS` határnál távolítsa el a még várakozó exact jobot.
- A timeoutolt job taskja soha ne induljon el.
- A job pontosan egyszer kapja a meglévő typed `SliceQueueTimeoutError` hibát,
  változatlan HTTP `503` és `SLICE_QUEUE_TIMEOUT` mappinggel.
- A queued per-client számláló pontosan egyszer csökkenjen; a túlélő jobok FIFO
  sorrendje maradjon változatlan.
- Dequeue/timeout/abort race esetén egyetlen JS-turnben eldöntött job-state
  garantálja, hogy a job vagy queuedként elutasul, vagy activeként elindul, de
  mindkettő nem történhet meg.
- A timer minden terminal pathon törlődjön, és ne tartsa életben szükségtelenül
  a Node processzt, ha a platform támogatja az `unref()`-et.
- A dequeue-kori elapsed-time ellenőrzés maradhat defense-in-depth, de nem lehet
  az egyetlen deadline enforcement.

### 2. Egységes job AbortSignal

- Az `enqueueSliceJob` kompatibilisen bővíthető options-kontraktusa fogadjon
  külső `AbortSignal`-t.
- A queue minden elfogadott jobhoz egyetlen belső abort- és settlement
  tulajdonost használjon; a task ugyanazt az effektív signalt kapja meg.
- Már aborted signal esetén a task ne kerüljön queue-ba, ne fusson el, és
  számláló/timer/listener ne maradjon utána.
- Várakozó job abortja távolítsa el az exact jobot, törölje timerét/listenereit,
  csökkentse a queued számlálót és utasítsa el pontosan egyszer.
- Aktív job abortja azonnal jelezze a tasknak az effektív signalt, de **ne**
  szabadítsa fel korán az active slotot, active per-client számlálót vagy
  request-owned workspace lifecycle-t.
- Az aktív slot és counter csak a task promise tényleges settlementje után
  szabadulhat fel. Egy abortot ignoráló task mellett nem indulhat replacement
  job a konfigurált concurrency fölé.
- Ha abort után a task mégis success értékkel tér vissza, az abort outcome nyer,
  de csak a task tényleges settlementje után. Nem lehet sikeres response vagy
  artifact-release egy már abortált requesthez.
- Késői abort a már settled job eredményét nem változtathatja meg.

### 3. Klienskapcsolat megszakítása

- A queue előtti upload-abort meglévő `UPLOAD_REQUEST_ABORTED` viselkedését
  őrizd meg.
- A már feltöltött/queued/active requesthez a Node request/response lifecycle
  alapján hozz létre egy idempotens abort bindingot.
- Valódi megszakításnak számítson legalább a request `aborted`, releváns socket
  error, illetve response `close`, ha a response nem fejeződött be sikeresen.
- Normál `finish`/sikeres close nem abort.
- Már eleve destroyed/aborted requestet fail-fast kezeld listener-szivárgás
  nélkül.
- Minden request/queue/task terminal path távolítsa el az összes hozzáadott
  listenert. Egy requesten legfeljebb egy abort és egy külső settlement legyen.
- Megszakadt socketre ne próbálj JSON választ írni, és ne adj félrevezető 500-at.
- A route `finally` továbbra is megvárja a handler/queue biztonságos
  settlementjét, majd pontosan egyszer takarítja a request-owned workspace-et.

### 4. Queue-szintű shutdown kontraktus

- A queue biztosítson idempotens, determinisztikusan tesztelhető
  `begin/shutdown` seamet.
- Shutdown után új job nem fogadható el; a még queued jobok taskja nem indulhat
  el, timerük/listenerük/counterük felszabadul.
- Az aktív jobok effektív signalja abortálódik, de slotjuk csak tényleges task
  settlement után szabadul fel.
- Ha egy még írható kapcsolaton a shutdown miatti admission rejection választ
  igényel, használj stabil typed `503` queue-hibát és dokumentált additív
  errorCode-ot; disconnected socketre ne írj.
- Az operációs `SIGTERM`/`SIGINT` bekötés **nem része ennek a párhuzamos
  checkpointnak**, mert az `app/server.js` az S3a-B1 feltételes startup scope-ja.
  Az S1b adja át a tesztelt queue shutdown API-t; az I1 integrátor köti be a
  server lifecycle-ba az S3a-B1 eredményének ismeretében.

### 5. Kompatibilitás

- FIFO, max concurrency, total queue cap és queued+active per-client cap
  változatlan.
- Meglévő error code-ok, statusok és response body-k változatlanok:
  `SLICE_QUEUE_FULL`, `SLICE_QUEUE_CLIENT_LIMIT`, `SLICE_QUEUE_TIMEOUT`.
- A legacy prefixed queue-error mappinget ne távolítsd el ebben az etapban.
- A `getQueueStatus()` meglévő publikus mezőit és jelentését őrizd meg.
- A `choosenFile`, endpointok, pricing, profile, slicer argumentumok és sikeres
  response alakja nem változhat.
- Az S1a workspace containment, symlink, output custody, response settlement és
  cleanup invariánsai maradjanak meg.

## Tervezési és dekompozíciós elvárás

Ne növeld korlátlanul a jelenlegi `queue.js`-t. Ha a timer/signal/shutdown state
átláthatóan nem fér el a guardrail alatt, bontsd kis, célzott modulra, például
queue job-lifecycle/scheduler komponensre, miközben a `queue.js` kompatibilis
publikus facade marad.

Determinista tesztekhez használj injektálható clock/scheduler seamet. Ne építs
milliszekundumos, wall-clock timingra vagy hosszú `sleep`-re támaszkodó flaky
tesztet. A production default továbbra is a natív `Date.now`, `setTimeout` és
`clearTimeout` legyen.

## Engedélyezett fájlfelület

Elsődleges implementáció:

- `app/services/slice/queue.js`;
- legfeljebb két új, célzott modul `app/services/slice/` alatt a queue job-state
  és request abort binding számára;
- `app/services/slice.service.js`;
- `app/routes/slice.routes.js`, csak ha a request lifecycle tulajdonosi határhoz
  ténylegesen szükséges;
- `app/services/slice/response-lifecycle.js`, csak a close/finish single-
  settlement kontraktus megőrzéséhez szükséges minimális módosításra;
- `app/middleware/errorHandler.js`, csak bizonyított új typed shutdown/admission
  mappinghez.

Teszt/evidence:

- `tests/unit/js/queue.test.js`;
- `tests/unit/js/fixtures/queue-scenarios.js`;
- `tests/unit/js/helpers/load-queue-for-scenario.js`;
- meglévő `slice-route-lifecycle`, `slice-route-multipart-live` és
  `slice-output-lifecycle` tesztek, ha közvetlenül érintettek;
- legfeljebb két új célzott JS teszt/helper;
- egy új `docs/codex/evidence/s1b-queue-deadline-and-abort-contract.md`.

Minden más fájl igénye esetén állj meg és jelents scope-bővítési igényt.

## Párhuzamos ownership miatt tiltott fájlok

Az S3a-B1 lane-nel való ütközés elkerülésére ebben az etapban ne módosítsd:

- `.github/**`;
- `Dockerfile`, Compose, `.dockerignore`;
- `app/server.js`;
- `app/config/paths.js`, `app/config/python.js`;
- `app/services/slice/workspace.js`;
- `AGENTS.md`;
- `docs/codex/hardening-plan.md`, `project-map.md`, `security-model.md`;
- bármely `graphify-out/**` fájl.

Az I1 integrátor végzi a server-shutdown bekötést és a kanonikus tudás
rekonsziliációját a két párhuzamos lane után.

## További tiltott scope és mellékhatás

- `app/services/slice/command.js` vagy natív process-kill implementáció;
- pipeline/converter/slicer argumentum vagy subprocess environment módosítása;
- `package.json`, lockfile, requirements vagy dependency update;
- pricing, slicer profile, output-retention/quota vagy API auth fejlesztés;
- main push/merge, PR, force push, tag, release;
- deploy, registry push, image promotion, VPS/SSH;
- production/remote slicerhívás, customer modell vagy valódi secret;
- LeadPilot repó módosítása;
- idegen worktree reset/stash/clean/absorb művelete.

## Kötelező karakterizációs és adversarial tesztek

Legalább az alábbi bizonyítékok készüljenek:

1. Blokkolt active worker mellett a queued job a deadline pillanatában elutasul,
   mielőtt a worker felszabadulna.
2. Timeoutolt/abortált queued task soha nem fut.
3. Több queued job közül egy középső timeoutja/abortja megőrzi a túlélők FIFO
   sorrendjét.
4. Timeout vs dequeue és abort vs dequeue race pontosan egy outcome-ot ad.
5. Queued counter minden full/client-cap/timeout/abort/shutdown pathon pontosan
   helyreáll.
6. Aktív abort signal eljut a taskhoz, de a slot/counter a task tényleges
   settlementjéig foglalt marad.
7. Abortot ignoráló active task nem okoz concurrency túllépést.
8. Abort után success-szel visszatérő task nem válik sikeres requestté.
9. Késői abort nem írja felül a settled success/failure eredményt.
10. Már aborted signal admission előtt nem hoz létre timer/listener/counter
    állapotot.
11. Request `aborted`, hibás socket és nem-finished response close egyetlen
    abortot okoz; normál finish nem.
12. Minden finish/error/abort/timeout/shutdown pathon nulla megmaradt timer és
    hozzáadott listener bizonyítható.
13. Disconnected response-ra nincs JSON write vagy double-send.
14. Workspace cleanup pontosan egyszer, csak a task biztonságos settlementje
    után történik.
15. Shutdown queued/active/admission viselkedése, idempotenciája és counter-
    tisztasága dinamikusan igazolt.
16. Meglévő FIFO, concurrency, overflow, per-client cap, typed/legacy mapping,
    multipart és output-response tesztek változatlanul zöldek.

Mutation proof kötelező legalább ezekre:

- deadline timer eltávolítása vagy visszaállítás dequeue-only ellenőrzésre;
- timeoutolt job queue-ban hagyása vagy későbbi lefuttatása;
- timer/listener el nem távolítása;
- queued/active counter double-decrement vagy leak;
- active slot korai felszabadítása abortkor;
- AbortSignal tasknak való átadásának elhagyása;
- abort utáni task-success elfogadása;
- disconnected socketre response write;
- shutdown utáni admission vagy queued task futtatása;
- route cleanup abort előtti/dupla végrehajtása.

## Kötelező kapuk

A legkisebb célzott ellenőrzésekkel kezdj, majd pontos parancsokkal és
darabszámokkal futtasd:

1. exact npm `10.9.8` és `npm ci --ignore-scripts --no-audit --no-fund`;
2. új S1b queue/deadline/abort/shutdown tesztek és mutation proof;
3. meglévő queue, route lifecycle, live multipart és output lifecycle tesztek;
4. teljes `npm test`, külön JavaScript- és Python-számmal;
5. minden trackelt JavaScript és Python szintaxisellenőrzése;
6. instruction mirror teszt;
7. tracked repository safety, majd a nem üres staged scope safety gate;
8. `npm audit --omit=dev --audit-level=moderate`;
9. `git diff --check`, staged diff-check és exact candidate-range whitespace
   ellenőrzés friss `origin/main` merge-base/ancestry bizonyítással;
10. quality/decomposition review minden 300 soros service, 500 soros source,
    250 soros test runner vagy 60 soros function guardrail-közeli fájlra.

Windows alatt a létező, abszolút bundled `PYTHON_EXECUTABLE` értéket használd;
ne módosíts production kódot azért, mert a host PATH nem tartalmaz Pythont.

Docker vagy natív slicer futtatás nem kötelező ehhez a queue-contract etaphoz.
Ha mégis futtatod, csak inert, szintetikus, lokális input és biztonságos exact
cleanup engedélyezett. Környezeti hiányt `NOT_RUN_ENVIRONMENT` státusszal jelents.

## Commit és engedélyezett push

Legfeljebb két atomikus lokális commit készülhet:

1. queue/request abort implementáció és tesztek;
2. külön evidence commit, ha szükséges.

Ne amendelj és ne squasholj idegen checkpointot. Minden kötelező helyi kapu
után a felhasználó korábbi engedélye alapján pontosan egy normál, non-force push
engedélyezett, kizárólag erre az ágra:

`codex/s1b-queue-deadline-abort`

Semmilyen más refet ne pusholj. A push után read-only módon ellenőrizd az exact
SHA hosted Source és Image workflow-ját. Az I0-ból örökölt image-liveness hiba az
S3a-B1 tulajdona: ne javítsd ebben az ágban, de bizonyítsd, hogy az S1b nem vitte
korábbra vagy más lépésre a hibát.

## Státuszszabály

- `STATUS: COMPLETED`: minden helyi S1b kapu zöld, a commit/push sikeres, hosted
  Source Validation zöld, és az image run nem mutat S1b által okozott regressziót.
- `STATUS: CHECKPOINT_PUSHED`: helyi kapuk és push zöldek, de hosted ellenőrzés
  pending/elérhetetlen, vagy az image workflow a külön S3a-B1 által tulajdonolt
  baseline-liveness ponton marad piros.
- `STATUS: CHECKPOINT_COMMITTED`: helyi kapuk zöldek és commit készült, de a
  normál push auth/network okból nem sikerült.
- `STATUS: BLOCKED`: baseline/scope/mandatory local gate/race invariáns hibás.
  Ilyenkor ne pusholj.

## Kötelező zárójelentés

```text
STATUS:
CODE_BASELINE:
WORK_BASELINE:
BRANCH:
COMMITS:
REMOTE_BRANCH_AND_PUSH_RESULT:
MODIFIED_FILES:
GRAPHIFY_AND_DIRECT_SOURCE_MAP:
OLD_DEQUEUE_ONLY_FAILURE_PROOF:
QUEUE_JOB_STATE_MODEL:
DEADLINE_CONTRACT:
REQUEST_ABORT_CONTRACT:
SHUTDOWN_SEAM_CONTRACT:
ACTIVE_SLOT_AND_COUNTER_PROOF:
WORKSPACE_AND_RESPONSE_SETTLEMENT_PROOF:
PUBLIC_CONTRACT_PRESERVATION:
MUTATION_TESTS_AND_COUNTS:
FOCUSED_TESTS_AND_COUNTS:
FULL_TESTS_AND_COUNTS:
SYNTAX_AND_REPOSITORY_GATES:
DEPENDENCY_AUDIT:
QUALITY_AND_DECOMPOSITION_REVIEW:
HOSTED_SOURCE_WORKFLOW:
HOSTED_IMAGE_WORKFLOW:
UNRUN_OR_BLOCKED_GATES:
KNOWN_REMAINING_RISKS:
I1_INTEGRATION_HANDOFF:
FORBIDDEN_SIDE_EFFECTS_CHECK:
```

Az `I1_INTEGRATION_HANDOFF` nevezze meg pontosan:

- az S3a-B1-gyel közös új baseline-t;
- az `app/server.js` SIGTERM/SIGINT bekötésének hátralévő feladatát;
- az integrátor által frissítendő `AGENTS.md` és három kanonikus
  `docs/codex/` fájlt;
- az S1c számára átadott exact task `AbortSignal` API-t és annak invariánsait.
