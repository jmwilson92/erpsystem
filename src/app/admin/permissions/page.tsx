import {
  listPermissionGroups,
  ensureDefaultPermissionGroups,
  ensurePermissionCatalog,
} from "@/lib/services/permissions";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  actionAssignUserGroup,
  actionRemoveUserGroup,
  actionGrantUserPermission,
} from "@/app/actions";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function PermissionsAdminPage() {
  await ensureDefaultPermissionGroups();
  await ensurePermissionCatalog();

  const [groups, users, directGrants] = await Promise.all([
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
                    className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-teal-400/90"
                  >
                    {pl.permission.code}
                  </li>
                ))}
              </ul>
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
              {PERMISSIONS.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.code} — {p.name}
                </option>
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
