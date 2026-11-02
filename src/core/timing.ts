/** Ор на приглашении не должен поднимать порог, поэтому комната снимается до него. */
export const HUSH_MS = 400
export const INVITE_MS = 2_000
export const LISTEN_MS = 8_000
export const ROUND_MS = HUSH_MS + INVITE_MS + LISTEN_MS

/** Поверх голоса быка очко меньше: попасть нужно в его вдох. */
export const VOICE_WEIGHT = 0.35

/** Запас над порогом, пока динамик сам мычит: тихий засвет микрофона не становится криком. */
export const VOICE_GATE_DB = 8

export const TARGET_INHALE_MS = 4_800
