# Customer Responsibility Matrix — Protessera on-premise

**For:** a customer's security officer, assessor, or System Security Plan (SSP) author.
**Applies to:** an on-premise Protessera deployment (Docker on customer hardware) with `AIRGAP=1`.
**Last reviewed:** 2026-07-30

---

## Read this first

**Protessera is not "CMMC compliant," and no application can be.** NIST SP 800-171 and
CMMC are assessed against *your whole environment* — your network, your people, your
physical facility, your policies — by a C3PAO. Software is one component inside that
boundary.

What this document does is state, control by control, what the software enforces, what
you must configure, and what it inherits from the platform you run it on. That makes it
an **input to your SSP**, not a substitute for one.

Every "Software" row below was verified against the code, with the implementing file
named. If a row says the software does something, you can go read it. Where the software
does *not* implement a control, this document says so plainly rather than leaving a gap
for an assessor to find.

Control descriptions are paraphrased. **Map them against the authoritative NIST SP
800-171 text**, which is the version your assessor uses.

**Legend**
| | |
|---|---|
| **Software** | Protessera enforces this |
| **Shared** | Protessera provides a mechanism; you must configure or operate it |
| **Customer** | Entirely yours — the software has no role |
| **Inherited** | Satisfied by the host/platform you deploy on |

---

## 3.1 Access Control

| Control | Paraphrase | Responsibility | How |
|---|---|---|---|
| 3.1.1 | Limit access to authorised users | **Software** | Session-cookie authentication; every non-public route is gated in `src/middleware.ts`. Identity is re-resolved and re-validated server-side on every request, never trusted from the cookie alone. |
| 3.1.2 | Limit access to permitted transactions and functions | **Software** | Granular permission catalogue (`Permission`, `PermissionGroup`) enforced at ~216 call sites across server actions and pages. |
| 3.1.5 | Least privilege | **Shared** | The permission model supports it; **you** assign roles so people hold only what their job needs. |
| 3.1.8 | Limit unsuccessful logon attempts | **Software** | 10 failed attempts per e-mail locks that account for 15 minutes (`assertLoginNotRateLimited`, `src/lib/auth-core.ts`). **Caveat:** the counter is in-process. On a single on-premise container that is the whole application; if you run multiple replicas, the limit applies per replica. |
| 3.1.11 | Terminate a session after inactivity | **Software** | Defaults to 15 minutes under `AIRGAP=1`; `SESSION_IDLE_MINUTES` overrides. The session row is **deleted**, not merely rejected, so a captured cookie cannot be replayed afterwards. |
| 3.1.12 | Control remote access | **Customer** | Your VPN / network boundary. |
| 3.1.13 | Cryptographic protection of remote access | **Inherited** | TLS terminated by Caddy (`docker-compose.prod.yml`) using your certificates. |
| 3.1.20 | Control connections to external systems | **Software** | `AIRGAP=1` makes third-party calls impossible: analytics removed from the bundle, address lookup disabled, and the server **refuses to start** if any external integration key is configured. CI enforces it (`npm run verify:airgap`). |
| 3.1.22 | Control publicly posted information | **Customer** | Nothing in an on-premise install is public. |

## 3.3 Audit and Accountability

| Control | Paraphrase | Responsibility | How |
|---|---|---|---|
| 3.3.1 | Create and retain audit records | **Software** | `AuditLog` written from ~288 call sites — every meaningful write goes through `logAudit`. Each record carries entity, action, acting user, a JSON diff of changes, source IP address, and timestamp. |
| 3.3.2 | Trace actions to individual users | **Software** | Every record carries `userId`. Accounts are per-person; nothing in the product encourages shared logins (seats are unlimited by design, so there is no cost incentive to share one). |
| 3.3.4 | Alert on audit logging failure | **Shared** | Audit failures are logged to stderr. **You** must collect container logs and alert on them — the application does not page anyone. |
| 3.3.8 | Protect audit information from modification and deletion | **Software** | `AuditLog` is append-only, enforced by database triggers that refuse `UPDATE` and `DELETE` while still permitting `INSERT`. Applied on every provisioning path and re-applied on every container boot. Verify any time with `npx tsx scripts/apply-audit-hardening.ts --check`. **Scope:** this stops the application and casual database access. A database superuser can still `ALTER TABLE ... DISABLE TRIGGER` — see *Known limitations*. |
| 3.3.9 | Limit audit management to a privileged subset | **Shared** | Viewing audit trails is permission-gated. **You** decide who holds that permission. |

## 3.4 Configuration Management

| Control | Paraphrase | Responsibility | How |
|---|---|---|---|
| 3.4.1 / 3.4.2 | Baseline configuration | **Shared** | The application ships as a versioned container image with configuration entirely in environment variables. **You** record the image tag and env as your baseline. |
| 3.4.6 | Least functionality | **Software** | Modules can be disabled per deployment (`src/lib/modules.ts`), so unused functionality is not exposed. |
| 3.4.9 | Control user-installed software | **Customer** | Host policy. |

## 3.5 Identification and Authentication

| Control | Paraphrase | Responsibility | How |
|---|---|---|---|
| 3.5.1 / 3.5.2 | Identify and authenticate users | **Software** | Per-person accounts; passwords stored only as salted scrypt hashes (`hashPassword`), never reversibly. |
| 3.5.3 | Multi-factor authentication | **Software** | TOTP (RFC 6238) second factor, enrolment and challenge (`src/lib/services/mfa.ts`). Secrets encrypted at rest with AES-256-GCM. **You** must require enrolment as policy — see *Known limitations*. |
| 3.5.7 | Minimum password complexity | **Software** | 12+ characters of any composition, or 8+ using three of four character classes, plus a small block-list of passwords that pass composition rules and are still guessed first. |
| 3.5.8 | Prohibit password reuse | **Not implemented** | No password history is retained. See *Known limitations*. |
| 3.5.10 | Store and transmit only protected passwords | **Software** | scrypt hashes at rest; TLS in transit. |

## 3.13 System and Communications Protection

| Control | Paraphrase | Responsibility | How |
|---|---|---|---|
| 3.13.1 | Monitor and protect boundaries | **Customer** | Your firewall and network segmentation. |
| 3.13.8 | Cryptographic protection in transit | **Inherited** | TLS via Caddy with your certificates. |
| 3.13.11 | FIPS-validated cryptography | **Inherited** | All cryptography uses Node's `crypto` (OpenSSL). Satisfying this control means **deploying on a host with a FIPS-validated OpenSSL module in FIPS mode**. The application does not bundle its own crypto library. |
| 3.13.16 | Protect CUI at rest | **Shared** | Business data is in PostgreSQL. **You** provide encryption at rest — full-disk encryption, or an encrypted volume for the database. MFA secrets are additionally application-encrypted. |

## Families the software has no role in

Entirely **Customer**: **3.2** Awareness and Training, **3.6** Incident Response,
**3.7** Maintenance, **3.8** Media Protection, **3.9** Personnel Security,
**3.10** Physical Protection, **3.11** Risk Assessment, **3.12** Security Assessment,
**3.14** System and Information Integrity.

An on-premise deployment shifts most of 800-171 onto you, which is the point: nothing
reaches our infrastructure, so nothing about our infrastructure is in your assessment
scope.

---

## Known limitations

Stated deliberately. An assessor will find these; better that they read them here.

1. **Audit immutability is not tamper-proof against a database administrator.** The
   triggers defeat the application and casual SQL access. Anyone with superuser or table
   ownership can disable them. Full non-repudiation requires shipping audit records
   off-box to append-only storage (syslog to a WORM target, or a separate append-only
   database), which is your infrastructure decision.
2. **Password reuse (3.5.8) is not enforced.** No password history is stored, so a user
   may set a password they previously used.
3. **MFA is not mandatory.** The mechanism is complete and per-user, but the application
   does not refuse to serve users who have not enrolled. Enforce enrolment as policy.
4. **Failed-logon limiting is per-process.** Correct for a single container; weaker if you
   scale to multiple replicas without a shared store.
5. **FIPS is not verified by the application.** It does not check whether the host OpenSSL
   is in FIPS mode, so it will run and report nothing on a non-FIPS host.
6. **No automated 3.3.4 alerting.** Audit-write failures reach stderr only.

## Verifying these claims yourself

```bash
# Audit logs are append-only in every schema (non-zero exit if any is not)
npx tsx scripts/apply-audit-hardening.ts --check

# Prove the trigger refuses tampering (both must ERROR)
psql "$DATABASE_URL" -c "UPDATE public.\"AuditLog\" SET action = 'TAMPERED';"
psql "$DATABASE_URL" -c "DELETE FROM public.\"AuditLog\";"

# ...while inserting still works, so audit logging is not broken
psql "$DATABASE_URL" -c "INSERT INTO public.\"AuditLog\" (id,\"entityType\",\"entityId\",action) VALUES ('probe','Probe','1','CHECK');"

# The shipped client contains no third-party hosts
npm run verify:airgap

# Air-gapped mode refuses to start with an outbound integration configured
AIRGAP=1 RESEND_API_KEY=x npm start        # must fail with a FATAL message
```

The boot log states the posture on every start:

```
[protessera] AIRGAP=1 — analytics off, address lookup off, no third-party integrations configured
[protessera] applying append-only audit log protection
```
