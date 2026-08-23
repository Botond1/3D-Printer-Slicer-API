# I3 service authentication and HTTP envelope evidence

## Scope and checkpoint

I3 starts from exact baseline
`6241685f1af0c0a1d4be6f1c229d66ca922fbb88` on isolated branch
`codex/i3-s4a-service-auth-http-envelope`.

This checkpoint covers only:

- the slice-service authentication and slice browser-Origin subsets of S4; and
- the application-level Node HTTP-server subset of S2.

At evidence preparation time, the implementation was an uncommitted worktree
delta, so the final implementation SHA was not yet available. Final aggregate
validation and hosted exact-SHA validation are reported by the I3 integrator
after this snapshot rather than inferred here.

This stage's physical instruction mirror is the existing `.claude/**` topology;
the target worktree contains no `.Codex/**` tree, and I3 does not create one.

## Service authentication contract

- `SLICE_SERVICE_API_KEY` is mandatory at startup.
- Its value must contain 32-256 bytes, all in printable ASCII `0x20..0x7e`.
- It must differ from `ADMIN_API_KEY`; one broad shared admin/service credential
  is rejected.
- Both `POST /prusa/slice` and `POST /orca/slice` require
  `x-slicer-api-key`.
- Missing or incorrect credentials return exactly HTTP 401:

```json
{
  "success": false,
  "error": "Slice service authentication is required.",
  "errorCode": "SLICE_SERVICE_AUTH_REQUIRED"
}
```

- Supplied and configured string values are hashed to fixed-length SHA-256
  digests before `crypto.timingSafeEqual`, including unequal-length inputs.
  A missing header is rejected without entering a string comparison.
- The rejection log has one fixed event message and only sanitized `requestId`
  and resolved `clientIp` metadata. It does not include either credential,
  method, or URL.
- Route order is rate limiter -> service authentication -> root-scoped
  workspace allocation -> Multer `choosenFile` upload -> queue -> native
  processing. Authentication rejection allocates no workspace and reaches no
  upload, queue admission, artifact, timer/listener, or native-process effect.

Relevant implementation:

- [`app/config/service-auth.js`](../../../app/config/service-auth.js)
- [`app/middleware/requireSliceService.js`](../../../app/middleware/requireSliceService.js)
- [`app/routes/slice.routes.js`](../../../app/routes/slice.routes.js)
- [`app/server.js`](../../../app/server.js)
- [`app/docs/swagger-docs.js`](../../../app/docs/swagger-docs.js)

## Browser-Origin contract

- Requests without `Origin` remain allowed for service clients.
- Browser-origin slice calls must match only
  `SLICE_CORS_ALLOWED_ORIGINS`.
- `ADMIN_CORS_ALLOWED_ORIGINS` remains separate and does not authorize slice
  calls.
- Rejected browser-origin slice requests return HTTP 403
  `SLICE_CORS_ORIGIN_NOT_ALLOWED`.
- This subset does not close the protected pricing browser-Origin policy.

Relevant implementation:

- [`app/middleware/corsPolicy.js`](../../../app/middleware/corsPolicy.js)
- [`app/middleware/errorHandler.js`](../../../app/middleware/errorHandler.js)
- [`app/server.js`](../../../app/server.js)

## Node HTTP envelope

| Environment key | Default | Inclusive bounds |
| --- | ---: | ---: |
| `HTTP_HEADERS_TIMEOUT_MS` | `60000` | `1000..60000` |
| `HTTP_REQUEST_TIMEOUT_MS` | `600000` | `60000..600000` |
| `HTTP_KEEP_ALIVE_TIMEOUT_MS` | `5000` | `1000..60000` |
| `HTTP_MAX_HEADERS_COUNT` | `2000` | `16..2000` |
| `HTTP_MAX_CONNECTIONS` | `128` | `1..1024` |
| `HTTP_MAX_REQUESTS_PER_SOCKET` | `100` | `1..1000` |

Omitted, null, empty, zero, negative, fractional, exponent-form,
non-decimal, unsafe-integer, below-bound, and above-bound overrides fall back
to the corresponding default. Valid bounds are inclusive. Effective
`headersTimeout` is additionally capped at `requestTimeout`.

The bounded values are applied to one Node HTTP server before it listens.
These application settings do not establish actual VPS capacity, reverse-proxy
timeouts, total streamed upload duration, or measured CPU/RAM/disk behavior.
Those remain `UNVERIFIED` S2/S4 work.

Relevant implementation:

- [`app/config/constants.js`](../../../app/config/constants.js)
- [`app/services/http-server.js`](../../../app/services/http-server.js)
- [`app/server.js`](../../../app/server.js)

## Focused local evidence

Current implementation-lane results:

- integrated focused execution: 469/469 passed;
- focused Python-runner execution: 6/6 passed;
- required I3 source mutations: 5/5 rejected;
- HTTP envelope defaults, inclusive bounds, invalid-value fallbacks,
  pre-listen application, max-connection rejection, partial-request cleanup,
  and repeat assertions passed.

The durable tests cover startup failure, 32/256-byte boundaries,
printable-ASCII rejection, admin-key reuse rejection, exact HTTP 401 response,
timing-safe primitive use, sanitized log fields, route order and zero
unauthorized side effects, separate/no-Origin CORS behavior, OpenAPI contract,
Python runner header propagation, and inert image-validation startup
configuration.

Final aggregate results and hosted exact-SHA results remain pending and must not
be inferred from these focused counts.

## Preserved and unverified boundaries

- Runtime state remains root-scoped under `input/`, `output/`, and `configs/`.
  No `app/input`, `app/output`, or `app/configs` path is introduced.
- The workflow uses a separate safe inert slice key for validation startup; it
  does not read or disclose a production secret.
- No local Docker build result is claimed.
- No deploy, push, PR, merge, tag, release, registry publication, SSH/VPS
  contact, or production proof occurred in this documentation lane.
- Credential rotation/revocation/audience and production secret delivery,
  protected pricing Origin policy, proxy-hop/CIDR verification, private
  ingress/egress, observability, actual VPS capacity, proxy timeouts, remaining
  S2 resource/state exits, complete S4, S3b, and production readiness remain
  `UNVERIFIED`.
