import {
  listPermissionGroups,
  ensureDefaultPermissionGroups,
} from "@/lib/services/permissions";
import { prisma } from "@/lib/db";
import { PERMISSIONS, ROLES } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  actionAssignUserGroup,
  actionRemoveUserGroup,
  actionGrantUserPermission,
  actionCreatePermissionGroup,
  actionToggleGroupPermission,
  actionInviteUser,
  actionDecidePermissionRequest,
  actionAdminResetPin,
} from "@/app/actions";
import { Input } from "@/components/ui/input";

/** Permissions grouped by module for pickers and the catalog reference. */
function permsByModule() {
  const by = new Map<string, typeof PERMISSIONS>();
  for (const p of PERMISSIONS) {
    const list = by.get(p.module) || [];
    list.push(p);
    by.set(p.module, list);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function PermissionsAdminPage() {
  // Single ensure path — soft-fail so a SQLite busy lock doesn't 500 the whole page
  try {
    await ensureDefaultPermissionGroups();
  } catch (e) {
    console.error("ensureDefaultPermissionGroups", e);
  }

  const accessRequests = await prisma.permissionRequest.findMany({
    where: { status: "PENDING" },
    include: { user: { select: { name: true, role: true } } },
    orderBy: { createdAt: "asc" },
  });
  const [pendingInvites, groups, users, directGrants] = await Promise.all([
    prisma.userInvite.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    listPermissionGroups(),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        permissionGroups: {
          include: { group: { select: { code: true, name: true } } },
        },
      },
    }),
    prisma.userPermission.findMany({
      include: {
        user: { select: { name: true } },
        permission: { select: { code: true, name: true } },
      },
      take: 50,
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles & Permissions"
        description="Assign permission groups or grant individual actions to users"
      />

      {/* Access requests — raised from the "no permission" page */}
      {accessRequests.length > 0 && (
        <Card className="border-amber-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Access requests ({accessRequests.length})
            </CardTitle>
            <p className="text-xs text-slate-500">
              People who hit a permission wall and asked for access. Grant
              permanently, grant for 24 hours, or deny.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {accessRequests.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 px-3 py-2 text-sm"
              >
                <span className="text-slate-200">{r.user.name}</span>
                <span className="text-xs text-slate-500">{r.user.role}</span>
                <span className="font-mono text-xs text-amber-300">
                  {r.permissionCode}
                </span>
                {r.note && (
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                    “{r.note}”
                  </span>
                )}
                <div className="ml-auto flex gap-1.5">
                  {(
                    [
                      ["GRANT", "Grant", "default"],
                      ["GRANT_ONCE", "Grant 24h", "secondary"],
                      ["DENY", "Deny", "outline"],
                    ] as const
                  ).map(([decision, label, variant]) => (
                    <form key={decision} action={actionDecidePermissionRequest}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="decision" value={decision} />
                      <Button
                        type="submit"
                        size="sm"
                        variant={variant}
                        className={`h-7 text-xs ${decision === "DENY" ? "text-rose-400" : ""}`}
                      >
                        {label}
                      </Button>
                    </form>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Sign-off PIN reset */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Reset a sign-off PIN</CardTitle>
          <p className="text-xs text-slate-500">
            For techs who forgot their shop-floor PIN. Leave the PIN blank to
            clear it (they set a new one under My Account).
          </p>
        </CardHeader>
        <CardContent>
          <form action={actionAdminResetPin} className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">
              User
              <select name="userId" required className={`${selectClass} mt-1 w-64`}>
                <option value="">— Select —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.role}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              New PIN (4–6 digits, blank = clear)
              <Input
                name="pin"
                inputMode="numeric"
                pattern="\d{0,6}"
                maxLength={6}
                className="mt-1 h-9 w-40"
              />
            </label>
            <Button type="submit" size="sm" className="h-9">
              Reset PIN
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-teal-900/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Invite teammates</CardTitle>
          <p className="text-xs text-slate-500">
            Unlimited seats — invite everyone. The invite e-mail (with the
            activation link) is logged in the Email Center; SMTP delivers it
            for real in production.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            action={actionInviteUser}
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Input name="email" type="email" required placeholder="teammate@company.com" className="h-9" />
            <Input name="name" placeholder="Name (optional)" className="h-9" />
            <select
              name="role"
              className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200"
              defaultValue="OPERATOR"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" className="h-9">
              Send invite
            </Button>
          </form>
          {pendingInvites.length > 0 && (
            <div className="space-y-1 border-t border-slate-800 pt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Pending invites
              </p>
              {pendingInvites.map((inv) => (
                <p key={inv.id} className="text-xs text-slate-400">
                  {inv.email} · {inv.role} · {inv.kind.toLowerCase()} · expires{" "}
                  {inv.expiresAt.toISOString().slice(0, 10)}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <Card key={g.id} className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {g.name}{" "}
                <span className="font-mono text-xs text-slate-500">{g.code}</span>
              </CardTitle>
              <p className="text-xs text-slate-500">
                Base role: {g.baseRole || "—"} · {g.users.length} member(s)
              </p>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-slate-400">
              <ul className="flex flex-wrap gap-1">
                {g.permissions.map((pl) => (
                  <li
                    key={pl.id}
                    className="flex items-center gap-1 rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-teal-400/90"
                  >
                    {pl.permission.code}
                    <form action={actionToggleGroupPermission}>
                      <input type="hidden" name="groupId" value={g.id} />
                      <input
                        type="hidden"
                        name="permissionCode"
                        value={pl.permission.code}
                      />
                      <input type="hidden" name="enabled" value="false" />
                      <button
                        type="submit"
                        className="text-slate-600 hover:text-rose-400"
                        title={`Remove ${pl.permission.code} from ${g.name}`}
                      >
                        ×
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
              <form
                action={actionToggleGroupPermission}
                className="flex flex-wrap gap-1.5 border-t border-slate-800 pt-2"
              >
                <input type="hidden" name="groupId" value={g.id} />
                <input type="hidden" name="enabled" value="true" />
                <select
                  name="permissionCode"
                  required
                  className={`${selectClass} h-8 max-w-[260px] text-[11px]`}
                >
                  <option value="">Add permission…</option>
                  {permsByModule().map(([module, perms]) => (
                    <optgroup key={module} label={module}>
                      {perms.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.code} — {p.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <Button type="submit" size="sm" variant="outline" className="h-8">
                  Add
                </Button>
              </form>
              {g.users.length > 0 && (
                <ul className="space-y-1 border-t border-slate-800 pt-2">
                  {g.users.map((u) => (
                    <li
                      key={u.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="text-slate-300">{u.user.name}</span>
                      <form action={actionRemoveUserGroup}>
                        <input type="hidden" name="userId" value={u.userId} />
                        <input type="hidden" name="groupId" value={g.id} />
                        <Button type="submit" size="sm" variant="ghost">
                          Remove
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Create permission group</CardTitle>
          <p className="text-xs text-slate-500">
            Build custom groups (e.g. &quot;Shop Leads&quot;, &quot;Finance
            Approvers&quot;) and attach any mix of view / action permissions.
          </p>
        </CardHeader>
        <CardContent>
          <form
            action={actionCreatePermissionGroup}
            className="flex flex-wrap gap-2"
          >
            <Input
              name="name"
              required
              placeholder="Group name"
              className="max-w-xs"
            />
            <Input
              name="description"
              placeholder="Description (optional)"
              className="max-w-sm"
            />
            <Button type="submit" size="sm">
              Create group
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Permission catalog ({PERMISSIONS.length})
          </CardTitle>
          <p className="text-xs text-slate-500">
            Every module has a <span className="font-mono">.view</span>{" "}
            permission gating read access plus action permissions gating
            writes. Role defaults apply unless a group or direct grant says
            otherwise; direct denies always win.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {permsByModule().map(([module, perms]) => (
            <div key={module} className="rounded-lg border border-slate-800 p-2.5">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {module}
              </p>
              <ul className="space-y-0.5">
                {perms.map((p) => (
                  <li key={p.code} className="text-[11px]">
                    <span
                      className={
                        p.code.endsWith(".view")
                          ? "font-mono text-sky-400/90"
                          : "font-mono text-teal-400/90"
                      }
                    >
                      {p.code}
                    </span>{" "}
                    <span className="text-slate-500">{p.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Assign user to group</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionAssignUserGroup} className="flex flex-wrap gap-2">
            <select name="userId" required className={`${selectClass} max-w-xs`}>
              <option value="">User…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
            <select name="groupId" required className={`${selectClass} max-w-xs`}>
              <option value="">Group…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm">
              Assign
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Grant / deny single permission</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={actionGrantUserPermission}
            className="flex flex-wrap gap-2"
          >
            <select name="userId" required className={`${selectClass} max-w-xs`}>
              <option value="">User…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <select
              name="permissionCode"
              required
              className={`${selectClass} max-w-sm`}
            >
              <option value="">Permission…</option>
              {permsByModule().map(([module, perms]) => (
                <optgroup key={module} label={module}>
                  {perms.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.code} — {p.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select name="allowed" className={selectClass} defaultValue="true">
              <option value="true">Allow</option>
              <option value="false">Deny</option>
            </select>
            <Button type="submit" size="sm">
              Apply
            </Button>
          </form>
          {directGrants.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-slate-500">
              {directGrants.map((g) => (
                <li key={g.id}>
                  {g.user.name}: {g.permission.code}{" "}
                  {g.allowed ? (
                    <span className="text-emerald-500">allow</span>
                  ) : (
                    <span className="text-rose-400">deny</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">User membership snapshot</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex flex-wrap justify-between gap-2 border-b border-slate-900 py-1.5"
            >
              <span className="text-slate-300">
                {u.name}{" "}
                <span className="text-slate-600">({u.role})</span>
              </span>
              <span className="text-slate-500">
                {u.permissionGroups.length === 0
                  ? "no groups"
                  : u.permissionGroups
                      .map((pg) => pg.group.code)
                      .join(", ")}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
