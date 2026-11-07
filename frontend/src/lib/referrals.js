// Coach referrals (CHW-350): the link a coach shares. It goes to fitpal.ma's home, whose site.js
// carries the ref on to the sign-up; the server checks it (App\Coaching\Referrals).
export const referralLink = handle => 'https://fitpal.ma/?ref=' + encodeURIComponent(handle)
