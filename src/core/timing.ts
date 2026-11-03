/** Ор на приглашении не должен поднимать порог, поэтому комната снимается до него. */
export const HUSH_MS = 400
export const INVITE_MS = 2_000
export const COUNT_AT_MS = [HUSH_MS, HUSH_MS + INVITE_MS / 3, HUSH_MS + INVITE_MS * 2 / 3, HUSH_MS + INVITE_MS] as const
export const LISTEN_MS = 8_000
export const ROUND_MS = HUSH_MS + INVITE_MS + LISTEN_MS

/** Край шкалы для досрочного нокаута. */
export const KO_PULL_MS = 3_600
export const INHALE_PLAYER = 1.35
export const INHALE_BULL = 0.12
export const VOICE_PLAYER = 0.72
export const VOICE_BULL = 1

/** Запас над порогом, пока динамик сам мычит: тихий засвет микрофона не становится криком. */
export const VOICE_GATE_DB = 8

export const TARGET_INHALE_MS = 4_800
