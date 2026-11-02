import { useAuth } from "@/contexts/AuthContext";
import { canDo } from "@/lib/permissions";

// `const { can } = usePermissions(); can("employees", "delete")` — admins always true
export function usePermissions() {
  const { user } = useAuth();
  return { can: (module, action = "view") => canDo(user, module, action) };
}
