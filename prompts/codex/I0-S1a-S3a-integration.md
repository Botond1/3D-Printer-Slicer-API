# I0 — S1a és S3a/S3a.1 integráció

## Végrehajtói profil

- Modell: `gpt-5.6-sol`
- Effort: `medium`
- `high` csak akkor indokolt, ha váratlan konfliktus vagy biztonsági szemantikai
  ellentmondás jelenik meg.

## Küldetés

Egy új, tiszta integrációs ágon egyesítsd az S1a upload/workspace hardeninget és
az S3a build-provenance/no-deploy workflow-t, majd igazold, hogy a két változás
együtt is megőrzi az API-, runtime-, CI- és biztonsági kontraktusokat. Ez
integrációs és dokumentáció-rekonsziliációs etap: ne tervezz új funkciót és ne
gyengíts kaput azért, hogy zöld legyen.

## Rögzített bemenetek

- `CODE_BASELINE`: `c3f1a06bd1ed48b80e3bb825e21ac6455bf1218d`
- `WORK_BASELINE`: a feladat indítóüzenetében megadott prompt-commit SHA
- Célág: `codex/i0-s1a-s3a-integration`
- S1a runtime commit: `e7a409566bb8795a22f38bbf9f514b42c51bda74`
- S1a dokumentációs commit: `cff7f46aa5ad8cf307d9a0bc9ed658315bb4ad8d`
- S3a commit: `ea923c034359d742914154ffbfd68be110714055`
- S3a.1 prompt checkpoint: `602566c7618fc09a2489a9b5a67202dd9c657fa5`
- S3a.1 implementáció: `4f55062096d57a9245282b686fd8619c29c473e8`
- Elvárt origin: `https://github.com/Botond1/3D-Printer-Slicer-API.git`

Az S3a.1 exact commit jelenleg ismert hosted bizonyítéka:

- Source Validation: sikeres —
  <https://github.com/Botond1/3D-Printer-Slicer-API/actions/runs/29680527745>
- Image Validation: sikertelen a scan eredményt értelmező fail-closed lépésnél —
  <https://github.com/Botond1/3D-Printer-Slicer-API/actions/runs/29680527711>

Az Image Validation okáról ne következtess bizonyíték nélkül: lehet scanner
infrastruktúrahiba vagy tényleges HIGH/CRITICAL találat. A scan kaput tilos
gyengíteni vagy megkerülni.

## Kötelező preflight

1. Olvasd el teljesen a gyökér `AGENTS.md` fájlt, majd az általa előírt
   tudásfájlokat, a read-only `CLAUDE.md`-t és az alkalmazandó repository,
   workflow, Docker és testing instrukciókat/skill-eket.
2. Ellenőrizd az origin URL-t, a `WORK_BASELINE` exact commitot, valamint mind az
   öt integrálandó commit objektumát és parent kapcsolatát.
3. Indulj a `WORK_BASELINE` exact SHA-ról új, tiszta linked worktree-ben, az új
   `codex/i0-s1a-s3a-integration` ágon. Meglévő ágat, idegen worktree-t vagy
   dirty állapotot ne resetelj, stash-elj, cleanelj vagy olvassz be.
4. A célág sem lokálisan, sem az origin alatt nem létezhet. Ha létezik, állj
   meg; ne force-pusholj és ne írd felül.
5. Bizonyítsd, hogy a prompt-commit a `CODE_BASELINE` leszármazottja, és a
   baseline eltérése csak az I0 promptot/tudásréteg engedélyezett változásait
   tartalmazza. Váratlan eltérésnél `STATUS: BLOCKED`.
6. Fetch csak read-only felderítéshez és a szükséges commit/ref objektumok
   eléréséhez engedélyezett. Ne merge-elj origint, ne húzd be a `main` új
   tartalmát.

## Kötelező integrációs sorrend

Őrizd meg az etapok atomikus történetét. Ne squasholj, ne amendelj és ne
másold kézzel a commitok tartalmát. Ebben a sorrendben cherry-pickelj:

1. `e7a409566bb8795a22f38bbf9f514b42c51bda74`
2. `cff7f46aa5ad8cf307d9a0bc9ed658315bb4ad8d`
3. `ea923c034359d742914154ffbfd68be110714055`
4. `602566c7618fc09a2489a9b5a67202dd9c657fa5`
5. `4f55062096d57a9245282b686fd8619c29c473e8`

Minden pick után ellenőrizd a commitot, a diffet és a worktree állapotát. Ha
konfliktus keletkezik:

- csak a felsorolt commitok által érintett fájlban oldhatod fel;
- mindkét etap szigorúbb biztonsági és kompatibilitási kontraktusát őrizd meg;
- váratlan vagy nem egyértelmű runtime/workflow konfliktusnál állj meg;
- ne folytasd automatikusan találgatással.

A push csak az összes pick, a rekonsziliáció és valamennyi kötelező helyi kapu
után történhet. Köztes állapotot ne pusholj.

## Rekonsziliációs scope

Készíts legfeljebb egy külön, atomikus I0 rekonsziliációs commitot. Kézi
módosítás csak az alábbi területeken engedélyezett:

- valódi cherry-pick konfliktus feloldása az érintett fájlban;
- `AGENTS.md`;
- `docs/codex/project-map.md`;
- `docs/codex/security-model.md`;
- `docs/codex/hardening-plan.md`;
- `docs/codex/evidence/s3a-build-provenance-and-deploy-separation.md`;
- opcionálisan egyetlen új `docs/codex/evidence/` I0 integrációs bizonyítékfájl.

Dokumentáld a jelenlegi, pontos igazságot:

- az S1a upload/workspace/multipart eredményei megmaradtak;
- a repository workflow már nem automatikus production deployként működik;
- az exact candidate SHA, build-once szétválasztás, no-deploy és dinamikus
  candidate-range whitespace gate az integrált fában jelen van;
- az S3a.1 source hosted futása a fenti exact commiton zöld;
- az image hosted futása fail-closed piros, az ok még `UNVERIFIED`;
- branch protection, required check beállítás, immutable registry digest,
  signature/attestation, promotion, production readiness és VPS topológia nem
  tekinthető igazoltnak;
- a futó VPS-t és a `main` ágat ez az etap nem érinti.

Távolítsd el vagy javítsd a kanonikus tudásban azokat az állításokat, amelyek
még automatikus main-push deployt írnak le aktuális állapotként. Történeti
megállapítást ne hamisíts meg: jelöld múltbeli vagy lezárt kockázatként.

## Megőrzendő kontraktusok

- Az S1a API-válaszok, státuszkódok, alapértelmezett limitjei és upload lifecycle
  szemantikája nem változhat.
- Customer modellel, valódi ügyfélfájllal vagy secrettel nem tesztelhetsz.
- A `.github/workflows/ci.yml` candidate SHA/range kapuja nem váltható vissza
  bare `git diff --check` ellenőrzésre, hard-coded base-re, empty-tree base-re
  vagy üres fallbackre.
- Workflow checkout maradjon credentials-disabled és minimális
  `contents: read` jogosultságú.
- A validation workflow nem deployolhat, nem pusholhat registrybe, nem használhat
  SSH/VPS útvonalat és nem igényelhet production secretet.
- A HIGH/CRITICAL image scan kapu fail-closed maradjon.
- Pricing, slicer profile, production artifact és runtime image nem módosítható.

## Tiltott mellékhatások

- `main` push vagy merge;
- force push, tag, release vagy PR létrehozása;
- deploy, registry push, image promotion, VPS/SSH művelet;
- távoli/production API- vagy slicerhívás;
- dependency vagy lockfile frissítés;
- Dockerfile/Compose/runtime redesign;
- customer adat, valódi secret vagy production credential használata;
- a LeadPilot repó módosítása;
- idegen ág/worktree tartalmának törlése vagy átírása.

## Kötelező ellenőrzések

A repository instrukciói szerint futtasd és pontos parancsokkal, darabszámokkal
jelentsd legalább az alábbiakat:

1. Az integrált commit-lánc, parentek és engedélyezett fájlfelület vizsgálata.
2. Clean install a repository által rögzített npm-verzióval (jelenleg npm
   `10.9.8`): `npm ci --ignore-scripts --no-audit --no-fund`.
3. Az S1a célzott upload/workspace/multipart tesztjei.
4. Az S3a/S3a.1 workflow-contract és candidate-whitespace tesztjei.
5. A teljes `npm test`, külön JavaScript- és Python-darabszámmal.
6. Minden trackelt JavaScript és Python fájl szintaxisellenőrzése.
7. Repository safety gate a teljes tracked halmazon, majd a nem üres staged
   változtatáskészleten is.
8. Instruction mirror teszt.
9. `npm audit --omit=dev --audit-level=moderate`.
10. `actionlint`, ha ellenőrzötten elérhető; hiányát pontosan jelentsd, ne
    telepíts globális eszközt ad hoc.
11. Az integrált candidate exact SHA-jára futó dinamikus range/whitespace gate
    a frissen fetch-elt `origin/main` commit-refből, merge-base és ancestry
    bizonyítással, üres fallback nélkül.
12. `git diff --check`, staged diff-check és záró clean-worktree ellenőrzés.
13. Disposable local Docker/API smoke csak akkor, ha a daemon igazoltan
    elérhető, nem használ ügyfélmodellt/secrettet, és a repository instrukciói
    szerint biztonságosan takarítható. Ellenkező esetben `UNVERIFIED`.

Ne hardcode-old a korábbi tesztdarabszámokat elvárásként; az integrált fa
tényleges számait jelentsd. Bármely kötelező helyi kapu hibája blokkoló. Ne
commitolj vagy pusholj piros helyi kapu mellett.

## Commit és engedélyezett push

Ha kézi rekonsziliáció történt és minden kötelező helyi kapu zöld, készíts egy
külön commitot, például:

`docs: reconcile S1a and S3a integration evidence`

Ezután a felhasználó engedélye alapján pontosan egy normál, non-force push
engedélyezett, kizárólag erre az ágra:

`codex/i0-s1a-s3a-integration`

Semmilyen más refet ne pusholj. A push után ellenőrizd az exact integrált SHA
GitHub Actions futásait. Ha `gh` nem érhető el, használhatsz read-only GitHub
web/API ellenőrzést. Ne indíts újra, ne cancelölj és ne módosíts workflow-t csak
azért, hogy zöld legyen.

## Státuszszabály

- `STATUS: COMPLETED`: minden helyi kapu és mindkét hosted Source/Image
  Validation zöld az exact integrált SHA-n.
- `STATUS: CHECKPOINT_PUSHED`: a helyi kapuk zöldek és a push sikeres, de hosted
  ellenőrzés pending, elérhetetlen vagy fail-closed piros. Ez nem production
  readiness.
- `STATUS: CHECKPOINT_COMMITTED`: a helyi kapuk zöldek és a commit kész, de a
  normál push auth/network okból nem sikerült.
- `STATUS: BLOCKED`: kötelező helyi kapu, baseline, scope, konfliktus vagy
  biztonsági invariáns hibás. Ilyenkor ne pusholj.

## Kötelező zárójelentés

Add vissza pontosan és érdemben kitöltve:

```text
STATUS:
CODE_BASELINE:
WORK_BASELINE:
BRANCH:
INTEGRATED_COMMITS_AND_ORDER:
FINAL_COMMIT:
REMOTE_BRANCH_AND_PUSH_RESULT:
MODIFIED_FILES:
CONFLICTS_AND_RESOLUTIONS:
CANONICAL_KNOWLEDGE_RECONCILIATION:
S1A_CONTRACT_PRESERVATION_PROOF:
S3A_NO_DEPLOY_AND_CANDIDATE_RANGE_PROOF:
FOCUSED_TESTS_AND_COUNTS:
FULL_TESTS_AND_COUNTS:
SYNTAX_AND_REPOSITORY_GATES:
DEPENDENCY_AUDIT:
DOCKER_SMOKE:
HOSTED_SOURCE_WORKFLOW:
HOSTED_IMAGE_WORKFLOW:
UNRUN_OR_BLOCKED_GATES:
KNOWN_REMAINING_RISKS:
NEXT_PARALLEL_ETAPS:
FORBIDDEN_SIDE_EFFECTS_CHECK:
```

`NEXT_PARALLEL_ETAPS` csak sikeres I0 checkpoint után javasolhatja párhuzamosan
az S1b runtime hardeninget és az S3a-B image/supply-chain hibafeltárást. Ezeket
ebben az etapban ne kezdd el.
