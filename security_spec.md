# Firestore Security Specification

## 1. Data Invariants
1. **Identity Isolation**: `/users/{userId}` contains PII (`email`) and may only be read or written by the authenticated user whose `request.auth.uid == userId`. No `list` queries are allowed on `/users`.
2. **Non-PII Email Lookup**: `/emailLookup/{emailHash}` is keyed by a 64-char hex SHA-256 hash of a normalized lowercase email address, stores only `{ uid, displayName, updatedAt }` (no email PII), forbids `list`, and only allows `create`/`update`/`delete` when `uid == request.auth.uid`.
3. **Task Ownership & Collaboration**: `/tasks/{taskId}` must always have `ownerId == request.auth.uid` on creation, `sharedWithUids` initialized empty (`size() == 0`) on creation, and `sharedWithUids.size() <= 20` on updates. Only the owner or a user listed in `sharedWithUids` may read or update a task, and only the owner may delete it.
4. **Master-Gated Subcollection Shares**: `/tasks/{taskId}/shares/{shareUserId}` must reference an existing parent task where the caller is the owner or an existing collaborator, and creations/deletions must stay synchronized with `tasks/{taskId}.sharedWithUids` via `getAfter(...)` / `!existsAfter(...)`.
5. **Temporal & Structural Integrity**: All `createdAt` and `updatedAt` fields must equal `request.time`. All document IDs must match `^[a-zA-Z0-9_\-]+$` (`<= 128` chars), and every write validates exact allowed/required keys and string/list bounds.

## 2. The "Dirty Dozen" Attack Payloads
1. **Identity Spoofing on Task Create**: Authenticated as `userA`, attempt to create `/tasks/task1` with `ownerId: "userB"`. Expected: `PERMISSION_DENIED`.
2. **Unverified Email Write**: Authenticated with `email_verified: false`, attempt to create `/tasks/task1`. Expected: `PERMISSION_DENIED`.
3. **Shadow Field Injection on Create**: Create `/tasks/task1` with all valid fields plus `"isAdmin": true`. Expected: `PERMISSION_DENIED`.
4. **Shadow Field Injection on Update**: Update `/tasks/task1` with `{"completed": true, "isAdmin": true, "updatedAt": request.time}`. Expected: `PERMISSION_DENIED`.
5. **Owner Hijack on Update**: As collaborator `userB`, update `/tasks/task1` changing `ownerId` from `"userA"` to `"userB"`. Expected: `PERMISSION_DENIED`.
6. **Client Timestamp Forgery**: Create `/tasks/task1` with `createdAt` set to a past client timestamp instead of server `request.time`. Expected: `PERMISSION_DENIED`.
7. **PII Blanket Read**: Authenticated as `userB`, attempt `get` or `list` on `/users/userA`. Expected: `PERMISSION_DENIED`.
8. **Email Lookup Scraping**: Authenticated as `userB`, attempt `list` on `/emailLookup`. Expected: `PERMISSION_DENIED`.
9. **ID Poisoning**: Attempt to create `/tasks/` with a 200-character ID or invalid characters like `task/../admin`. Expected: `PERMISSION_DENIED`.
10. **Unbounded Array / Value Poisoning**: Update `/tasks/task1` setting `sharedWithUids` to 21 UIDs or `title` to a 500-character string. Expected: `PERMISSION_DENIED`.
11. **Unauthorized Task Delete**: As collaborator `userB` (in `sharedWithUids`, not `ownerId`), attempt `delete` on `/tasks/task1`. Expected: `PERMISSION_DENIED`.
12. **Orphaned / Desynchronized Share Write**: Create `/tasks/task1/shares/userB` directly without atomically adding `"userB"` to `/tasks/task1.sharedWithUids` in the same batch. Expected: `PERMISSION_DENIED`.
