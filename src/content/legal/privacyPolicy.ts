// src/content/legal/privacyPolicy.ts
// The privacy policy shown in the game (main menu → Privacy). The same
// text is in PRIVACY.md for hosting at a public URL, which the App Store
// listing also requires. Keep the two in sync, and fill in the
// [bracketed] details before release.

export const PRIVACY_POLICY_UPDATED = "2026-10-06";

export const PRIVACY_POLICY: { heading: string; body: string[] }[] = [
  {
    heading: "What we collect",
    body: [
      "Your account: the username you choose and your password. Passwords are never stored — only a salted, one-way hash of them.",
      "Your game progress: level, experience, weapon levels, items and gold, story progress, where you are in the world and where your Budmobile is, and play statistics (time played, enemies defeated, deaths, coins collected).",
      "We don't collect your name, email, location, contacts, photos, device identifiers or advertising identifiers, and the game contains no ads or third-party analytics or tracking.",
    ],
  },
  {
    heading: "Why",
    body: ["Only to let you log in and to save and restore your game. Your data is not sold, shared with third parties or used for advertising or profiling."],
  },
  {
    heading: "Where it's stored",
    body: [
      "On-device mode: everything stays in this device's app storage and never leaves it.",
      "Online mode: on our game server, sent only over encrypted connections (HTTPS). Session tokens are random and stored on the server only as one-way hashes.",
    ],
  },
  {
    heading: "How long",
    body: ["As long as your account exists. Log-in sessions expire after 30 days. When you delete your account, your account, saves and sessions are deleted immediately."],
  },
  {
    heading: "Your choices",
    body: [
      "Download your data: main menu → Account → Download my data.",
      "Delete your account and all its data: main menu → Account → Delete account.",
    ],
  },
  {
    heading: "Children",
    body: ["The game isn't directed at children under 13 and we don't knowingly collect data from them."],
  },
  {
    heading: "Contact",
    body: ["[Developer / company name] — [contact email]. We'll answer privacy questions and requests within 30 days."],
  },
];
