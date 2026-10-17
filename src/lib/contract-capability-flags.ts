// SPDX-License-Identifier: MIT
/**
 * Granular contract capability pause bitflags (#1358).
 *
 * Allows surgical pausing of individual contract subsystems (`PAUSE_PAYMENTS`,
 * `PAUSE_ESCROWS`, `PAUSE_STREAMS`, `PAUSE_GOVERNANCE`) without halting
 * unrelated operations globally.
 */

export const PAUSE_PAYMENTS = 1;
export const PAUSE_ESCROWS = 2;
export const PAUSE_STREAMS = 4;
export const PAUSE_GOVERNANCE = 8;

export const ALL_SUBSYSTEM_FLAGS =
  PAUSE_PAYMENTS | PAUSE_ESCROWS | PAUSE_STREAMS | PAUSE_GOVERNANCE;

export type SubsystemName = "payments" | "escrows" | "streams" | "governance";

export const SUBSYSTEM_FLAG_MAP: Record<SubsystemName, number> = {
  payments: PAUSE_PAYMENTS,
  escrows: PAUSE_ESCROWS,
  streams: PAUSE_STREAMS,
  governance: PAUSE_GOVERNANCE,
};

/**
 * Sets or clears a subsystem bitflag in the 32-bit pause flags mask.
 */
export function setSubsystemPause(
  currentMask: number,
  subsystemFlag: number,
  paused: boolean
): number {
  const validFlag = subsystemFlag & ALL_SUBSYSTEM_FLAGS;
  if (validFlag === 0 || validFlag !== subsystemFlag) {
    throw new Error(`Invalid subsystem capability flag: ${subsystemFlag}`);
  }
  return paused ? (currentMask | validFlag) >>> 0 : (currentMask & ~validFlag) >>> 0;
}

/**
 * Returns true if the specified subsystem bitflag is currently paused.
 */
export function isSubsystemPaused(
  currentMask: number,
  subsystemFlag: number
): boolean {
  return (currentMask & subsystemFlag) !== 0;
}

/**
 * Throws if the requested subsystem is paused in `currentMask`.
 */
export function requireSubsystemActive(
  currentMask: number,
  subsystemFlag: number
): void {
  if (isSubsystemPaused(currentMask, subsystemFlag)) {
    throw new Error("ContractPaused: requested subsystem is currently paused");
  }
}

/**
 * Clears all subsystem pause flags (emergency unpause).
 */
export function clearAllSubsystemPauses(): number {
  return 0;
}

/**
 * Decodes a 32-bit pause bitmask into the list of currently paused subsystem names.
 */
export function decodePausedSubsystems(mask: number): SubsystemName[] {
  const paused: SubsystemName[] = [];
  for (const [name, flag] of Object.entries(SUBSYSTEM_FLAG_MAP) as Array<
    [SubsystemName, number]
  >) {
    if ((mask & flag) !== 0) {
      paused.push(name);
    }
  }
  return paused;
}
