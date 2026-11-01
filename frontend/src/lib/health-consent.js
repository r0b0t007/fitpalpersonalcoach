// A coached client's consent to their coach seeing the health data they log (CHW-360; GDPR
// Art. 9(2)(a); backend App\Coaching\HealthConsent): check-ins, body weight, measurements, meals,
// progress photos. The app asks before the first entry (sheets.jsx withHealthConsent); without it
// those features record nothing. Withdrawing deletes the data, here and on the server.

/** The state keys that hold it, as the server's HealthConsent::KEYS. */
export const HEALTH_KEYS = ['bodyweight', 'measurements', 'checkins', 'meals', 'mealDays']

/** The weigh-in a workout carries, as the server's HealthConsent::WORKOUT_KEYS. */
export const WORKOUT_WEIGHT_KEYS = ['bw', 'bwUnit', 'bodyweight', 'bodyweightUnit']

/** Whether the app must ask before health data is logged: a coach's client who has not agreed. */
export const mustAsk = c => !!c && c.required === true && !c.consentAt

/** Withdrawal's local half: the device's copy of the data goes too (a mutator for update()). */
export function emptyHealth(s) {
  for (const k of HEALTH_KEYS) s[k] = k === 'mealDays' ? {} : []
  for (const w of [...(Array.isArray(s.workouts) ? s.workouts : []), s.active]) {
    if (w && typeof w === 'object') for (const k of WORKOUT_WEIGHT_KEYS) delete w[k]
  }
}
