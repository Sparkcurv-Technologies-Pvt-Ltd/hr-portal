import { useEffect, useState } from "react";
import { getAvatarUrl } from "@/lib/api";
import { getInitials } from "@/lib/format";

// Round profile photo, falling back to the person's initials when there is no photo
// or it fails to load (e.g. a deleted or unreachable image)
export function Avatar({ url, name, size = "h-8 w-8", textSize = "text-xs" }) {
  const src = getAvatarUrl(url);
  const [failed, setFailed] = useState(false);

  // A new photo URL gets a fresh attempt
  useEffect(() => { setFailed(false); }, [src]);

  if (src && !failed) {
    return <img src={src} alt={name} onError={() => setFailed(true)} className={`${size} rounded-full object-cover flex-shrink-0`} />;
  }
  return (
    <div
      className={`${size} rounded-full text-white flex items-center justify-center font-bold flex-shrink-0 ${textSize}`}
      style={{ background: 'var(--brand-gradient)' }}
      aria-label={name}
    >
      {getInitials(name)}
    </div>
  );
}
