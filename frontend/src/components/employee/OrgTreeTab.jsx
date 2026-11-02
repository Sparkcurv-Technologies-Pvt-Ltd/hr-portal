import { TreeStructure } from "@phosphor-icons/react";
import { OrgTreeView } from "@/components/common/OrgTreeNode";
import { TabHeader, EmptyState } from "@/components/employee/EmployeeUi";

export function OrgTreeTab({ orgNodes, orgLevels }) {
  return (
    <>
      <TabHeader title="Worker Tree" description="Your company's organizational hierarchy">
        {orgNodes.length > 0 && <span className="chip tone-blue">{orgNodes.length} {orgNodes.length === 1 ? "person" : "people"}</span>}
      </TabHeader>

      {orgNodes.length === 0 ? (
        <div className="section-card">
          <EmptyState icon={TreeStructure} tone="violet" title="Org chart not set up yet" hint="Contact your admin to build the worker tree" />
        </div>
      ) : (
        <OrgTreeView nodes={orgNodes} levelLabels={orgLevels} />
      )}
    </>
  );
}
