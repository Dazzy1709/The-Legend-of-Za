// src/screens/menu/PrivacyPolicy.tsx
// The privacy policy, readable from the main menu (and linked at sign-up).

import { PRIVACY_POLICY, PRIVACY_POLICY_UPDATED } from "../../content/legal/privacyPolicy";

export function PrivacyPolicy() {
  return (
    <div className="max-h-[60vh] overflow-y-auto pr-2 text-sm leading-relaxed text-stone-300">
      <p className="mb-3 text-xs text-stone-500">Last updated {PRIVACY_POLICY_UPDATED}</p>
      {PRIVACY_POLICY.map((section) => (
        <section key={section.heading} className="mb-4">
          <h3 className="mb-1 font-bold tracking-wide text-stone-100 uppercase">{section.heading}</h3>
          {section.body.map((p) => (
            <p key={p} className="mb-1.5">
              {p}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}
