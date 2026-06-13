# React + TypeScript Migration Workspace

This route is the first-stage React + TypeScript frontend skeleton.

- URL: `/workspace`
- Keeps the legacy `/index.html` + `/app.js` UI intact.
- Reuses existing Next.js API routes, Prisma, sessions, and permissions.
- Loads only authentication and menu permission data on entry.
- Business modules remain placeholders until each module is migrated and verified.

Verification for migrated modules:

- `npm run typecheck`
- `npm run lint`
- `npm run build`

Migration order:

1. Login page
2. Permission initialization
3. Sidebar navigation
4. Base layout and welcome workspace
5. Business modules one by one
