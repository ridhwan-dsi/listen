/* Public config. Nothing here is a secret.
   - googleClientId: shared with Hifz/Habits (same origin ridhwan-dsi.github.io, same Google project).
   - apiKey: Google API key restricted to https://ridhwan-dsi.github.io/* and the Drive API only.
     It reads folders shared "Anyone with the link" without sign-in. Empty = only signed-in playback. */
window.APP_CONFIG = {
  appName: 'Lectures',
  appVersion: 'v3 · 18 Nov 2026',      // bump with sw.js SHELL every release
  googleClientId: '821072899008-ca195enamr9si60pr3s3ruu6q4qa98u1.apps.googleusercontent.com',
  apiKey: 'AIzaSyB76FBeFynQZYx-OfqcsFiwDEfPin39lWw',
  scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.appdata openid email',   // full Drive: uploads from the phone, trash a finished folder
  driveFile: 'lectures.json'
};
