import { AccessMatrix } from "@/components/admin/AccessMatrix";

export function RoleAccessTab({ api }) {
  return (
    <>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight">Role Access Control</h1>
          <p className="text-slate-500 mt-1 text-sm">Grant View, Edit or Delete access per module (only the superadmin can grant)</p>
        </div>
      </div>
      <AccessMatrix api={api} />
    </>
  );
}
