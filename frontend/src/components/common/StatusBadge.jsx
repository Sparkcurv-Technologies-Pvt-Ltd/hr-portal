// Approved / Rejected / Pending pill for leave & permission requests
export const getStatusBadge = (status) => {
  switch (status) {
    case "approved":
      return <span className="badge-approved">Approved</span>;
    case "rejected":
      return <span className="badge-rejected">Rejected</span>;
    default:
      return <span className="badge-pending">Pending</span>;
  }
};
