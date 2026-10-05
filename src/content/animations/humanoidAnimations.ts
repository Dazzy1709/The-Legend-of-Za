// src/content/animations/humanoidAnimations.ts
// The shared humanoid animation library: every clip any character can
// play, and its file in public/assets/animations/humanoid/. Clips are
// Mixamo animations retargeted onto whichever skin plays them, so one
// clip works for every character. To add one: drop the .glb in that
// folder, add its name to HumanoidAnimation and its file below.

export type HumanoidAnimation =
  | "idle"
  | "walkForward"
  | "walkBackward"
  | "running"
  | "runningBackward"
  | "jumping"
  | "jumpingForward"
  | "jumpingBackward"
  | "pistolIdle"
  | "pistolAiming"
  | "pistolStrafeLeft"
  | "pistolStrafeRight"
  | "pistolStrafeForward"
  | "pistolStrafeBackward"
  | "pistolRun"
  | "shooting"
  | "meleeAttackDownward"
  | "meleeAttackHorizontal"
  | "meleeAttack360"
  | "meleeComboV2"
  | "talking1"
  | "talking2"
  | "talking3"
  // New — all 8 verified as genuine, clean Mixamo animation-only GLBs
  // (65 bones each, no mesh, "Armature|mixamo.com|Layer0" clip), unlike
  // an earlier attempt with .fbx versions of some of these that needed
  // a lossy Assimp conversion; these load the same reliable way every
  // other clip here does.
  | "taunt"
  | "insult"
  | "hookPunch"
  | "punching"
  | "kipUp"
  | "injuredRun"
  | "fallingBackDeath"
  | "headHit"
  | "point"
  | "reload"
  // Riding the Budmobile: hopping on, the riding pose, hopping off.
  | "budMount"
  | "budHover"
  | "budDismount";

export const HUMANOID_ANIMATION_FILES: Record<HumanoidAnimation, string> = {
  idle: "Idle.glb",
  walkForward: "Walking_Forward.glb",
  walkBackward: "Walking_Backward.glb",
  running: "Running.glb",
  runningBackward: "Running_Backward.glb",
  jumping: "Jumping_Forward.glb",
  jumpingForward: "Jumping_Forward.glb",
  jumpingBackward: "Jumping_Backward.glb",
  pistolIdle: "Pistol_Idle.glb",
  pistolAiming: "Pistol_Aiming.glb",
  pistolStrafeLeft: "Pistol_Strafe_Left.glb",
  pistolStrafeRight: "Pistol_Strafe_Right.glb",
  pistolStrafeForward: "Pistol_Strafe_Forward.glb",
  pistolStrafeBackward: "Pistol_Strafe_Backward.glb",
  pistolRun: "Pistol_Run.glb",
  shooting: "shooting.glb", // the real shot clip — aim, recoil, settle (Pistol_Aiming.glb is just the held aim pose, used by pistolAiming)
  taunt: "Taunt.glb",
  insult: "Insult.glb",
  hookPunch: "Hook_Punch.glb",
  punching: "Punching.glb",
  kipUp: "Kip_Up.glb",
  injuredRun: "Injured_Run.glb",
  fallingBackDeath: "Falling_Back_Death.glb",
  headHit: "Head_Hit.glb",
  point: "Point.glb",
  reload: "Reloading.glb",
  budMount: "Bud_Mount.glb",
  budHover: "Hovering.glb",
  budDismount: "Bud_Dismount.glb",
  meleeAttackDownward: "Standing_Melee_Attack_Downward.glb",
  meleeAttackHorizontal: "Melee_Attack_Standing_Horizontal.glb",
  meleeAttack360: "Melee_Attack_Standing_360.glb",
  meleeComboV2: "Standing_Melee_Combo_Attack_Ver__2.glb",
  talking1: "Talking1.glb",
  talking2: "Talking2.glb",
  talking3: "Talking3.glb",
};

