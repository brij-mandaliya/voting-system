# Design — Dynamic Team Voting & Evaluation System

Phase 1 output (per the delivery plan). Implementation follows this document.

---

## 1. Requirements Analysis — Assumptions & Resolved Ambiguities

| # | Ambiguity | Decision / Assumption |
|---|-----------|----------------------|
| A1 | "One team per room membership" vs org-level team | Participant has an org-level team (`user.teamId`) used as the **default** when added to a room; `room_members.teamId` can override per room (e.g. a scratch team created for one event). Self-vote rule uses the **room-membership** team. |
| A2 | Who are "eligible voters" for a round | Active participants whose **room membership** team ≠ presenting team. Participants with no team (`teamId = NULL`) are eligible to vote for any team (judges/observers). |
| A3 | Moderator scope | Moderators are assigned per room via `room_members.role = MODERATOR`. Room creator admin is implicitly permitted everywhere. |
| A4 | "Team is already complete → prevent reselect" | A round for team T in state `CLOSED` cannot be re-presented unless an admin explicitly re-opens it (`re-open` = reopen that same round, audited) or admin starts it again via the same control with `force: true` (also audited). |
| A5 | Config version boundaries | Categories are **immutable rows** tied to a `RoomConfigVersion`. Structural edits (ranges/weight/step/add/remove) after first vote require starting a new config version; the new version deep-copies current categories. Cosmetic edits (name/description) mutate in place. |
| A6 | Vote submission atomicity | One vote row + N score rows inside one DB transaction with `INSERT ... ON CONFLICT (round_id, voter_id) DO UPDATE` semantics (upsert on the unique constraint) so double-clicks are idempotent; concurrent edits increment `revision`. |
| A7 | Results visibility | Participants see nothing until `room.publishedAt` is set, unless `liveResults=true`. A participant whose team participated sees own-team summary once published. |
| A8 | Login identifier | Username **or** email both accepted; generic "Invalid credentials" always. |
| A9 | Trimmed mean | Applied per category when the room's `aggregationMethod = trimmed_mean`: drop one highest and one lowest score **per category** (requires ≥ 3 scores), then weighted-mean of the remaining category averages. |
| A10 | Score normalization | `overall = Σ(weight_i × avg_i / max_i) / Σ(weight_i) × 100`. Missing votes excluded (never zero). |
| A11 | Tie-break | (1) higher overall; (2) higher avg/max in the highest-weight category; (3) more votes; else **shared rank**. |
| A12 | Numbers | Scores stored as `DECIMAL(6,2)`; averages/overalls as `DECIMAL(8,4)`. |
| A13 | Real-time fallback | Socket.IO with long-polling fallback transport; on reconnect the client re-fetches a full REST snapshot. Redis adapter enabled only when `REDIS_URL` is set (single-instance deployments skip Redis). |
| A14 | Multiple concurrent open rounds? | No — one voting round open per room at a time; presenting team is singular per room. |
| A15 | Participants with no team in "open_with_code" rooms | Allowed to join and vote for any team. |

### Extension of the voting state machine after deactivation
If a participant is deactivated mid-round, their session + sockets are invalidated immediately; their already-submitted votes remain (they were valid at submission), but they leave the "eligible/pending" pool live.

---

## 2. Architecture

Monorepo (npm workspaces):

```
voting-system/
├── docker-compose.yml
├── .env.example
├── packages/shared/          # zod schemas, TS types, permission model (FE+BE)
│   └── src/{permissions.ts, dto.ts, realtime.ts, index.ts}
├── server/                   # Express + TS, layered
│   └── src/
│       ├── index.ts          # bootstrap (HTTP + Socket.IO)
│       ├── app.ts            # express wiring
│       ├── config.ts         # env (zod-validated)
│       ├── db.ts             # prisma client
│       ├── middleware/       # auth, permission, csrf, rate-limit, errors
│       ├── repositories/     # data access (prisma wrappers)  ← persistence layer
│       ├── services/         # business logic (transactions, rules)
│       ├── routes/           # controllers (validation → service)
│       ├── realtime/         # socket auth + emitters
│       └── utils/            # codes, sanitize, passwords, errors
└── web/                      # React + Vite + TS + Tailwind
    └── src/{api, components, contexts, layouts, pages}
```

Request flow: `route (zod validation) → permission guard → service (rules & transactions) → repository (prisma)`, with audit logging inside services.

---

## 3. ER / Schema (Prisma)

```
User(id, usernameuniq, email uniq, name, passwordHash, role[ADMIN|MODERATOR|PARTICIPANT],
     status[ACTIVE|INACTIVE], mustChangePassword, teamId?, deletedAt?)
Team(id, name uniq, description, projectTitle, links json, logoUrl?, deletedAt?)
Room(id, name, description, joinCode uniq, joinCodeExpiresAt?, joinCodeEnabled,
     accessMode[RESTRICTED|OPEN_WITH_CODE], status[DRAFT|ACTIVE|CLOSED|ARCHIVED],
     settings json{allowVoteEdit, adminCanSeeVoterIdentity, liveResults,
                   minVotesThreshold, aggregationMethod},
     publishedAt?, createdBy, deletedAt?)
RoomMember(id, roomId, userId, role[PARTICIPANT|MODERATOR], teamId?)  UNIQUE(roomId,userId)
RoomTeam(id, roomId, teamId, presentationOrder, details json)          UNIQUE(roomId,teamId)
RoomConfigVersion(id, roomId, version, isCurrent)                      UNIQUE(roomId,version)
Category(id, roomId, configVersionId, name, description, minScore, maxScore, step,
         weight, isRequired, displayOrder, active)
VotingRound(id, roomId, teamId, status[PENDING|OPEN|PAUSED|CLOSED], configVersionId,
            openedAt?, closedAt?, reopenedCount)
Vote(id, roundId, roomId, teamId, voterId, revision, submittedAt, updatedAt)
   UNIQUE(roundId, voterId)
VoteScore(id, voteId, categoryId, score DECIMAL)       UNIQUE(voteId, categoryId)
AuditLog(id, actorId?, action, entityType, entityId?, before json?, after json?, ip?, createdAt)
Session(id, userId, tokenHash, expiresAt, ip?, userAgent?)
ImportJob(id, filename, createdById, status[PENDING|PREVIEWED|COMMITTED|FAILED], report json)
```

Extra DB-enforced integrity (raw SQL in a post-migration):
- `CHECK (vote belongs to room of round & team)` via composite FK + CHECK constraints:
  ` votes → VotingRound(roomId)` and `votes.roomId = round.roomId` enforced by FK `(roundId, roomId)` → `voting_rounds(id, roomId)`.
- `CHECK (score >= min AND score <= max AND (score-min) % step = 0)` — validated in service against the round's config snapshot **and** guarded by CHECK on vote_scores joining the category row.
- Self-vote prevention: CHECK `(voterId != (SELECT userId FROM room_members WHERE roomId=votes.roomId AND teamId=votes.teamId))` equivalent is enforced in the service; plus a DB-level rule: a vote's team must have a RoomTeam row for that room (FK) and the voter's membership team is checked in-transaction with row locks to be race-free.
- Soft deletes (`deletedAt`) on users, teams, rooms, and `active` flag on categories.

---

## 4. Journeys

**Admin:** login → create participants (form or CSV/XLSX bulk upload with dry-run preview → commit) → download credentials sheet → create teams → create room (join code auto-generated) → link teams + order → define categories (any number) → activate room → open live view → select presenting team → open voting → monitor progress → close round → next team → publish results → export CSV/XLSX → archive.

**Participant:** login (forced password change on first login) → lobby → join room by code/invite link → see room, teams, categories, current presenting team (live) → when round opens: score each category (slider/stepper sized to range) → review → submit → confirmation; can edit while round open (if allowed) → see own status → see published results.

## 5. Voting state machine

```
Room:      DRAFT → ACTIVE → CLOSED → ARCHIVED        (closed room rejects joins/votes)
Round:     PENDING --open--> OPEN --pause--> PAUSED --resume--> OPEN
                     OPEN/PAUSED --close--> CLOSED --reopen(admin)--> OPEN (reopenedCount++, audited)
```
- `PENDING` rounds are created implicitly when a team is selected; presenting team changes only when no round is OPEN (or admin forces).
- Votes accepted only while `status=OPEN`.
- Room `votingState` derives from the current round.

## 6. API contract (prefix `/api`)

Auth: `POST /auth/login`, `POST /auth/logout`, `POST /auth/logout-all`, `POST /auth/change-password`, `GET /auth/me`
Participants (admin): `GET/POST /participants`, `PATCH /participants/:id` (edit/status/soft-delete/team), `POST /participants/:id/reset-password`, `POST /participants/import/preview` (multipart), `POST /participants/import/commit`, `GET /participants/import/template` (csv/xlsx), `GET /participants/credentials-sheet`
Teams: `GET/POST /teams`, `PATCH/DELETE /teams/:id`, `POST /teams/import/preview|commit` (multipart CSV, optional `roomId`), `GET /teams/import/template`
Rooms: `GET/POST /rooms`, `GET/PATCH/DELETE /rooms/:id`, `POST /rooms/:id/status`, `POST /rooms/:id/duplicate`, `POST /rooms/:id/join-code/regenerate|disable`, `POST /rooms/join {code}`
Room members: `GET/PUT /rooms/:id/members` (bulk set), room teams: `GET/PUT /rooms/:id/teams`
Categories: `GET/POST /rooms/:id/categories`, `PATCH/DELETE /categories/:id`, `POST /rooms/:id/categories/reorder`, `POST /rooms/:id/config/new-version`
Rounds: `GET /rooms/:id/rounds`, `POST /rooms/:id/rounds/select {teamId, force?}`, `POST /rounds/:id/open|pause|resume|close|reopen`
Votes: `POST /rounds/:id/votes {scores:[{categoryId,score}]}` (participant; upsert), `GET /rooms/:id/my-vote/:roundId?`
Progress (admin/mod): `GET /rooms/:id/rounds/:roundId/progress`
Results: `GET /rooms/:id/results`, `POST /rooms/:id/results/publish|unpublish`, `GET /rooms/:id/results/export?format=csv|xlsx&kind=summary|categories|raw`
Audit (admin): `GET /audit`
All mutating requests require the `X-CSRF-Token` header matching the `csrf` cookie. Auth uses httpOnly `session` cookie.

## 7. Socket events (namespace default, rooms `room:{id}`)

Outbound: `room:state_changed`, `team:presenting_changed {roundId, teamId, status}`,
`voting:opened|paused|resumed|closed {roundId}`, `vote:submitted {roundId, count, total}` (admin/mod only),
`results:published {publishedAt}`.
Client → server: `room:join {roomId}` (session-authenticated, membership-checked), `room:leave`.
Auth: session cookie handshake; every join authorized server-side. **Server is source of truth** — clients only render received state + REST resync on reconnect (`snapshot = GET /rooms/:id/full`).

## 8. Permission model (new roles = data, not refactor)

`packages/shared/src/permissions.ts` exports `PERMISSIONS` (string literals) and `ROLE_PERMISSIONS: Record<Role, Permission[]>`. Middleware `requirePermission('participants:write')` and room-scoped `requireRoomRole(...)`. Adding a role = adding one map entry.

## 9. Edge cases handled

- Presenting team changed mid-vote → round auto-closes (audited), in-flight votes already stored stay valid; UI gets `team:presenting_changed`.
- Participant deactivated/moved mid-round → sessions revoked, sockets disconnected, pending pool recalculated live.
- Socket drop during submission → submission is idempotent (upsert keyed `roundId+voterId`); client retries safely.
- Double click → same payload upserts same revision.
- Room closed while vote in flight → round/room status re-checked inside the transaction.
- Team with no eligible voters → moderation UI warns; results show participation 0.
- Empty room → lobby shows empty states.
- Clock skew → all timestamps server-generated.
- CSV formula injection → cells starting with `=` `+` `-` `@` are neutralized; size (5 MB) and row (5000) limits enforced.
- Concurrent submissions → unique constraint + upsert + transaction with row lock on membership row.

## 10. Security checklist

- [x] Argon2id hashing; temp passwords generated CSPRNG (16 chars), shown once, downloadable sheet, `mustChangePassword` forced.
- [x] httpOnly+Secure+SameSite=Strict session cookies (session table), CSRF double-submit, logout & logout-all.
- [x] Login rate limit 5/15min per account+IP with lockout + audit.
- [x] Zod validation on every route; parameterized queries (Prisma); output encoding React.
- [x] Helmet, strict CORS (origin from env), no secrets in logs, .env only.
- [x] Guards on every REST route & socket event; room-scope checked in services (no IDOR: all `/rooms/:id/...` verify membership/permission).
- [x] Audit log: logins (success/fail), credential ops, participant/team/room/category changes, round controls, vote submit/edit, publish, exports.
- [x] Generic auth errors (no user enumeration).
