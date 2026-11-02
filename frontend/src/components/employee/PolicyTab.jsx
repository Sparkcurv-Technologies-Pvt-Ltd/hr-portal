import { format } from "date-fns";
import { Scroll } from "@phosphor-icons/react";
import { TabHeader, EmptyState } from "@/components/employee/EmployeeUi";

export function PolicyTab({ policies }) {
  return (
    <>
      <TabHeader title="Company Policy" description="Read and understand our company guidelines">
        {policies.length > 0 && <span className="chip tone-blue">{policies.length} {policies.length === 1 ? "policy" : "policies"}</span>}
      </TabHeader>

      {policies.length === 0 ? (
        <div className="section-card">
          <EmptyState icon={Scroll} tone="blue" title="No company policies have been added yet." hint="Policies published by HR will show up here." />
        </div>
      ) : (
        <div className="space-y-4">
          {policies.map((policy) => (
            <div key={policy.id} data-testid={`policy-card-${policy.id}`} className="section-card p-5 sm:p-6">
              <div className="flex items-start gap-3.5 mb-3">
                <span className="stat-icon tone-blue">
                  <Scroll className="h-5 w-5" weight="duotone" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-slate-900 font-['Outfit'] leading-snug">{policy.title}</h3>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="chip tone-blue">{policy.category}</span>
                    {policy.updated_at && (
                      <span className="text-xs text-slate-400">
                        Last updated: {format(new Date(policy.updated_at), "MMM d, yyyy")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed sm:pl-[56px] break-words">
                {policy.content}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
