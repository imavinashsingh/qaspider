# Registration and access control

A visitor can register using an email and password. Registration must preserve email uniqueness. These acceptance criteria are authoritative; a failing run must never alter them.

## Acceptance Criteria
- AC-1: A guest submitting a valid unique email and a generated password sees exactly Account created in the status role.
- AC-2: A guest submitting invalid-email and a generated password sees exactly Invalid email in the alert role.
- AC-3: A guest submitting an email belonging to an existing owned fixture and a generated password sees exactly Email already exists in the alert role; do not create a duplicate account.
- AC-4: A guest GET to http://127.0.0.1:4317/api/admin/users returns HTTP 401.
- AC-5: An authenticated standard user GET to http://127.0.0.1:4317/api/admin/users returns HTTP 403.
- AC-6: An authenticated admin GET to http://127.0.0.1:4317/api/admin/users returns HTTP 200.
