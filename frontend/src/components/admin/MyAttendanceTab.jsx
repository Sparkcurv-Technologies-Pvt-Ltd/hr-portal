import { format } from "date-fns";
import { CalendarBlank } from "@phosphor-icons/react";
import { TimeTrackerCard } from "@/components/common/TimeTrackerCard";

// Manager's own clock in/out view
export function MyAttendanceTab({ api, user }) {
  return (
    <>
      <div className="hero-banner mb-6">
        <div className="flex items-end justify-between">
          <div>
            <p className="hero-sub text-sm font-medium flex items-center gap-1.5">
              <CalendarBlank className="h-4 w-4" weight="bold" />
              {format(new Date(), "EEEE, MMMM d, yyyy")}
            </p>
            <h1 className="font-bold font-['Outfit'] tracking-tight mt-1.5">
              Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 18 ? 'Afternoon' : 'Evening'}, {user?.name?.split(' ')[0]}
            </h1>
            <p className="hero-sub text-sm mt-1">Clock in, take breaks and track your working hours.</p>
          </div>
        </div>
      </div>
      <div className="max-w-md">
        <TimeTrackerCard user={user} api={api} />
      </div>
    </>
  );
}
